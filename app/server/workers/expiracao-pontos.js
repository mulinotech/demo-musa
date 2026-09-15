'use strict';
/** Expiração de pontos — T5.4.
 *
 *  IDEMPOTÊNCIA PELO ID DO ACÚMULO, não pela data.
 *
 *  A tentação é gravar "expirei hoje" numa configuração e pular se já rodou.
 *  Isso quebra de duas formas: o dia vira meia-noite no meio da execução, e
 *  qualquer acúmulo que vença depois nunca é pego. Aqui cada acúmulo vencido
 *  gera uma transação de EXPIRAÇÃO com `source='WORKER'` e
 *  `source_id = <id do acúmulo>`. O índice único `(source, source_id, type)` faz
 *  a segunda tentativa esbarrar no banco.
 *
 *  Consequência prática: rodar dez vezes no mesmo dia expira uma vez só, e
 *  rodar depois de três dias parado pega o que ficou atrás.
 *
 *  Como o resto dos workers deste sistema, o relógio interno não é a única
 *  porta — `POST /api/loyalty/expire` faz a mesma passada, para um cron do
 *  sistema chamar (ver OPERACOES.md §9.2).
 *
 *  ======================================== UMA PASSADA, CINQUENTA CLINICAS (M2.3)
 *
 *  Duas camadas, como o worker de lembrete:
 *
 *  - `umaClinica(db, op)` — o trabalho de UMA clínica, recebendo o escopo dela.
 *    Não sabe que existem outras, e por isso é testável sem banco.
 *  - `rodarUmaVez(op)` — o laço sobre as clínicas ativas, **capturando o erro
 *    por clínica**: uma que estoure entra no relatório e a próxima continua.
 *
 *  Sem a separação, a fila de acúmulos de uma paciente poderia ser misturada
 *  com a de outra clínica — e o consumo de uma apagaria o ponto da outra, que é
 *  exatamente o defeito que o agrupamento por cliente já existia para impedir,
 *  agora um nível acima.
 *
 *  ======================== POR QUE EXPIRA MESMO COM O PROGRAMA DESLIGADO
 *
 *  Diferente do lembrete, a expiração **não** consulta se o programa está
 *  ligado. A validade foi gravada em `expires_at` no instante em que o ponto foi
 *  creditado — ou seja, já foi dita à paciente. Desligar o programa depois não
 *  estende o que já estava prometido, e deixar de expirar criaria passivo
 *  invisível: pontos que a clínica acha que venceram e o sistema ainda aceita.
 *
 *  Clínica **suspensa ou encerrada** fica fora do laço: ali ninguém está
 *  atendendo, e mexer no extrato de quem não pode nem entrar no sistema seria
 *  mudar o saldo de uma paciente sem ninguém para explicar a mudança.
 */

const fid = require('../services/fidelidade');
const escopo = require('../db/escopo');

const MOTIVO_VARREDURA =
  'a varredura de expiracao de pontos percorre todas as clinicas ativas por ' +
  'definicao: e o cron que a chama, sem sessao, e cada clinica e tratada no escopo dela';

const INTERVALO_MS = 6 * 60 * 60 * 1000;   // 4x por dia; expiracao nao tem pressa

function novoId(p) {
  return p + '_' + Math.random().toString(36).slice(2, 10);
}

/**
 * Uma passada. Percorre cliente por cliente porque a fila de acúmulos é por
 * cliente — misturar os extratos faria o consumo de uma paciente apagar o ponto
 * de outra.
 */
async function umaClinica(db, op) {
  op = op || {};
  const hoje = fid.hojeISO(op.hoje);

  const [linhas] = await db.q(`
    SELECT t.id, t.client_id, t.type, t.points, t.expired, t.description,
           DATE_FORMAT(t.expires_at, '%Y-%m-%d') AS expires_at,
           DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
           c.name AS client_name
      FROM loyalty_transactions t
      JOIN clients c ON c.id = t.client_id AND c.clinica_id = :clinica
     WHERE t.clinica_id = :clinica
     ORDER BY t.client_id, t.created_at
  `);

  const porCliente = new Map();
  for (const l of linhas) {
    if (!porCliente.has(l.client_id)) porCliente.set(l.client_id, { nome: l.client_name, tx: [] });
    porCliente.get(l.client_id).tx.push(l);
  }

  let expirados = 0, pontos = 0, jaExistiam = 0;
  const detalhe = [];

  for (const [clientId, dados] of porCliente) {
    const alvos = fid.paraExpirar(dados.tx, hoje);
    for (const a of alvos) {
      try {
        // CARIMBA A CLINICA. Era esta gravacao a ultima pendencia do portao da
        // M1.7: sem a coluna, ela falharia no dia em que `clinica_id` voltasse a
        // ser obrigatoria -- e falharia calada, porque o laco engole o erro de
        // uma clinica para nao parar as outras.
        await db.q(
          `INSERT INTO loyalty_transactions
            (id, client_id, type, points, description, source, source_id, clinica_id)
           VALUES (?,?, 'EXPIRACAO', ?, ?, 'WORKER', ?, :clinica)`,
          [novoId('lt'), clientId, -a.pontos,
           'Pontos expirados em ' + a.expirouEm, a.acumuloId]
        );
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') { jaExistiam += 1; continue; }
        throw e;
      }
      // A marca no acumulo e conveniencia de consulta; a verdade e a transacao.
      await db.q('UPDATE loyalty_transactions SET expired = 1' +
                 ' WHERE clinica_id = :clinica AND id = ?', [a.acumuloId]);
      expirados += 1;
      pontos += a.pontos;
      if (detalhe.length < 20) {
        detalhe.push({ paciente: dados.nome, pontos: a.pontos, venceuEm: a.expirouEm });
      }
    }
  }

  return { hoje: hoje, expirados: expirados, pontos: pontos, jaExistiam: jaExistiam, detalhe: detalhe };
}

/** Uma passada em TODAS as clínicas ativas.
 *
 *  O erro de uma **não interrompe as outras**: entra no relatório com o motivo
 *  e a varredura continua. Uma clínica com dado estranho não pode fazer as 49
 *  restantes deixarem de expirar ponto — e esse é o tipo de parada que ninguém
 *  nota, porque saldo que devia cair e não caiu não gera reclamação de ninguém.
 */
async function rodarUmaVez(op) {
  op = op || {};
  const cru = escopo.todasAsClinicas(MOTIVO_VARREDURA);
  const [clinicas] = await cru.q(
    "SELECT id, nome FROM clinicas WHERE status = 'ativa' ORDER BY id");

  const porClinica = [];
  let expirados = 0, pontos = 0, jaExistiam = 0, comErro = 0;

  for (const c of clinicas) {
    try {
      const db = escopo.paraClinica(c.id, { autor: 'Sistema' });
      const r = await umaClinica(db, op);
      expirados += r.expirados;
      pontos += r.pontos;
      jaExistiam += r.jaExistiam;
      porClinica.push(Object.assign({ clinica: c.id, nome: c.nome }, r));
    } catch (e) {
      comErro += 1;
      console.error('[pontos] clinica ' + c.id + ' falhou:', e.message);
      porClinica.push({ clinica: c.id, nome: c.nome, erro: e.message,
                        expirados: 0, pontos: 0, jaExistiam: 0, detalhe: [] });
    }
  }

  return {
    hoje: fid.hojeISO(op.hoje), clinicas: clinicas.length, comErro: comErro,
    expirados: expirados, pontos: pontos, jaExistiam: jaExistiam,
    porClinica: porClinica
  };
}

function iniciar() {
  const passada = async function () {
    try {
      const r = await rodarUmaVez();
      if (r.expirados || r.comErro) {
        console.log('[pontos] ' + r.clinicas + ' clinica(s); ' + r.expirados +
                    ' acumulo(s) expirado(s), ' + r.pontos + ' ponto(s)' +
                    (r.comErro ? '; ' + r.comErro + ' clinica(s) com erro' : ''));
      }
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') console.error('[pontos] falha na passada:', e.message);
    }
  };
  setTimeout(passada, 45000);
  return setInterval(passada, INTERVALO_MS);
}

module.exports = {
  rodarUmaVez: rodarUmaVez,
  umaClinica: umaClinica,
  iniciar: iniciar,
  INTERVALO_MS: INTERVALO_MS
};

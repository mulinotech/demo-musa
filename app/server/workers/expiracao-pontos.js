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
 */

const fid = require('../services/fidelidade');

const INTERVALO_MS = 6 * 60 * 60 * 1000;   // 4x por dia; expiracao nao tem pressa

function novoId(p) {
  return p + '_' + Math.random().toString(36).slice(2, 10);
}

/**
 * Uma passada. Percorre cliente por cliente porque a fila de acúmulos é por
 * cliente — misturar os extratos faria o consumo de uma paciente apagar o ponto
 * de outra.
 */
async function rodarUmaVez(pool, op) {
  op = op || {};
  const hoje = fid.hojeISO(op.hoje);

  const [linhas] = await pool.query(`
    SELECT t.id, t.client_id, t.type, t.points, t.expired, t.description,
           DATE_FORMAT(t.expires_at, '%Y-%m-%d') AS expires_at,
           DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
           c.name AS client_name
      FROM loyalty_transactions t
      JOIN clients c ON c.id = t.client_id
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
        await pool.query(
          `INSERT INTO loyalty_transactions
            (id, client_id, type, points, description, source, source_id)
           VALUES (?,?, 'EXPIRACAO', ?, ?, 'WORKER', ?)`,
          [novoId('lt'), clientId, -a.pontos,
           'Pontos expirados em ' + a.expirouEm, a.acumuloId]
        );
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') { jaExistiam += 1; continue; }
        throw e;
      }
      // A marca no acumulo e conveniencia de consulta; a verdade e a transacao.
      await pool.query('UPDATE loyalty_transactions SET expired = 1 WHERE id = ?', [a.acumuloId]);
      expirados += 1;
      pontos += a.pontos;
      if (detalhe.length < 20) {
        detalhe.push({ paciente: dados.nome, pontos: a.pontos, venceuEm: a.expirouEm });
      }
    }
  }

  return { hoje: hoje, expirados: expirados, pontos: pontos, jaExistiam: jaExistiam, detalhe: detalhe };
}

function iniciar(pool) {
  const passada = async function () {
    try {
      const r = await rodarUmaVez(pool);
      if (r.expirados) console.log('[pontos] ' + r.expirados + ' acumulo(s) expirado(s), ' + r.pontos + ' ponto(s)');
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') console.error('[pontos] falha na passada:', e.message);
    }
  };
  setTimeout(passada, 45000);
  return setInterval(passada, INTERVALO_MS);
}

module.exports = { rodarUmaVez: rodarUmaVez, iniciar: iniciar, INTERVALO_MS: INTERVALO_MS };

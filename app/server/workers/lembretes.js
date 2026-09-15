'use strict';
/** Worker de lembrete — T1.5, o lado que toca o mundo.
 *
 *  A regra mora em `services/lembretes.js`, pura. Aqui só existe o que precisa
 *  de banco e de rede.
 *
 *  ENVIAR PRIMEIRO, MARCAR DEPOIS. Se marcasse antes e o envio falhasse, a
 *  paciente nunca receberia e o sistema juraria que enviou. Do jeito que está,
 *  uma queda entre o envio e o UPDATE faz o lembrete sair duas vezes na
 *  próxima passada — chato, e muito menos grave do que um horário perdido.
 *  O UPDATE é condicionado a `reminder_sent_at IS NULL`, então duas execuções
 *  simultâneas não se atropelam.
 *
 *  DESLIGADO POR PADRÃO, e isso não é excesso de zelo. Este banco é de
 *  demonstração e tem telefones de gente de verdade cadastrados. Um worker que
 *  já sobe ligado manda mensagem para essas pessoas na primeira vez que alguém
 *  abre o sistema. A chave `lembretes_ativos` nasce em '0'; a prévia mostra o
 *  que sairia, sem enviar nada.
 *
 *  ======================================== UMA PASSADA, CINQUENTA CLINICAS
 *
 *  Desde a M2.1b o worker tem **duas camadas**, e a separação é o que faz uma
 *  clínica com configuração ruim não calar o lembrete das outras 49:
 *
 *  - `umaClinica(db, cfg, op)` — o trabalho de UMA clínica, recebendo o escopo
 *    dela. Não sabe que existem outras, e por isso é testável sem banco.
 *  - `rodarUmaVez(op)` — o laço. Percorre as clínicas ativas **que têm
 *    instância de WhatsApp**, monta o escopo de cada uma, e **captura o erro por
 *    clínica**: uma que estoure entra no relatório com o motivo, e a próxima
 *    continua. Sem isso, a primeira clínica com problema interromperia a
 *    varredura e as depois dela ficariam sem lembrete — em silêncio, porque
 *    ninguém compara a lista de quem recebeu com a lista de quem devia.
 *
 *  **Clínica sem instância não entra no laço.** Não há por onde mandar, e usar a
 *  instância de outra faria a paciente receber do número do consultório errado
 *  — e responder para a clínica errada. Envio não tem desfazer.
 *
 *  O RELÓGIO NÃO PODE SER SÓ ESTE PROCESSO. O LiteSpeed recicla a aplicação
 *  quando ninguém acessa, e um `setInterval` morre junto. Por isso existe
 *  também `POST /api/appointments/reminders/run`: um cron do sistema (ou o
 *  botão da tela) faz a mesma passada. As duas portas chamam esta função, e
 *  ela é idempotente — rodar de novo não repete mensagem.
 */

const servico = require('../services/lembretes');
const escopo = require('../db/escopo');
const cfgSvc = require('../services/clinica-config');

const INTERVALO_MS = 15 * 60 * 1000;

const MOTIVO_VARREDURA =
  'uma passada de lembrete percorre todas as clinicas ativas por definicao: ' +
  'e o cron que a chama, sem sessao, e cada clinica e tratada no escopo dela';

/** Só compromissos que ainda podem receber. O recorte grosso é do SQL; a
 *  decisão fina é da função pura, para poder ser testada. */
const SELECT_CANDIDATOS = `
  SELECT a.id, a.title, a.status, a.kind, a.client_id, a.professional_id,
         DATE_FORMAT(a.starts_at, '%Y-%m-%d %H:%i:%s') AS starts_at,
         DATE_FORMAT(a.reminder_sent_at, '%Y-%m-%d %H:%i:%s') AS reminder_sent_at,
         c.name AS client_name, c.phone AS phone, u.name AS professional_name
    FROM appointments a
    LEFT JOIN clients c ON c.id = a.client_id AND c.clinica_id = :clinica
    LEFT JOIN users u ON u.id = a.professional_id AND u.clinica_id = :clinica
   WHERE a.clinica_id = :clinica
     AND a.kind = 'ATENDIMENTO'
     AND a.status IN ('AGENDADO','CONFIRMADO')
     AND a.reminder_sent_at IS NULL
     AND a.starts_at > NOW()
     AND a.starts_at < DATE_ADD(NOW(), INTERVAL 3 DAY)
   ORDER BY a.starts_at
`;

/** O trabalho de UMA clínica. `db` é o escopo dela.
 *
 * @param db          escopo da clínica (de `escopo.paraClinica` ou `escopo(req)`)
 * @param cfg         configuração já lida (de `clinica-config.lerLembrete`)
 * @param op.agora    instante de referência; default, agora
 * @param op.enviar   função (telefone, texto, instancia) -> Promise; injetada
 *                    para o teste nunca disparar WhatsApp de verdade
 * @param op.simular  true = decide tudo e não envia (é a prévia da tela)
 */
async function umaClinica(db, cfg, op) {
  op = op || {};
  const agora = op.agora || new Date();
  const simular = !!op.simular;

  if (!cfg.ativo && !simular) {
    return {
      ativo: false, enviados: 0, falhas: 0, avaliados: 0, itens: [],
      aviso: cfg.instancia
        ? 'lembretes desligados na configuracao desta clinica'
        : 'lembretes desligados: esta clinica nao tem instancia de WhatsApp'
    };
  }

  const [candidatos] = await db.q(SELECT_CANDIDATOS);
  const itens = [];
  let enviados = 0, falhas = 0;

  for (const c of candidatos) {
    const d = servico.deveEnviar(c, agora, { antecedenciaH: cfg.antecedenciaH });
    const linha = {
      id: c.id, titulo: c.title, paciente: c.client_name, telefone: c.phone,
      quando: c.starts_at, momentoDeEnvio: d.momento || null,
      enviar: !!d.enviar, motivo: d.motivo || null, atrasadoMin: d.atrasadoMin || 0
    };

    if (!d.enviar) { itens.push(linha); continue; }

    linha.mensagem = servico.montarMensagem(cfg.template, c);

    if (simular) { linha.simulado = true; itens.push(linha); continue; }

    try {
      // A INSTANCIA VAI JUNTO. Sem ela, `sendWhatsappText` resolve uma
      // globalmente -- e a mensagem sai do numero do consultorio errado.
      await op.enviar(c.phone, linha.mensagem, cfg.instancia);
      // Só agora o compromisso é marcado — e só se ainda estiver sem marca.
      await db.q(
        'UPDATE appointments SET reminder_sent_at = NOW()' +
        ' WHERE clinica_id = :clinica AND id = ? AND reminder_sent_at IS NULL',
        [c.id]
      );
      linha.enviado = true;
      enviados += 1;
    } catch (e) {
      linha.enviado = false;
      linha.erro = e.message;
      falhas += 1;
    }
    itens.push(linha);
  }

  return { ativo: cfg.ativo, simulado: simular, avaliados: candidatos.length,
           enviados: enviados, falhas: falhas, itens: itens };
}

/** Uma passada em TODAS as clínicas ativas que tenham instância.
 *
 *  O erro de uma clínica **não interrompe as outras**: entra no relatório com o
 *  motivo e a varredura continua. É a diferença entre "a clínica X está com
 *  problema" e "os lembretes pararam" — e a segunda leva dias para ser notada,
 *  porque ninguém compara a lista de quem recebeu com a de quem devia receber.
 *
 * @param op.enviar   função (telefone, texto, instancia) -> Promise
 * @param op.agora    instante de referência
 */
async function rodarUmaVez(op) {
  op = op || {};
  const cru = escopo.todasAsClinicas(MOTIVO_VARREDURA);
  const [clinicas] = await cru.q(
    "SELECT id, nome, evolution_instance FROM clinicas" +
    " WHERE status = 'ativa' AND evolution_instance IS NOT NULL ORDER BY id");

  const porClinica = [];
  let enviados = 0, falhas = 0, avaliados = 0, comErro = 0;

  for (const c of clinicas) {
    try {
      const db = escopo.paraClinica(c.id, { autor: 'Sistema' });
      const cfg = await cfgSvc.lerLembrete(db);
      const r = await umaClinica(db, cfg, op);
      enviados += r.enviados;
      falhas += r.falhas;
      avaliados += r.avaliados;
      porClinica.push(Object.assign({ clinica: c.id, nome: c.nome }, r));
    } catch (e) {
      comErro += 1;
      console.error('[lembretes] clinica ' + c.id + ' falhou:', e.message);
      porClinica.push({ clinica: c.id, nome: c.nome, erro: e.message,
                        enviados: 0, falhas: 0, avaliados: 0, itens: [] });
    }
  }

  return {
    clinicas: clinicas.length, comErro: comErro,
    avaliados: avaliados, enviados: enviados, falhas: falhas,
    porClinica: porClinica
  };
}

/** Relógio interno. Vale enquanto o processo estiver de pé; não substitui o
 *  disparo externo. `unref` fica de fora de propósito: o processo do servidor
 *  não deve sair, e no teste este módulo nunca é iniciado. */
function iniciar(enviar) {
  const passada = async function () {
    try {
      const r = await rodarUmaVez({ enviar: enviar });
      if (r.enviados || r.falhas || r.comErro) {
        console.log('[lembretes] ' + r.clinicas + ' clinica(s); enviados: ' + r.enviados +
                    ', falhas: ' + r.falhas + ', clinicas com erro: ' + r.comErro);
      }
    } catch (e) {
      console.error('[lembretes] falha na passada:', e.message);
    }
  };
  setTimeout(passada, 30000);           // uma logo apos o boot, sem atrapalhar a subida
  return setInterval(passada, INTERVALO_MS);
}

module.exports = {
  rodarUmaVez: rodarUmaVez,
  umaClinica: umaClinica,
  iniciar: iniciar,
  INTERVALO_MS: INTERVALO_MS,
  SELECT_CANDIDATOS: SELECT_CANDIDATOS
};

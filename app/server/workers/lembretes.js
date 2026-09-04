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
 *  O RELÓGIO NÃO PODE SER SÓ ESTE PROCESSO. O LiteSpeed recicla a aplicação
 *  quando ninguém acessa, e um `setInterval` morre junto. Por isso existe
 *  também `POST /api/appointments/reminders/run`: um cron do sistema (ou o
 *  botão da tela) faz a mesma passada. As duas portas chamam esta função, e
 *  ela é idempotente — rodar de novo não repete mensagem.
 */

const servico = require('../services/lembretes');

const INTERVALO_MS = 15 * 60 * 1000;

/** Só compromissos que ainda podem receber. O recorte grosso é do SQL; a
 *  decisão fina é da função pura, para poder ser testada. */
const SELECT_CANDIDATOS = `
  SELECT a.id, a.title, a.status, a.kind, a.client_id, a.professional_id,
         DATE_FORMAT(a.starts_at, '%Y-%m-%d %H:%i:%s') AS starts_at,
         DATE_FORMAT(a.reminder_sent_at, '%Y-%m-%d %H:%i:%s') AS reminder_sent_at,
         c.name AS client_name, c.phone AS phone, u.name AS professional_name
    FROM appointments a
    LEFT JOIN clients c ON c.id = a.client_id
    LEFT JOIN users u ON u.id = a.professional_id
   WHERE a.kind = 'ATENDIMENTO'
     AND a.status IN ('AGENDADO','CONFIRMADO')
     AND a.reminder_sent_at IS NULL
     AND a.starts_at > NOW()
     AND a.starts_at < DATE_ADD(NOW(), INTERVAL 3 DAY)
   ORDER BY a.starts_at
`;

async function lerConfig(pool) {
  let r = [];
  try {
    [r] = await pool.query("SELECT chave, valor FROM system_settings WHERE chave LIKE 'lembrete%'");
  } catch (e) {
    // Tabela ainda nao existe (migration 013 nao rodou). O padrao seguro e
    // DESLIGADO -- nunca "ligado porque nao consegui ler a configuracao".
    if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
  }
  const m = {};
  for (const l of r) m[l.chave] = l.valor;
  return {
    ativo: m.lembretes_ativos === '1',
    template: m.lembrete_template || servico.TEMPLATE_PADRAO,
    antecedenciaH: Number(m.lembrete_antecedencia_h) || servico.ANTECEDENCIA_H
  };
}

/**
 * Uma passada. Devolve o que fez e o que deixou de fazer, com motivo.
 *
 * @param pool        conexão (ou objeto com .query, nos testes)
 * @param op.agora    instante de referência; default, agora
 * @param op.enviar   função (telefone, texto) -> Promise; injetada para o
 *                    teste nunca disparar WhatsApp de verdade
 * @param op.simular  true = decide tudo e não envia (é a prévia da tela)
 */
async function rodarUmaVez(pool, op) {
  op = op || {};
  const agora = op.agora || new Date();
  const cfg = op.config || (await lerConfig(pool));
  const simular = !!op.simular;

  if (!cfg.ativo && !simular) {
    return { ativo: false, enviados: 0, falhas: 0, avaliados: 0, itens: [],
             aviso: 'lembretes desligados (system_settings.lembretes_ativos)' };
  }

  const [candidatos] = await pool.query(SELECT_CANDIDATOS);
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
      await op.enviar(c.phone, linha.mensagem);
      // Só agora o compromisso é marcado — e só se ainda estiver sem marca.
      await pool.query(
        'UPDATE appointments SET reminder_sent_at = NOW() WHERE id = ? AND reminder_sent_at IS NULL',
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

/** Relógio interno. Vale enquanto o processo estiver de pé; não substitui o
 *  disparo externo. `unref` fica de fora de propósito: o processo do servidor
 *  não deve sair, e no teste este módulo nunca é iniciado. */
function iniciar(pool, enviar) {
  const passada = async function () {
    try {
      const r = await rodarUmaVez(pool, { enviar: enviar });
      if (r.enviados || r.falhas) {
        console.log('[lembretes] enviados: ' + r.enviados + ', falhas: ' + r.falhas);
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
  lerConfig: lerConfig,
  iniciar: iniciar,
  INTERVALO_MS: INTERVALO_MS,
  SELECT_CANDIDATOS: SELECT_CANDIDATOS
};

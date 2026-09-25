'use strict';
/** O WEBHOOK DO WHATSAPP — a única entrada de dado que vem de fora, sem sessão.
 *
 *  ================================== O QUE A M2.1 RESOLVEU (e era o problema)
 *
 *  Até aqui, a mensagem que chegava trazia **um telefone e um texto**, e nada
 *  mais. Para saber de qual clínica ela era, só havia o telefone — e telefone
 *  repetido entre clínicas é caso real, não hipótese: a mesma pessoa pode ser
 *  paciente de dois consultórios. Nenhum filtro de banco resolvia isso: a
 *  informação que faltava nunca chegava.
 *
 *  **A informação sempre esteve no envelope, e não na carta.** A Evolution
 *  manda, em cada disparo, o nome da INSTÂNCIA que recebeu a mensagem
 *  (`payload.instance`). Com a migration 024 ligando cada instância a uma
 *  clínica — e com o banco recusando duas clínicas na mesma instância —, a
 *  mensagem que chega passa a ter dono, e este arquivo passa a usar a camada
 *  como qualquer outro do sistema.
 *
 *  ============================ E QUANDO A INSTANCIA NAO E DE CLINICA NENHUMA
 *
 *  Aí não há resposta certa, e escolher uma clínica seria inventá-la. Mas
 *  **descartar a mensagem também não é aceitável**: ela não fica em fila, não
 *  volta, e a pessoa do outro lado fica sem resposta achando que a clínica a
 *  ignorou.
 *
 *  A saída é registrar o que se sabe, onde se pode: um registro **da
 *  instalação** com o nome da instância, o telefone e o **texto inteiro da
 *  mensagem**. Nada se perde — só deixa de ser arquivado na ficha de alguém,
 *  porque não se sabe de quem. E aparece para quem cuida da plataforma como o
 *  que é: uma instância recebendo mensagem sem estar vinculada a clínica
 *  nenhuma, que se resolve escolhendo a clínica na tela.
 *
 *  A resposta ao WhatsApp continua sendo 200: erro faria a Evolution reenviar
 *  a mesma mensagem indefinidamente, e o problema não é de entrega.
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');
const { sendWhatsappText } = require('../services/evolution');
const lembretes = require('../services/lembretes');
const logs = require('../services/logs');
const jid = require('../services/whatsapp-jid');

const MOTIVO_ENVELOPE =
  'o webhook chega sem sessao: a clinica sai da INSTANCIA que recebeu a mensagem, ' +
  'e descobrir qual e exige olhar as clinicas uma vez';

/** A clínica dona da instância que recebeu a mensagem, ou `null`.
 *
 *  Esta é a única travessia deste arquivo, e ela é estreita de propósito: lê
 *  uma linha de `clinicas` por um valor que veio de fora, e não toca em dado de
 *  clínica nenhuma. Tudo o que vem depois é escopado. */
async function clinicaDaInstancia(instancia) {
  if (!instancia) return null;
  const cru = escopo.todasAsClinicas(MOTIVO_ENVELOPE);
  const [r] = await cru.q(
    "SELECT id FROM clinicas WHERE evolution_instance = ? AND status = 'ativa'", [instancia]);
  return r.length ? r[0].id : null;
}

/** Resposta a um lembrete de compromisso (T1.5).
 *
 *  O compromisso alvo é o próximo desta paciente nas próximas 48 h que já
 *  recebeu lembrete. A janela existe para não confirmar o horário errado de
 *  quem tem três sessões marcadas no mês — e "já recebeu lembrete" é o que
 *  garante que a resposta é resposta, e não uma mensagem solta.
 *
 *  "2" NÃO REMARCA NADA. Registra o pedido e sinaliza na agenda; remarcar
 *  sozinho, sem saber para quando, trocaria um horário incerto por outro
 *  inventado. Quem remarca é gente, olhando os horários livres.
 *
 *  Desde a M2.1 recebe o escopo da clínica. Era exatamente aqui que o telefone
 *  repetido entre clínicas confirmaria o compromisso da paciente errada — e o
 *  sintoma seria a agenda de um consultório mudando sozinha. */
async function responderLembrete(db, phone, texto) {
  const intencao = lembretes.interpretarResposta(texto);

  const digitos = String(phone || '').replace(/\D/g, '');
  if (!digitos) return null;

  try {
    const [r] = await db.q(`
      SELECT a.id, a.title, a.status,
             DATE_FORMAT(a.starts_at, '%Y-%m-%d %H:%i:%s') AS starts_at,
             c.name AS client_name
        FROM appointments a
        JOIN clients c ON c.id = a.client_id AND c.clinica_id = :clinica
       WHERE a.clinica_id = :clinica
         AND REPLACE(REPLACE(REPLACE(REPLACE(c.phone,'+',''),'-',''),' ',''),'(','') LIKE ?
         AND a.kind = 'ATENDIMENTO'
         AND a.status IN ('AGENDADO','CONFIRMADO')
         AND a.reminder_sent_at IS NOT NULL
         AND a.reminder_reply_at IS NULL
         AND a.starts_at > NOW()
         AND a.starts_at < DATE_ADD(NOW(), INTERVAL 48 HOUR)
       ORDER BY a.starts_at
       LIMIT 1
    `, ['%' + digitos.slice(-8)]);

    if (!r.length) return null;
    const c = r[0];

    /* ============================ QUALQUER TEXTO PARA A RÉGUA (M6.7)
     *
     * Antes desta linha a função saía logo no começo quando a resposta não era
     * exatamente "1" ou "2". Com um lembrete só isso não tinha consequência: a
     * mensagem já estava gravada e uma pessoa leria.
     *
     * Com a régua de três disparos tem, e é grave: "posso chegar 10 minutos
     * depois?" não é "1" nem "2", então a paciente seguiria como quem não
     * respondeu — receberia a cobrança e, quatro horas depois, o cancelamento
     * do horário que ela acabou de tratar de manter. O sistema teria por
     * escrito que ela não deu notícia, com a notícia dela no banco, dois campos
     * ao lado.
     *
     * `reminder_reply_at` é carimbado ANTES de qualquer interpretação: o que
     * para a régua é a paciente ter falado, não ela ter falado a palavra certa.
     * Texto que o sistema não entende continua sendo trabalho de gente — só que
     * agora o horário fica de pé esperando essa pessoa. */
    await db.q(
      'UPDATE appointments SET reminder_reply_at = NOW()' +
      ' WHERE clinica_id = :clinica AND id = ? AND reminder_reply_at IS NULL',
      [c.id]);

    if (!intencao) {
      await logs.registrar(db, 'AGENDA',
        c.client_name + ' respondeu sobre "' + c.title + '" pelo WhatsApp; ' +
        'a regua de confirmacao parou e o horario aguarda atendimento humano.');
      return { compromisso: c.id, acao: 'RESPOSTA_LIVRE' };
    }

    if (intencao === 'CONFIRMAR') {
      await db.q(
        "UPDATE appointments SET status = 'CONFIRMADO', confirmed_at = NOW()" +
        " WHERE clinica_id = :clinica AND id = ? AND status = 'AGENDADO'",
        [c.id]
      );
      await logs.registrar(db, 'AGENDA',
        c.client_name + ' confirmou "' + c.title + '" pelo WhatsApp.');
      return { compromisso: c.id, acao: 'CONFIRMADO' };
    }

    // REMARCAR: sinaliza e para por aqui.
    await db.q(
      "UPDATE appointments SET notes = CONCAT(COALESCE(notes,''), ?)" +
      " WHERE clinica_id = :clinica AND id = ?",
      ['\n[' + new Date().toISOString().slice(0, 10) + '] Paciente pediu remarcacao pelo WhatsApp.', c.id]
    );
    await logs.registrar(db, 'AGENDA',
      c.client_name + ' pediu remarcacao de "' + c.title + '" pelo WhatsApp.');
    return { compromisso: c.id, acao: 'PEDIU_REMARCACAO' };
  } catch (e) {
    // Uma falha aqui nao pode derrubar o webhook: a mensagem ja foi gravada.
    console.error('[Webhook] Falha ao tratar resposta de lembrete:', e.message);
    return null;
  }
}

router.post('/api/webhook/whatsapp', async function (req, res) {
  const payload = req.body || {};
  const messageData = payload.data || payload;
  const key = messageData.key;
  if (key && key.fromMe) {
    return res.json({ status: 'ignored' });
  }
  const senderJid = (key && key.remoteJid) || '';

  /* ================================= GRUPO NAO E PACIENTE (M5.9a, 18/09)
   *
   * Encontrado em producao, com print: o numero da clinica esta num grupo de
   * trabalho, alguem escreveu, e o CRM respondeu **"Seja muito bem-vinda!"
   * no grupo**, na frente de um cliente.
   *
   * A causa era uma linha -- `senderJid.split('@')[0]`. O WhatsApp identifica a
   * origem pelo SUFIXO do JID:
   *
   *     5511987654321@s.whatsapp.net       uma pessoa
   *     120363111222333@g.us               um grupo
   *     ...@broadcast, status@broadcast    transmissao e "status"
   *
   * Jogando o sufixo fora, o id do grupo virava "telefone". Nenhum paciente tem
   * aquele numero, entao o webhook concluia "contato novo", criava um lead
   * chamado como quem escreveu, com `whatsapp = 120363111222333`, e disparava a
   * saudacao para o grupo inteiro.
   *
   * Duas consequencias, e a segunda e a que doi: o funil enche de leads que sao
   * grupos, e **a clinica fala sozinha em publico**. A primeira e sujeira; a
   * segunda e a marca dela.
   *
   * POR QUE RECUSAR, e nao "gravar sem responder": em grupo, quem falou esta em
   * `key.participant`, nao em `remoteJid` -- gravar pelo remoteJid arquivaria a
   * fala de varias pessoas numa ficha so. E conversa de grupo nao e atendimento
   * de paciente: nao e isso que a tela de Atendimento mostra.
   *
   * A resposta continua 200 de proposito: nao e erro de entrega, e um 4xx faria
   * a Evolution reenviar a mesma mensagem para sempre. */
  const origem = jid.origemDoJid(senderJid);
  if (origem !== 'pessoa') {
    return res.json({ status: 'ignored', motivo: origem });
  }

  const phone = jid.telefoneDoJid(senderJid);
  const contactName = messageData.pushName || 'Contato WhatsApp';

  // O ENVELOPE. A Evolution manda o nome da instancia em `instance`; versoes
  // diferentes o repetem dentro de `data`, entao os dois lugares sao lidos.
  const instancia = payload.instance || messageData.instance || null;

  const messageType = messageData.messageType || 'conversation';
  let content = '';
  if (messageType === 'conversation' || messageType === 'extendedTextMessage') {
    content = (messageData.message && (messageData.message.conversation ||
      (messageData.message.extendedTextMessage && messageData.message.extendedTextMessage.text))) || '';
  } else if (messageType === 'imageMessage') {
    const caption = (messageData.message && messageData.message.imageMessage &&
                     messageData.message.imageMessage.caption) || '';
    content = caption ? '[Imagem]: ' + caption : '[Imagem Recebida]';
  } else {
    return res.json({ status: 'unsupported' });
  }

  if (!phone) return res.status(400).json({ error: 'No phone' });

  try {
    const clinicaId = await clinicaDaInstancia(instancia);

    if (!clinicaId) {
      // NADA SE PERDE, mas nada e arquivado no lugar errado. O texto inteiro vai
      // para o registro da instalacao, junto com a instancia e o telefone.
      await logs.daInstalacao(
        'mensagem recebida por instancia de WhatsApp que nao pertence a clinica nenhuma',
        'WHATSAPP_SEM_CLINICA',
        'Instancia "' + (instancia || '(nao informada)') + '" recebeu mensagem de ' +
        phone + ' (' + contactName + '): ' + content,
        'WhatsApp', req.ip);
      console.error(
        '[Webhook] instancia "' + instancia + '" nao pertence a clinica nenhuma. ' +
        'A mensagem foi registrada nos logs da instalacao, com o texto inteiro. ' +
        'Vincule a instancia a uma clinica na tela "Integracao WhatsApp".');
      return res.json({ status: 'sem-clinica', instancia: instancia });
    }

    // A partir daqui e uma clinica so, como qualquer rota do sistema. O autor e
    // a paciente: a mensagem foi ela quem mandou.
    const db = escopo.paraClinica(clinicaId, { autor: 'Paciente', ip: req.ip });

    const [clients] = await db.q(
      'SELECT id FROM clients WHERE clinica_id = :clinica AND REPLACE(phone, "+", "") = ?', [phone]);
    const [leads] = await db.q(
      'SELECT id FROM leads WHERE clinica_id = :clinica AND REPLACE(whatsapp, "+", "") = ?', [phone]);

    let targetId = '';
    if (clients.length > 0) {
      targetId = clients[0].id;
    } else if (leads.length > 0) {
      targetId = leads[0].id;
    } else {
      // Lead novo, JA CARIMBADO. Era esta gravacao que mantinha o webhook no
      // portao da M1.7: sem clinica, ela falharia no dia em que a coluna
      // voltasse a ser obrigatoria -- e falharia calada, porque o `catch` existe
      // justamente para o webhook nao derrubar a entrega.
      targetId = 'l_' + Math.random().toString(36).substring(2, 9);
      await db.q(
        'INSERT INTO leads (id, name, whatsapp, treatment, status, clinica_id)' +
        " VALUES (?, ?, ?, 'Geral', 'novo', :clinica)",
        [targetId, contactName, phone]);

      const welcome = 'Seja muito bem-vinda! ✨\n\nRecebemos sua mensagem por aqui e nossa ' +
        'equipe ja esta ciente do seu contato. Como podemos ajudar? 🌸';
      // Uma falha no envio da saudação não deve derrubar o webhook (a mensagem
      // recebida precisa ser registrada de qualquer forma).
      try {
        await sendWhatsappText(phone, welcome, instancia);
      } catch (welcomeErr) {
        console.error('[Webhook] Falha ao enviar saudacao automatica:', welcomeErr.message);
      }

      await db.q(
        'INSERT INTO interactions (id, client_id, type, content, direction, clinica_id)' +
        " VALUES (?, ?, 'whatsapp', ?, 'out', :clinica)",
        ['i_' + Math.random().toString(36).substring(2, 9), targetId, welcome]);
    }

    await db.q(
      'INSERT INTO interactions (id, client_id, type, content, direction, clinica_id)' +
      " VALUES (?, ?, 'whatsapp', ?, 'in', :clinica)",
      ['i_' + Math.random().toString(36).substring(2, 9), targetId, content]);

    // A mensagem PODE ser resposta a um lembrete. Se for exatamente "1" ou "2",
    // o compromisso reage; qualquer outro texto segue o fluxo humano normal, que
    // ja foi registrado acima.
    const agenda = await responderLembrete(db, phone, content);

    res.json({ success: true, clinica: clinicaId, agenda: agenda });
  } catch (error) {
    console.error('[Webhook]', error && error.message);
    res.status(500).json({ error: 'Falha ao registrar a mensagem recebida.' });
  }
});

module.exports = router;

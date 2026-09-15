'use strict';
/** As interações — o histórico de conversa com lead e com paciente.
 *
 *  ================================================= O QUE A M1.6 MUDOU AQUI
 *
 *  A listagem trazia a conversa de todo mundo. Mas o furo grave não era esse:
 *  era o **envio**.
 *
 *  A rota de criar interação, quando é WhatsApp de saída, procura o telefone
 *  do destinatário por `clientId` em `leads` e em `clients` — e nenhuma das
 *  duas buscas filtrava. Como os ids são únicos no banco inteiro, uma clínica
 *  com o id de um contato da outra **mandava mensagem para a paciente da
 *  vizinha**, pelo número de WhatsApp compartilhado, e a mensagem ficava
 *  gravada na conversa dela. Não é vazamento de leitura: é a clínica A falando
 *  com a paciente da clínica B em nome do consultório.
 *
 *  Agora as duas buscas filtram, e contato que não é desta clínica devolve
 *  **404 antes de qualquer envio** — a ordem importa: conferir depois de mandar
 *  não desfaz a mensagem.
 *
 *  ================================================= O QUE AINDA NAO MUDOU
 *
 *  A instância de WhatsApp continua sendo **uma só** para as 50 clínicas (vem
 *  de `EVOLUTION_API_URL`/`_INSTANCE_NAME` no `.env`). Então a mensagem sai
 *  correta em conteúdo e destinatário, mas do **número errado**: a paciente da
 *  clínica A recebe do número da instalação, não do consultório dela. Isso é a
 *  **M2.1**, e é mudança de configuração, não de consulta.
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');
const cfgSvc = require('../services/clinica-config');
const { sendWhatsappText } = require('../services/evolution');

router.get('/api/interactions', async function (req, res) {
  const db = escopo(req);
  try {
    const [rows] = await db.q(
      'SELECT id, client_id AS clientId, type, content, direction, created_at AS createdAt' +
      ' FROM interactions WHERE clinica_id = :clinica ORDER BY created_at ASC');
    res.json(rows);
  } catch (error) {
    console.error('[interacoes]', error && error.message);
    res.status(500).json({ error: 'Erro ao buscar interacoes' });
  }
});


router.post('/api/interactions', async function (req, res) {
  const db = escopo(req);
  const { clientId, type, content, direction } = req.body;
  if (!clientId || !content) {
    return res.status(400).json({ error: 'Campos obrigatorios ausentes.' });
  }
  const id = 'i_' + Math.random().toString(36).substring(2, 9);
  try {
    // O DONO DO CONTATO E CONFERIDO SEMPRE, e nao so quando vai enviar.
    //
    // A conferencia poderia viver dentro do `if` de envio -- e ali ela ja
    // existiria de graca, porque as buscas de telefone agora filtram. Fora do
    // `if` ela cobre tambem a interacao apenas REGISTRADA (uma ligacao, uma
    // observacao): sem isso, a clinica A escreveria no historico da paciente da
    // B sem mandar mensagem nenhuma.
    const [leads] = await db.q(
      'SELECT whatsapp AS fone FROM leads WHERE clinica_id = :clinica AND id = ?', [clientId]);
    const [clients] = await db.q(
      'SELECT phone AS fone FROM clients WHERE clinica_id = :clinica AND id = ?', [clientId]);
    if (!leads.length && !clients.length) {
      return res.status(404).json({ error: 'Contato nao encontrado.' });
    }

    let whatsappSent = true;
    let whatsappError = null;

    if (direction === 'out' && type === 'whatsapp') {
      const targetPhone = (leads[0] && leads[0].fone) || (clients[0] && clients[0].fone);
      // A INSTANCIA DESTA CLINICA. `null` nao e "use a padrao": e nao mande --
      // a paciente receberia do numero de outro consultorio e responderia para
      // a clinica errada.
      const instancia = await cfgSvc.instancia(db);
      if (targetPhone && !instancia) {
        whatsappSent = false;
        whatsappError = 'Esta clinica ainda nao tem WhatsApp conectado. ' +
                        'A interacao foi registrada, mas nada foi enviado.';
      } else if (targetPhone) {
        try {
          await sendWhatsappText(targetPhone, content, instancia);
        } catch (sendErr) {
          console.error('[WhatsApp Send Error]:', sendErr && sendErr.message);
          whatsappSent = false;
          whatsappError = sendErr.message || 'Falha ao conectar com o serviço de WhatsApp';
        }
      } else {
        whatsappSent = false;
        whatsappError = 'Contato sem número de WhatsApp cadastrado.';
      }
    }

    await db.q(
      'INSERT INTO interactions (id, client_id, type, content, direction, clinica_id)' +
      ' VALUES (?, ?, ?, ?, ?, :clinica)',
      [id, clientId, type || 'whatsapp', content, direction || 'out']);

    res.status(201).json({ id, clientId, type, content, direction, whatsappSent, whatsappError });
  } catch (error) {
    console.error('[interacoes]', error && error.message);
    res.status(500).json({ error: 'Erro ao registrar interacao' });
  }
});

module.exports = router;

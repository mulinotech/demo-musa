'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { SIMULATED_INSTANCES, EvolutionService, sendWhatsappText, getEvolutionManagerUrl, normalizeWhatsappNumber, jidToNumber } = require('../services/evolution');

router.get('/api/evolution/instances', async function(req, res) {
  try {
    const list = await EvolutionService.listInstances();
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


router.post('/api/evolution/instances', async function(req, res) {
  const { instanceName } = req.body;
  try {
    const created = await EvolutionService.createInstance(instanceName);
    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


router.get('/api/evolution/instances/connect/:name', async function(req, res) {
  try {
    const connection = await EvolutionService.connectInstance(req.params.name);
    res.json(connection);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 13.1. Status resumido da integração (usado pelo Gerenciador WhatsApp nativo)

router.get('/api/evolution/status', async function(req, res) {
  try {
    const configured = EvolutionService.isConfigured();
    if (!configured) {
      return res.json({ configured: false, instance: null, state: 'close', managerUrl: getEvolutionManagerUrl() });
    }
    const instance = await EvolutionService.getInstanceName(req.query.refresh === '1');
    let state = 'close';
    try {
      const st = await EvolutionService.connectionState(instance);
      state = st.state;
    } catch (e) {
      state = 'close';
    }
    res.json({ configured: true, instance, state, managerUrl: getEvolutionManagerUrl() });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao consultar status da Evolution API', details: error.message });
  }
});

// 13.2. Conversas reais da instância do WhatsApp

router.get('/api/evolution/chats', async function(req, res) {
  try {
    const instance = req.query.instance || await EvolutionService.getInstanceName();
    const chats = await EvolutionService.findChats(instance);
    res.json(chats);
  } catch (error) {
    res.status(502).json({ error: 'Não foi possível carregar as conversas do WhatsApp.', details: error.message });
  }
});

// 13.3. Contatos salvos na instância do WhatsApp

router.get('/api/evolution/contacts', async function(req, res) {
  try {
    const instance = req.query.instance || await EvolutionService.getInstanceName();
    const contacts = await EvolutionService.findContacts(instance);
    res.json(contacts);
  } catch (error) {
    res.status(502).json({ error: 'Não foi possível carregar os contatos do WhatsApp.', details: error.message });
  }
});

// 13.4. Histórico de mensagens de uma conversa

router.get('/api/evolution/messages', async function(req, res) {
  const rawJid = req.query.jid || '';
  const number = normalizeWhatsappNumber(req.query.number || rawJid);
  const remoteJid = rawJid.includes('@') ? rawJid : (number ? `${number}@s.whatsapp.net` : '');
  if (!remoteJid) {
    return res.status(400).json({ error: 'Informe o contato (jid ou number).' });
  }
  const limit = Number(req.query.limit) || 60;

  // 1) Histórico registrado no próprio CRM (sempre disponível)
  let crmMessages = [];
  if (number) {
    try {
      const last8 = number.slice(-8);
      const [rows] = await pool.query(
        `SELECT i.id, i.content, i.direction, i.type, i.created_at AS createdAt
           FROM interactions i
          WHERE i.client_id IN (
                  SELECT id FROM leads
                   WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(whatsapp, '+', ''), '-', ''), ' ', ''), '(', ''), 8) = ?
                  UNION
                  SELECT id FROM clients
                   WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(phone, '+', ''), '-', ''), ' ', ''), '(', ''), 8) = ?
                )
          ORDER BY i.created_at ASC
          LIMIT ?`,
        [last8, last8, limit]
      );
      crmMessages = rows.map(r => ({
        id: `crm_${r.id}`,
        direction: r.direction,
        content: r.content,
        createdAt: new Date(r.createdAt).toISOString(),
        source: 'crm'
      }));
    } catch (dbErr) {
      console.error('[Evolution Messages] Falha ao ler histórico do CRM:', dbErr.message);
    }
  }

  // 2) Histórico direto do WhatsApp (quando a Evolution conseguir devolver)
  let waMessages = [];
  let waError = null;
  try {
    const instance = req.query.instance || await EvolutionService.getInstanceName();
    waMessages = await EvolutionService.findMessages(instance, remoteJid, limit);
  } catch (error) {
    waError = error.message;
    console.warn('[Evolution Messages] WhatsApp indisponível:', error.message);
  }

  // Mesclar as duas fontes, removendo duplicidades (mesmo texto no mesmo minuto)
  const seen = new Set();
  const merged = [];
  for (const msg of [...waMessages, ...crmMessages]) {
    const bucket = `${msg.direction}|${(msg.content || '').trim()}|${String(msg.createdAt).slice(0, 16)}`;
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    merged.push(msg);
  }
  merged.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  if (merged.length === 0 && waError) {
    return res.status(502).json({ error: 'Não foi possível carregar o histórico da conversa.', details: waError });
  }
  res.json(merged.slice(-limit));
});

// 13.5. Envio direto pelo Gerenciador WhatsApp (também registra no CRM)

router.post('/api/evolution/send', async function(req, res) {
  const { number, text, name, jid } = req.body || {};
  const targetNumber = normalizeWhatsappNumber(number || jidToNumber(jid));

  if (!targetNumber) {
    return res.status(400).json({ error: 'Informe um número de WhatsApp válido.' });
  }
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: 'A mensagem não pode estar vazia.' });
  }

  try {
    const result = await sendWhatsappText(targetNumber, String(text));

    // Espelhar a mensagem no CRM: localizar (ou criar) o lead correspondente
    let clientId = null;
    try {
      const last8 = targetNumber.slice(-8);
      const [clients] = await pool.query(
        "SELECT id FROM clients WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(phone, '+', ''), '-', ''), ' ', ''), '(', ''), 8) = ? LIMIT 1",
        [last8]
      );
      const [leads] = await pool.query(
        "SELECT id FROM leads WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(whatsapp, '+', ''), '-', ''), ' ', ''), '(', ''), 8) = ? LIMIT 1",
        [last8]
      );

      if (clients.length > 0) {
        clientId = clients[0].id;
      } else if (leads.length > 0) {
        clientId = leads[0].id;
      } else {
        clientId = 'l_' + Math.random().toString(36).substring(2, 9);
        await pool.query(
          'INSERT INTO leads (id, name, whatsapp, treatment, message, source, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [clientId, (name && String(name).trim()) || `WhatsApp ${targetNumber.slice(-4)}`, targetNumber, 'Atendimento Geral', 'Conversa iniciada pelo Gerenciador WhatsApp.', 'site', 'contatado']
        );
      }

      await pool.query(
        'INSERT INTO interactions (id, client_id, type, content, direction) VALUES (?, ?, ?, ?, ?)',
        ['i_' + Math.random().toString(36).substring(2, 9), clientId, 'whatsapp', String(text), 'out']
      );
    } catch (dbErr) {
      console.error('[Evolution Send] Mensagem enviada, mas falhou o registro no CRM:', dbErr.message);
    }

    res.json({ success: true, number: targetNumber, clientId, result });
  } catch (error) {
    console.error('[Evolution Send Error]:', error.message);
    res.status(502).json({ error: 'Falha ao enviar a mensagem pelo WhatsApp.', details: error.message });
  }
});


router.post('/api/evolution/instances/simulate-connect', function(req, res) {
  const { instanceName, number } = req.body;
  const inst = SIMULATED_INSTANCES.find(i => i.name === instanceName);
  if (inst) {
    inst.status = 'open';
    inst.number = number || '5511900000000';
    inst.qrcode = undefined;
  }
  res.json({ success: true });
});

// 14. Webhook WhatsApp Evolution

router.post('/api/webhook/whatsapp', async function(req, res) {
  const payload = req.body;
  const messageData = payload.data || payload;
  const key = messageData.key;
  if (key && key.fromMe) {
    return res.json({ status: 'ignored' });
  }
  const senderJid = key?.remoteJid || '';
  const phone = senderJid.split('@')[0];
  const contactName = messageData.pushName || 'Contato WhatsApp';
  
  const messageType = messageData.messageType || 'conversation';
  let content = '';
  if (messageType === 'conversation' || messageType === 'extendedTextMessage') {
    content = messageData.message?.conversation || messageData.message?.extendedTextMessage?.text || '';
  } else if (messageType === 'imageMessage') {
    const caption = messageData.message?.imageMessage?.caption || '';
    content = caption ? `[Imagem]: ${caption}` : '[Imagem Recebida]';
  } else {
    return res.json({ status: 'unsupported' });
  }

  if (!phone) return res.status(400).json({ error: 'No phone' });

  try {
    // Buscar se cliente ou lead já existe
    let [clients] = await pool.query('SELECT id FROM clients WHERE REPLACE(phone, "+", "") = ?', [phone]);
    let [leads] = await pool.query('SELECT id FROM leads WHERE REPLACE(whatsapp, "+", "") = ?', [phone]);
    
    let targetId = '';
    if (clients.length > 0) {
      targetId = clients[0].id;
    } else if (leads.length > 0) {
      targetId = leads[0].id;
    } else {
      // Capturar como novo lead automaticamente
      targetId = 'l_' + Math.random().toString(36).substring(2, 9);
      await pool.query('INSERT INTO leads (id, name, whatsapp, treatment, status) VALUES (?, ?, ?, ?, ?)', [
        targetId, contactName, phone, 'Geral', 'novo'
      ]);
      const welcome = `Seja muito bem-vinda à Dra. Musa Estética de Elite! ✨\n\nRecebemos sua mensagem por aqui e nosso concierge de beleza já está ciente de seu contato. Como podemos ajudar no seu dia de beleza e cuidados? 🌸`;
      // Uma falha no envio da saudação não deve derrubar o webhook (a mensagem
      // recebida precisa ser registrada de qualquer forma).
      try {
        await sendWhatsappText(phone, welcome);
      } catch (welcomeErr) {
        console.error('[Webhook] Falha ao enviar saudação automática:', welcomeErr.message);
      }

      const interactionId = 'i_' + Math.random().toString(36).substring(2, 9);
      await pool.query('INSERT INTO interactions (id, client_id, type, content, direction) VALUES (?, ?, ?, ?, ?)', [
        interactionId, targetId, 'whatsapp', welcome, 'out'
      ]);
    }

    const newInteractionId = 'i_' + Math.random().toString(36).substring(2, 9);
    await pool.query('INSERT INTO interactions (id, client_id, type, content, direction) VALUES (?, ?, ?, ?, ?)', [
      newInteractionId, targetId, 'whatsapp', content, 'in'
    ]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// 15. PDF Report Generation Endpoint

module.exports = router;

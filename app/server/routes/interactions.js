'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { sendWhatsappText } = require('../services/evolution');

router.get('/api/interactions', async function(req, res) {
  try {
    const [rows] = await pool.query('SELECT id, client_id as clientId, type, content, direction, created_at as createdAt FROM interactions ORDER BY created_at ASC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar interacoes', details: error.message });
  }
});

// 12. Criar Interação

router.post('/api/interactions', async function(req, res) {
  const { clientId, type, content, direction } = req.body;
  if (!clientId || !content) {
    return res.status(400).json({ error: 'Campos obrigatorios ausentes.' });
  }
  const id = 'i_' + Math.random().toString(36).substring(2, 9);
  try {
    let whatsappSent = true;
    let whatsappError = null;

    // Tentativa de envio real se for saída de WhatsApp
    if (direction === 'out' && type === 'whatsapp') {
      const [leads] = await pool.query('SELECT whatsapp FROM leads WHERE id = ?', [clientId]);
      const [clients] = await pool.query('SELECT phone FROM clients WHERE id = ?', [clientId]);
      const targetPhone = (leads[0] && leads[0].whatsapp) || (clients[0] && clients[0].phone);
      if (targetPhone) {
        try {
          await sendWhatsappText(targetPhone, content);
        } catch (sendErr) {
          console.error('[WhatsApp Send Error]:', sendErr);
          whatsappSent = false;
          whatsappError = sendErr.message || 'Falha ao conectar com o serviço de WhatsApp';
        }
      } else {
        whatsappSent = false;
        whatsappError = 'Contato sem número de WhatsApp cadastrado.';
      }
    }

    await pool.query('INSERT INTO interactions (id, client_id, type, content, direction) VALUES (?, ?, ?, ?, ?)', [
      id, clientId, type || 'whatsapp', content, direction || 'out'
    ]);

    res.status(201).json({ id, clientId, type, content, direction, whatsappSent, whatsappError });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao registrar interacao', details: error.message });
  }
});

// 13. Evolution API Instance Manager

module.exports = router;

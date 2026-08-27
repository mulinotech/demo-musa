'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const auth = require('../../auth');
const { EvolutionService } = require('../services/evolution');

// ---- LOGIN COM JWT (T0.3 etapa 1) - aceita e-mail+senha e o formato antigo ----
router.post('/api/auth/login', express.json({ limit: '1mb' }), async function (req, res) {
  const bcrypt = require('bcryptjs');
  const email = (req.body && req.body.email || '').trim().toLowerCase();
  const senha = req.body && req.body.password || '';
  if (!senha) return res.status(400).json({ error: 'Senha e obrigatoria.' });

  try {
    if (email) {
      const [r] = await pool.query("SELECT * FROM users WHERE email = ? AND status = 'active'", [email]);
      if (!r.length || !bcrypt.compareSync(senha, r[0].password_hash)) {
        return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      }
      const u = r[0];
      await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [u.id]);
      return res.json({ token: auth.gerarToken(u), role: u.role, salespersonName: u.name, salespersonId: u.salesperson_id });
    }

    return res.status(401).json({ error: 'Informe e-mail e senha.' });
  } catch (e) {
    return res.status(500).json({ error: 'Falha no login.' });
  }
});


router.get('/api/config', function(req, res) {
  const geminiKey = process.env.GEMINI_API_KEY || '';
  res.json({
    hasGemini: !!geminiKey,
    hasEvolution: EvolutionService.isConfigured()
  });
});

// 5.1. Rota de Login / Autenticação (Multi-Usuários e Vendedores)

module.exports = router;

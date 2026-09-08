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

      // Sem clinica, nao ha sessao (M0.3). Deixar entrar produziria um token
      // que o porteiro recusa na requisicao seguinte -- a pessoa veria a tela
      // piscar e voltar para o login, sem explicacao. Melhor recusar aqui, com
      // uma frase que diga o que fazer.
      //
      // Como isso acontece: usuario criado entre a migration 020 e a M1.7 por
      // codigo que ainda nao preenchia a coluna. A senha esta certa; o cadastro
      // e que esta incompleto -- e a mensagem nao insinua o contrario.
      if (!u.clinica_id) {
        return res.status(403).json({
          error: 'Este acesso nao esta vinculado a uma clinica. Fale com o administrador.'
        });
      }

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

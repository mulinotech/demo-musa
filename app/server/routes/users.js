'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');

const PAPEIS_VALIDOS = ['admin', 'gerente', 'profissional', 'vendedor'];

router.get('/api/users', async function (req, res) {
  try {
    const [r] = await pool.query(
      'SELECT id, name, email, role, status, last_login_at, created_at FROM users ORDER BY name'
    );
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: 'Falha ao listar usuarios.' });
  }
});


router.post('/api/users', express.json({ limit: '1mb' }), async function (req, res) {
  const bcrypt = require('bcryptjs');
  const b = req.body || {};
  const nome = (b.name || '').trim();
  const email = (b.email || '').trim().toLowerCase();
  const senha = b.password || '';
  const papel = PAPEIS_VALIDOS.indexOf(b.role) !== -1 ? b.role : 'vendedor';
  if (!nome || !email || !senha) return res.status(400).json({ error: 'Nome, e-mail e senha sao obrigatorios.' });
  if (String(senha).length < 10) return res.status(400).json({ error: 'A senha precisa ter ao menos 10 caracteres.' });
  try {
    const id = 'u_' + Math.random().toString(36).slice(2, 10);
    await pool.query('INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [id, nome, email, bcrypt.hashSync(String(senha), 10), papel]);
    res.status(201).json({ id: id, name: nome, email: email, role: papel });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ja existe usuario com esse e-mail.' });
    res.status(500).json({ error: 'Falha ao criar usuario.' });
  }
});


router.patch('/api/users/:id', express.json({ limit: '1mb' }), async function (req, res) {
  const bcrypt = require('bcryptjs');
  const b = req.body || {};
  const campos = [], valores = [];
  if (b.name) { campos.push('name = ?'); valores.push(String(b.name).trim()); }
  if (b.role && PAPEIS_VALIDOS.indexOf(b.role) !== -1) { campos.push('role = ?'); valores.push(b.role); }
  if (b.status === 'active' || b.status === 'inactive') { campos.push('status = ?'); valores.push(b.status); }
  if (b.password) {
    if (String(b.password).length < 10) return res.status(400).json({ error: 'A senha precisa ter ao menos 10 caracteres.' });
    campos.push('password_hash = ?'); valores.push(bcrypt.hashSync(String(b.password), 10));
  }
  if (!campos.length) return res.status(400).json({ error: 'Nada para atualizar.' });
  try {
    valores.push(req.params.id);
    await pool.query('UPDATE users SET ' + campos.join(', ') + ' WHERE id = ?', valores);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao atualizar usuario.' });
  }
});

module.exports = router;

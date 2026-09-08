'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { verificarAlteracao } = require('../services/usuarios');

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

    // A CLINICA DO NOVO USUARIO E A DE QUEM O ESTA CRIANDO (M0.3).
    //
    // Vem da sessao, nunca do corpo da requisicao: aceitar `clinica_id` do
    // cliente deixaria a proprietaria da clinica A criar um acesso dentro da
    // clinica B -- que e o pior tipo de furo, porque nao vaza dado, cria uma
    // porta.
    //
    // Sem stamp, o usuario nasceria com clinica vazia e nao conseguiria entrar
    // (o porteiro recusa token sem clinica). Este e o primeiro lugar do sistema
    // que grava a coluna; a fase M1 faz o mesmo nos outros 44.
    const clinicaId = req.usuario && req.usuario.clinicaId;
    if (!clinicaId) {
      return res.status(403).json({ error: 'Sessao sem clinica. Entre de novo.' });
    }

    await pool.query(
      'INSERT INTO users (id, name, email, password_hash, role, clinica_id) VALUES (?, ?, ?, ?, ?, ?)',
      [id, nome, email, bcrypt.hashSync(String(senha), 10), papel, clinicaId]);
    res.status(201).json({ id: id, name: nome, email: email, role: papel });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      // NAO diga "ja existe usuario com esse e-mail".
      //
      // `users.email` e unico entre TODAS as clinicas (decisao de produto de
      // 04/09), entao a recusa pode estar vindo de um cadastro que existe em
      // OUTRA clinica. Dizer "ja existe" conta a esta clinica que aquele
      // endereco esta em uso em algum lugar da plataforma -- e informacao de um
      // cliente escapando para outro. Pouca, mas de graca para quem quiser
      // sondar: basta tentar cadastrar e-mails e ler a resposta.
      //
      // A recusa continua existindo; o que muda e nao explicar o motivo.
      // Ha teste em tests/multi-inquilino.test.js fixando esta frase, porque
      // e o tipo de mensagem que alguem "melhora" para ser mais util.
      return res.status(409).json({ error: 'Este e-mail nao esta disponivel. Use outro endereco.' });
    }
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
    // Guarda contra os dois cliques que trancam todo mundo do lado de fora.
    const [alvos] = await pool.query('SELECT id, name, role, status FROM users WHERE id = ?', [req.params.id]);
    if (!alvos.length) return res.status(404).json({ error: 'Usuario nao encontrado.' });
    const [contagem] = await pool.query(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'"
    );
    const impedimento = verificarAlteracao({
      solicitanteId: req.usuario && req.usuario.sub,
      alvo: alvos[0],
      mudanca: b,
      adminsAtivos: Number(contagem[0].n)
    });
    if (impedimento) return res.status(impedimento.status).json({ error: impedimento.error });

    valores.push(req.params.id);
    await pool.query('UPDATE users SET ' + campos.join(', ') + ' WHERE id = ?', valores);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao atualizar usuario.' });
  }
});

module.exports = router;

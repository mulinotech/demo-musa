'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { logSystemEvent } = require('../services/logs');

router.get('/api/salespeople', async function(req, res) {
  try {
    const [rows] = await pool.query('SELECT * FROM salespeople ORDER BY name ASC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar vendedores', details: error.message });
  }
});


router.post('/api/salespeople', async function(req, res) {
  const { name, email, whatsapp, avatar, role, password, status } = req.body;
  const authorName = (req.usuario && req.usuario.nome) || 'Proprietária (Master)';
  if (!name || !whatsapp) {
    return res.status(400).json({ error: 'Nome e WhatsApp sao obrigatorios.' });
  }

  try {
    const id = Math.random().toString(36).substring(2, 9);
    await pool.query(
      'INSERT INTO salespeople (id, name, email, whatsapp, avatar, role, password, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, name, email || null, whatsapp, avatar || null, role || 'vendedor', password || null, status || 'active']
    );

    await logSystemEvent(
      'SALESPERSON_CREATE',
      `Novo membro da equipe comercial cadastrado: "${name}" - Cargo: ${role || 'vendedor'}`,
      authorName,
      req.ip
    );

    res.status(201).json({ message: 'Vendedor cadastrado com sucesso!', id });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar vendedor', details: error.message });
  }
});


router.patch('/api/salespeople/:id', async function(req, res) {
  const { id } = req.params;
  const { name, email, whatsapp, role, password, status } = req.body;
  const authorName = (req.usuario && req.usuario.nome) || 'Proprietária (Master)';
  try {
    if (password) {
      await pool.query(
        'UPDATE salespeople SET name = COALESCE(?, name), email = COALESCE(?, email), whatsapp = COALESCE(?, whatsapp), role = COALESCE(?, role), password = COALESCE(?, password), status = COALESCE(?, status) WHERE id = ?',
        [name || null, email || null, whatsapp || null, role || null, password, status || null, id]
      );
    } else {
      await pool.query(
        'UPDATE salespeople SET name = COALESCE(?, name), email = COALESCE(?, email), whatsapp = COALESCE(?, whatsapp), role = COALESCE(?, role), status = COALESCE(?, status) WHERE id = ?',
        [name || null, email || null, whatsapp || null, role || null, status || null, id]
      );
    }
    await logSystemEvent(
      'SALESPERSON_UPDATE',
      `Dados do vendedor ID ${id} foram alterados (Nome: ${name || 'N/A'}, Cargo: ${role || 'N/A'})`,
      authorName,
      req.ip
    );

    res.json({ message: 'Vendedor atualizado com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar vendedor', details: error.message });
  }
});


router.delete('/api/salespeople/:id', async function(req, res) {
  const authorName = (req.usuario && req.usuario.nome) || 'Proprietária (Master)';
  try {
    await pool.query('DELETE FROM salespeople WHERE id = ?', [req.params.id]);
    await logSystemEvent(
      'SALESPERSON_DELETE',
      `Membro da equipe comercial ID ${req.params.id} foi excluído`,
      authorName,
      req.ip
    );
    res.json({ message: 'Vendedor excluido' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir', details: error.message });
  }
});

// 4.2. Catalogo de Tratamentos (Treatment Catalog)

module.exports = router;

'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');

router.get('/api/treatment-catalog', async function(req, res) {
  try {
    const [rows] = await pool.query('SELECT * FROM treatment_catalog ORDER BY name ASC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar catalogo', details: error.message });
  }
});


router.post('/api/treatment-catalog', async function(req, res) {
  const { name, price, packagePrice, duration, description, targetRegions, restrictions } = req.body;
  if (!name || price === undefined) return res.status(400).json({ error: 'Nome e Preco sao obrigatorios.' });
  
  const id = 'tc_' + Math.random().toString(36).substring(2, 9);
  try {
    await pool.query(
      'INSERT INTO treatment_catalog (id, name, price, package_price, duration, description, target_regions, restrictions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 
      [id, name, price, packagePrice || null, duration || '', description || '', targetRegions || '', restrictions || '']
    );
    res.status(201).json({ id, name, price, packagePrice, duration, description, targetRegions, restrictions });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar tratamento no catalogo', details: error.message });
  }
});


router.patch('/api/treatment-catalog/:id', async function(req, res) {
  const { id } = req.params;
  const { name, price, packagePrice, duration, description, targetRegions, restrictions } = req.body;
  try {
    await pool.query(
      'UPDATE treatment_catalog SET name = COALESCE(?, name), price = COALESCE(?, price), package_price = COALESCE(?, package_price), duration = COALESCE(?, duration), description = COALESCE(?, description), target_regions = COALESCE(?, target_regions), restrictions = COALESCE(?, restrictions) WHERE id = ?',
      [name, price, packagePrice === undefined ? null : packagePrice, duration, description, targetRegions, restrictions, id]
    );
    res.json({ message: 'Tratamento atualizado com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar tratamento no catalogo', details: error.message });
  }
});


router.delete('/api/treatment-catalog/:id', async function(req, res) {
  try {
    await pool.query('DELETE FROM treatment_catalog WHERE id = ?', [req.params.id]);
    res.json({ message: 'Tratamento excluido do catalogo' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir', details: error.message });
  }
});

// EVOLUTION API E OUTROS ENDPOINTS CRM UNIFICADOS

// Estado simulado em memória para Evolution API

module.exports = router;

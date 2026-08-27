'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { logSystemEvent } = require('../services/logs');

router.get('/api/clients', async function(req, res) {
  const userRole = req.usuario ? req.usuario.papel : '';
  const salespersonId = req.usuario ? req.usuario.vendedorId : null;

  try {
    if (userRole === 'vendedor' && salespersonId) {
      const query = `
        SELECT DISTINCT c.id, c.name, c.email, c.phone, c.anamnese, c.image_base64 as imageBase64, c.laudo, c.created_at as createdAt, c.updated_at as updatedAt 
        FROM clients c
        INNER JOIN leads l ON REPLACE(l.whatsapp, "+", "") = REPLACE(c.phone, "+", "")
        WHERE l.salesperson_id = ?
        ORDER BY c.name ASC
      `;
      const [rows] = await pool.query(query, [salespersonId]);
      return res.json(rows);
    }
    const [rows] = await pool.query('SELECT id, name, email, phone, anamnese, image_base64 as imageBase64, laudo, created_at as createdAt, updated_at as updatedAt FROM clients ORDER BY name ASC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar clientes', details: error.message });
  }
});

// 7. Criar Cliente

router.post('/api/clients', async function(req, res) {
  const { name, email, phone } = req.body;
  const authorName = (req.usuario && req.usuario.nome) || 'Sistema';
  if (!name || !phone) {
    return res.status(400).json({ error: 'Nome e telefone sao obrigatorios.' });
  }
  const id = 'c_' + Math.random().toString(36).substring(2, 9);
  try {
    await pool.query('INSERT INTO clients (id, name, email, phone) VALUES (?, ?, ?, ?)', [id, name, email || '', phone]);
    await logSystemEvent(
      'CLIENT_CREATE',
      `Novo paciente cadastrado: "${name}" (${phone})`,
      authorName,
      req.ip
    );
    res.status(201).json({ id, name, email: email || '', phone });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar cliente', details: error.message });
  }
});

// 8. Atualizar Cliente

router.patch('/api/clients/:id', async function(req, res) {
  const { id } = req.params;
  const { name, email, phone, anamnese, image_base64, laudo } = req.body;
  const authorName = (req.usuario && req.usuario.nome) || 'Sistema';
  
  // mysql2 não aceita undefined, precisa ser null
  const pName = name === undefined ? null : name;
  const pEmail = email === undefined ? null : email;
  const pPhone = phone === undefined ? null : phone;
  const pAnamnese = anamnese === undefined ? null : anamnese;
  const pImageBase64 = image_base64 === undefined ? null : image_base64;
  const pLaudo = laudo === undefined ? null : laudo;

  try {
    await pool.query(
      'UPDATE clients SET name = COALESCE(?, name), email = COALESCE(?, email), phone = COALESCE(?, phone), anamnese = COALESCE(?, anamnese), image_base64 = COALESCE(?, image_base64), laudo = COALESCE(?, laudo) WHERE id = ?', 
      [pName, pEmail, pPhone, pAnamnese, pImageBase64, pLaudo, id]
    );

    let desc = `Ficha do paciente ID ${id} atualizada`;
    if (anamnese !== undefined) desc = `Anamnese do paciente ID ${id} atualizada`;
    if (laudo !== undefined) desc = `Laudo Digital do paciente ID ${id} atualizado`;

    await logSystemEvent(
      'CLIENT_UPDATE',
      desc,
      authorName,
      req.ip
    );

    res.json({ message: 'Cliente atualizado com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar cliente', details: error.message });
  }
});

// 8.1. Excluir Cliente

router.delete('/api/clients/:id', async function(req, res) {
  const { id } = req.params;
  const authorName = (req.usuario && req.usuario.nome) || 'Sistema';
  try {
    await pool.query('DELETE FROM clients WHERE id = ?', [id]);
    await logSystemEvent(
      'CLIENT_DELETE',
      `Paciente ID ${id} foi excluído do sistema`,
      authorName,
      req.ip
    );
    res.json({ message: 'Cliente excluído com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir cliente', details: error.message });
  }
});

// 9. Listar Tratamentos

module.exports = router;

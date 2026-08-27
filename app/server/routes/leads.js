'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { logSystemEvent } = require('../services/logs');

router.get('/api/leads', async function(req, res) {
  try {
    const [rows] = await pool.query('SELECT * FROM leads ORDER BY date DESC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar leads', details: error.message });
  }
});

// 2. Criar um novo lead (Formulário ou Quiz)

router.post('/api/leads', async function(req, res) {
  const { id, name, whatsapp, email, treatment, message, scoreResult, date, status, salespersonId, source } = req.body;
  const authorName = (req.usuario && req.usuario.nome) || 'Sistema (Site/Formulario)';

  if (!name || !whatsapp || !treatment) {
    return res.status(400).json({ error: 'Campos obrigatorios ausentes (name, whatsapp, treatment).' });
  }

  try {
    const leadId = id || Math.random().toString(36).substring(2, 9);
    const query = `
      INSERT INTO leads (id, name, whatsapp, email, treatment, message, score_result, salesperson_id, source, date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await pool.query(query, [
      leadId,
      name,
      whatsapp,
      email || null,
      treatment,
      message || '',
      scoreResult || null,
      salespersonId || null,
      source || 'site',
      date ? new Date(date) : new Date(),
      status || 'novo'
    ]);

    const getFirstName = (fullName) => (fullName || '').trim().split(' ')[0] || fullName;
    await logSystemEvent(
      'LEAD_CREATE',
      `Novo lead cadastrado: "${getFirstName(name)}" (${whatsapp}) - Interesse: ${treatment}`,
      authorName,
      req.ip
    );

    // O id precisa voltar para o frontend poder selecionar a conversa recém-criada
    res.status(201).json({ id: leadId, message: 'Lead inserido com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar o lead', details: error.message });
  }
});

// 3. Atualizar um lead (status, whatsapp, email)

router.put('/api/leads/:id', async function(req, res) {
  const { id } = req.params;
  const { status, whatsapp, email, salesNotes, qualified, treatment } = req.body;
  try {
    let updateFields = [];
    let queryParams = [];
    const authorName = (req.usuario && req.usuario.nome) || 'Sistema';

    if (status !== undefined) {
      updateFields.push('status = ?');
      queryParams.push(status);
    }
    if (whatsapp !== undefined) {
      updateFields.push('whatsapp = ?');
      queryParams.push(whatsapp);
    }
    if (email !== undefined) {
      updateFields.push('email = ?');
      queryParams.push(email);
    }
    if (salesNotes !== undefined) {
      updateFields.push('sales_notes = ?');
      queryParams.push(salesNotes);
    }
    if (qualified !== undefined) {
      updateFields.push('qualified = ?');
      queryParams.push(qualified ? 1 : 0);
    }
    if (treatment !== undefined && treatment !== '') {
      updateFields.push('treatment = ?');
      queryParams.push(treatment);
    }

    updateFields.push('last_edited_by = ?');
    queryParams.push(authorName);

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar foi fornecido.' });
    }

    // Helper para extrair o primeiro nome do lead
    const getFirstName = (fullName) => (fullName || '').trim().split(' ')[0] || fullName;
    const [leadRows] = await pool.query('SELECT name, whatsapp FROM leads WHERE id = ?', [id]);
    const leadFirstName = leadRows[0] ? getFirstName(leadRows[0].name) : '';
    const leadInfo = leadRows[0] ? `"${leadFirstName}" (${leadRows[0].whatsapp})` : `ID ${id}`;

    queryParams.push(id);
    const query = `UPDATE leads SET ${updateFields.join(', ')} WHERE id = ?`;
    await pool.query(query, queryParams);

    const changesText = status ? `Status alterado para "${status}"` : 'Dados de contato atualizados';
    await logSystemEvent(
      'LEAD_UPDATE',
      `Lead ${leadInfo} atualizado: ${changesText}`,
      authorName,
      req.ip
    );

    res.json({ message: 'Lead atualizado com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar o lead', details: error.message });
  }
});

// 4. Excluir um lead

router.delete('/api/leads/:id', async function(req, res) {
  const { id } = req.params;
  const authorName = (req.usuario && req.usuario.nome) || 'Sistema';
  try {
    // Buscar nome e telefone antes de excluir para constar no histórico de auditoria
    const [leadRows] = await pool.query('SELECT name, whatsapp, treatment FROM leads WHERE id = ?', [id]);
    const getFirstName = (fullName) => (fullName || '').trim().split(' ')[0] || fullName;
    const leadFirstName = leadRows[0] ? getFirstName(leadRows[0].name) : '';
    const leadInfo = leadRows[0] 
      ? `"${leadFirstName}" (WhatsApp: ${leadRows[0].whatsapp} | Tratamento: ${leadRows[0].treatment})` 
      : `ID ${id}`;

    await pool.query('DELETE FROM leads WHERE id = ?', [id]);
    await logSystemEvent(
      'LEAD_DELETE',
      `Lead ${leadInfo} foi removido do sistema`,
      authorName,
      req.ip
    );
    res.json({ message: 'Lead excluido com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir o lead', details: error.message });
  }
});

// 4.1. Vendedores (Salespeople)

module.exports = router;

'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');

router.get('/api/treatments', async function(req, res) {
  const userRole = req.usuario ? req.usuario.papel : '';
  const salespersonId = req.usuario ? req.usuario.vendedorId : null;

  try {
    let rows;
    if (userRole === 'vendedor' && salespersonId) {
      const query = `
        SELECT t.id, t.client_id as clientId, t.procedure_name as procedureName, t.session_date as sessionDate, t.notes, t.next_session_date as nextSessionDate, t.price, t.total_sessions as totalSessions, t.completed_sessions as completedSessions 
        FROM treatments t
        INNER JOIN clients c ON t.client_id = c.id
        INNER JOIN leads l ON REPLACE(l.whatsapp, "+", "") = REPLACE(c.phone, "+", "")
        WHERE l.salesperson_id = ?
        ORDER BY t.session_date DESC
      `;
      const [result] = await pool.query(query, [salespersonId]);
      rows = result;
    } else {
      const [result] = await pool.query('SELECT id, client_id as clientId, procedure_name as procedureName, session_date as sessionDate, notes, next_session_date as nextSessionDate, price, total_sessions as totalSessions, completed_sessions as completedSessions FROM treatments ORDER BY session_date DESC');
      rows = result;
    }

    // Mapear procedureName para procedure para bater com o layout React anterior
    const mapped = rows.map(r => ({
      id: r.id,
      clientId: r.clientId,
      procedure: r.procedureName,
      sessionDate: r.sessionDate,
      notes: r.notes,
      nextSessionDate: r.nextSessionDate,
      price: r.price !== null ? Number(r.price) : null,
      totalSessions: r.totalSessions,
      completedSessions: r.completedSessions
    }));
    res.json(mapped);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar tratamentos', details: error.message });
  }
});

// 10. Criar Tratamento

router.post('/api/treatments', async function(req, res) {
  const { clientId, procedure, sessionDate, notes, nextSessionDate, price, totalSessions, completedSessions } = req.body;
  if (!clientId || !procedure || !sessionDate) {
    return res.status(400).json({ error: 'Campos obrigatorios ausentes.' });
  }
  const id = 't_' + Math.random().toString(36).substring(2, 9);
  try {
    await pool.query('INSERT INTO treatments (id, client_id, procedure_name, session_date, notes, next_session_date, price, total_sessions, completed_sessions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      id, clientId, procedure, new Date(sessionDate), notes || '', nextSessionDate ? new Date(nextSessionDate) : null, price !== undefined ? price : null, totalSessions || 1, completedSessions || 1
    ]);
    res.status(201).json({ id, clientId, procedure, sessionDate, notes, nextSessionDate, price, totalSessions: totalSessions || 1, completedSessions: completedSessions || 1 });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao registrar tratamento', details: error.message });
  }
});

// 10.1 Atualizar Tratamento

router.patch('/api/treatments/:id', async function(req, res) {
  const { id } = req.params;
  const { procedure, sessionDate, notes, price, totalSessions, completedSessions } = req.body;
  try {
    await pool.query('UPDATE treatments SET procedure_name = COALESCE(?, procedure_name), session_date = COALESCE(?, session_date), notes = COALESCE(?, notes), price = COALESCE(?, price), total_sessions = COALESCE(?, total_sessions), completed_sessions = COALESCE(?, completed_sessions) WHERE id = ?', [procedure, sessionDate ? new Date(sessionDate) : null, notes, price !== undefined ? price : null, totalSessions, completedSessions, id]);
    res.json({ message: 'Tratamento atualizado com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar tratamento', details: error.message });
  }
});

// 10.2. Listar Planos de Tratamento

module.exports = router;

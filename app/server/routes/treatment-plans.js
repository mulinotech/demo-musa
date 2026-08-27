'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');

router.get('/api/treatment-plans', async function(req, res) {
  try {
    const [plans] = await pool.query('SELECT id, client_id as clientId, title, clinical_objective as clinicalObjective, total_sessions as totalSessions, periodicity, status, start_date as startDate, estimated_end_date as estimatedEndDate, created_at as createdAt FROM treatment_plans ORDER BY created_at DESC');
    const [sessions] = await pool.query('SELECT id, plan_id as planId, session_number as sessionNumber, session_type as sessionType, status, equipments_used as equipmentsUsed, supplies_applied as suppliesApplied, professional_in_charge as professionalInCharge, clinical_evolution as clinicalEvolution, media_urls as mediaUrls, session_date as sessionDate, next_session_date as nextSessionDate, price, created_at as createdAt FROM treatment_sessions ORDER BY session_number ASC');
    
    const plansWithSessions = plans.map(plan => ({
      ...plan,
      sessions: sessions.filter(s => s.planId === plan.id).map(s => ({
        ...s,
        price: s.price !== null ? Number(s.price) : null
      }))
    }));
    res.json(plansWithSessions);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar planos de tratamento', details: error.message });
  }
});

// 10.3. Criar Plano de Tratamento

router.post('/api/treatment-plans', async function(req, res) {
  const { clientId, title, clinicalObjective, totalSessions, periodicity, status, startDate, estimatedEndDate, sessionPrice } = req.body;
  if (!clientId || !title || !totalSessions) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes (clientId, title, totalSessions).' });
  }
  const id = 'p_' + Math.random().toString(36).substring(2, 9);
  try {
    await pool.query('INSERT INTO treatment_plans (id, client_id, title, clinical_objective, total_sessions, periodicity, status, start_date, estimated_end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      id, clientId, title, clinicalObjective || '', totalSessions, periodicity || '', status || 'ATIVO', startDate ? new Date(startDate) : null, estimatedEndDate ? new Date(estimatedEndDate) : null
    ]);
    
    for (let i = 1; i <= totalSessions; i++) {
      const sessId = 's_sess_' + Math.random().toString(36).substring(2, 9);
      await pool.query('INSERT INTO treatment_sessions (id, plan_id, session_number, session_type, status, price) VALUES (?, ?, ?, ?, ?, ?)', [
        sessId, id, i, 'SESSAO_TRATAMENTO', 'PENDENTE', sessionPrice !== undefined && sessionPrice !== null ? sessionPrice : null
      ]);
    }
    res.status(201).json({ id, clientId, title, clinicalObjective, totalSessions, periodicity, status, startDate, estimatedEndDate });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar plano de tratamento', details: error.message });
  }
});

// 10.4. Atualizar Plano de Tratamento

router.patch('/api/treatment-plans/:id', async function(req, res) {
  const { id } = req.params;
  const { title, clinicalObjective, totalSessions, periodicity, status, startDate, estimatedEndDate } = req.body;
  try {
    await pool.query(
      'UPDATE treatment_plans SET title = COALESCE(?, title), clinical_objective = COALESCE(?, clinical_objective), total_sessions = COALESCE(?, total_sessions), periodicity = COALESCE(?, periodicity), status = COALESCE(?, status), start_date = COALESCE(?, start_date), estimated_end_date = COALESCE(?, estimated_end_date) WHERE id = ?',
      [title || null, clinicalObjective || null, totalSessions || null, periodicity || null, status || null, startDate ? new Date(startDate) : null, estimatedEndDate ? new Date(estimatedEndDate) : null, id]
    );
    res.json({ message: 'Plano de tratamento atualizado com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar plano de tratamento', details: error.message });
  }
});

// 10.5. Excluir Plano de Tratamento

router.delete('/api/treatment-plans/:id', async function(req, res) {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM treatment_plans WHERE id = ?', [id]);
    res.json({ message: 'Plano de tratamento excluído com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir plano de tratamento', details: error.message });
  }
});

// 10.6. Atualizar Sessão de Tratamento

router.patch('/api/treatment-sessions/:id', async function(req, res) {
  const { id } = req.params;
  const { sessionType, status, equipmentsUsed, suppliesApplied, professionalInCharge, clinicalEvolution, mediaUrls, sessionDate, nextSessionDate, price } = req.body;
  try {
    await pool.query(
      'UPDATE treatment_sessions SET session_type = COALESCE(?, session_type), status = COALESCE(?, status), equipments_used = COALESCE(?, equipments_used), supplies_applied = COALESCE(?, supplies_applied), professional_in_charge = COALESCE(?, professional_in_charge), clinical_evolution = COALESCE(?, clinical_evolution), media_urls = COALESCE(?, media_urls), session_date = COALESCE(?, session_date), next_session_date = COALESCE(?, next_session_date), price = COALESCE(?, price) WHERE id = ?',
      [
        sessionType || null,
        status || null,
        equipmentsUsed || null,
        suppliesApplied || null,
        professionalInCharge || null,
        clinicalEvolution || null,
        mediaUrls || null,
        sessionDate ? new Date(sessionDate) : null,
        nextSessionDate ? new Date(nextSessionDate) : null,
        price !== undefined ? price : null,
        id
      ]
    );
    res.json({ message: 'Sessão atualizada com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar sessão', details: error.message });
  }
});

// 11. Listar Interações

module.exports = router;

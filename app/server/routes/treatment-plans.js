'use strict';
/** Planos de tratamento e suas sessões (M1.1b, na camada por clínica).
 *
 *  ============================================ O QUE MUDOU NA CONVERSÃO
 *
 *  As duas listas do `GET` são lidas separadas e casadas em memória por
 *  `planId`. As **duas** passaram a filtrar clínica. Filtrar só os planos
 *  bastaria para a resposta sair limpa — as sessões da outra clínica não
 *  encontrariam plano para se juntar — mas seria proteção por acidente: uma
 *  sessão cujo `plan_id` colidisse com um plano desta clínica apareceria.
 *  Colisão de id gerado por `Math.random().toString(36)` com 7 caracteres não
 *  é hipótese teórica quando são 50 clínicas gravando no mesmo banco.
 *
 *  O `POST` ganhou a conferência de dono do paciente, pelo mesmo motivo
 *  descrito em `treatments.js`.
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');

router.get('/api/treatment-plans', async function(req, res) {
  const db = escopo(req);
  try {
    const [plans] = await db.q('SELECT id, client_id as clientId, title, clinical_objective as clinicalObjective, total_sessions as totalSessions, periodicity, status, start_date as startDate, estimated_end_date as estimatedEndDate, created_at as createdAt FROM treatment_plans WHERE clinica_id = :clinica ORDER BY created_at DESC');
    const [sessions] = await db.q('SELECT id, plan_id as planId, session_number as sessionNumber, session_type as sessionType, status, equipments_used as equipmentsUsed, supplies_applied as suppliesApplied, professional_in_charge as professionalInCharge, clinical_evolution as clinicalEvolution, media_urls as mediaUrls, session_date as sessionDate, next_session_date as nextSessionDate, price, created_at as createdAt FROM treatment_sessions WHERE clinica_id = :clinica ORDER BY session_number ASC');

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
  const db = escopo(req);
  const { clientId, title, clinicalObjective, totalSessions, periodicity, status, startDate, estimatedEndDate, sessionPrice } = req.body;
  if (!clientId || !title || !totalSessions) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes (clientId, title, totalSessions).' });
  }
  const id = 'p_' + Math.random().toString(36).substring(2, 9);
  try {
    const [dono] = await db.q(
      'SELECT id FROM clients WHERE clinica_id = :clinica AND id = ?', [clientId]);
    if (!dono.length) return res.status(404).json({ error: 'Paciente nao encontrado.' });

    // O plano e as sessoes dele numa transacao: plano gravado sem as sessoes
    // deixa um plano de N sessoes com zero sessoes, e a tela nao tem como
    // consertar isso -- ela so sabe criar plano novo.
    await db.transacao(async function (tx) {
      await tx.q('INSERT INTO treatment_plans (id, client_id, title, clinical_objective, total_sessions, periodicity, status, start_date, estimated_end_date, clinica_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, :clinica)', [
        id, clientId, title, clinicalObjective || '', totalSessions, periodicity || '', status || 'ATIVO', startDate ? new Date(startDate) : null, estimatedEndDate ? new Date(estimatedEndDate) : null
      ]);

      for (let i = 1; i <= totalSessions; i++) {
        const sessId = 's_sess_' + Math.random().toString(36).substring(2, 9);
        await tx.q('INSERT INTO treatment_sessions (id, plan_id, session_number, session_type, status, price, clinica_id) VALUES (?, ?, ?, ?, ?, ?, :clinica)', [
          sessId, id, i, 'SESSAO_TRATAMENTO', 'PENDENTE', sessionPrice !== undefined && sessionPrice !== null ? sessionPrice : null
        ]);
      }
    });

    res.status(201).json({ id, clientId, title, clinicalObjective, totalSessions, periodicity, status, startDate, estimatedEndDate });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar plano de tratamento', details: error.message });
  }
});

// 10.4. Atualizar Plano de Tratamento

router.patch('/api/treatment-plans/:id', async function(req, res) {
  const db = escopo(req);
  const { id } = req.params;
  const { title, clinicalObjective, totalSessions, periodicity, status, startDate, estimatedEndDate } = req.body;
  try {
    const [r] = await db.q(
      'UPDATE treatment_plans SET title = COALESCE(?, title), clinical_objective = COALESCE(?, clinical_objective), total_sessions = COALESCE(?, total_sessions), periodicity = COALESCE(?, periodicity), status = COALESCE(?, status), start_date = COALESCE(?, start_date), estimated_end_date = COALESCE(?, estimated_end_date) WHERE clinica_id = :clinica AND id = ?',
      [title || null, clinicalObjective || null, totalSessions || null, periodicity || null, status || null, startDate ? new Date(startDate) : null, estimatedEndDate ? new Date(estimatedEndDate) : null, id]
    );
    /* NENHUMA LINHA ALTERADA = o plano nao e desta clinica (ou nao existe).
     * Responder "atualizado com sucesso" seria mentir para quem chamou e, de
     * quebra, confirmar que aquele id existe em algum lugar. Medido na M4.1. */
    if (!r || r.affectedRows === 0) {
      return res.status(404).json({ error: 'Plano de tratamento nao encontrado.' });
    }
    res.json({ message: 'Plano de tratamento atualizado com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar plano de tratamento', details: error.message });
  }
});

// 10.5. Excluir Plano de Tratamento

router.delete('/api/treatment-plans/:id', async function(req, res) {
  const db = escopo(req);
  const { id } = req.params;
  try {
    // Sem o filtro, um id adivinhado apaga o plano de outra clinica -- e o
    // CASCADE leva as sessoes junto.
    const [r] = await db.q(
      'DELETE FROM treatment_plans WHERE clinica_id = :clinica AND id = ?', [id]);
    if (!r || r.affectedRows === 0) {
      return res.status(404).json({ error: 'Plano de tratamento nao encontrado.' });
    }
    res.json({ message: 'Plano de tratamento excluído com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir plano de tratamento', details: error.message });
  }
});

// 10.6. Atualizar Sessão de Tratamento

router.patch('/api/treatment-sessions/:id', async function(req, res) {
  const db = escopo(req);
  const { id } = req.params;
  const { sessionType, status, equipmentsUsed, suppliesApplied, professionalInCharge, clinicalEvolution, mediaUrls, sessionDate, nextSessionDate, price } = req.body;
  try {
    const [r] = await db.q(
      'UPDATE treatment_sessions SET session_type = COALESCE(?, session_type), status = COALESCE(?, status), equipments_used = COALESCE(?, equipments_used), supplies_applied = COALESCE(?, supplies_applied), professional_in_charge = COALESCE(?, professional_in_charge), clinical_evolution = COALESCE(?, clinical_evolution), media_urls = COALESCE(?, media_urls), session_date = COALESCE(?, session_date), next_session_date = COALESCE(?, next_session_date), price = COALESCE(?, price) WHERE clinica_id = :clinica AND id = ?',
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
    if (!r || r.affectedRows === 0) {
      return res.status(404).json({ error: 'Sessao nao encontrada.' });
    }
    res.json({ message: 'Sessão atualizada com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar sessão', details: error.message });
  }
});

// 11. Listar Interações

module.exports = router;

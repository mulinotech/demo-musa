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
const agenda = require('../services/agenda-de-sessoes');
const logs = require('../services/logs');

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
  const { clientId, title, clinicalObjective, totalSessions, periodicity, status, startDate, estimatedEndDate, sessionPrice, intervaloDias } = req.body;
  if (!clientId || !title || !totalSessions) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes (clientId, title, totalSessions).' });
  }
  const id = 'p_' + Math.random().toString(36).substring(2, 9);
  try {
    const [dono] = await db.q(
      'SELECT id FROM clients WHERE clinica_id = :clinica AND id = ?', [clientId]);
    if (!dono.length) return res.status(404).json({ error: 'Paciente nao encontrado.' });

    const programado = agenda.datasDasSessoes({
      inicio: startDate, periodicidade: periodicity,
      total: Number(totalSessions), intervaloDias: intervaloDias
    });

    // O plano e as sessoes dele numa transacao: plano gravado sem as sessoes
    // deixa um plano de N sessoes com zero sessoes, e a tela nao tem como
    // consertar isso -- ela so sabe criar plano novo.
    await db.transacao(async function (tx) {
      await tx.q('INSERT INTO treatment_plans (id, client_id, title, clinical_objective, total_sessions, periodicity, status, start_date, estimated_end_date, clinica_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, :clinica)', [
        id, clientId, title, clinicalObjective || '', totalSessions, periodicity || '', status || 'ATIVO', startDate ? new Date(startDate) : null, estimatedEndDate ? new Date(estimatedEndDate) : null
      ]);

      /* AS SESSOES JA NASCEM COM DATA PREVISTA (M5.12).
       *
       * Ate aqui elas nasciam com `session_date` vazio -- e o formulario do
       * plano JA perguntava a data de inicio e a periodicidade, gravava as
       * duas, e nao fazia com elas a unica coisa que elas servem para fazer.
       * Plano de 10 sessoes virava dez janelas e dez datas digitadas a mao.
       *
       * Se a programacao nao der (data invalida, periodicidade sem intervalo),
       * as sessoes nascem sem data, exatamente como antes: o plano tem de ser
       * criado de um jeito ou de outro, e a tela mostra o motivo. */
      for (let i = 1; i <= totalSessions; i++) {
        const sessId = 's_sess_' + Math.random().toString(36).substring(2, 9);
        const data = programado.datas[i - 1] || null;
        await tx.q('INSERT INTO treatment_sessions (id, plan_id, session_number, session_type, status, session_date, price, clinica_id) VALUES (?, ?, ?, ?, ?, ?, ?, :clinica)', [
          sessId, id, i, 'SESSAO_TRATAMENTO', 'PENDENTE', data,
          sessionPrice !== undefined && sessionPrice !== null ? sessionPrice : null
        ]);
      }
    });

    res.status(201).json({
      id, clientId, title, clinicalObjective, totalSessions, periodicity, status,
      startDate, estimatedEndDate,
      /* A tela precisa saber se as datas entraram, e por que nao entraram
         quando nao entraram -- senao a recepcao descobre abrindo as dez. */
      programacao: {
        programadas: programado.datas.length,
        avisos: programado.avisos,
        erro: programado.erro
      }
    });
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

/** PROGRAMAR AS DATAS DE UM PLANO QUE JÁ EXISTE (M5.12).
 *
 *  A criação do plano já programa. Esta rota é para os planos que existiam
 *  antes da M5.12 — e para quando o tratamento muda de ritmo no meio ("vamos
 *  espaçar para mensal").
 *
 *  ================================== O QUE ELA NUNCA MEXE, E POR QUE IMPORTA
 *
 *  **Sessão que já aconteceu não é reprogramada.** `REALIZADA`, `FALTOU`,
 *  `CANCELADA` e `REAGENDADA` são fatos sobre o passado: a data ali é a data em
 *  que a paciente esteve (ou não esteve) na clínica. Reescrevê-las ao mudar o
 *  ritmo do que ainda vem seria falsificar prontuário — em silêncio, e com a
 *  tela ficando coerente.
 *
 *  Então só `PENDENTE` e `AGENDADA` recebem data nova, e a resposta diz quantas
 *  foram preservadas. Quem programa fica sabendo o que não mudou, em vez de
 *  supor que mudou tudo.
 *
 *  As datas são calculadas para o plano INTEIRO e cada sessão recebe a da sua
 *  posição: assim a 7ª sessão continua sendo a 7ª data do ritmo, mesmo que as
 *  seis primeiras estejam congeladas. Recomeçar a contagem na primeira pendente
 *  encavalaria o plano por cima do que já foi feito. */
router.post('/api/treatment-plans/:id/programar', async function (req, res) {
  const db = escopo(req);
  const { id } = req.params;
  const { inicio, periodicidade, intervaloDias } = req.body || {};

  const CONGELADAS = ['REALIZADA', 'FALTOU', 'CANCELADA', 'REAGENDADA'];

  try {
    const [plano] = await db.q(
      'SELECT id, total_sessions AS total FROM treatment_plans' +
      ' WHERE clinica_id = :clinica AND id = ?', [id]);
    if (!plano[0]) return res.status(404).json({ error: 'Plano nao encontrado.' });

    const [sessoes] = await db.q(
      'SELECT id, session_number AS n, status FROM treatment_sessions' +
      ' WHERE clinica_id = :clinica AND plan_id = ? ORDER BY session_number', [id]);

    const total = Math.max(Number(plano[0].total) || 0, sessoes.length);
    const r = agenda.datasDasSessoes({
      inicio: inicio, periodicidade: periodicidade, total: total, intervaloDias: intervaloDias
    });
    if (r.erro) return res.status(400).json({ error: r.erro });

    const preservadas = sessoes.filter((s) => CONGELADAS.indexOf(s.status) !== -1);
    const mover = sessoes.filter((s) => CONGELADAS.indexOf(s.status) === -1);

    await db.transacao(async function (tx) {
      for (const s of mover) {
        const data = r.datas[s.n - 1];
        if (!data) continue;
        await tx.q(
          'UPDATE treatment_sessions SET session_date = ?' +
          ' WHERE clinica_id = :clinica AND id = ?', [data, s.id]);
      }
      await tx.q(
        'UPDATE treatment_plans SET start_date = ?, periodicity = ?' +
        ' WHERE clinica_id = :clinica AND id = ?',
        [r.datas[0], String(periodicidade || ''), id]);
    });

    await logs.registrar(db, 'PLANO',
      'Datas do plano programadas: ' + mover.length + ' sessao(oes) a partir de ' +
      r.datas[0] + (preservadas.length
        ? '. ' + preservadas.length + ' sessao(oes) ja realizada(s) nao foram tocadas.'
        : '.'));

    res.json({
      programadas: mover.length,
      preservadas: preservadas.length,
      avisos: r.avisos,
      datas: r.datas
    });
  } catch (error) {
    console.error('[planos]', error && error.message);
    res.status(500).json({ error: 'Erro ao programar as datas do plano.' });
  }
});


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

'use strict';
/** Atendimentos registrados (M1.1b, na camada por clínica).
 *
 *  ============================================ O QUE MUDOU NA CONVERSÃO
 *
 *  Toda consulta passou a `escopo(req)`, e o `clinica_id` está amarrado em
 *  **cada tabela da junção**, não só na principal. A junção do vendedor toca
 *  três tabelas (`treatments`, `clients`, `leads`); filtrar só a primeira
 *  deixaria as outras duas atravessarem clínica.
 *
 *  O `POST` ganhou uma conferência que não existia: o `clientId` vem do corpo
 *  da requisição, então um id de paciente de outra clínica criaria um
 *  atendimento *desta* clínica apontando para paciente *daquela*. A linha
 *  ficaria certa aos olhos do filtro (o `clinica_id` dela é o da sessão) e
 *  errada de fato. Ver a nota no lugar.
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');

router.get('/api/treatments', async function(req, res) {
  const db = escopo(req);
  const userRole = req.usuario ? req.usuario.papel : '';
  const salespersonId = req.usuario ? req.usuario.vendedorId : null;

  try {
    let rows;
    if (userRole === 'vendedor' && salespersonId) {
      // Tres tabelas, tres filtros. O `l.clinica_id` fica na propria juncao (e
      // nao no WHERE) porque `leads` entra por INNER JOIN de telefone: o mesmo
      // telefone existe em duas clinicas quando a pessoa e atendida nas duas,
      // e isso nao e caso remoto -- e o normal no ramo.
      const query = `
        SELECT t.id, t.client_id as clientId, t.procedure_name as procedureName, t.session_date as sessionDate, t.notes, t.next_session_date as nextSessionDate, t.price, t.total_sessions as totalSessions, t.completed_sessions as completedSessions
        FROM treatments t
        INNER JOIN clients c ON t.client_id = c.id AND c.clinica_id = :clinica
        INNER JOIN leads l ON REPLACE(l.whatsapp, "+", "") = REPLACE(c.phone, "+", "") AND l.clinica_id = :clinica
        WHERE t.clinica_id = :clinica AND l.salesperson_id = ?
        ORDER BY t.session_date DESC
      `;
      const [result] = await db.q(query, [salespersonId]);
      rows = result;
    } else {
      const [result] = await db.q('SELECT id, client_id as clientId, procedure_name as procedureName, session_date as sessionDate, notes, next_session_date as nextSessionDate, price, total_sessions as totalSessions, completed_sessions as completedSessions FROM treatments WHERE clinica_id = :clinica ORDER BY session_date DESC');
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
  const db = escopo(req);
  const { clientId, procedure, sessionDate, notes, nextSessionDate, price, totalSessions, completedSessions } = req.body;
  if (!clientId || !procedure || !sessionDate) {
    return res.status(400).json({ error: 'Campos obrigatorios ausentes.' });
  }
  const id = 't_' + Math.random().toString(36).substring(2, 9);
  try {
    // O paciente TEM de ser desta clinica. Sem esta conferencia, um `clientId`
    // de outra clinica cria um atendimento com o `clinica_id` certo apontando
    // para paciente errado -- linha que nenhum filtro de leitura acusa, porque
    // o filtro olha o `clinica_id` dela, e ele esta certo.
    const [dono] = await db.q(
      'SELECT id FROM clients WHERE clinica_id = :clinica AND id = ?', [clientId]);
    if (!dono.length) return res.status(404).json({ error: 'Paciente nao encontrado.' });

    await db.q('INSERT INTO treatments (id, client_id, procedure_name, session_date, notes, next_session_date, price, total_sessions, completed_sessions, clinica_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, :clinica)', [
      id, clientId, procedure, new Date(sessionDate), notes || '', nextSessionDate ? new Date(nextSessionDate) : null, price !== undefined ? price : null, totalSessions || 1, completedSessions || 1
    ]);
    res.status(201).json({ id, clientId, procedure, sessionDate, notes, nextSessionDate, price, totalSessions: totalSessions || 1, completedSessions: completedSessions || 1 });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao registrar tratamento', details: error.message });
  }
});

// 10.1 Atualizar Tratamento

router.patch('/api/treatments/:id', async function(req, res) {
  const db = escopo(req);
  const { id } = req.params;
  const { procedure, sessionDate, notes, price, totalSessions, completedSessions } = req.body;
  try {
    const [r] = await db.q('UPDATE treatments SET procedure_name = COALESCE(?, procedure_name), session_date = COALESCE(?, session_date), notes = COALESCE(?, notes), price = COALESCE(?, price), total_sessions = COALESCE(?, total_sessions), completed_sessions = COALESCE(?, completed_sessions) WHERE clinica_id = :clinica AND id = ?', [procedure, sessionDate ? new Date(sessionDate) : null, notes, price !== undefined ? price : null, totalSessions, completedSessions, id]);
    if (!r || r.affectedRows === 0) {
      return res.status(404).json({ error: 'Tratamento nao encontrado.' });
    }
    res.json({ message: 'Tratamento atualizado com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar tratamento', details: error.message });
  }
});

// 10.2. Listar Planos de Tratamento

module.exports = router;

'use strict';
/** Trilha de auditoria. O autor vem sempre do token (req.usuario.nome),
 *  nunca de cabecalho enviado pelo cliente. */
const { pool } = require('../db');

async function logSystemEvent(actionType, description, author = 'Sistema', ipAddress = null) {
  try {
    const id = Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    await pool.query(
      'INSERT INTO system_logs (id, action_type, description, author, ip_address, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [id, actionType, description, author, ipAddress]
    );
  } catch (err) {
    console.error('Erro ao gravar log de sistema:', err.message);
  }
}


// ROTAS DO CRM

// Rota GET /api/logs (Consulta de auditoria imutável read-only)
module.exports = { logSystemEvent: logSystemEvent };

'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');

router.get('/api/logs', async function(req, res) {
  try {
    const [rows] = await pool.query(`
      SELECT 
        id, 
        action_type as actionType, 
        description, 
        author, 
        ip_address as ipAddress, 
        created_at as createdAt 
      FROM system_logs 
      ORDER BY created_at DESC 
      LIMIT 500
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar logs do sistema', details: error.message });
  }
});



// 1. Listar todos os leads

module.exports = router;

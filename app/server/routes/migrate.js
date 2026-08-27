'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');

router.post('/api/_migrate', async function (req, res) {
  const conn = await pool.getConnection();
  try {
    const run = require('../../db/run-migrations');
    const r = await run(conn, { statusOnly: req.query.status === '1' });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.sqlMessage || e.message });
  } finally {
    conn.release();
  }
});

// ---- GESTAO DE USUARIOS (T0.3) - somente admin, ver REGRAS_DE_PAPEL ----
const PAPEIS_VALIDOS = ['admin', 'gerente', 'profissional', 'vendedor'];

module.exports = router;

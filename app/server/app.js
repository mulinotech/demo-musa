'use strict';
/** Monta a aplicacao Express e a exporta SEM subir servidor.
 *  Quem escuta e o server/index.js — a separacao existe para os testes
 *  poderem instanciar a API sem abrir socket. */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (e) {
  // dotenv e opcional
}

const { porteiro } = require('./middleware/autenticacao');
const { exigirPapel } = require('./middleware/autorizacao');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || 'https://demo-musa.mulinotech.com' }));
app.use('/api', rateLimit({ windowMs: 60000, max: 120, standardHeaders: true, legacyHeaders: false }));

// A ordem importa: autenticar, autorizar, so entao interpretar o corpo e servir rotas.
app.use('/api', porteiro);
app.use('/api', exigirPapel);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// ---- ROTAS ----
// Cada arquivo declara os caminhos completos (/api/...), por isso montamos na raiz.
app.use(require('./routes/auth'));
app.use(require('./routes/logs'));
app.use(require('./routes/leads'));
app.use(require('./routes/salespeople'));
app.use(require('./routes/catalog'));
app.use(require('./routes/clients'));
app.use(require('./routes/treatments'));
app.use(require('./routes/treatment-plans'));
app.use(require('./routes/interactions'));
app.use(require('./routes/gemini'));
app.use(require('./routes/evolution'));
app.use(require('./routes/reports'));
app.use(require('./routes/users'));
app.use(require('./routes/pricing'));
app.use(require('./routes/finance'));
app.use(require('./routes/appointments'));
app.use(require('./routes/stock'));
app.use(require('./routes/loyalty'));
app.use(require('./routes/documents'));
app.use(require('./routes/migrate'));

// Rota curinga do SPA React: precisa ficar DEPOIS de todas as rotas /api.
if (fs.existsSync(distPath)) {
  app.get('*', function (req, res) {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

module.exports = app;

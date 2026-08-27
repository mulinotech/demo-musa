'use strict';

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const url = require('url');

// Carregar variáveis de ambiente do .env (se existir)
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (e) {
  // dotenv é opcional
}

const app = express();
// ---- AUTENTICACAO E AUTORIZACAO ----
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const auth = require('../auth');
const { pool } = require('./db');
const { logSystemEvent } = require('./services/logs');
const {
  SIMULATED_INSTANCES,
  EvolutionService,
  sendWhatsappText,
  getEvolutionManagerUrl,
  normalizeWhatsappNumber,
  jidToNumber
} = require('./services/evolution');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: 'https://demo-musa.mulinotech.com' }));
app.use('/api', rateLimit({ windowMs: 60000, max: 120, standardHeaders: true, legacyHeaders: false }));
const ROTAS_PUBLICAS = [
  { method: 'POST', path: '/api/leads' },
  { method: 'POST', path: '/api/auth/login' },
  { method: 'GET',  path: '/api/config' },
  { method: 'POST', path: '/api/webhook/whatsapp' }
];
app.use('/api', function (req, res, next) {
  res.set('X-Trava-Musa', 'v3');
  const caminho = req.originalUrl.split('?')[0];
  if (ROTAS_PUBLICAS.some(function (r) { return r.method === req.method && caminho === r.path; })) return next();
  const tokenUser = auth.usuarioDaRequisicao(req);
  if (tokenUser) { req.usuario = tokenUser; return next(); }
  return res.status(401).json({ error: 'Sessao nao autenticada ou expirada.' });
});
// ---- AUTORIZACAO POR PAPEL (T0.3 etapa 3) ----
const REGRAS_DE_PAPEL = [
  { metodo: '*',      prefixo: '/api/_migrate',          papeis: ['admin'] },
  { metodo: '*',      prefixo: '/api/logs',              papeis: ['admin', 'gerente'] },
  { metodo: 'POST',   prefixo: '/api/salespeople',       papeis: ['admin', 'gerente'] },
  { metodo: 'PATCH',  prefixo: '/api/salespeople',       papeis: ['admin', 'gerente'] },
  { metodo: 'DELETE', prefixo: '/api/salespeople',       papeis: ['admin', 'gerente'] },
  { metodo: 'POST',   prefixo: '/api/treatment-catalog', papeis: ['admin', 'gerente'] },
  { metodo: 'PATCH',  prefixo: '/api/treatment-catalog', papeis: ['admin', 'gerente'] },
  { metodo: 'DELETE', prefixo: '/api/treatment-catalog', papeis: ['admin', 'gerente'] },
  { metodo: 'DELETE', prefixo: '/api/clients',           papeis: ['admin', 'gerente'] },
  { metodo: '*',      prefixo: '/api/users',             papeis: ['admin'] }
];

app.use('/api', function (req, res, next) {
  const caminho = req.originalUrl.split('?')[0];
  const regra = REGRAS_DE_PAPEL.find(function (r) {
    return (r.metodo === '*' || r.metodo === req.method) && caminho.indexOf(r.prefixo) === 0;
  });
  if (!regra) return next();
  if (!req.usuario || regra.papeis.indexOf(req.usuario.papel) === -1) {
    return res.status(403).json({ error: 'Sem permissao para esta area.' });
  }
  next();
});
// ---- FIM DA AUTENTICACAO E AUTORIZACAO ----

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Servir arquivos estáticos do frontend React compilados (pasta dist)
const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// Configuração da Pool de Conexão com o MySQL na Cloudez

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
app.use(require('./routes/migrate'));

// Rota curinga do SPA React: precisa ficar DEPOIS de todas as rotas /api.
if (fs.existsSync(distPath)) {
  app.get('*', function (req, res) {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Iniciar o servidor no Socket UNIX da Cloudez ou na porta local
const SOCKET_PATH = '/srv/demo-musa.2d384ff2.configr.cloud/etc/nodejs/nodejs.sock';
const PORT = process.env.PORT || 3001;

// Verificar se estamos no servidor da Cloudez (socket existe) ou rodando localmente
if (fs.existsSync(path.dirname(SOCKET_PATH))) {
  // Remover socket antigo se existir para evitar conflito
  if (fs.existsSync(SOCKET_PATH)) {
    fs.unlinkSync(SOCKET_PATH);
  }
  const server = app.listen(SOCKET_PATH, function() {
    console.log('Servidor rodando no socket: ' + SOCKET_PATH);
    // Permissão necessária para o LiteSpeed acessar o socket
    fs.chmodSync(SOCKET_PATH, '777');
  });
} else {
  // Ambiente local - escutar em uma porta TCP normal
  app.listen(PORT, function() {
    console.log('Servidor rodando na porta ' + PORT);
  });
}

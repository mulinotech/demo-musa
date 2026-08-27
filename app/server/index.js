'use strict';
/** Ponto de subida do servidor. Socket UNIX na Cloudez, porta TCP em ambiente local. */

const fs = require('fs');
const path = require('path');
const app = require('./app');
const { verificarConexao } = require('./db');

verificarConexao();

const SOCKET_PATH = '/srv/demo-musa.2d384ff2.configr.cloud/etc/nodejs/nodejs.sock';
const PORT = process.env.PORT || 3001;

if (fs.existsSync(path.dirname(SOCKET_PATH))) {
  if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);
  app.listen(SOCKET_PATH, function () {
    console.log('Servidor rodando no socket: ' + SOCKET_PATH);
    fs.chmodSync(SOCKET_PATH, '777');
  });
} else {
  app.listen(PORT, function () {
    console.log('Servidor rodando na porta ' + PORT);
  });
}

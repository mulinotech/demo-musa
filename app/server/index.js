'use strict';
/** Ponto de subida do servidor. Socket UNIX na Cloudez, porta TCP em ambiente local. */

const fs = require('fs');
const path = require('path');
const app = require('./app');
const { pool, verificarConexao } = require('./db');
const lembretes = require('./workers/lembretes');
const expiracaoPontos = require('./workers/expiracao-pontos');
const { sendWhatsappText } = require('./services/evolution');

verificarConexao();

/* Relogio interno dos lembretes (T1.5). Roda a cada 15 minutos ENQUANTO o
 * processo estiver de pe -- e o LiteSpeed o recicla quando ninguem acessa, por
 * isso ele nao e a unica porta: POST /api/appointments/reminders/run faz a
 * mesma passada, para um cron do sistema chamar. As duas sao idempotentes.
 *
 * Nao envia nada enquanto `system_settings.lembretes_ativos` for '0', que e
 * como a migration 013 deixa. Ligar e um ato deliberado, feito na tela. */
lembretes.iniciar(pool, sendWhatsappText);

/* Expiracao de pontos (T5.4). Mesma historia do relogio dos lembretes: vale
 * enquanto o processo vive, e POST /api/loyalty/expire faz a mesma passada para
 * um cron do sistema chamar. A idempotencia e pelo id do acumulo, entao rodar
 * dez vezes no mesmo dia expira uma vez so. */
expiracaoPontos.iniciar(pool);

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

'use strict';
/** Pool de conexao com o MySQL. Instancia unica do processo — nenhum outro
 *  arquivo deve criar pool proprio. */
const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || '',
  password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
  database: process.env.DB_NAME || '',
  port: parseInt(process.env.DB_PORT || '3306'),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

/** O esquema e responsabilidade das migrations em db/migrations.
 *  Esta checagem existe so para o erro aparecer no log no boot — e e chamada
 *  pelo index.js, nunca no carregamento, para os testes nao tentarem conectar. */
function verificarConexao() {
  return pool.getConnection()
    .then(function (c) { console.log('Conexao com o MySQL estabelecida.'); c.release(); })
    .catch(function (e) { console.error('Falha na conexao com o MySQL:', e.message); });
}

module.exports = { pool: pool, dbConfig: dbConfig, verificarConexao: verificarConexao };

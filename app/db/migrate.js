'use strict';
/**
 * Runner de migrations do Musa CRM.
 *
 * Uso:  npm run migrate          aplica o que falta
 *       npm run migrate -- --status   só lista o estado, sem aplicar
 *
 * Regras:
 * - Cada arquivo em db/migrations/ é aplicado UMA vez, em ordem alfabética.
 * - Uma migration já aplicada NUNCA deve ser editada. Crie a próxima.
 * - Suporta .sql (statements separados por ';') e .js (module.exports = async (conn) => {}).
 *
 * Aviso: DDL em MySQL faz commit implícito. Não há rollback automático de uma
 * migration que falhe no meio. Mantenha cada arquivo pequeno e reversível na mão.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const DIR = path.join(__dirname, 'migrations');

async function conectar() {
  return mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_NAME,
    multipleStatements: false,
  });
}

async function garantirTabelaDeControle(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function listarArquivos() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR)
    .filter(f => f.endsWith('.sql') || f.endsWith('.js'))
    .sort();
}

/** Divide um .sql em statements, ignorando ';' dentro de string e comentários de linha. */
function dividirSql(sql) {
  return sql
    .split('\n')
    .filter(l => !l.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*$/m)
    .map(s => s.trim())
    .filter(Boolean);
}

async function aplicar(conn, arquivo) {
  const caminho = path.join(DIR, arquivo);
  if (arquivo.endsWith('.js')) {
    const up = require(caminho);
    if (typeof up !== 'function') throw new Error(`${arquivo} precisa exportar uma função async (conn)`);
    await up(conn);
  } else {
    for (const stmt of dividirSql(fs.readFileSync(caminho, 'utf8'))) {
      await conn.query(stmt);
    }
  }
}

(async () => {
  const apenasStatus = process.argv.includes('--status');
  let conn;
  try {
    conn = await conectar();
  } catch (e) {
    console.error('Nao foi possivel conectar ao banco:', e.code || e.message);
    console.error('Confira DB_HOST, DB_PORT, DB_USER, DB_PASSWORD e DB_NAME no .env.');
    process.exit(1);
  }

  try {
    await garantirTabelaDeControle(conn);
    const [linhas] = await conn.query('SELECT version FROM schema_migrations');
    const aplicadas = new Set(linhas.map(r => r.version));
    const arquivos = listarArquivos();

    if (apenasStatus) {
      console.log('versao'.padEnd(40) + 'estado');
      for (const f of arquivos) console.log(f.padEnd(40) + (aplicadas.has(f) ? 'aplicada' : 'PENDENTE'));
      return;
    }

    const pendentes = arquivos.filter(f => !aplicadas.has(f));
    if (pendentes.length === 0) {
      console.log('Nada a aplicar. Banco em dia com ' + arquivos.length + ' migration(s).');
      return;
    }

    for (const arquivo of pendentes) {
      process.stdout.write('-> ' + arquivo + ' ... ');
      await aplicar(conn, arquivo);
      await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [arquivo]);
      console.log('ok');
    }
    console.log('\n' + pendentes.length + ' migration(s) aplicada(s).');
  } catch (e) {
    console.error('\nFALHOU: ' + (e.sqlMessage || e.message));
    console.error('A migration que falhou NAO foi registrada. Corrija e rode de novo.');
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
})();

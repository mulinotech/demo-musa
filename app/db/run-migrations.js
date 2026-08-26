'use strict';
/**
 * Núcleo do runner de migrations, desacoplado da forma de conexão.
 *
 * Recebe uma conexão já aberta e aplica os arquivos de db/migrations que ainda
 * não constam em schema_migrations. Usado por:
 *   - db/migrate.js           (linha de comando, conecta pelo .env)
 *   - POST /api/_migrate      (rota temporária, usa o pool da aplicação)
 *
 * A rota existe porque as credenciais do .env do servidor estão defasadas — a
 * aplicação recebe as corretas por variável de ambiente injetada pelo painel do
 * Configr. Ela sai quando o deploy por git estiver de pé (T0.4).
 *
 * Aviso: DDL em MySQL faz commit implícito. Não há rollback de uma migration que
 * falhe no meio. Mantenha cada arquivo pequeno.
 */

const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, 'migrations');

function listar() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter(f => /\.(sql|js)$/.test(f)).sort();
}

function dividirSql(sql) {
  return sql
    .split('\n')
    .filter(l => !l.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*$/m)
    .map(s => s.trim())
    .filter(Boolean);
}

async function aplicar(conn, arq) {
  const p = path.join(DIR, arq);
  if (arq.endsWith('.js')) {
    const up = require(p);
    if (typeof up !== 'function') throw new Error(arq + ' precisa exportar async (conn)');
    await up(conn);
  } else {
    for (const s of dividirSql(fs.readFileSync(p, 'utf8'))) await conn.query(s);
  }
}

module.exports = async function run(conn, opts) {
  opts = opts || {};
  await conn.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (' +
    'version VARCHAR(255) PRIMARY KEY, ' +
    'applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP' +
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
  const [rows] = await conn.query('SELECT version FROM schema_migrations');
  const aplicadas = new Set(rows.map(r => r.version));
  const arquivos = listar();
  const pendentes = arquivos.filter(f => !aplicadas.has(f));

  if (opts.statusOnly) return { arquivos, jaAplicadas: [...aplicadas], pendentes };

  const feitas = [];
  for (const a of pendentes) {
    await aplicar(conn, a);
    await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [a]);
    feitas.push(a);
  }
  return { aplicadasAgora: feitas, total: feitas.length };
};

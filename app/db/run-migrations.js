'use strict';
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, 'migrations');
function listar() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter(f => /\.(sql|js)$/.test(f)).sort();
}
function dividirSql(sql) {
  return sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    .split(/;\s*$/m).map(s => s.trim()).filter(Boolean);
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
  await conn.query('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(255) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
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

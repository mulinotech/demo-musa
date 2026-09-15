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
/** Aplica uma migration e DEVOLVE o que ela devolver.
 *
 *  ===================================== POR QUE O RETORNO PASSOU A IMPORTAR
 *
 *  Em 09/09 a migration 021 contou quantas linhas preencheu por tabela e essa
 *  contagem foi para o `console.log` -- que nesta instalacao nao e guardado em
 *  arquivo nenhum (`log/lsws/error.log` esta em 0 byte desde 17/08). O estado
 *  final estava garantido, porque a 021 aborta se sobrar linha vazia; o quanto
 *  ela mexeu ficou irrecuperavel.
 *
 *  A regra que saiu dai foi "migration grava o relatorio em `system_logs`". So
 *  que `system_logs` sem clinica **nao aparece em tela nenhuma** desde a M1.6a,
 *  de proposito -- e a 022 caiu justamente nesse buraco: o relatorio existia,
 *  persistia, e ninguem conseguia ler sem abrir o banco.
 *
 *  Agora o relatorio volta na RESPOSTA de quem rodou a migration. Os dois
 *  caminhos ficam: o banco guarda para depois, a resposta mostra agora. */
async function aplicar(conn, arq) {
  const p = path.join(DIR, arq);
  if (arq.endsWith('.js')) {
    const up = require(p);
    if (typeof up !== 'function') throw new Error(arq + ' precisa exportar async (conn)');
    return await up(conn);
  }
  for (const s of dividirSql(fs.readFileSync(p, 'utf8'))) await conn.query(s);
  return undefined;
}
const run = async function (conn, opts) {
  opts = opts || {};
  await conn.query('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(255) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
  const [rows] = await conn.query('SELECT version FROM schema_migrations');
  const aplicadas = new Set(rows.map(r => r.version));
  const arquivos = listar();
  const pendentes = arquivos.filter(f => !aplicadas.has(f));
  if (opts.statusOnly) return { arquivos, jaAplicadas: [...aplicadas], pendentes };
  const feitas = [];
  const relatorios = {};
  for (const a of pendentes) {
    const relatorio = await aplicar(conn, a);
    await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [a]);
    feitas.push(a);
    // So entra quem tem algo a dizer. Migration que nao devolve nada nao ganha
    // uma chave vazia na resposta -- ruido esconde o que importa.
    if (relatorio !== undefined && relatorio !== null) relatorios[a] = relatorio;
  }
  const saida = { aplicadasAgora: feitas, total: feitas.length };
  if (Object.keys(relatorios).length) saida.relatorios = relatorios;
  return saida;
};

module.exports = run;
// `aplicar` e exportada para o teste poder exercitar UMA migration com banco de
// mentira, em vez de rodar as 22 -- que exigiria MySQL e tornaria o teste
// dependente de banco, coisa que esta suite nao faz de proposito.
module.exports.aplicar = aplicar;

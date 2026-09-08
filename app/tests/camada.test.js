'use strict';
/** A camada de acesso por clínica (M0.4) e a catraca da M1.
 *
 *  O coração aqui é o analisador de SQL. Se ele contar um `?` a mais ou a
 *  menos, todos os parâmetros seguintes deslizam uma casa — e deslizar
 *  parâmetro não dá erro de sintaxe: dá **resultado errado**. Um `WHERE
 *  clinica_id = ?` que recebe o valor da coluna seguinte devolve linhas da
 *  clínica errada, calado. Por isso os casos abaixo são chatos de propósito.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const escopo = require('../server/db/escopo');
const naoConvertidos = require('../server/db/nao-convertidos');

const CL = 'cl_1';

/* ============================================================ o analisador */

test('a marca vira ? e o valor da clinica entra na posicao dela', function () {
  const p = escopo.preparar(
    'SELECT * FROM clients WHERE clinica_id = :clinica AND status = ?', ['ativo'], CL);
  assert.strictEqual(p.sql, 'SELECT * FROM clients WHERE clinica_id = ? AND status = ?');
  assert.deepStrictEqual(p.params, [CL, 'ativo']);
});

test('a marca no MEIO nao desalinha os parametros', function () {
  const p = escopo.preparar(
    'SELECT * FROM a WHERE x = ? AND clinica_id = :clinica AND y = ?', [1, 2], CL);
  assert.deepStrictEqual(p.params, [1, CL, 2]);
});

test('a marca no FIM tambem', function () {
  const p = escopo.preparar('SELECT * FROM a WHERE x = ? AND clinica_id = :clinica', [9], CL);
  assert.deepStrictEqual(p.params, [9, CL]);
});

test('a marca repetida entra em todas as posicoes', function () {
  const p = escopo.preparar(
    'SELECT * FROM a JOIN b ON b.clinica_id = :clinica WHERE a.clinica_id = :clinica AND z = ?',
    ['z'], CL);
  assert.deepStrictEqual(p.params, [CL, CL, 'z']);
});

test('dois-pontos dentro de literal NAO vira marca', function () {
  // O caso real deste projeto: DATE_FORMAT(x, '%Y-%m-%d %H:%i:%s'). Se o
  // analisador enxergasse `:s` ou `:i` como marca, tudo desliza.
  const sql = "SELECT DATE_FORMAT(x, '%Y-%m-%d %H:%i:%s') AS q FROM a " +
              'WHERE clinica_id = :clinica AND id = ?';
  const p = escopo.preparar(sql, ['x1'], CL);
  assert.deepStrictEqual(p.params, [CL, 'x1']);
  assert.ok(p.sql.includes("'%Y-%m-%d %H:%i:%s'"), 'o literal tem de sair intacto');
});

test('interrogacao dentro de literal NAO conta como parametro', function () {
  const sql = "SELECT * FROM a WHERE clinica_id = :clinica AND msg = 'tudo bem?' AND id = ?";
  const p = escopo.preparar(sql, ['x1'], CL);
  assert.deepStrictEqual(p.params, [CL, 'x1']);
});

test('aspas escapadas nao confundem o fim do literal', function () {
  const sql = "SELECT * FROM a WHERE clinica_id = :clinica AND n = 'D''Avila' AND id = ?";
  const p = escopo.preparar(sql, [7], CL);
  assert.deepStrictEqual(p.params, [CL, 7]);

  const sql2 = 'SELECT * FROM a WHERE clinica_id = :clinica AND n = "D\\"Avila" AND id = ?';
  assert.deepStrictEqual(escopo.preparar(sql2, [7], CL).params, [CL, 7]);
});

test('crase (nome de coluna) tambem e literal para o analisador', function () {
  const p = escopo.preparar('SELECT `a?b` FROM t WHERE clinica_id = :clinica AND id = ?', [3], CL);
  assert.deepStrictEqual(p.params, [CL, 3]);
});

test('comentario nao vira marca nem parametro', function () {
  const sql = 'SELECT * FROM a\n' +
              '-- por que? porque :clinica aqui e comentario\n' +
              '/* e ? aqui tambem */\n' +
              'WHERE clinica_id = :clinica AND id = ?';
  const p = escopo.preparar(sql, [5], CL);
  assert.deepStrictEqual(p.params, [CL, 5]);
});

test('`:clinicas` NAO e a marca `:clinica`', function () {
  // Sem a checagem do caractere seguinte, `:clinica` casaria dentro de
  // `:clinicas` e deixaria um `s` solto na SQL.
  assert.throws(() => escopo.exigirFiltro('SELECT * FROM a WHERE x = :clinicas'),
    /sem `:clinica`/);
});

test('parametro a mais ou a menos e acusado com mensagem util', function () {
  assert.throws(
    () => escopo.preparar('SELECT * FROM a WHERE clinica_id = :clinica AND x = ?', [], CL),
    /1 parametro\(s\) `\?` e voce passou 0/);
  assert.throws(
    () => escopo.preparar('SELECT * FROM a WHERE clinica_id = :clinica', [1, 2], CL),
    /0 parametro\(s\) `\?` e voce passou 2/);
});

/* ==================================================== as duas conferencias */

test('consulta SEM a marca e recusada', function () {
  assert.throws(() => escopo.exigirFiltro('SELECT * FROM clients'), /sem `:clinica`/);
});

test('a recusa ensina o que fazer, inclusive a saida legitima', function () {
  try {
    escopo.exigirFiltro('SELECT * FROM clients');
    assert.fail('devia ter recusado');
  } catch (e) {
    assert.match(e.message, /WHERE clinica_id = :clinica/);
    assert.match(e.message, /todasAsClinicas/);
  }
});

test('marca sem a COLUNA nao passa', function () {
  // `SELECT :clinica AS x FROM clients` tem a marca e nao filtra nada. Era o
  // atalho obvio para calar a camada.
  assert.throws(() => escopo.exigirFiltro('SELECT :clinica AS x FROM clients'),
    /nao menciona a coluna `clinica_id`/);
});

test('a coluna citada so dentro de literal nao vale', function () {
  assert.throws(
    () => escopo.exigirFiltro("SELECT :clinica AS x, 'clinica_id' AS y FROM clients"),
    /nao menciona a coluna `clinica_id`/);
});

test('consulta correta passa nas duas conferencias', function () {
  escopo.exigirFiltro('SELECT * FROM clients WHERE clinica_id = :clinica');
  escopo.exigirFiltro('SELECT * FROM a JOIN b ON b.clinica_id = a.clinica_id ' +
                      'WHERE a.clinica_id = :clinica');
});

/* ========================================================= a clinica vem da sessao */

test('escopo(req) recusa requisicao sem sessao', function () {
  assert.throws(() => escopo({}), /sem clinica na sessao/);
  assert.throws(() => escopo({ usuario: {} }), /sem clinica na sessao/);
  assert.throws(() => escopo(null), /sem clinica na sessao/);
});

test('a clinica NAO pode vir do corpo nem do endereco', function () {
  // Se viesse, bastaria trocar um numero na requisicao para ler a clinica do
  // vizinho. O teste finge a tentativa mais obvia.
  const req = { body: { clinicaId: 'cl_9' }, params: { clinicaId: 'cl_9' }, query: { clinicaId: 'cl_9' } };
  assert.throws(() => escopo(req), /sem clinica na sessao/);
});

test('com sessao, o escopo usa a clinica da sessao', async function () {
  const visto = [];
  const db = escopo.fazerEscopo('cl_7', { query: async (s, p) => { visto.push({ s, p }); return [[]]; } });
  await db.q('SELECT * FROM clients WHERE clinica_id = :clinica AND id = ?', ['c1']);
  assert.deepStrictEqual(visto[0].p, ['cl_7', 'c1']);
});

test('escopo sem clinica nao chega a existir', function () {
  assert.throws(() => escopo.fazerEscopo(null, { query: async () => [[]] }), /sem clinica/);
  assert.throws(() => escopo.fazerEscopo('', { query: async () => [[]] }), /sem clinica/);
});

test('a consulta so chega ao banco depois de conferida', async function () {
  let chegou = false;
  const db = escopo.fazerEscopo(CL, { query: async () => { chegou = true; return [[]]; } });
  await assert.rejects(() => db.q('SELECT * FROM clients', []), /sem `:clinica`/);
  assert.strictEqual(chegou, false, 'consulta sem filtro nao pode nem tocar o banco');
});

/* ================================================= a saida para todas as clinicas */

test('todasAsClinicas exige motivo escrito', function () {
  assert.throws(() => escopo.todasAsClinicas(), /motivo escrito/);
  assert.throws(() => escopo.todasAsClinicas(''), /motivo escrito/);
  assert.throws(() => escopo.todasAsClinicas('porque sim'), /motivo escrito/);
});

test('com motivo, ela existe e guarda o motivo', function () {
  const t = escopo.todasAsClinicas('varredura de lembretes percorre todas as clinicas');
  assert.match(t.motivo, /varredura de lembretes/);
  assert.strictEqual(typeof t.q, 'function');
});

/* ================================================================== a catraca */

const DIR_ROTAS = path.join(__dirname, '..', 'server', 'routes');

function usaBancoDireto(arquivo) {
  const fonte = fs.readFileSync(path.join(DIR_ROTAS, arquivo), 'utf8');
  // O `codigo` do analisador apaga literais e comentarios; aqui basta o texto,
  // porque `pool.query(` dentro de comentario tambem e sinal de conversao
  // incompleta (alguem comentou em vez de converter).
  return /\b(pool|conn)\.query\s*\(/.test(fonte);
}

test('todo arquivo de rota que fala com o banco direto esta na catraca', function () {
  const fora = fs.readdirSync(DIR_ROTAS)
    .filter((f) => f.endsWith('.js'))
    .filter(usaBancoDireto)
    .filter((f) => naoConvertidos.indexOf(f) === -1);

  assert.deepStrictEqual(fora, [],
    'Estes arquivos usam pool.query sem estar na catraca:\n  ' + fora.join('\n  ') +
    '\nOu converta para escopo(req), ou acrescente a server/db/nao-convertidos.js ' +
    'com o numero da tarefa da M1. Rota nova NAO entra na catraca: ja nasce convertida.');
});

test('a catraca so encolhe: item que nao usa mais o banco direto tem de sair', function () {
  const sobrando = naoConvertidos.filter(function (f) {
    if (!fs.existsSync(path.join(DIR_ROTAS, f))) return true;   // arquivo sumiu
    return !usaBancoDireto(f);
  });

  assert.deepStrictEqual(sobrando, [],
    'Estes ja nao usam o banco direto e continuam na catraca:\n  ' + sobrando.join('\n  ') +
    '\nTire-os de server/db/nao-convertidos.js. Lista que nao encolhe vira decoracao, ' +
    'e ninguem percebe quando ela para de proteger.');
});

test('a catraca nao tem nome repetido nem arquivo inexistente', function () {
  assert.strictEqual(new Set(naoConvertidos).size, naoConvertidos.length, 'nome repetido');
  for (const f of naoConvertidos) {
    assert.ok(fs.existsSync(path.join(DIR_ROTAS, f)), f + ' nao existe em server/routes/');
  }
});

test('o tamanho da catraca hoje, para o progresso da M1 ser visivel', function () {
  // Este numero DEVE cair a cada tarefa da M1. Quando chegar a zero, apague
  // nao-convertidos.js e os tres testes acima.
  assert.strictEqual(naoConvertidos.length, 19,
    'a catraca mudou de tamanho -- atualize este numero junto, de proposito: ' +
    'e o registro de que alguem olhou.');
});

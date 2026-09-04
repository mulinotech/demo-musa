'use strict';
/** O token de serviço do agendador.
 *
 *  O que estes testes existem para impedir, em uma frase: que um token criado
 *  para mandar o servidor conferir lembretes vire uma chave para ler a ficha
 *  das pacientes.
 */
const test = require('node:test');
const assert = require('node:assert');

const cron = require('../server/middleware/cron');
const { exigirPapel } = require('../server/middleware/autorizacao');

/* ------------------------------------------------------- lista de rotas */

test('a lista de rotas do cron tem exatamente as duas varreduras', function () {
  // Se esta lista crescer, alguem precisa ter respondido a pergunta: a rota
  // nova e idempotente e nao devolve dado de paciente? O teste quebra de
  // proposito para forcar a resposta.
  assert.deepStrictEqual(cron.ROTAS_DE_CRON, [
    { metodo: 'POST', caminho: '/api/appointments/reminders/run' },
    { metodo: 'POST', caminho: '/api/loyalty/expire' }
  ]);
});

test('rota de cron so casa com o metodo certo', function () {
  assert.strictEqual(cron.ehRotaDeCron('POST', '/api/appointments/reminders/run'), true);
  assert.strictEqual(cron.ehRotaDeCron('GET', '/api/appointments/reminders/run'), false);
  assert.strictEqual(cron.ehRotaDeCron('POST', '/api/loyalty/expire'), true);
});

test('caminho parecido nao passa por parecenca', function () {
  assert.strictEqual(cron.ehRotaDeCron('POST', '/api/loyalty/expire/tudo'), false);
  assert.strictEqual(cron.ehRotaDeCron('POST', '/api/loyalty/expired'), false);
  assert.strictEqual(cron.ehRotaDeCron('POST', '/api/clients'), false);
  assert.strictEqual(cron.ehRotaDeCron('POST', '/api/appointments'), false);
});

/* ------------------------------------------------------------ comparacao */

test('a comparacao de token e por igualdade exata', function () {
  assert.strictEqual(cron.iguais('abc123', 'abc123'), true);
  assert.strictEqual(cron.iguais('abc123', 'abc124'), false);
  assert.strictEqual(cron.iguais('abc123', 'abc12'), false);   // prefixo nao serve
  assert.strictEqual(cron.iguais('abc123', 'abc1234'), false); // sufixo tambem nao
});

test('token vazio nunca confere, nem contra token vazio', function () {
  // Se o banco devolvesse string vazia por qualquer motivo, um cabecalho vazio
  // passaria a valer. Este e o caso que abriria as duas rotas para todo mundo.
  assert.strictEqual(cron.iguais('', ''), false);
  assert.strictEqual(cron.iguais(null, null), false);
  assert.strictEqual(cron.iguais(undefined, ''), false);
});

/* ------------------------------------------------------ identidade real */

function poolFalso(valor) {
  return {
    query: async function () {
      return [valor === null ? [] : [{ valor: valor }]];
    }
  };
}

const REQ = (headers, metodo) => ({ headers: headers || {}, method: metodo || 'POST' });
const CAMINHO = '/api/loyalty/expire';
const BOM = 'f'.repeat(64);

test('token certo na rota certa devolve a identidade de servico', async function () {
  const id = await cron.identidadeDeCron(poolFalso(BOM), REQ({ 'x-musa-cron': BOM }), CAMINHO);
  assert.strictEqual(id && id.servico, true);
  assert.strictEqual(id.papel, 'servico');
  assert.strictEqual(id.sub, null, 'a rotina nao e uma pessoa e nao tem id de usuario');
});

test('token certo em rota FORA da lista nao devolve nada', async function () {
  // O teste que importa. Um token que vaza nao vira leitura de prontuario.
  for (const caminho of ['/api/clients', '/api/clients/c1/documents', '/api/users', '/api/finance']) {
    const id = await cron.identidadeDeCron(poolFalso(BOM), REQ({ 'x-musa-cron': BOM }), caminho);
    assert.strictEqual(id, null, caminho + ' nao pode aceitar o token do cron');
  }
});

test('token errado na rota certa nao devolve nada', async function () {
  const id = await cron.identidadeDeCron(poolFalso(BOM), REQ({ 'x-musa-cron': 'e'.repeat(64) }), CAMINHO);
  assert.strictEqual(id, null);
});

test('sem cabecalho nao ha identidade', async function () {
  assert.strictEqual(await cron.identidadeDeCron(poolFalso(BOM), REQ({}), CAMINHO), null);
});

test('token ausente no banco nao libera nada', async function () {
  // Instalacao onde a migration 017 ainda nao rodou.
  assert.strictEqual(await cron.identidadeDeCron(poolFalso(null), REQ({ 'x-musa-cron': BOM }), CAMINHO), null);
  assert.strictEqual(await cron.identidadeDeCron(poolFalso(''), REQ({ 'x-musa-cron': '' }), CAMINHO), null);
});

test('metodo errado na rota certa nao devolve nada', async function () {
  const id = await cron.identidadeDeCron(poolFalso(BOM), REQ({ 'x-musa-cron': BOM }, 'GET'), CAMINHO);
  assert.strictEqual(id, null);
});

/* --------------------------------------------- a marca `servico` e o unico
                                                  passaporte na autorizacao */

function resFalso() {
  const r = { codigo: null, corpo: null };
  r.status = function (c) { r.codigo = c; return r; };
  r.json = function (b) { r.corpo = b; return r; };
  return r;
}

function passou(usuario, metodo, url) {
  const req = { usuario: usuario, method: metodo, originalUrl: url };
  const res = resFalso();
  let seguiu = false;
  exigirPapel(req, res, function () { seguiu = true; });
  return seguiu;
}

test('a rotina automatica atravessa a tabela de papeis', function () {
  assert.strictEqual(passou(cron.IDENTIDADE, 'POST', '/api/loyalty/expire'), true);
});

test('um papel inventado NAO vira rotina automatica', function () {
  // A marca e `servico: true`, nunca o texto do papel. Sem isto, bastaria um
  // token assinado com papel 'servico' para herdar a passagem.
  const impostor = { sub: 'u1', papel: 'servico', nome: 'Nao sou o cron' };
  assert.strictEqual(passou(impostor, '*', '/api/finance'), false);
  assert.strictEqual(passou(impostor, 'GET', '/api/pricing'), false);
});

test('vendedor continua barrado onde sempre esteve', function () {
  const v = { sub: 'u2', papel: 'vendedor' };
  assert.strictEqual(passou(v, 'GET', '/api/finance'), false);
  assert.strictEqual(passou(v, 'GET', '/api/clients/c1/documents'), false);
});

/* ------------------------------------------------- o defeito de 03/09 */

test('passar o modulo server/db em vez do pool GRITA, nao devolve 401', async function () {
  // O que aconteceu de verdade: `require('../db')` devolve { pool, dbConfig,
  // verificarConexao }, e nao o pool. `pool.query` virou undefined, a chamada
  // estourou, o catch do porteiro engoliu, e a resposta saiu 401 -- igualzinha
  // a de token errado. Erro de ligacao tem de ser distinguivel de credencial
  // ruim, senao se procura no lugar errado.
  const moduloInteiro = { pool: { query: async () => [[]] }, dbConfig: {}, verificarConexao: () => {} };
  await assert.rejects(
    () => cron.identidadeDeCron(moduloInteiro, REQ({ 'x-musa-cron': BOM }), CAMINHO),
    TypeError
  );
  await assert.rejects(
    () => cron.identidadeDeCron(null, REQ({ 'x-musa-cron': BOM }), CAMINHO),
    TypeError
  );
});

test('o pool de verdade continua funcionando', async function () {
  // A contraprova: com um objeto que TEM query, nao ha excecao nenhuma.
  const id = await cron.identidadeDeCron(poolFalso(BOM), REQ({ 'x-musa-cron': BOM }), CAMINHO);
  assert.strictEqual(id && id.servico, true);
});

test('a checagem de ligacao vem DEPOIS da checagem de rota', async function () {
  // Rota fora da lista nao chega nem a olhar o pool: quem manda o cabecalho
  // para /api/clients recebe null, nao uma excecao que vira 500 e vaza que a
  // rota existe.
  const id = await cron.identidadeDeCron(null, REQ({ 'x-musa-cron': BOM }), '/api/clients');
  assert.strictEqual(id, null);
});

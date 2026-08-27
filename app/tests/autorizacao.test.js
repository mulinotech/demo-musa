'use strict';
/** A tabela REGRAS_DE_PAPEL decide quem entra onde. Estes testes travam o
 *  comportamento do casamento de prefixo, que e onde o erro passa despercebido. */

const { test } = require('node:test');
const assert = require('node:assert');
const { regraPara } = require('../server/middleware/autorizacao');

test('rota sem regra nao exige papel', function () {
  assert.strictEqual(regraPara('GET', '/api/leads'), null);
  assert.strictEqual(regraPara('GET', '/api/clients'), null);
});

test('logs exigem admin ou gerente, em qualquer metodo', function () {
  const r = regraPara('GET', '/api/logs');
  assert.deepStrictEqual(r.papeis, ['admin', 'gerente']);
});

test('regra por metodo nao vaza para outro metodo', function () {
  assert.strictEqual(regraPara('GET', '/api/salespeople'), null);
  assert.deepStrictEqual(regraPara('POST', '/api/salespeople').papeis, ['admin', 'gerente']);
  assert.deepStrictEqual(regraPara('DELETE', '/api/salespeople/v_1').papeis, ['admin', 'gerente']);
});

test('a regra vale para o caminho exato e para os filhos dele', function () {
  assert.deepStrictEqual(regraPara('PATCH', '/api/users').papeis, ['admin']);
  assert.deepStrictEqual(regraPara('PATCH', '/api/users/u_123').papeis, ['admin']);
});

test('prefixo nao contamina caminho que apenas comeca igual', function () {
  // '/api/logs-publicos' nao pode herdar a regra de '/api/logs'
  assert.strictEqual(regraPara('GET', '/api/logs-publicos'), null);
  assert.strictEqual(regraPara('GET', '/api/usersimulado'), null);
});

test('gestao de usuarios e exclusiva de admin', function () {
  ['GET', 'POST', 'PATCH', 'DELETE'].forEach(function (m) {
    assert.deepStrictEqual(regraPara(m, '/api/users').papeis, ['admin'], m + ' deveria exigir admin');
  });
});

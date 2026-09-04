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

test('precificacao e de admin e gerente, nunca de quem atende', function () {
  ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].forEach(function (m) {
    assert.deepStrictEqual(regraPara(m, '/api/pricing/settings').papeis, ['admin', 'gerente'], m);
    assert.deepStrictEqual(regraPara(m, '/api/fixed-costs').papeis, ['admin', 'gerente'], m);
  });
  assert.deepStrictEqual(regraPara('POST', '/api/pricing/simulate').papeis, ['admin', 'gerente']);
  assert.deepStrictEqual(regraPara('DELETE', '/api/fixed-costs/fc_123').papeis, ['admin', 'gerente']);
});

test('prefixo de precificacao nao contamina caminho parecido', function () {
  assert.strictEqual(regraPara('GET', '/api/pricing-publico'), null);
  assert.strictEqual(regraPara('GET', '/api/fixed-costs-resumo'), null);
});

test('financeiro e de admin e gerente: profissional nao ve o caixa da clinica', function () {
  ['GET', 'POST', 'PATCH', 'DELETE'].forEach(function (m) {
    assert.deepStrictEqual(regraPara(m, '/api/finance/entries').papeis, ['admin', 'gerente'], m);
    assert.deepStrictEqual(regraPara(m, '/api/recurring-expenses').papeis, ['admin', 'gerente'], m);
  });
  assert.deepStrictEqual(regraPara('GET', '/api/finance/summary').papeis, ['admin', 'gerente']);
  assert.deepStrictEqual(regraPara('PATCH', '/api/finance/entries/ce_1/pay').papeis, ['admin', 'gerente']);
});

test('agenda nao entra em REGRAS_DE_PAPEL: o recorte e por dono, nao por papel', function () {
  // Todo mundo autenticado abre a agenda. Quem e `profissional` so enxerga a
  // propria, e isso a rota decide comparando o dono do registro - uma linha
  // nesta tabela nao daria conta, porque ela so conhece papel e caminho.
  ['GET', 'POST', 'PATCH', 'DELETE'].forEach(function (m) {
    assert.strictEqual(regraPara(m, '/api/appointments'), null, m);
    assert.strictEqual(regraPara(m, '/api/appointments/ap_1'), null, m);
  });
  assert.strictEqual(regraPara('GET', '/api/availability'), null);
});

test('estoque: profissional LE, mas nao mexe no saldo', function () {
  // A ordem das linhas na tabela importa: a regra de GET vem antes da regra
  // curinga. Se alguem reordenar, o profissional perde a consulta de saldo em
  // silencio -- e vai aplicar produto sem saber a validade.
  const ler = (c) => (regraPara('GET', c) || {}).papeis || [];
  const escrever = (m, c) => (regraPara(m, c) || {}).papeis || [];
  assert.ok(ler('/api/stock/balance').includes('profissional'), 'saldo e consultavel');
  assert.ok(ler('/api/products').includes('profissional'), 'produtos sao consultaveis');
  assert.ok(!escrever('POST', '/api/stock/entry').includes('profissional'), 'entrada nao');
  assert.ok(!escrever('POST', '/api/products').includes('profissional'), 'cadastro nao');
  assert.ok(!escrever('PUT', '/api/services/cat_1/supplies').includes('profissional'), 'ficha tecnica nao');
});

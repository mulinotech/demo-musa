'use strict';
/** O token e a unica fonte de identidade e papel no sistema.
 *  Se estes testes passarem a falhar, a autorizacao inteira esta comprometida. */

process.env.JWT_SECRET = 'segredo-apenas-de-teste-nao-usar-em-producao';

const { test } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const auth = require('../auth');

function req(cabecalho) {
  return { headers: cabecalho ? { authorization: cabecalho } : {} };
}

test('token valido devolve papel, nome e vinculo com o vendedor', function () {
  const token = auth.gerarToken({ id: 'u_1', name: 'Silvia', role: 'admin', salesperson_id: 'v_9' });
  const u = auth.usuarioDaRequisicao(req('Bearer ' + token));
  assert.ok(u, 'deveria decodificar');
  assert.strictEqual(u.papel, 'admin');
  assert.strictEqual(u.nome, 'Silvia');
  assert.strictEqual(u.sub, 'u_1');
  assert.strictEqual(u.vendedorId, 'v_9');
});

test('vendedor sem vinculo tem vendedorId nulo, nunca indefinido', function () {
  const token = auth.gerarToken({ id: 'u_2', name: 'Rodrigo', role: 'vendedor' });
  const u = auth.usuarioDaRequisicao(req('Bearer ' + token));
  assert.strictEqual(u.vendedorId, null);
});

test('sem cabecalho Authorization nao ha usuario', function () {
  assert.strictEqual(auth.usuarioDaRequisicao(req()), null);
});

test('autenticacao basica nao e aceita — ela saiu na T0.3', function () {
  const basica = 'Basic ' + Buffer.from('musa:qualquer').toString('base64');
  assert.strictEqual(auth.usuarioDaRequisicao(req(basica)), null);
});

test('token adulterado e recusado', function () {
  const token = auth.gerarToken({ id: 'u_3', name: 'Alguem', role: 'vendedor' });
  const partes = token.split('.');
  const carga = JSON.parse(Buffer.from(partes[1], 'base64url').toString());
  carga.papel = 'admin';
  partes[1] = Buffer.from(JSON.stringify(carga)).toString('base64url');
  assert.strictEqual(auth.usuarioDaRequisicao(req('Bearer ' + partes.join('.'))), null);
});

test('token expirado e recusado', function () {
  const vencido = jwt.sign({ sub: 'u_4', nome: 'Antigo', papel: 'admin' },
    process.env.JWT_SECRET, { expiresIn: '-10s' });
  assert.strictEqual(auth.usuarioDaRequisicao(req('Bearer ' + vencido)), null);
});

test('token assinado com outro segredo e recusado', function () {
  const forjado = jwt.sign({ sub: 'x', nome: 'Forjado', papel: 'admin' }, 'outro-segredo');
  assert.strictEqual(auth.usuarioDaRequisicao(req('Bearer ' + forjado)), null);
});

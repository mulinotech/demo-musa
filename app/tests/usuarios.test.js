'use strict';
/** A tela de usuarios (T0.5) tornou clicavel o que antes exigia SSH. Estes
 *  testes travam as duas travas que impedem alguem de se trancar do lado de
 *  fora do proprio sistema. */

const { test } = require('node:test');
const assert = require('node:assert');
const { verificarAlteracao } = require('../server/services/usuarios');

const ADMIN = { id: 'u_1', name: 'Silvia', role: 'admin', status: 'active' };
const OUTRO_ADMIN = { id: 'u_2', name: 'Rodrigo', role: 'admin', status: 'active' };
const VENDEDOR = { id: 'u_9', name: 'Convidado', role: 'vendedor', status: 'active' };

test('trocar a propria senha continua permitido', function () {
  const r = verificarAlteracao({
    solicitanteId: 'u_1', alvo: ADMIN, mudanca: { password: 'uma-senha-bem-longa' }, adminsAtivos: 1
  });
  assert.strictEqual(r, null);
});

test('admin nao consegue inativar a si mesmo', function () {
  const r = verificarAlteracao({
    solicitanteId: 'u_1', alvo: ADMIN, mudanca: { status: 'inactive' }, adminsAtivos: 3
  });
  assert.ok(r, 'deveria impedir');
  assert.strictEqual(r.status, 400);
});

test('admin nao consegue rebaixar a si mesmo', function () {
  const r = verificarAlteracao({
    solicitanteId: 'u_1', alvo: ADMIN, mudanca: { role: 'vendedor' }, adminsAtivos: 3
  });
  assert.ok(r, 'deveria impedir');
  assert.strictEqual(r.status, 400);
});

test('o unico administrador ativo nao pode ser inativado por ninguem', function () {
  const r = verificarAlteracao({
    solicitanteId: 'u_2', alvo: ADMIN, mudanca: { status: 'inactive' }, adminsAtivos: 1
  });
  assert.ok(r, 'deveria impedir');
  assert.strictEqual(r.status, 409);
});

test('o unico administrador ativo nao pode ser rebaixado por ninguem', function () {
  const r = verificarAlteracao({
    solicitanteId: 'u_2', alvo: ADMIN, mudanca: { role: 'gerente' }, adminsAtivos: 1
  });
  assert.ok(r, 'deveria impedir');
  assert.strictEqual(r.status, 409);
});

test('com dois administradores ativos, inativar um deles e permitido', function () {
  const r = verificarAlteracao({
    solicitanteId: 'u_1', alvo: OUTRO_ADMIN, mudanca: { status: 'inactive' }, adminsAtivos: 2
  });
  assert.strictEqual(r, null);
});

test('inativar um vendedor nunca esbarra na regra de administrador', function () {
  const r = verificarAlteracao({
    solicitanteId: 'u_1', alvo: VENDEDOR, mudanca: { status: 'inactive' }, adminsAtivos: 1
  });
  assert.strictEqual(r, null);
});

test('promover alguem a admin nunca e bloqueado', function () {
  const r = verificarAlteracao({
    solicitanteId: 'u_1', alvo: VENDEDOR, mudanca: { role: 'admin' }, adminsAtivos: 1
  });
  assert.strictEqual(r, null);
});

test('reativar um admin inativo nao dispara a trava', function () {
  const inativo = { id: 'u_3', name: 'Pedro', role: 'admin', status: 'inactive' };
  const r = verificarAlteracao({
    solicitanteId: 'u_1', alvo: inativo, mudanca: { status: 'active' }, adminsAtivos: 1
  });
  assert.strictEqual(r, null);
});

test('renomear nao e alteracao de acesso', function () {
  const r = verificarAlteracao({
    solicitanteId: 'u_1', alvo: ADMIN, mudanca: { name: 'Silvia M.' }, adminsAtivos: 1
  });
  assert.strictEqual(r, null);
});

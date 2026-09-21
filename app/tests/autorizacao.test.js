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

/* ============ A AGENDA MUDOU DE REGRA NA M5.2 (15/09), e este teste conta a
 * decisao NOVA -- ele nao foi apagado, foi reescrito.
 *
 * ANTES: nenhuma linha na tabela. O recorte era so por DONO, dentro da rota:
 * todo autenticado abria a agenda, e `profissional` mexia apenas na propria.
 *
 * AGORA: a LEITURA continua sem linha nenhuma (o recorte por dono segue
 * valendo), mas ESCREVER saiu do alcance do `vendedor`. Decisao da Silvia
 * depois de ver, medido, o que o papel alcancava: o vendedor trabalha o que e
 * comercial e nao mexe no calendario de quem atende.
 *
 * O caso que pesou e `PATCH /api/appointments/:id/status` -- concluir. Concluir
 * lanca receita, baixa insumo e credita ponto de uma vez. Quem nunca aplicou o
 * procedimento nao e quem deve declarar que ele aconteceu. */
test('agenda: a LEITURA e de todos, e ESCREVER nao e do vendedor', function () {
  // A leitura segue sem linha: quem recorta e o dono, dentro da rota.
  assert.strictEqual(regraPara('GET', '/api/appointments'), null);
  assert.strictEqual(regraPara('GET', '/api/appointments/ap_1'), null);
  assert.strictEqual(regraPara('GET', '/api/availability'), null);

  // Escrever tem linha, e ela exclui o vendedor -- nunca os outros tres.
  ['POST', 'PATCH', 'PUT', 'DELETE'].forEach(function (m) {
    const r = regraPara(m, '/api/appointments');
    assert.ok(r, m + ' precisa de regra: sem ela o vendedor volta a marcar');
    assert.ok(!r.papeis.includes('vendedor'), m + ' nao pode ser do vendedor');
    ['admin', 'gerente', 'profissional'].forEach(function (p) {
      assert.ok(r.papeis.includes(p), m + ' tem de continuar valendo para ' + p);
    });
  });

  // E o caminho COM ID tambem. A regra e por prefixo, mas quem le precisa ver
  // isso afirmado: foi um `padrao` esquecido que abriu /api/clients/:id/documents
  // uma vez, e a licao custou caro.
  const status = regraPara('PATCH', '/api/appointments/ap_1/status');
  assert.ok(status && !status.papeis.includes('vendedor'),
    'concluir atendimento nao pode ser do vendedor');
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

test('a Visao Geral abre para quem ve a tela; o dinheiro dela, so para a gestao', function () {
  // A ordem das duas linhas na tabela e o proprio conserto: /api/dashboard
  // cobriria /api/dashboard/dinheiro se viesse antes, e a profissional passaria
  // a ver faturamento e CPL -- justamente o que /api/finance lhe nega.
  const geral = regraPara('GET', '/api/dashboard/visao-geral');
  assert.ok(geral, 'a visao geral precisa de regra: sem ela o vendedor entra');
  assert.deepStrictEqual(geral.papeis, ['admin', 'gerente', 'profissional']);
  assert.ok(!geral.papeis.includes('vendedor'));

  const dinheiro = regraPara('GET', '/api/dashboard/dinheiro');
  assert.deepStrictEqual(dinheiro.papeis, ['admin', 'gerente']);
  assert.ok(!dinheiro.papeis.includes('profissional'),
    'quem nao ve preco em Precificacao nao pode ver faturamento na abertura');
});

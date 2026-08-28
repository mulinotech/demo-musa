'use strict';
/** Teste-modelo do projeto (T2.2).
 *
 *  O caso de referencia foi conferido a mao e vale centavo a centavo. Se ele
 *  quebrar, a formula mudou - e nao ha "quase certo" em preco: margem errada nao
 *  derruba nada, so aparece no fechamento do mes, tarde demais.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const {
  calcularPreco,
  compararComPraticado,
  interpretarDuracao
} = require('../server/services/precificacao');

const REFERENCIA = {
  durationMin: 60,
  totalFixedMonthly: 12000,
  monthlyWorkingHours: 160,
  variableCost: 45,
  marginPct: 30,
  commissionPct: 10,
  cardFeePct: 3.5,
  taxPct: 6
};

test('caso de referencia bate centavo a centavo', function () {
  const r = calcularPreco(REFERENCIA);
  assert.ok(!r.erro, 'nao deveria dar erro: ' + r.erro);
  assert.strictEqual(r.custoFixoHora, 75.00, 'custo fixo por hora');
  assert.strictEqual(r.custoFixoServico, 75.00, 'custo fixo do servico');
  assert.strictEqual(r.custoDireto, 120.00, 'custo direto');
  assert.strictEqual(r.percentuaisSobreVenda, 0.495, 'percentuais sobre a venda');
  assert.strictEqual(r.precoSugerido, 237.62, 'preco sugerido');
  assert.strictEqual(r.valorHora, 237.62, 'valor por hora');
  assert.strictEqual(r.lucroLiquido, 71.29, 'lucro liquido');
});

test('markup divisor, nao multiplicacao sobre o custo', function () {
  const r = calcularPreco(REFERENCIA);
  // custo * (1 + margem) daria 156,00 e uma margem real de 19%, nao de 30%.
  assert.notStrictEqual(r.precoSugerido, 156.00, 'esta multiplicando o custo pela margem');
  assert.ok(r.precoSugerido > 200, 'preco baixo demais para o markup divisor');

  // A prova da margem: o que sobra depois de tirar custo, comissao, cartao e
  // imposto tem de ser exatamente os 30% pedidos sobre o preco de venda.
  const margemReal = (r.lucroLiquido / r.precoSugerido) * 100;
  assert.ok(Math.abs(margemReal - 30) < 0.02, 'margem real ficou em ' + margemReal.toFixed(2) + '%');
});

test('metade da duracao, metade do custo fixo do servico', function () {
  const r = calcularPreco(Object.assign({}, REFERENCIA, { durationMin: 30 }));
  assert.strictEqual(r.custoFixoHora, 75.00, 'custo por hora nao muda com a duracao');
  assert.strictEqual(r.custoFixoServico, 37.50);
  assert.strictEqual(r.custoDireto, 82.50);
  assert.strictEqual(r.precoSugerido, 163.37);
});

test('valor por hora de um servico curto e maior que o de um longo', function () {
  const curto = calcularPreco(Object.assign({}, REFERENCIA, { durationMin: 30 }));
  const longo = calcularPreco(Object.assign({}, REFERENCIA, { durationMin: 120 }));
  assert.ok(curto.valorHora > longo.valorHora,
    'com insumo fixo, diluir em mais tempo baixa o valor por hora');
});

test('sem custo variavel o preco ainda cobre o custo fixo', function () {
  const r = calcularPreco(Object.assign({}, REFERENCIA, { variableCost: 0 }));
  assert.strictEqual(r.custoDireto, 75.00);
  assert.strictEqual(r.precoSugerido, 148.51);
  assert.ok(r.lucroLiquido > 0);
});

/* ---------------------------------------------------------------- guardas */

test('soma de percentuais em 100% e recusada', function () {
  const r = calcularPreco(Object.assign({}, REFERENCIA, { marginPct: 80.5 }));
  assert.ok(r.erro, 'deveria recusar');
  assert.match(r.erro, /menor que 100%/);
});

test('soma de percentuais acima de 100% e recusada', function () {
  const r = calcularPreco(Object.assign({}, REFERENCIA, { marginPct: 95 }));
  assert.ok(r.erro, 'deveria recusar');
  assert.strictEqual(r.precoSugerido, undefined, 'nao pode devolver preco junto com erro');
});

test('horas produtivas zeradas nao viram divisao por zero', function () {
  const r = calcularPreco(Object.assign({}, REFERENCIA, { monthlyWorkingHours: 0 }));
  assert.ok(r.erro, 'deveria recusar');
  assert.match(r.erro, /horas produtivas/);
});

test('duracao zerada e recusada', function () {
  const r = calcularPreco(Object.assign({}, REFERENCIA, { durationMin: 0 }));
  assert.ok(r.erro, 'deveria recusar');
  assert.match(r.erro, /duracao/);
});

test('valor negativo e recusado', function () {
  const r = calcularPreco(Object.assign({}, REFERENCIA, { variableCost: -10 }));
  assert.ok(r.erro, 'deveria recusar');
});

test('texto no lugar de numero e recusado', function () {
  const r = calcularPreco(Object.assign({}, REFERENCIA, { totalFixedMonthly: 'doze mil' }));
  assert.ok(r.erro, 'deveria recusar');
});

test('percentuais em 99,99% calculam sem estourar', function () {
  const r = calcularPreco({
    durationMin: 60, totalFixedMonthly: 12000, monthlyWorkingHours: 160,
    variableCost: 0, marginPct: 99.99, commissionPct: 0, cardFeePct: 0, taxPct: 0
  });
  assert.ok(!r.erro, 'deveria calcular');
  assert.ok(isFinite(r.precoSugerido) && r.precoSugerido > 0);
});

/* ------------------------------------------------------ comparacao com o praticado */

test('comparacao mostra quanto se deixa na mesa', function () {
  const c = compararComPraticado(237.62, 180);
  assert.strictEqual(c.precoAtual, 180);
  assert.strictEqual(c.diferenca, 57.62);
  assert.strictEqual(c.deixandoNaMesa, 57.62);
});

test('preco praticado acima do sugerido nao vira valor negativo na mesa', function () {
  const c = compararComPraticado(237.62, 300);
  assert.strictEqual(c.diferenca, -62.38);
  assert.strictEqual(c.deixandoNaMesa, 0);
});

test('sem preco praticado nao ha comparacao', function () {
  assert.strictEqual(compararComPraticado(237.62, 0), null);
  assert.strictEqual(compararComPraticado(237.62, null), null);
});

/* ------------------------------------------------------------- duracao */

test('duracao numerica e aceita', function () {
  assert.strictEqual(interpretarDuracao(60), 60);
  assert.strictEqual(interpretarDuracao('60'), 60);
  assert.strictEqual(interpretarDuracao('60 min'), 60);
  assert.strictEqual(interpretarDuracao('90 minutos'), 90);
});

test('duracao ambigua devolve null em vez de chutar', function () {
  // O catalogo herdado tem textos assim. Precificar em cima do primeiro numero
  // que aparece seria adivinhar - a tela pede a duracao.
  assert.strictEqual(interpretarDuracao('40 a 60 minutos'), null);
  assert.strictEqual(interpretarDuracao('Sessoes combinadas de 60 a 90 minutos'), null);
  assert.strictEqual(interpretarDuracao('15 a 45 minutos (conforme area)'), null);
  assert.strictEqual(interpretarDuracao(''), null);
  assert.strictEqual(interpretarDuracao(null), null);
  assert.strictEqual(interpretarDuracao(undefined), null);
});

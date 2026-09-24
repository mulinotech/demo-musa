'use strict';
/** Custo fixo x custo recorrente (M6.3).
 *
 *  O que se prova aqui é o número que entra em todo preço da clínica: se a
 *  separação errar, o custo por hora erra, e o erro não aparece em tela nenhuma.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const c = require('../server/services/custos-fixos');

const item = (o) => Object.assign({ monthlyAmount: 100, active: true, natureza: 'FIXO' }, o);

test('so o FIXO entra no custo por hora', () => {
  const r = c.separar([
    item({ monthlyAmount: 6000, natureza: 'FIXO' }),        // aluguel
    item({ monthlyAmount: 4000, natureza: 'VARIAVEL' })     // acido hialuronico
  ]);
  assert.strictEqual(r.totalFixo, 6000);
  assert.strictEqual(r.totalVariavel, 4000);
});

test('e o recorrente NAO some da tela', () => {
  /* Some do custo por hora, nao da lista: quem lancou precisa continuar vendo
     que o custo existe, senao a reclassificacao parece ter apagado dinheiro. */
  const r = c.separar([item({ natureza: 'VARIAVEL' })]);
  assert.strictEqual(r.variaveis.length, 1);
});

test('custo inativo nao soma de nenhum lado', () => {
  const r = c.separar([
    item({ monthlyAmount: 900, active: false, natureza: 'FIXO' }),
    item({ monthlyAmount: 900, active: false, natureza: 'VARIAVEL' })
  ]);
  assert.strictEqual(r.totalFixo, 0);
  assert.strictEqual(r.totalVariavel, 0);
  assert.strictEqual(r.fixos.length + r.variaveis.length, 2, 'mas continuam na lista');
});

test('linha sem natureza vale FIXO -- que e como ela vinha sendo contada', () => {
  /* A migration 041 nao reclassifica nada. Se o padrao fosse VARIAVEL, o custo
     por hora de 50 clinicas cairia a zero no dia do deploy. */
  for (const v of [undefined, null, '', '   ', 'qualquer coisa']) {
    assert.strictEqual(c.natureza(v), 'FIXO', JSON.stringify(v));
  }
  assert.strictEqual(c.separar([item({ natureza: undefined })]).totalFixo, 100);
});

test('a natureza nao e sensivel a maiuscula nem a espaco', () => {
  assert.strictEqual(c.natureza(' variavel '), 'VARIAVEL');
  assert.strictEqual(c.natureza('Fixo'), 'FIXO');
});

test('o custo por hora divide so o fixo', () => {
  const r = c.separar([
    item({ monthlyAmount: 12000, natureza: 'FIXO' }),
    item({ monthlyAmount: 8000, natureza: 'VARIAVEL' })
  ]);
  // 12000 / 120h = 100. Com o recorrente junto seriam 166,67 -- 66% a mais em
  // cima de TODO preco, por um custo que a ficha tecnica ja cobra.
  assert.strictEqual(c.custoPorHora(r.totalFixo, 120), 100);
});

test('zero hora produtiva vale NAO SEI, e nao zero real', () => {
  /* Zero faria a calculadora nao somar estrutura nenhuma e o preco sair barato
     demais, em silencio. `null` obriga a tela a dizer que falta um dado. */
  for (const h of [0, -5, null, undefined, 'abc']) {
    assert.strictEqual(c.custoPorHora(6000, h), null, String(h));
  }
});

test('os centavos nao viram dizima', () => {
  const r = c.separar([
    item({ monthlyAmount: 33.333, natureza: 'FIXO' }),
    item({ monthlyAmount: 33.333, natureza: 'FIXO' }),
    item({ monthlyAmount: 33.334, natureza: 'FIXO' })
  ]);
  assert.strictEqual(r.totalFixo, 100);
  assert.strictEqual(c.custoPorHora(r.totalFixo, 3), 33.33);
});

test('aceita a linha crua do banco (monthly_amount)', () => {
  const r = c.separar([{ monthly_amount: '2500.00', active: 1, natureza: 'FIXO' }]);
  assert.strictEqual(r.totalFixo, 2500);
});

test('lista vazia ou ausente devolve zero, e nao NaN', () => {
  for (const v of [[], null, undefined, 'nao e lista']) {
    const r = c.separar(v);
    assert.strictEqual(r.totalFixo, 0);
    assert.strictEqual(r.totalVariavel, 0);
  }
});

test('as duas naturezas se explicam na propria lista', () => {
  /* A tela desenha a partir daqui. Texto de ajuda escrito na tela seria uma
     segunda versao da regra, livre para divergir desta. */
  assert.strictEqual(c.NATUREZAS.length, 2);
  for (const n of c.NATUREZAS) {
    assert.ok(n.rotulo && n.ajuda, n.valor + ' sem explicacao');
  }
  assert.strictEqual(c.NATUREZAS.filter((n) => n.entraNoCustoPorHora).length, 1);
});

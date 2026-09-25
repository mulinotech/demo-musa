'use strict';
/** O preço do pacote acompanha o da sessão (M6.6).
 *
 *  Aplicar um preço novo gravava `price` e deixava `package_price` como estava:
 *  a tela passava a mostrar a sessão a R$ 450 e o pacote ainda calculado sobre
 *  R$ 400. A clínica vende o pacote pelo número velho sem perceber.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { precoDoPacote } = require('../server/services/precificacao');

test('o pacote sobe na mesma proporcao da sessao', () => {
  // 10 sessoes com 10% de desconto: 3.600 para uma sessao de 400.
  const r = precoDoPacote(3600, 400, 450);
  assert.strictEqual(r.novo, 4050);
  assert.strictEqual(r.anterior, 3600);
  assert.strictEqual(r.mexeu, true);
});

test('e desce tambem', () => {
  assert.strictEqual(precoDoPacote(3600, 400, 360).novo, 3240);
});

test('o desconto do pacote e preservado', () => {
  /* O sistema nao sabe quantas sessoes tem o pacote nem qual desconto a clinica
     pratica: `package_price` e um numero solto. A RAZAO entre os dois precos
     carrega as duas informacoes juntas. */
  const antes = 400, pacote = 3600;               // 9 sessoes equivalentes
  const r = precoDoPacote(pacote, antes, 500);
  assert.strictEqual(Math.round((r.novo / 500) * 100) / 100, 9);
});

test('servico sem pacote nao ganha um', () => {
  /* Multiplicar por dez para "criar" um pacote poria um preco de venda no
     catalogo por palpite. */
  for (const v of [0, null, undefined, '', -100]) {
    const r = precoDoPacote(v, 400, 450);
    assert.strictEqual(r.mexeu, false, JSON.stringify(v));
    assert.strictEqual(r.novo, null);
  }
});

test('sem preco anterior o pacote fica como esta, e a resposta diz por que', () => {
  const r = precoDoPacote(3600, 0, 450);
  assert.strictEqual(r.mexeu, false);
  assert.strictEqual(r.novo, 3600, 'o valor NAO e zerado');
  assert.match(r.porque, /proporção/);
});

test('preco novo invalido nao estraga o pacote', () => {
  for (const v of [0, -1, null, 'abc']) {
    const r = precoDoPacote(3600, 400, v);
    assert.strictEqual(r.mexeu, false, JSON.stringify(v));
    assert.strictEqual(r.novo, 3600);
  }
});

test('preco igual nao conta como mudanca', () => {
  /* `mexeu: false` evita um UPDATE que reescreveria o mesmo valor e sujaria a
     trilha com uma alteracao que nao houve. */
  const r = precoDoPacote(3600, 400, 400);
  assert.strictEqual(r.mexeu, false);
  assert.strictEqual(r.novo, 3600);
});

test('os centavos nao viram dizima', () => {
  const r = precoDoPacote(1000, 333.33, 400);
  assert.strictEqual(r.novo, Math.round(r.novo * 100) / 100);
});

test('a resposta diz quantas sessoes o pacote vale', () => {
  /* E a frase que a tela mostra. Sem ela, "o pacote passou de 3.600 para 4.050"
     parece um numero tirado do nada. */
  assert.match(precoDoPacote(3600, 400, 450).porque, /9 sessões/);
});

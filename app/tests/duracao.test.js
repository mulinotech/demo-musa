'use strict';
/** Quanto tempo dura um serviço (M5.14)
 *
 *  A duração vive em duas colunas do catálogo — `duration` (texto) e
 *  `duration_min` (INT) — e só a primeira era escrita pela tela de Cadastros.
 *  Trocar "60" por "90" ali fazia a tela mostrar 90 e a **Agenda continuar
 *  marcando 60**, porque `duration_min` ficava como estava.
 *
 *  Metade destes testes é sobre o que a regra se RECUSA a entender. É a parte
 *  que importa: o número que sair daqui vira o tamanho de um compromisso na
 *  agenda de uma pessoa de verdade, e chutar uma faixa ("40 a 60 minutos") é
 *  marcar horário por adivinhação.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const d = require('../server/services/duracao');

/* ------------------------------------------------------- o que ela entende */

test('so o numero, com ou sem a palavra', function () {
  assert.strictEqual(d.minutosDe('90'), 90);
  assert.strictEqual(d.minutosDe('90 min'), 90);
  assert.strictEqual(d.minutosDe('90 minutos'), 90);
  assert.strictEqual(d.minutosDe('  45  '), 45);
  assert.strictEqual(d.minutosDe('45min'), 45);
  assert.strictEqual(d.minutosDe('45 MINUTOS'), 45);
});

test('hora cheia', function () {
  assert.strictEqual(d.minutosDe('1h'), 60);
  assert.strictEqual(d.minutosDe('1 hora'), 60);
  assert.strictEqual(d.minutosDe('2 horas'), 120);
  assert.strictEqual(d.minutosDe('2H'), 120);
});

test('hora e minuto, nas formas que a clinica escreve', function () {
  for (const forma of ['1h30', '1h 30', '1h30min', '1 h 30 min', '1 hora 30 minutos', '1:30']) {
    assert.strictEqual(d.minutosDe(forma), 90, 'nao entendeu: ' + forma);
  }
  assert.strictEqual(d.minutosDe('0:45'), 45);
  assert.strictEqual(d.minutosDe('2:15'), 135);
});

test('numero ja em minutos passa direto', function () {
  assert.strictEqual(d.minutosDe(60), 60);
  assert.strictEqual(d.minutosDe(45.4), 45);
});

/* -------------------------------- O QUE ELA SE RECUSA A ENTENDER, E POR QUE */

test('A FAIXA NAO VIRA NUMERO: "40 a 60 minutos" e null, nao 40', function () {
  /* Este texto existe no catalogo de verdade -- a migration 007 ja o cita. Se a
     regra olhasse so o primeiro numero, ele viraria 40 em silencio, e 40 min
     seria o tamanho do compromisso de alguem.
     
     ESTE TESTE E' A PROTECAO, e nao uma linha de codigo: a recusa vem das
     ancoras `^...$` de cada padrao. Quem afrouxar uma ancora para aceitar mais
     uma forma de escrever derruba este teste, e e' assim que descobre. */
  for (const faixa of ['40 a 60 minutos', '30-45', '30 – 45 min', '30 ate 45',
                       '60 ou 90', '45/60']) {
    assert.strictEqual(d.minutosDe(faixa), null, 'chutou um numero em: ' + faixa);
  }
});

test('texto que nao e numero nao vira numero', function () {
  for (const t of ['cerca de 1h', 'meia hora', 'a combinar', 'depende', 'uma hora',
                   '', '   ', null, undefined, 'min', 'h']) {
    assert.strictEqual(d.minutosDe(t), null, 'inventou numero para: ' + JSON.stringify(t));
  }
});

test('fora da faixa do que e duracao de procedimento', function () {
  assert.strictEqual(d.minutosDe('0'), null);
  assert.strictEqual(d.minutosDe('-30'), null);
  /* 10 horas e o teto: acima disso nao e duracao, e' erro de digitacao -- e
     aceitar transformaria um dia inteiro de agenda num atendimento so. */
  assert.strictEqual(d.minutosDe('601'), null);
  assert.strictEqual(d.minutosDe('600'), 600);
  assert.strictEqual(d.minutosDe('9999'), null);
  assert.strictEqual(d.MAXIMO_MINUTOS, 600);
});

test('o que a migration 007 aceitou continua sendo aceito', function () {
  /* A 007 preencheu `duration_min` com o REGEXP '^ *[0-9]{1,4} *(min|minuto|
     minutos)? *$'. Tudo o que ela aceitou tem de continuar valendo, senao um
     servico ja convertido passaria a ser "nao entendi" na proxima edicao. */
  for (const [texto, esperado] of [['60', 60], ['60 min', 60], ['  90  ', 90],
                                   ['30 minuto', 30], ['15minutos', 15]]) {
    assert.strictEqual(d.minutosDe(texto), esperado, 'regrediu em: ' + texto);
  }
});

/* --------------------------------------------------------------- a frase */

test('minutos viram frase de gente', function () {
  assert.strictEqual(d.descrever(90), '1 h 30 min');
  assert.strictEqual(d.descrever(60), '1 h');
  assert.strictEqual(d.descrever(45), '45 min');
  assert.strictEqual(d.descrever(125), '2 h 5 min');
});

test('sem duracao, frase vazia -- e nunca "0 min"', function () {
  for (const x of [null, undefined, 0, -5, 'abc', 700]) {
    assert.strictEqual(d.descrever(x), '', 'inventou frase para ' + JSON.stringify(x));
  }
});

test('ida e volta: o que ela entende, ela sabe descrever', function () {
  for (const texto of ['45', '1h', '1h30', '2:15', '600']) {
    const min = d.minutosDe(texto);
    assert.ok(min !== null, texto);
    assert.ok(d.descrever(min).length > 0, texto);
    // E o que ela descreveu volta a ser o mesmo numero.
    assert.strictEqual(d.minutosDe(d.descrever(min).replace(/\s*h\s*/, 'h').replace(' min', '')),
      min, 'ida e volta mudou: ' + texto);
  }
});

test('nunca lanca', function () {
  for (const x of [{}, [], () => {}, NaN, Infinity]) {
    assert.doesNotThrow(() => d.minutosDe(x));
    assert.strictEqual(d.minutosDe(x), null, JSON.stringify(x));
  }
});

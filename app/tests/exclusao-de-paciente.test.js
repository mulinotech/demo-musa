'use strict';
/** Apagar uma paciente (M6.5).
 *
 *  O que se prova aqui é a recusa: a ficha com prontuário não some, e a frase
 *  diz o que existe. Antes desta tarefa o DELETE ia direto — cascateava
 *  documento assinado e deixava conversa e dinheiro órfãos, em silêncio.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const ex = require('../server/services/exclusao-de-paciente');

test('ficha vazia e apagada', () => {
  /* A duplicata criada por engano e' caso real e frequente -- foi o que a M5.10
     veio reduzir. Tornar TODA exclusao impossivel trocaria um problema por
     outro: a clinica ficaria com as duplicatas para sempre. */
  const r = ex.decidir({});
  assert.strictEqual(r.pode, true);
  assert.strictEqual(r.total, 0);
});

test('zero em tudo tambem e ficha vazia', () => {
  const r = ex.decidir({
    documentos: 0, planos: 0, sessoes: 0, procedimentos: 0,
    compromissos: 0, conversas: 0, pontos: 0, financeiro: 0
  });
  assert.strictEqual(r.pode, true);
});

test('UM documento emitido ja recusa', () => {
  /* Receita, atestado e termo assinado sao prova de ato profissional, e
     cascateavam em silencio quando a paciente era apagada. */
  const r = ex.decidir({ documentos: 1 });
  assert.strictEqual(r.pode, false);
  assert.match(r.error, /1 documento emitido/);
});

test('cada tipo de historico segura a exclusao sozinho', () => {
  for (const h of ex.HISTORICO) {
    const r = ex.decidir({ [h.chave]: 1 });
    assert.strictEqual(r.pode, false, h.chave + ' deixou passar');
  }
});

test('a frase diz TUDO o que existe, e nao so o primeiro', () => {
  /* Quem le a recusa precisa saber o tamanho do que esta segurando: "tem
     documento" e "tem 1 documento, 12 sessoes e 40 mensagens" levam a decisoes
     diferentes. */
  const r = ex.decidir({ documentos: 2, sessoes: 12, conversas: 40 });
  assert.match(r.error, /2 documentos emitidos/);
  assert.match(r.error, /12 sessões lançadas/);
  assert.match(r.error, /40 mensagens de WhatsApp/);
  assert.strictEqual(r.total, 54);
});

test('singular e plural sao respeitados', () => {
  assert.match(ex.decidir({ planos: 1 }).error, /1 plano de tratamento/);
  assert.match(ex.decidir({ planos: 3 }).error, /3 planos de tratamento/);
});

test('a ordem de leitura e clinica primeiro, dinheiro depois', () => {
  const r = ex.decidir({ financeiro: 1, documentos: 1 });
  assert.ok(r.error.indexOf('documento') < r.error.indexOf('lançamento no financeiro'));
});

test('a recusa NAO e um beco: ela diz o caminho', () => {
  /* Sem isto, a pessoa fica com um "nao pode" e nenhuma acao -- e a paciente
     que pediu a exclusao continua esperando. A exportacao atende o art. 18, V. */
  const r = ex.decidir({ documentos: 1 });
  assert.match(r.error, /Exportar dados/);
  assert.match(r.error, /caso a caso/);
});

test('a frase explica POR QUE, e nao so que nao pode', () => {
  const r = ex.decidir({ documentos: 1 });
  assert.match(r.error, /prazo legal de guarda/);
});

test('contagem estranha nao vira recusa nem quebra', () => {
  /* Um COUNT que volte string, nulo ou negativo nao pode virar "tem historico"
     por acidente -- nem estourar. */
  for (const v of [null, undefined, '0', -3, NaN, 'abc']) {
    assert.strictEqual(ex.decidir({ documentos: v }).pode, true, JSON.stringify(v));
  }
  assert.strictEqual(ex.decidir({ documentos: '4' }).pode, false, 'string numerica conta');
});

test('as contagens vem separadas, para a tela poder desenhar', () => {
  const r = ex.decidir({ documentos: 2, conversas: 5 });
  assert.deepStrictEqual(r.itens.map((i) => i.chave), ['documentos', 'conversas']);
  assert.deepStrictEqual(r.itens.map((i) => i.n), [2, 5]);
});

test('sem contagem nenhuma (chamada torta) nao explode', () => {
  for (const v of [null, undefined, 'nao e objeto']) {
    assert.strictEqual(ex.decidir(v).pode, true, JSON.stringify(v));
  }
});

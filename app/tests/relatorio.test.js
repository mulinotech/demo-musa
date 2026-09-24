'use strict';
/** O relatório impresso para de inventar número (M6.4).
 *
 *  Estes testes existem por causa de seis constantes que estavam escritas no
 *  código e saíam impressas como se fossem medidas. O que se prova aqui é o
 *  contrário disso: sem dado, a resposta é `null` — nunca um valor plausível.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const rel = require('../server/services/relatorio');

const msg = (clientId, direction, createdAt) => ({ clientId, direction, createdAt });

/* -------------------------------------------------------- tempo de resposta */

test('o tempo de resposta e o intervalo entre a recebida e a resposta', () => {
  const r = rel.tempoDeResposta([
    msg('c1', 'in', '2026-09-20 10:00:00'),
    msg('c1', 'out', '2026-09-20 10:12:00')
  ]);
  assert.strictEqual(r.minutos, 12);
  assert.strictEqual(r.amostra, 1);
});

test('MEDIANA, e nao media: uma resposta de segunda-feira nao estraga o mes', () => {
  /* Quatro respostas de 10 min e uma de 60 horas. A media daria 727 minutos --
     doze horas --, que nao descreve nenhum atendimento que aconteceu. */
  const linhas = [];
  for (let i = 1; i <= 4; i++) {
    linhas.push(msg('c' + i, 'in', '2026-09-2' + i + ' 10:00:00'));
    linhas.push(msg('c' + i, 'out', '2026-09-2' + i + ' 10:10:00'));
  }
  linhas.push(msg('c9', 'in', '2026-09-18 20:00:00'));
  linhas.push(msg('c9', 'out', '2026-09-21 08:00:00'));
  const r = rel.tempoDeResposta(linhas);
  assert.strictEqual(r.minutos, 10);
  assert.strictEqual(r.amostra, 5);
});

test('quatro mensagens seguidas da paciente contam UMA espera', () => {
  /* Contar quatro faria a mediana parecer melhor do que e: a paciente esperou
     uma vez, do primeiro "oi" ate a resposta. */
  const r = rel.tempoDeResposta([
    msg('c1', 'in', '2026-09-20 10:00:00'),
    msg('c1', 'in', '2026-09-20 10:01:00'),
    msg('c1', 'in', '2026-09-20 10:02:00'),
    msg('c1', 'in', '2026-09-20 10:03:00'),
    msg('c1', 'out', '2026-09-20 10:30:00')
  ]);
  assert.strictEqual(r.amostra, 1);
  assert.strictEqual(r.minutos, 30, 'conta do PRIMEIRO oi, nao do ultimo');
});

test('conversa sem resposta nao vira tempo zero -- vira contagem propria', () => {
  /* Zero minutos seria "respondemos na hora". O numero que a clinica precisa
     ver e justamente quantas ficaram sem resposta nenhuma. */
  const r = rel.tempoDeResposta([
    msg('c1', 'in', '2026-09-20 10:00:00'),
    msg('c2', 'in', '2026-09-20 11:00:00'),
    msg('c2', 'out', '2026-09-20 11:05:00')
  ]);
  assert.strictEqual(r.semResposta, 1);
  assert.strictEqual(r.amostra, 1);
  assert.strictEqual(r.minutos, 5);
});

test('mensagem NOSSA antes da dela nao conta como resposta', () => {
  /* A clinica que manda lembrete e recebe "ok" nao respondeu em -3 minutos. */
  const r = rel.tempoDeResposta([
    msg('c1', 'out', '2026-09-20 09:00:00'),
    msg('c1', 'in', '2026-09-20 09:03:00')
  ]);
  assert.strictEqual(r.amostra, 0);
  assert.strictEqual(r.minutos, null);
  assert.strictEqual(r.semResposta, 1);
});

test('as conversas nao se misturam entre pacientes', () => {
  /* Sem separar por paciente, a resposta mandada para a Ana contaria como
     resposta a mensagem da Beatriz, e a mediana viraria ficcao. */
  const r = rel.tempoDeResposta([
    msg('c1', 'in', '2026-09-20 10:00:00'),
    msg('c2', 'out', '2026-09-20 10:01:00'),
    msg('c1', 'out', '2026-09-20 10:40:00')
  ]);
  assert.strictEqual(r.minutos, 40);
});

test('sem mensagem nenhuma o tempo e NULO, e nao "12 minutos"', () => {
  for (const v of [[], null, undefined]) {
    assert.strictEqual(rel.tempoDeResposta(v).minutos, null, JSON.stringify(v));
  }
});

/* ------------------------------------------------------ tempo de conversao */

test('o tempo de conversao sai de converted_at, e nao de 3,5 fixo', () => {
  const r = rel.tempoDeConversao([
    { date: '2026-09-01 10:00:00', convertedAt: '2026-09-05 10:00:00' },
    { date: '2026-09-01 10:00:00', convertedAt: '2026-09-03 10:00:00' },
    { date: '2026-09-01 10:00:00', convertedAt: '2026-09-11 10:00:00' }
  ]);
  assert.strictEqual(r.dias, 4);
  assert.strictEqual(r.amostra, 3);
});

test('lead sem conversao nao entra na conta', () => {
  const r = rel.tempoDeConversao([
    { date: '2026-09-01', convertedAt: null },
    { date: '2026-09-01', convertedAt: '2026-09-03' }
  ]);
  assert.strictEqual(r.amostra, 1);
});

test('a AMOSTRA volta junto, porque a M5.10 nao preencheu para tras', () => {
  /* Uma mediana de dois leads nao e a mesma informacao que uma de duzentos, e
     o papel precisa poder dizer sobre quantos esta falando. */
  const r = rel.tempoDeConversao([{ date: '2026-09-01', convertedAt: '2026-09-04' }]);
  assert.strictEqual(r.amostra, 1);
});

test('conversao antes da entrada e data errada, e nao dia negativo', () => {
  const r = rel.tempoDeConversao([
    { date: '2026-09-10', convertedAt: '2026-09-01' },
    { date: '2026-09-01', convertedAt: '2026-09-03' }
  ]);
  assert.strictEqual(r.amostra, 1);
  assert.strictEqual(r.dias, 2);
});

test('sem nenhum lead convertido o tempo e NULO', () => {
  assert.strictEqual(rel.tempoDeConversao([]).dias, null);
});

test('as datas tambem chegam como OBJETO Date, direto do mysql2', () => {
  /* Achado no ensaio contra banco de verdade, nao aqui: o mysql2 devolve
     DATETIME como Date, e a primeira versao de `instante` fazia
     `String(v).replace(' ', 'T')` -- que num Date trocava o espaco depois do
     "Wed" e produzia "WedTSep 09 ...". O tempo de conversao voltava `null`
     com o dado presente no banco: um "nao medido" mentiroso, que e exatamente
     o que esta tarefa veio tirar da folha. */
  const r = rel.tempoDeConversao([
    { date: new Date('2026-09-05T00:00:00Z'), convertedAt: new Date('2026-09-09T00:00:00Z') }
  ]);
  assert.strictEqual(r.dias, 4);
  assert.strictEqual(r.amostra, 1);
});

test('e o tempo de resposta tambem aceita Date', () => {
  const r = rel.tempoDeResposta([
    { clientId: 'c1', direction: 'in', createdAt: new Date('2026-09-10T14:00:00Z') },
    { clientId: 'c1', direction: 'out', createdAt: new Date('2026-09-10T14:15:00Z') }
  ]);
  assert.strictEqual(r.minutos, 15);
});

/* -------------------------------------------------------- taxa de conversao */

test('convertido e VENDA FECHADA (arquivado), e nao proposta enviada', () => {
  /* O DEFEITO: a conta antiga contava `agendado`, que no Kanban e' a coluna
     "Proposta Enviada". Quem fechou ja saiu dela. Uma clinica que fechasse
     TODOS os leads do mes imprimiria 0% de conversao. */
  const leads = [
    { status: 'novo' }, { status: 'contatado' },
    { status: 'agendado' }, { status: 'arquivado' }, { status: 'perdido' }
  ];
  const r = rel.taxaDeConversao(leads);
  assert.strictEqual(r.fechados, 1);
  assert.strictEqual(r.pct, 20);
});

test('clinica que fecha tudo imprime 100%, e nao zero', () => {
  const r = rel.taxaDeConversao([{ status: 'arquivado' }, { status: 'arquivado' }]);
  assert.strictEqual(r.pct, 100);
});

test('sem lead no periodo a taxa e NULA, e nao 0%', () => {
  /* 0% de conversao e' um mes ruim; "nao houve lead" e' outra coisa, e a
     clinica age diferente em cada caso. */
  const r = rel.taxaDeConversao([]);
  assert.strictEqual(r.pct, null);
  assert.strictEqual(r.total, 0);
});

/* ---------------------------------------------------------- horario de pico */

test('o horario de pico e a hora com mais mensagens', () => {
  const p = rel.horarioDePico([
    msg('c1', 'in', '2026-09-20 14:10:00'),
    msg('c1', 'in', '2026-09-20 14:40:00'),
    msg('c1', 'in', '2026-09-20 09:00:00')
  ]);
  assert.strictEqual(p.hora, 14);
  assert.strictEqual(p.faixa, '14:00 - 15:00');
  assert.strictEqual(p.mensagens, 2);
});

test('sem mensagem o pico e NULO, e nao "14:00 - 15:00"', () => {
  assert.strictEqual(rel.horarioDePico([]), null);
});

test('a virada da meia-noite nao imprime 24:00', () => {
  const p = rel.horarioDePico([msg('c1', 'in', '2026-09-20 23:30:00')]);
  assert.strictEqual(p.faixa, '23:00 - 00:00');
});

/* --------------------------------------------------------- taxa de retorno */

test('a taxa de retorno divide quem tem mais de um plano', () => {
  const r = rel.taxaDeRetorno(10, 3);
  assert.strictEqual(r.pct, 30);
});

test('sem paciente nenhuma a taxa e NULA, e nao 24%', () => {
  /* `Math.round(taxa || 24)` era o codigo antigo: zero paciente imprimia 24%
     de retorno de coisa nenhuma. */
  const r = rel.taxaDeRetorno(0, 0);
  assert.strictEqual(r.pct, null);
});

/* ------------------------------------------------------------------ mediana */

test('a mediana de lista par e a media dos dois do meio', () => {
  assert.strictEqual(rel.mediana([1, 2, 3, 4]), 2.5);
});

test('a mediana de lista vazia e nula, e nao zero', () => {
  assert.strictEqual(rel.mediana([]), null);
  assert.strictEqual(rel.mediana(['a', null, undefined]), null);
});

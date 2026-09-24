'use strict';
/** As sessões programadas viram horário (M6.3).
 *
 *  Os casos que importam são as RECUSAS: a sessão que já aconteceu, a data que
 *  já passou e a sessão que já está na agenda. Cada uma delas, passando, cria
 *  uma linha errada no calendário de uma clínica de verdade.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const a = require('../server/services/sessoes-na-agenda');

const HOJE = '2026-09-24';
const sessao = (o) => Object.assign(
  { id: 's1', n: 1, status: 'PENDENTE', sessionDate: '2026-10-06', appointmentId: null }, o);

const rodar = (sessoes, extra) => a.horariosDasSessoes(Object.assign(
  { sessoes: sessoes, hora: '09:00', duracaoMin: 60, hoje: HOJE }, extra || {}));

test('a sessao programada vira horario de inicio e fim', () => {
  const r = rodar([sessao({})]);
  assert.strictEqual(r.marcar.length, 1);
  assert.strictEqual(r.marcar[0].inicio, '2026-10-06 09:00:00');
  assert.strictEqual(r.marcar[0].fim, '2026-10-06 10:00:00');
});

test('a duracao e respeitada, e nao arredondada para a hora cheia', () => {
  const r = rodar([sessao({})], { duracaoMin: 90 });
  assert.strictEqual(r.marcar[0].fim, '2026-10-06 10:30:00');
  const r2 = rodar([sessao({})], { hora: '14:45', duracaoMin: 40 });
  assert.strictEqual(r2.marcar[0].inicio, '2026-10-06 14:45:00');
  assert.strictEqual(r2.marcar[0].fim, '2026-10-06 15:25:00');
});

test('sessao que ja aconteceu NAO vira compromisso', () => {
  /* Os mesmos quatro estados congelados da M5.12. Agendar uma sessao REALIZADA
     poria na agenda um atendimento que ja foi feito -- e ele apareceria como
     futuro, esperando alguem. */
  for (const s of ['REALIZADA', 'FALTOU', 'CANCELADA', 'REAGENDADA']) {
    const r = rodar([sessao({ status: s })]);
    assert.strictEqual(r.marcar.length, 0, s);
    assert.match(r.pular[0].porque, /já aconteceu/);
  }
});

test('sessao que JA esta na agenda nao entra de novo', () => {
  /* Sem isto, clicar duas vezes no botao criaria a segunda linha na agenda para
     o mesmo tratamento -- a duplicata da M6.2 em outra tela. */
  const r = rodar([sessao({ appointmentId: 'ap_1' })]);
  assert.strictEqual(r.marcar.length, 0);
  assert.strictEqual(r.pular[0].porque, 'já está na agenda');
});

test('data que ja passou nao vira compromisso', () => {
  /* Encheria o historico da agenda de atendimentos que nunca existiram, e o
     relatorio do mes passado mudaria depois de fechado. */
  const r = rodar([sessao({ sessionDate: '2026-09-01' })]);
  assert.strictEqual(r.marcar.length, 0);
  assert.match(r.pular[0].porque, /já passou/);
});

test('mas HOJE ainda entra', () => {
  const r = rodar([sessao({ sessionDate: HOJE })]);
  assert.strictEqual(r.marcar.length, 1, 'a sessao de hoje as 9h ainda e de hoje');
});

test('sessao sem data programada e pulada, e dito por que', () => {
  for (const d of [null, '', undefined]) {
    const r = rodar([sessao({ sessionDate: d })]);
    assert.strictEqual(r.marcar.length, 0);
    assert.strictEqual(r.pular[0].porque, 'sem data programada');
  }
});

test('as que entram e as que nao entram vem SEPARADAS, com o numero da sessao', () => {
  /* Quem clicou precisa saber exatamente quais das dez ficaram de fora. "7 de
     10 agendadas" sem dizer quais e' a mesma coisa que nao dizer nada. */
  const r = rodar([
    sessao({ id: 's1', n: 1, status: 'REALIZADA' }),
    sessao({ id: 's2', n: 2, sessionDate: '2026-10-13' }),
    sessao({ id: 's3', n: 3, sessionDate: null }),
    sessao({ id: 's4', n: 4, sessionDate: '2026-10-27' })
  ]);
  assert.deepStrictEqual(r.marcar.map((m) => m.n), [2, 4]);
  assert.deepStrictEqual(r.pular.map((p) => p.n), [1, 3]);
});

test('hora invalida e recusa, e nao um horario chutado', () => {
  for (const h of ['', '9', '25:00', '09:70', 'manha', null, '09-00']) {
    assert.ok(rodar([sessao({})], { hora: h }).erro, 'passou: ' + JSON.stringify(h));
  }
});

test('duracao invalida e recusa', () => {
  for (const d of [0, -30, null, 'uma hora', 601]) {
    assert.ok(rodar([sessao({})], { duracaoMin: d }).erro, 'passou: ' + JSON.stringify(d));
  }
});

test('a sessao tarde da noite termina no dia seguinte, sem ajuda do fuso', () => {
  /* A soma e' em MINUTOS de calendario. Com `new Date` do servidor, uma clinica
     rodando em UTC empurraria o fim para o dia errado. */
  const r = rodar([sessao({})], { hora: '23:30', duracaoMin: 90 });
  assert.strictEqual(r.marcar[0].inicio, '2026-10-06 23:30:00');
  assert.strictEqual(r.marcar[0].fim, '2026-10-07 01:00:00');
});

test('a virada do mes e do ano tambem', () => {
  const r = rodar([sessao({ sessionDate: '2026-12-31' })], { hora: '23:00', duracaoMin: 120 });
  assert.strictEqual(r.marcar[0].fim, '2027-01-01 01:00:00');
});

test('data que nao e data e pulada, e nao vira compromisso torto', () => {
  const r = rodar([sessao({ sessionDate: '31/12/2026' })]);
  assert.strictEqual(r.marcar.length, 0);
  assert.match(r.pular[0].porque, /não é uma data/);
});

test('lista vazia devolve vazio, sem erro', () => {
  const r = rodar([]);
  assert.deepStrictEqual(r.marcar, []);
  assert.deepStrictEqual(r.pular, []);
});

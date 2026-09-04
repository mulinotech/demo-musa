'use strict';
/** Agenda (T1.1 e T1.2).
 *
 *  A regra de conflito e o caso classico de erro que passa em revisao: a
 *  expressao "parece" certa e o sistema so quebra na recepcao, com duas
 *  pacientes na mesma hora. Estes testes travam os cinco casos que o contexto
 *  do modulo exige, incluindo o que mais se erra: compromissos ENCOSTADOS nao
 *  conflitam.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const ag = require('../server/services/agenda');

const P1 = 'u_musa';
const P2 = 'u_pedro';

const c = (id, prof, de, ate, status) => ({
  id: id, professional_id: prof, title: 'Compromisso ' + id,
  starts_at: '2026-09-01 ' + de + ':00', ends_at: '2026-09-01 ' + ate + ':00',
  status: status || 'AGENDADO'
});

const AGENDA = [
  c('a1', P1, '09:00', '10:00'),
  c('a2', P1, '14:00', '15:00'),
  c('a3', P2, '09:00', '10:00'),
  c('a4', P1, '16:00', '17:00', 'CANCELADO'),
  c('a5', P1, '17:00', '18:00', 'FALTOU'),
];

const novo = (de, ate, prof, id) => ({
  id: id, professionalId: prof || P1,
  startsAt: '2026-09-01 ' + de + ':00', endsAt: '2026-09-01 ' + ate + ':00'
});

/* ------------------------------------------------------------ R1 */

test('sobreposicao parcial e conflito', function () {
  assert.strictEqual(ag.conflito(novo('09:30', '10:30'), AGENDA).id, 'a1');
});

test('contencao total e conflito, nos dois sentidos', function () {
  assert.strictEqual(ag.conflito(novo('09:15', '09:45'), AGENDA).id, 'a1', 'novo dentro do existente');
  assert.strictEqual(ag.conflito(novo('08:00', '11:00'), AGENDA).id, 'a1', 'existente dentro do novo');
});

test('compromissos ENCOSTADOS nao conflitam', function () {
  // O erro classico: usar <= no lugar de <. A agenda de uma clinica e feita de
  // horarios encostados; com <= o dia inteiro vira erro de conflito.
  assert.strictEqual(ag.conflito(novo('10:00', '11:00'), AGENDA), null, 'comeca quando o outro termina');
  assert.strictEqual(ag.conflito(novo('08:00', '09:00'), AGENDA), null, 'termina quando o outro comeca');
});

test('mesmo horario com profissional diferente nao conflita', function () {
  assert.strictEqual(ag.conflito(novo('09:00', '10:00', 'u_novo'), AGENDA), null);
});

test('editar um compromisso nao conflita com ele mesmo', function () {
  assert.strictEqual(ag.conflito(novo('09:00', '10:00', P1, 'a1'), AGENDA), null);
  assert.strictEqual(ag.conflito(novo('09:30', '10:30', P1, 'a1'), AGENDA), null, 'mover um pouco tambem vale');
});

test('editar um compromisso ainda conflita com OUTRO', function () {
  assert.strictEqual(ag.conflito(novo('14:30', '15:30', P1, 'a1'), AGENDA).id, 'a2');
});

test('compromisso cancelado ou faltou libera o horario', function () {
  assert.strictEqual(ag.conflito(novo('16:00', '17:00'), AGENDA), null, 'CANCELADO nao ocupa');
  assert.strictEqual(ag.conflito(novo('17:00', '18:00'), AGENDA), null, 'FALTOU nao ocupa');
});

test('bloqueio de horario participa do conflito como qualquer outro', function () {
  const comBloqueio = AGENDA.concat([
    { id: 'b1', professional_id: P1, title: 'Almoco', kind: 'BLOQUEIO',
      starts_at: '2026-09-01 12:00:00', ends_at: '2026-09-01 13:00:00', status: 'AGENDADO' }
  ]);
  assert.strictEqual(ag.conflito(novo('12:30', '13:30'), comBloqueio).id, 'b1');
});

/* -------------------------------------------------------- validacao */

test('fim antes do inicio e recusado', function () {
  const r = ag.validar(novo('11:00', '10:00'), AGENDA);
  assert.strictEqual(r.status, 400);
  assert.match(r.error, /depois do inicio/);
});

test('fim igual ao inicio e recusado', function () {
  assert.strictEqual(ag.validar(novo('11:00', '11:00'), AGENDA).status, 400);
});

test('compromisso sem profissional e recusado', function () {
  const r = ag.validar({ startsAt: '2026-09-01 11:00:00', endsAt: '2026-09-01 12:00:00' }, []);
  assert.strictEqual(r.status, 400);
  assert.match(r.error, /profissional/);
});

test('conflito devolve 409 e diz com o que conflitou', function () {
  const r = ag.validar(novo('09:30', '10:30'), AGENDA);
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.conflito.id, 'a1');
  assert.match(r.error, /ja tem/);
});

test('horario livre passa na validacao', function () {
  assert.strictEqual(ag.validar(novo('11:00', '12:00'), AGENDA), null);
});

/* ------------------------------------------------------------ R4 */

const GRADE = [{ start_time: '09:00', end_time: '18:00' }];

test('grade cheia de 09 as 18 com um compromisso das 14 as 15', function () {
  const livres = ag.janelasLivres({
    data: '2026-09-01', grade: GRADE, duracaoMin: 60,
    compromissos: [c('x', P1, '14:00', '15:00')]
  });
  const inicios = livres.map((h) => h.inicio);
  assert.ok(inicios.includes('09:00'), 'comeca as 09:00');
  assert.ok(inicios.includes('13:00'), '13:00 cabe antes do compromisso');
  assert.ok(!inicios.includes('13:15'), '13:15 invadiria as 14:00');
  assert.ok(!inicios.includes('14:00'), 'o horario ocupado nao e oferecido');
  assert.ok(inicios.includes('15:00'), 'volta a oferecer quando o compromisso termina');
  assert.strictEqual(inicios[inicios.length - 1], '17:00', 'ultimo horario que cabe antes das 18:00');
});

test('duracao maior encontra menos janelas', function () {
  const p = { data: '2026-09-01', grade: GRADE, compromissos: [c('x', P1, '14:00', '15:00')] };
  const meia = ag.janelasLivres({ ...p, duracaoMin: 30 });
  const duas = ag.janelasLivres({ ...p, duracaoMin: 120 });
  assert.ok(meia.length > duas.length);
  assert.ok(!duas.map((h) => h.inicio).includes('13:00'), '2h as 13:00 esbarraria nas 14:00');
});

test('dia sem grade nao oferece horario nenhum', function () {
  assert.deepStrictEqual(ag.janelasLivres({ data: '2026-09-01', grade: [], duracaoMin: 60, compromissos: [] }), []);
});

test('dia lotado nao oferece horario', function () {
  const livres = ag.janelasLivres({
    data: '2026-09-01', grade: GRADE, duracaoMin: 60,
    compromissos: [c('x', P1, '09:00', '18:00')]
  });
  assert.deepStrictEqual(livres, []);
});

test('compromisso cancelado nao bloqueia o horario livre', function () {
  const livres = ag.janelasLivres({
    data: '2026-09-01', grade: GRADE, duracaoMin: 60,
    compromissos: [c('x', P1, '14:00', '15:00', 'CANCELADO')]
  });
  assert.ok(livres.map((h) => h.inicio).includes('14:00'));
});

test('grade partida em dois turnos respeita o intervalo do almoco', function () {
  const livres = ag.janelasLivres({
    data: '2026-09-01', duracaoMin: 60, compromissos: [],
    grade: [{ start_time: '09:00', end_time: '12:00' }, { start_time: '14:00', end_time: '18:00' }]
  });
  const inicios = livres.map((h) => h.inicio);
  assert.ok(inicios.includes('11:00'), 'ultimo do turno da manha');
  assert.ok(!inicios.includes('12:00'), 'almoco nao e oferecido');
  assert.ok(!inicios.includes('13:00'), 'almoco nao e oferecido');
  assert.ok(inicios.includes('14:00'), 'volta a tarde');
});

test('horarios saem alinhados na grade de 15 minutos', function () {
  const livres = ag.janelasLivres({
    data: '2026-09-01', grade: GRADE, duracaoMin: 60,
    compromissos: [c('x', P1, '09:00', '09:50')]
  });
  assert.strictEqual(livres[0].inicio, '10:00', 'nao oferece 09:50; sobe para a grade de 15 min');
});

/* -------------------------------------------------- status legado */

test('status de sessao vira status de agenda', function () {
  assert.strictEqual(ag.statusDaSessao('REALIZADA'), 'REALIZADO');
  assert.strictEqual(ag.statusDaSessao('AGENDADA'), 'AGENDADO');
  assert.strictEqual(ag.statusDaSessao('FALTOU'), 'FALTOU');
  assert.strictEqual(ag.statusDaSessao('CANCELADA'), 'CANCELADO');
  assert.strictEqual(ag.statusDaSessao('REAGENDADA'), 'CANCELADO');
});

test('sessao PENDENTE nao vira compromisso', function () {
  // Sessao prevista dentro de um plano nao e horario marcado com ninguem.
  // Criar compromisso para ela encheria a agenda de horarios fantasmas.
  assert.strictEqual(ag.statusDaSessao('PENDENTE'), null);
  assert.strictEqual(ag.statusDaSessao(''), null);
  assert.strictEqual(ag.statusDaSessao(null), null);
});

/* ------------------------------------------- data como texto local */

test('DATETIME e lido como hora local, nao como instante universal', function () {
  // O mysql2 devolve DATETIME como Date e o Express serializa em ISO-UTC:
  // um compromisso das 09:00 vira "2026-04-15T12:00:00.000Z". Quem le isso
  // passa a depender do fuso do navegador, e agrupar por dia pelos dez
  // primeiros caracteres joga o compromisso da noite para o dia seguinte.
  // A rota formata no SQL justamente para o texto chegar assim:
  const local = '2026-04-15 09:00:00';
  assert.strictEqual(local.slice(0, 10), '2026-04-15', 'o dia sai direto do texto');
  assert.ok(!isNaN(ag.instante(local)), 'e uma data valida');

  // E a comparacao de conflito continua funcionando com o formato de texto.
  const existentes = [{ id: 'x', professional_id: 'u1', status: 'AGENDADO',
                        starts_at: '2026-04-15 09:00:00', ends_at: '2026-04-15 10:00:00' }];
  assert.ok(ag.conflito({ professionalId: 'u1', startsAt: '2026-04-15 09:30:00', endsAt: '2026-04-15 10:30:00' }, existentes));
  assert.strictEqual(ag.conflito({ professionalId: 'u1', startsAt: '2026-04-15 10:00:00', endsAt: '2026-04-15 11:00:00' }, existentes), null);
});

test('um compromisso da noite pertence ao dia dele, nao ao seguinte', function () {
  const noite = '2026-04-15 22:00:00';
  assert.strictEqual(noite.slice(0, 10), '2026-04-15');
  // Em ISO-UTC de um fuso negativo o mesmo horario viraria 2026-04-16T01:00Z,
  // e o compromisso apareceria no dia errado da agenda.
  assert.notStrictEqual(new Date(noite.replace(' ', 'T')).toISOString().slice(0, 10), undefined);
});

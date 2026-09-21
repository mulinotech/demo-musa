'use strict';
/** As datas das sessões de um plano (M5.12)
 *
 *  Um plano de 10 sessões obrigava a recepção a abrir dez janelas e digitar dez
 *  datas — enquanto o formulário do plano já perguntava a data de início e a
 *  periodicidade e guardava as duas sem usar.
 *
 *  Os testes de mês são a maior parte daqui, e é onde mora o defeito que não
 *  aparece em nenhum teste "feliz": encadear a partir da data já encurtada faz
 *  o plano escorregar para trás um pouco a cada mês, e cada data isolada
 *  continua parecendo certa.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const a = require('../server/services/agenda-de-sessoes');

const prog = (e) => a.datasDasSessoes(e);

/* ------------------------------------------------------------ o caso de todo dia */

test('quinzenal, 10 sessoes: dez datas de 14 em 14 dias', function () {
  const r = prog({ inicio: '2026-09-21', periodicidade: 'Quinzenal', total: 10 });
  assert.strictEqual(r.erro, null);
  assert.strictEqual(r.datas.length, 10);
  assert.strictEqual(r.datas[0], '2026-09-21');
  assert.strictEqual(r.datas[1], '2026-10-05');
  assert.strictEqual(r.datas[9], '2027-01-25');
});

test('semanal anda de 7 em 7, e a primeira e a data informada', function () {
  const r = prog({ inicio: '2026-09-21', periodicidade: 'Semanal', total: 3 });
  assert.deepStrictEqual(r.datas, ['2026-09-21', '2026-09-28', '2026-10-05']);
});

test('uma sessao so devolve a data informada', function () {
  assert.deepStrictEqual(
    prog({ inicio: '2026-09-21', periodicidade: 'Mensal', total: 1 }).datas,
    ['2026-09-21']);
});

/* -------------------------------------------------- O DEFEITO QUE ESCORREGA */

test('MENSAL COMECANDO EM 31: ancora no dia, e NAO encadeia a partir do encurtado', function () {
  const r = prog({ inicio: '2026-01-31', periodicidade: 'Mensal', total: 4 });
  /* Encadeando a partir de 28/02 o proximo seria 28/03, depois 28/04: o plano
     escorrega tres dias para tras e nunca mais volta. Cada data, sozinha,
     parece certa -- e por isso ninguem percebe. */
  assert.deepStrictEqual(r.datas, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.notStrictEqual(r.datas[2], '2026-03-28');
});

test('fevereiro de ano bissexto', function () {
  const r = prog({ inicio: '2028-01-31', periodicidade: 'Mensal', total: 2 });
  assert.deepStrictEqual(r.datas, ['2028-01-31', '2028-02-29']);
  assert.strictEqual(a.diasDoMes(2028, 2), 29);
  assert.strictEqual(a.diasDoMes(2026, 2), 28);
  // 1900 nao foi bissexto; 2000 foi. A regra dos seculos, de graca com o Date.
  assert.strictEqual(a.diasDoMes(1900, 2), 28);
  assert.strictEqual(a.diasDoMes(2000, 2), 29);
});

test('mensal atravessa o ano sem se perder', function () {
  const r = prog({ inicio: '2026-11-30', periodicidade: 'Mensal', total: 4 });
  assert.deepStrictEqual(r.datas, ['2026-11-30', '2026-12-30', '2027-01-30', '2027-02-28']);
});

test('dia 30 em fevereiro volta a ser 30 em marco', function () {
  const r = prog({ inicio: '2026-01-30', periodicidade: 'Mensal', total: 3 });
  assert.deepStrictEqual(r.datas, ['2026-01-30', '2026-02-28', '2026-03-30']);
});

/* --------------------------------------------------------------- customizado */

test('customizado exige o intervalo em dias, e diz isso', function () {
  const r = prog({ inicio: '2026-09-21', periodicidade: 'Customizado', total: 3 });
  assert.match(r.erro, /de quantos em quantos dias/);
  assert.deepStrictEqual(r.datas, []);
});

test('customizado com intervalo funciona', function () {
  const r = prog({ inicio: '2026-09-21', periodicidade: 'Customizado', total: 3, intervaloDias: 10 });
  assert.deepStrictEqual(r.datas, ['2026-09-21', '2026-10-01', '2026-10-11']);
});

test('periodicidade que a clinica escreveu antes da lista tambem cai no customizado', function () {
  /* `treatment_plans.periodicity` e texto livre e existe desde antes da lista:
     ha plano gravado com "A cada 21 dias". Recusar com pedido de intervalo e
     melhor do que escolher um passo no chute. */
  const r = prog({ inicio: '2026-09-21', periodicidade: 'A cada 21 dias', total: 2 });
  assert.match(r.erro, /de quantos em quantos dias/);
  assert.deepStrictEqual(
    prog({ inicio: '2026-09-21', periodicidade: 'A cada 21 dias', total: 2, intervaloDias: 21 }).datas,
    ['2026-09-21', '2026-10-12']);
});

test('intervalo fora do razoavel e recusado', function () {
  for (const dias of [0, -5, 366, 1.5, 'dez', null]) {
    const r = prog({ inicio: '2026-09-21', periodicidade: 'Customizado', total: 2, intervaloDias: dias });
    assert.ok(r.erro, 'aceitou intervalo ' + JSON.stringify(dias));
  }
});

/* --------------------------------------------------- o domingo, e o que NAO fazer */

test('domingo e AVISADO, e a data NAO e movida', function () {
  // 2026-09-20 e domingo; semanal mantem todas em domingo.
  const r = prog({ inicio: '2026-09-20', periodicidade: 'Semanal', total: 3 });
  assert.deepStrictEqual(r.datas, ['2026-09-20', '2026-09-27', '2026-10-04']);
  assert.strictEqual(r.avisos.length, 1);
  assert.match(r.avisos[0], /3 sessões caem/);
  assert.match(r.avisos[0], /ficaram como estão/);
  /* Empurrar sozinho para segunda inventaria um horario de funcionamento que
     ninguem cadastrou. O sistema nao sabe em que dias esta clinica abre. */
  assert.strictEqual(r.datas.includes('2026-09-21'), false);
});

test('sem domingo, sem aviso', function () {
  const r = prog({ inicio: '2026-09-21', periodicidade: 'Semanal', total: 3 });
  assert.deepStrictEqual(r.avisos, []);
});

test('o aviso conta no singular quando e uma so', function () {
  const r = prog({ inicio: '2026-09-19', periodicidade: 'Quinzenal', total: 1 });
  assert.deepStrictEqual(r.avisos, []);              // sabado nao e avisado
  const d = prog({ inicio: '2026-09-20', periodicidade: 'Mensal', total: 1 });
  assert.match(d.avisos[0], /^1 sessão cai/);
});

/* ------------------------------------------------------------- entrada torta */

test('data invalida nao vira plano', function () {
  for (const i of ['', null, '2026-02-31', '21/09/2026', '2026-13-01', 'amanha', '2026-09-00']) {
    const r = prog({ inicio: i, periodicidade: 'Semanal', total: 3 });
    assert.ok(r.erro, 'aceitou a data ' + JSON.stringify(i));
    assert.deepStrictEqual(r.datas, []);
  }
});

test('total fora da faixa e recusado, e a trava vale tambem fora da tela', function () {
  for (const t of [0, -1, 21, 2.5, 'tres', null]) {
    assert.ok(prog({ inicio: '2026-09-21', periodicidade: 'Semanal', total: t }).erro,
      'aceitou total ' + JSON.stringify(t));
  }
  assert.strictEqual(prog({ inicio: '2026-09-21', periodicidade: 'Semanal', total: 20 }).erro, null);
});

test('nunca lanca: quem chama e uma tela', function () {
  for (const e of [undefined, null, {}, { inicio: {} }, { total: [] }]) {
    const r = a.datasDasSessoes(e);
    assert.ok(r && Array.isArray(r.datas));
    assert.ok(r.erro, 'entrada torta passou sem erro: ' + JSON.stringify(e));
  }
});

test('as datas saem em ordem e sem repetir', function () {
  for (const p of ['Semanal', 'Quinzenal', 'Mensal']) {
    const r = prog({ inicio: '2026-01-31', periodicidade: p, total: 12 });
    assert.strictEqual(r.erro, null);
    assert.strictEqual(new Set(r.datas).size, 12, p + ': data repetida');
    for (let i = 1; i < r.datas.length; i++) {
      assert.ok(r.datas[i] > r.datas[i - 1], p + ': ' + r.datas[i] + ' veio depois de ' + r.datas[i - 1]);
    }
  }
});

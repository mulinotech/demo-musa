'use strict';
/** Financeiro (T2.4 e T2.6).
 *
 *  O caso central destes testes é o que o contexto do módulo exige: competência
 *  e caixa têm de dar números DIFERENTES quando há despesa lançada e não paga,
 *  e os dois têm de estar certos. É a confusão nº 1 em relatório financeiro, e
 *  a que faz a pessoa parar de confiar no sistema.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fin = require('../server/services/financeiro');

/* Cenário conferido à mão, tudo em março de 2026:
 *
 *   RECEITA  05/03  1.000,00  paga em 05/03   Procedimentos
 *   RECEITA  20/03    500,00  paga em 02/04   Procedimentos   <- competência marco, caixa abril
 *   DESPESA  10/03    300,00  paga em 10/03   Insumos
 *   DESPESA  15/03    800,00  NAO paga, vence 05/04           <- so competencia
 *   DESPESA  01/02    200,00  NAO paga, vence 01/03           <- vencida, fora do periodo
 *
 *   competencia marco: receita 1.500,00 - despesa 1.100,00 = 400,00
 *   caixa marco:       receita 1.000,00 - despesa   300,00 = 700,00
 */
const RAZAO = [
  { id: 'e1', type: 'RECEITA', amount: 1000, entry_date: '2026-03-05', paid_at: '2026-03-05', due_date: null, category_id: 'c_proc', category_name: 'Procedimentos' },
  { id: 'e2', type: 'RECEITA', amount: 500, entry_date: '2026-03-20', paid_at: '2026-04-02', due_date: null, category_id: 'c_proc', category_name: 'Procedimentos' },
  { id: 'e3', type: 'DESPESA', amount: 300, entry_date: '2026-03-10', paid_at: '2026-03-10', due_date: null, category_id: 'c_ins', category_name: 'Insumos' },
  { id: 'e4', type: 'DESPESA', amount: 800, entry_date: '2026-03-15', paid_at: null, due_date: '2026-04-05', category_id: 'c_alu', category_name: 'Aluguel' },
  { id: 'e5', type: 'DESPESA', amount: 200, entry_date: '2026-02-01', paid_at: null, due_date: '2026-03-01', category_id: 'c_ins', category_name: 'Insumos' }
];

const MARCO = { de: '2026-03-01', ate: '2026-03-31', hoje: '2026-04-01' };

test('competencia: conta o que aconteceu, pago ou nao', function () {
  const r = fin.resumo(RAZAO, { ...MARCO, base: 'competencia' });
  assert.strictEqual(r.receitaTotal, 1500.00);
  assert.strictEqual(r.despesaTotal, 1100.00);
  assert.strictEqual(r.resultado, 400.00);
  assert.strictEqual(r.periodo.base, 'competencia');
});

test('caixa: conta so o dinheiro que andou dentro do periodo', function () {
  const r = fin.resumo(RAZAO, { ...MARCO, base: 'caixa' });
  assert.strictEqual(r.receitaTotal, 1000.00);
  assert.strictEqual(r.despesaTotal, 300.00);
  assert.strictEqual(r.resultado, 700.00);
  assert.strictEqual(r.periodo.base, 'caixa');
});

test('as duas bases dao numeros diferentes - e e assim que tem de ser', function () {
  const comp = fin.resumo(RAZAO, { ...MARCO, base: 'competencia' });
  const caixa = fin.resumo(RAZAO, { ...MARCO, base: 'caixa' });
  assert.notStrictEqual(comp.resultado, caixa.resultado);
  assert.strictEqual(comp.resultado - caixa.resultado, -300);
});

test('base desconhecida cai em competencia, nao mistura criterio', function () {
  const r = fin.resumo(RAZAO, { ...MARCO, base: 'chute' });
  assert.strictEqual(r.periodo.base, 'competencia');
  assert.strictEqual(r.resultado, 400.00);
});

test('margem sai sobre a receita, e nao estoura com receita zero', function () {
  const r = fin.resumo(RAZAO, { ...MARCO, base: 'competencia' });
  assert.strictEqual(r.margemPct, 26.67); // 400 / 1500
  const vazio = fin.resumo([], { ...MARCO, base: 'competencia' });
  assert.strictEqual(vazio.margemPct, 0);
  assert.strictEqual(vazio.resultado, 0);
});

test('despesa entra positiva e e subtraida pelo type, nunca somada', function () {
  const r = fin.resumo(
    [{ type: 'DESPESA', amount: 100, entry_date: '2026-03-10', paid_at: '2026-03-10' }],
    { ...MARCO, base: 'competencia' }
  );
  assert.strictEqual(r.despesaTotal, 100);
  assert.strictEqual(r.resultado, -100);
});

test('quebra por categoria soma certo e vem do maior para o menor', function () {
  const r = fin.resumo(RAZAO, { ...MARCO, base: 'competencia' });
  assert.deepStrictEqual(r.receitaPorCategoria.map((c) => [c.categoria, c.total]), [['Procedimentos', 1500]]);
  assert.deepStrictEqual(r.despesaPorCategoria.map((c) => [c.categoria, c.total]), [['Aluguel', 800], ['Insumos', 300]]);
});

test('lancamento sem categoria nao some do total', function () {
  const r = fin.resumo(
    [{ type: 'DESPESA', amount: 50, entry_date: '2026-03-10', paid_at: '2026-03-10', category_id: null }],
    { ...MARCO, base: 'competencia' }
  );
  assert.strictEqual(r.despesaTotal, 50);
  assert.strictEqual(r.despesaPorCategoria[0].categoria, 'Sem categoria');
});

/* ------------------------------------------------------------ contas a pagar */

test('contas a pagar ignoram o periodo: o que esta em aberto esta em aberto', function () {
  const r = fin.resumo(RAZAO, { ...MARCO, base: 'competencia' });
  assert.strictEqual(r.aPagar.total, 1000.00, '800 do aluguel + 200 do insumo de fevereiro');
  assert.strictEqual(r.aPagar.vencido, 200.00, 'venceu em 01/03 e hoje e 01/04');
  assert.strictEqual(r.aPagar.aVencer7Dias, 800.00, 'vence em 05/04');
});

test('conta ja paga sai das contas a pagar', function () {
  const r = fin.resumo(
    [{ type: 'DESPESA', amount: 900, entry_date: '2026-03-01', paid_at: '2026-03-02', due_date: '2026-03-05' }],
    { ...MARCO, base: 'competencia' }
  );
  assert.strictEqual(r.aPagar.total, 0);
});

test('despesa em aberto sem vencimento nao vira vencida por acidente', function () {
  const r = fin.resumo(
    [{ type: 'DESPESA', amount: 70, entry_date: '2026-03-01', paid_at: null, due_date: null }],
    { ...MARCO, base: 'competencia' }
  );
  assert.strictEqual(r.aPagar.total, 70);
  assert.strictEqual(r.aPagar.vencido, 0);
  assert.strictEqual(r.aPagar.semVencimento, 70);
});

/* ------------------------------------------------------------- comparativo */

test('comparativo mede a variacao contra o periodo anterior', function () {
  const atual = { receitaTotal: 1500, despesaTotal: 1100, resultado: 400 };
  const anterior = { receitaTotal: 1000, despesaTotal: 1000, resultado: 0 };
  const c = fin.comparativo(atual, anterior);
  assert.strictEqual(c.receitaPct, 50);
  assert.strictEqual(c.despesaPct, 10);
  assert.strictEqual(c.resultadoPct, null, 'sem base de comparacao devolve null, nao 0');
});

test('queda aparece como percentual negativo', function () {
  assert.strictEqual(fin.variacaoPct(800, 1000), -20);
});

test('variacao a partir de resultado negativo usa o modulo da base', function () {
  // De -500 para -250 e melhora de 50%, nao piora.
  assert.strictEqual(fin.variacaoPct(-250, -500), 50);
});

/* ------------------------------------------------------------------ fluxo */

test('fluxo por dia acumula saldo e nao pula dia vazio', function () {
  const s = fin.fluxo(RAZAO, { de: '2026-03-09', ate: '2026-03-11', base: 'caixa', agruparPor: 'day' });
  assert.strictEqual(s.length, 3, 'os tres dias, inclusive os sem lancamento');
  assert.deepStrictEqual(s.map((x) => x.periodo), ['2026-03-09', '2026-03-10', '2026-03-11']);
  assert.strictEqual(s[1].despesa, 300);
  assert.strictEqual(s[1].acumulado, -300);
  assert.strictEqual(s[2].acumulado, -300, 'dia vazio mantem o acumulado');
});

test('fluxo por mes agrupa e respeita a base', function () {
  const caixa = fin.fluxo(RAZAO, { de: '2026-03-01', ate: '2026-04-30', base: 'caixa', agruparPor: 'month' });
  assert.deepStrictEqual(caixa.map((x) => x.periodo), ['2026-03', '2026-04']);
  assert.strictEqual(caixa[0].receita, 1000);
  assert.strictEqual(caixa[1].receita, 500, 'a receita de marco paga em abril entra no caixa de abril');
});

/* ------------------------------------------------------------- recorrencia */

const ALUGUEL = { id: 'r1', day_of_month: 10, start_date: '2026-01-01', end_date: null, active: 1 };

test('recorrencia gera uma ocorrencia por mes', function () {
  const o = fin.ocorrencias(ALUGUEL, '2026-03-01', '2026-05-31');
  assert.deepStrictEqual(o, ['2026-03-10', '2026-04-10', '2026-05-10']);
});

test('dia 31 cai no ultimo dia do mes curto, em vez de sumir', function () {
  const o = fin.ocorrencias({ ...ALUGUEL, day_of_month: 31 }, '2026-02-01', '2026-04-30');
  assert.deepStrictEqual(o, ['2026-02-28', '2026-03-31', '2026-04-30']);
});

test('recorrencia inativa nao gera nada', function () {
  assert.deepStrictEqual(fin.ocorrencias({ ...ALUGUEL, active: 0 }, '2026-03-01', '2026-05-31'), []);
});

test('recorrencia respeita inicio e fim', function () {
  const o = fin.ocorrencias({ ...ALUGUEL, start_date: '2026-04-01', end_date: '2026-05-01' }, '2026-03-01', '2026-06-30');
  assert.deepStrictEqual(o, ['2026-04-10']);
});

test('a chave de idempotencia da recorrencia e uma por mes', function () {
  assert.strictEqual(fin.chaveRecorrencia('r1', '2026-03-10'), 'r1:2026-03');
  assert.strictEqual(
    fin.chaveRecorrencia('r1', '2026-03-10'),
    fin.chaveRecorrencia('r1', '2026-03-31'),
    'duas datas do mesmo mes tem de dar a MESMA chave, senao o worker duplica'
  );
  assert.notStrictEqual(fin.chaveRecorrencia('r1', '2026-03-10'), fin.chaveRecorrencia('r1', '2026-04-10'));
});

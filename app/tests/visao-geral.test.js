'use strict';
/** Os números da Visão Geral (M5.8).
 *
 *  ==================================================== O QUE ESTES TESTES SÃO
 *
 *  Os outros arquivos da suíte perguntam se o sistema FAZ o que promete. Estes
 *  perguntam outra coisa, e é a pergunta que faltava: **o que está na tela é
 *  verdade?**
 *
 *  A Visão Geral passou quatro meses exibindo "+12% vs período anterior" ao lado
 *  de "Total de Leads: 0", "R$ 18,50" de Custo por Lead e "156" no meio do
 *  gráfico de uma clínica sem lead nenhum. Nenhum dos 421 testes reclamou,
 *  porque nenhum deles olhava para uma afirmação e perguntava de onde ela vinha.
 *
 *  Por isso vários testes daqui têm a forma incomum de "o número X NÃO aparece":
 *  o defeito que eles travam não é uma conta errada, é uma conta que não existe.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const vg = require('../server/services/visao-geral');
const fin = require('../server/services/financeiro');

const lead = (id, data, status) => ({ id: id, created_at: data, status: status || 'novo' });

/* Dez dias de setembro, conferidos à mão:
 *
 *   JANELA ATUAL     10/09 a 16/09 (7 dias)  -> 4 leads, 2 fechados  = 50%
 *   JANELA ANTERIOR  03/09 a 09/09 (7 dias)  -> 2 leads, 1 fechado   = 50%
 */
const LEADS = [
  lead('l1', '2026-09-04', 'arquivado'),
  lead('l2', '2026-09-08', 'perdido'),
  lead('l3', '2026-09-10', 'arquivado'),
  lead('l4', '2026-09-10', 'novo'),
  lead('l5', '2026-09-14', 'arquivado'),
  lead('l6', '2026-09-16', 'contatado'),
  lead('l7', '2026-09-30', 'novo')            // fora das duas janelas
];

const ATUAL = { de: '2026-09-10', ate: '2026-09-16' };

/* ------------------------------------------------------- a janela anterior */

test('a janela anterior tem o MESMO tamanho e termina na vespera', function () {
  const a = vg.janelaAnterior('2026-09-10', '2026-09-16');
  assert.strictEqual(a.de, '2026-09-03');
  assert.strictEqual(a.ate, '2026-09-09');
});

test('30 dias comparam com 30 dias, e nao com "o mes passado"', function () {
  assert.strictEqual(vg.diasDaJanela('2026-02-01', '2026-02-28'), 28);
  const a = vg.janelaAnterior('2026-03-01', '2026-03-31');   // 31 dias
  assert.strictEqual(vg.diasDaJanela(a.de, a.ate), 31);
  assert.strictEqual(a.ate, '2026-02-28');
});

test('"ultimos 7 dias" inclui hoje: sao hoje e os 6 anteriores', function () {
  assert.strictEqual(vg.diasDaJanela(fin.somarDias('2026-09-16', -6), '2026-09-16'), 7);
});

/* ------------------------------------------- o percentual que nao se inventa */

test('sem base de comparacao o percentual e null, nunca um numero', function () {
  const p = vg.par(5, 0);
  assert.strictEqual(p.valor, 5);
  assert.strictEqual(p.variacaoPct, null);
});

test('ZERO no periodo e zero antes: variacao 0, e nao "+12%"', function () {
  const painel = vg.painel({ de: ATUAL.de, ate: ATUAL.ate, leads: [] });
  assert.strictEqual(painel.leads.valor, 0);
  assert.strictEqual(painel.leads.anterior, 0);
  assert.strictEqual(painel.leads.variacaoPct, 0);
  // O defeito original em uma linha: 0 leads com "+12%" escrito ao lado.
  assert.notStrictEqual(painel.leads.variacaoPct, 12);
});

test('a variacao de leads e calculada, e bate com a conta a mao', function () {
  const painel = vg.painel({ de: ATUAL.de, ate: ATUAL.ate, leads: LEADS });
  assert.strictEqual(painel.leads.valor, 4);        // 10, 10, 14, 16
  assert.strictEqual(painel.leads.anterior, 2);     // 04 e 08
  assert.strictEqual(painel.leads.variacaoPct, 100);
});

/* ---------------------------------------------------------------- conversao */

test('conversao conta "arquivado" como Venda Fechada, e perdido nao converte', function () {
  const c = vg.conversao(LEADS, ATUAL.de, ATUAL.ate);
  assert.strictEqual(c.total, 4);
  assert.strictEqual(c.fechados, 2);
  assert.strictEqual(c.pct, 50);
});

test('periodo sem lead nenhum nao divide por zero', function () {
  const c = vg.conversao([], ATUAL.de, ATUAL.ate);
  assert.strictEqual(c.pct, 0);
  assert.strictEqual(c.total, 0);
});

/* -------------------------------------------------------------------- funil */

test('o funil soma exatamente o total, com o lead perdido incluido', function () {
  const f = vg.funil(LEADS, '2026-09-01', '2026-09-30');
  assert.strictEqual(f.total, 7);
  assert.strictEqual(f.fechados + f.emNegociacao + f.novos + f.perdidos, f.total);
  assert.strictEqual(f.perdidos, 1);
});

test('clinica sem lead tem total ZERO -- nao 156', function () {
  const f = vg.funil([], ATUAL.de, ATUAL.ate);
  assert.strictEqual(f.total, 0);
  assert.notStrictEqual(f.total, 156);
});

/* ------------------------------------------------------------------- serie */

test('a serie tem um ponto por DATA, e nao por dia da semana', function () {
  const s = vg.serieDeLeads(LEADS, ATUAL.de, ATUAL.ate);
  assert.strictEqual(s.length, 7);
  assert.deepStrictEqual(s.map((p) => p.data), [
    '2026-09-10', '2026-09-11', '2026-09-12',
    '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16'
  ]);
  // Rotulo de dia da semana nao pode sobreviver aqui.
  assert.strictEqual(s.some((p) => /Seg|Ter|Qua|Dom/.test(p.data)), false);
});

test('dia sem lead vira ponto zero, e nao um buraco no eixo', function () {
  const s = vg.serieDeLeads(LEADS, ATUAL.de, ATUAL.ate);
  const porData = Object.fromEntries(s.map((p) => [p.data, p.leads]));
  assert.strictEqual(porData['2026-09-10'], 2);
  assert.strictEqual(porData['2026-09-11'], 0);
  assert.strictEqual(porData['2026-09-16'], 1);
  assert.strictEqual(s.reduce((t, p) => t + p.leads, 0), 4);
});

test('janela longa agrupa por SEMANA, e o rotulo continua sendo uma data', function () {
  const s = vg.serieDeLeads(LEADS, '2026-07-01', '2026-09-30');   // 92 dias
  assert.ok(s.length < 20, 'noventa barras nao cabem no eixo');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(s[0].data));
  assert.strictEqual(s.reduce((t, p) => t + p.leads, 0), 7);
});

/* --------------------------------------------------------------- o dinheiro */

/* Razão de setembro, conferido à mão:
 *
 *   RECEITA  12/09  3.000,00   paga            Procedimentos
 *   RECEITA  05/09  1.000,00   paga            Procedimentos   <- janela anterior
 *   DESPESA  11/09    600,00   paga            Anuncios        <- captacao
 *   DESPESA  13/09    400,00   paga            Agencia         <- captacao
 *   DESPESA  12/09  2.000,00   paga            Aluguel         <- NAO e captacao
 *   DESPESA  06/09    500,00   paga            Anuncios        <- captacao, anterior
 */
const RAZAO = [
  { id: 'r1', type: 'RECEITA', amount: 3000, entry_date: '2026-09-12', paid_at: '2026-09-12', category_id: 'c_proc' },
  { id: 'r2', type: 'RECEITA', amount: 1000, entry_date: '2026-09-05', paid_at: '2026-09-05', category_id: 'c_proc' },
  { id: 'd1', type: 'DESPESA', amount: 600, entry_date: '2026-09-11', paid_at: '2026-09-11', category_id: 'c_ads' },
  { id: 'd2', type: 'DESPESA', amount: 400, entry_date: '2026-09-13', paid_at: '2026-09-13', category_id: 'c_agencia' },
  { id: 'd3', type: 'DESPESA', amount: 2000, entry_date: '2026-09-12', paid_at: '2026-09-12', category_id: 'c_aluguel' },
  { id: 'd4', type: 'DESPESA', amount: 500, entry_date: '2026-09-06', paid_at: '2026-09-06', category_id: 'c_ads' }
];

const CAPTACAO = ['c_ads', 'c_agencia'];

test('o faturamento da Visao Geral e EXATAMENTE o resumo do Financeiro', function () {
  const meu = vg.receita(RAZAO, ATUAL.de, ATUAL.ate, 'competencia');
  const dele = fin.resumo(RAZAO, { de: ATUAL.de, ate: ATUAL.ate, base: 'competencia' });
  assert.strictEqual(meu, dele.receitaTotal);
  assert.strictEqual(meu, 3000);
});

test('sem categoria marcada o investimento e null -- nunca zero disfarcado', function () {
  assert.strictEqual(vg.investimentoEmCaptacao(RAZAO, ATUAL.de, ATUAL.ate, [], 'competencia'), null);
  assert.strictEqual(vg.investimentoEmCaptacao(RAZAO, ATUAL.de, ATUAL.ate, null, 'competencia'), null);
});

test('o investimento soma SO as categorias marcadas, e so despesa', function () {
  const i = vg.investimentoEmCaptacao(RAZAO, ATUAL.de, ATUAL.ate, CAPTACAO, 'competencia');
  assert.strictEqual(i, 1000);         // 600 + 400, sem o aluguel de 2.000
});

test('marcou categoria mas nao gastou no periodo: zero, e zero e um numero', function () {
  const i = vg.investimentoEmCaptacao(RAZAO, '2026-08-01', '2026-08-31', CAPTACAO, 'competencia');
  assert.strictEqual(i, 0);
  assert.notStrictEqual(i, null);
});

test('CPL = investimento dividido pelos leads do MESMO periodo', function () {
  assert.strictEqual(vg.custoPorLead(1000, 4), 250);
});

test('CPL sem categoria marcada e null, e nao R$ 18,50', function () {
  const cpl = vg.custoPorLead(null, 4);
  assert.strictEqual(cpl, null);
  assert.notStrictEqual(cpl, 18.5);
});

test('CPL com zero lead e null: dividir por zero nao vira numero', function () {
  assert.strictEqual(vg.custoPorLead(1000, 0), null);
});

test('ticket medio divide pelas pacientes DISTINTAS, nao pelas sessoes', function () {
  assert.strictEqual(vg.ticketMedio(3000, 4), 750);
  assert.strictEqual(vg.ticketMedio(3000, 0), 0);
});

/* --------------------------------------------------------- o painel inteiro */

test('o painel monta os cinco cartoes com o periodo anterior junto', function () {
  const p = vg.painel({
    de: ATUAL.de, ate: ATUAL.ate, base: 'competencia',
    leads: LEADS, razao: RAZAO, categoriasDeCaptacao: CAPTACAO,
    sessoes: 5, sessoesAnterior: 2,
    pacientesAtendidas: 4, pacientesAtendidasAnterior: 2
  });

  assert.strictEqual(p.periodo.dias, 7);
  assert.deepStrictEqual(p.periodoAnterior, { de: '2026-09-03', ate: '2026-09-09' });

  assert.strictEqual(p.leads.valor, 4);
  assert.strictEqual(p.conversao.valor, 50);
  assert.strictEqual(p.faturamento.valor, 3000);
  assert.strictEqual(p.faturamento.anterior, 1000);
  assert.strictEqual(p.faturamento.variacaoPct, 200);
  assert.strictEqual(p.ticketMedio.valor, 750);       // 3000 / 4 pacientes
  assert.strictEqual(p.custoPorLead.valor, 250);      // 1000 / 4 leads
  assert.strictEqual(p.custoPorLead.investimento, 1000);
  assert.strictEqual(p.custoPorLead.categoriasMarcadas, 2);
});

test('NENHUM cartao do painel carrega texto de tendencia pronto', function () {
  const p = vg.painel({
    de: ATUAL.de, ate: ATUAL.ate, leads: LEADS, razao: RAZAO,
    categoriasDeCaptacao: CAPTACAO, pacientesAtendidas: 4
  });
  // A frase "+12% vs periodo anterior" era literal no codigo da tela. O painel
  // devolve NUMERO e deixa a tela escrever a frase -- numero nao mente sozinho.
  const texto = JSON.stringify(p);
  assert.strictEqual(/vs per[ií]odo anterior/.test(texto), false);
  assert.strictEqual(/18[.,]50/.test(texto), false);
  assert.strictEqual(/1200|1\.200/.test(texto), false);
});

test('clinica nova: painel inteiro sem nenhum numero inventado', function () {
  const p = vg.painel({ de: ATUAL.de, ate: ATUAL.ate, leads: [], razao: [] });
  assert.strictEqual(p.leads.valor, 0);
  assert.strictEqual(p.conversao.valor, 0);
  assert.strictEqual(p.faturamento.valor, 0);
  assert.strictEqual(p.ticketMedio.valor, 0);
  assert.strictEqual(p.custoPorLead.valor, null);
  assert.strictEqual(p.custoPorLead.investimento, null);
  assert.strictEqual(p.custoPorLead.categoriasMarcadas, 0);
  assert.strictEqual(p.serieDeLeads.every((x) => x.leads === 0), true);
});

test('a base caixa muda o faturamento e o investimento, e nao so o rotulo', function () {
  const razao = [
    { id: 'x1', type: 'RECEITA', amount: 900, entry_date: '2026-09-12', paid_at: null, category_id: 'c_proc' },
    { id: 'x2', type: 'DESPESA', amount: 300, entry_date: '2026-09-12', paid_at: null, category_id: 'c_ads' }
  ];
  const comp = vg.painel({ de: ATUAL.de, ate: ATUAL.ate, base: 'competencia', leads: LEADS, razao: razao, categoriasDeCaptacao: CAPTACAO });
  const caixa = vg.painel({ de: ATUAL.de, ate: ATUAL.ate, base: 'caixa', leads: LEADS, razao: razao, categoriasDeCaptacao: CAPTACAO });
  assert.strictEqual(comp.faturamento.valor, 900);
  assert.strictEqual(caixa.faturamento.valor, 0);       // nada foi pago ainda
  assert.strictEqual(comp.custoPorLead.investimento, 300);
  assert.strictEqual(caixa.custoPorLead.investimento, 0);
});

/* ------------------------------------------------------- CPL zerado (M6.6) */

test('investimento ZERO nao vira CPL de R$ 0,00', () => {
  /* Numa apresentacao a clinica marcou as categorias de captacao e o cartao
     continuou em "R$ 0,00" -- que se le como "gastamos nada para captar", um
     resultado excelente. O que houve foi nenhuma despesa daquelas categorias
     ter caido no periodo do filtro. `null` obriga a tela a dizer o que falta. */
  assert.strictEqual(vg.custoPorLead(0, 10), null);
});

test('mas investimento de verdade continua dividindo', () => {
  assert.strictEqual(vg.custoPorLead(1000, 10), 100);
});

test('o detalhe diz QUANTOS lancamentos entraram na conta', () => {
  /* E o numero que separa "marquei e nao caiu nada no periodo" de "cairam
     despesas e elas somam zero". A tela escreve frases diferentes para os
     dois, e sem a contagem nao teria como. */
  const razao = [
    { type: 'DESPESA', amount: 300, entry_date: '2026-09-10', category_id: 'cat_ads' },
    { type: 'DESPESA', amount: 200, entry_date: '2026-09-11', category_id: 'cat_ads' },
    { type: 'DESPESA', amount: 999, entry_date: '2026-08-10', category_id: 'cat_ads' },
    { type: 'DESPESA', amount: 500, entry_date: '2026-09-12', category_id: 'cat_outra' }
  ];
  const d = vg.investimentoDetalhado(razao, '2026-09-01', '2026-09-30', ['cat_ads'], 'competencia');
  assert.strictEqual(d.valor, 500);
  assert.strictEqual(d.lancamentos, 2, 'agosto e a outra categoria ficam de fora');
});

test('sem categoria marcada o detalhe volta nulo, e nao zero', () => {
  const d = vg.investimentoDetalhado([], '2026-09-01', '2026-09-30', [], 'competencia');
  assert.strictEqual(d.valor, null);
  assert.strictEqual(d.marcadas, 0);
});

test('categoria marcada sem despesa no periodo: zero lancamentos', () => {
  const razao = [{ type: 'DESPESA', amount: 999, entry_date: '2026-08-10', category_id: 'cat_ads' }];
  const d = vg.investimentoDetalhado(razao, '2026-09-01', '2026-09-30', ['cat_ads'], 'competencia');
  assert.strictEqual(d.lancamentos, 0);
  assert.strictEqual(vg.custoPorLead(d.valor, 20), null, 'e o CPL nao vira zero');
});

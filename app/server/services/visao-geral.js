'use strict';
/** Os números da tela de abertura — funções puras (M5.8, 18/09).
 *
 *  ===================================== POR QUE ESTE ARQUIVO NASCEU
 *
 *  A Visão Geral misturava três coisas com a MESMA aparência de cartão:
 *
 *      valor medido        -> leads, faturamento, sessões
 *      valor com chute     -> o LTV, que usava R$ 1.200 como preço de
 *                             atendimento sem preço
 *      texto literal       -> "+12% vs período anterior", "R$ 18,50" de CPL
 *
 *  Enquanto o sistema era demonstração, isso era enfeite. Na primeira
 *  apresentação ao time comercial virou pergunta — "de onde vêm esses 12%?" —,
 *  e uma afirmação que não se sustenta contamina as que se sustentavam.
 *
 *  ================================ AS QUATRO DECISÕES QUE ESTE ARQUIVO CARREGA
 *
 *  1. **A comparação é com a janela imediatamente anterior, do mesmo tamanho.**
 *     7 dias contra os 7 anteriores; 30 contra os 30 anteriores. Era o que o
 *     time pediu, e é o que o Financeiro já fazia certo desde a T2.6 — este
 *     arquivo usa a MESMA função de variação, e não uma segunda versão dela.
 *
 *  2. **Sem base de comparação, não há percentual.** Zero leads no período
 *     anterior não vira "+100%" nem "+12%": vira `null`, e a tela escreve "sem
 *     base de comparação". Percentual sobre zero é divisão que não existe, e
 *     inventar um número ali foi exatamente o defeito original.
 *
 *  3. **O dinheiro vem do MESMO razão que o Financeiro lê.** Antes a Visão
 *     Geral somava os atendimentos por conta própria, com um preço chutado
 *     quando faltava — duas telas, duas contas, dois faturamentos possíveis.
 *     Agora é uma fonte só, e as duas telas não podem mais discordar.
 *
 *  4. **O CPL não inventa investimento.** Ele soma as despesas do período nas
 *     categorias que a clínica marcou como captação. Nenhuma marcada, nenhum
 *     CPL — e a tela diz onde marcar, em vez de mostrar um número bonito.
 */

const fin = require('./financeiro');

const dia = fin.dia;
const somarDias = fin.somarDias;
const centavos = fin.centavos;
const variacaoPct = fin.variacaoPct;

/** Quantos dias tem a janela, contando as duas pontas. */
function diasDaJanela(de, ate) {
  const ms = 86400000;
  return Math.round((new Date(ate + 'T12:00:00') - new Date(de + 'T12:00:00')) / ms) + 1;
}

/** A janela imediatamente anterior, do MESMO tamanho.
 *
 *  É o que dá sentido ao comparativo: 30 dias contra 30 dias, e não contra "o
 *  mês passado" solto — que teria 28, 30 ou 31 e faria fevereiro parecer queda.
 *  Mesma definição do Financeiro, de propósito. */
function janelaAnterior(de, ate) {
  const dias = diasDaJanela(de, ate);
  return { de: somarDias(de, -dias), ate: somarDias(de, -1) };
}

function dentro(d, de, ate) {
  if (!d) return false;
  return d >= de && d <= ate;
}

/** O par (valor no período, valor no anterior) com a variação.
 *
 *  `variacao` é `null` quando não há base — e a tela TEM de saber a diferença
 *  entre "não mudou" (0) e "não dá para comparar" (null). Foi confundir os dois
 *  que produziu "0 leads, +12%". */
function par(atual, anterior) {
  return { valor: atual, anterior: anterior, variacaoPct: variacaoPct(atual, anterior) };
}

/* -------------------------------------------------------------------- leads */

function contarLeads(leads, de, ate) {
  return (leads || []).filter((l) => dentro(dia(l.created_at), de, ate)).length;
}

/** Conversão = leads que chegaram em "Venda Fechada" sobre os leads do período.
 *
 *  O status no banco chama-se `arquivado`, e o nome engana: no funil desta
 *  clínica a coluna dele é **Venda Fechada**. Quem não converte é `perdido`.
 *  Fica escrito aqui porque a próxima pessoa a ler esta conta vai desconfiar da
 *  mesma coisa que eu desconfiei. */
function conversao(leads, de, ate) {
  const noPeriodo = (leads || []).filter((l) => dentro(dia(l.created_at), de, ate));
  const fechados = noPeriodo.filter((l) => l.status === 'arquivado').length;
  const total = noPeriodo.length;
  return { fechados: fechados, total: total, pct: total ? centavos((fechados / total) * 100) : 0 };
}

/** A rosca do funil: em que situação estão os leads DO PERÍODO.
 *
 *  A tela antiga desenhava três fatias e, no meio do buraco, escrevia
 *  `leads.length || '156'` — ou seja, clínica sem lead nenhum lia **156** no
 *  centro do gráfico. Aqui o total é o total, e zero é zero.
 *
 *  `perdido` ganhou fatia própria: ele existe no banco, saía de todas as três
 *  contagens, e a soma das fatias não fechava com o total exibido ao lado. */
function funil(leads, de, ate) {
  const noPeriodo = (leads || []).filter((l) => dentro(dia(l.created_at), de, ate));
  const quantos = (fn) => noPeriodo.filter(fn).length;
  return {
    total: noPeriodo.length,
    fechados: quantos((l) => l.status === 'arquivado'),
    emNegociacao: quantos((l) => l.status === 'agendado' || l.status === 'contatado'),
    novos: quantos((l) => l.status === 'novo'),
    perdidos: quantos((l) => l.status === 'perdido')
  };
}

/** A série do gráfico, um ponto por DATA — nunca por dia da semana.
 *
 *  O gráfico antigo somava todas as quartas-feiras do período num único ponto.
 *  Em 7 dias isso passa despercebido; em 30 dias é ininteligível, e foi assim
 *  que o time o descreveu: "não faz o menor sentido".
 *
 *  Janela longa agrupa por semana para o eixo não virar um pente de 90 barras,
 *  mas o rótulo continua sendo uma data de verdade. */
function serieDeLeads(leads, de, ate) {
  const dias = diasDaJanela(de, ate);
  const porSemana = dias > 45;
  const balde = new Map();

  const chave = (d) => {
    if (!porSemana) return d;
    // Segunda-feira da semana daquele dia.
    const data = new Date(d + 'T12:00:00');
    const desloca = (data.getDay() + 6) % 7;
    return somarDias(d, -desloca);
  };

  let cursor = de;
  while (cursor <= ate) {
    balde.set(chave(cursor), 0);
    cursor = somarDias(cursor, 1);
  }
  for (const l of (leads || [])) {
    const d = dia(l.created_at);
    if (!dentro(d, de, ate)) continue;
    const k = chave(d);
    // Buraco no eixo do tempo faz o gráfico mentir sobre a forma da curva: os
    // baldes vazios já foram criados acima, e continuam valendo zero.
    if (balde.has(k)) balde.set(k, balde.get(k) + 1);
  }
  return Array.from(balde.entries()).map(([data, n]) => ({ data: data, leads: n }));
}

/* ---------------------------------------------------------------- dinheiro */

/** Receita do período, lida do RAZÃO — a mesma fonte do Financeiro. */
function receita(razao, de, ate, base) {
  const r = fin.resumo(razao, { de: de, ate: ate, base: base || 'competencia' });
  return r.receitaTotal;
}

/** O investimento em captação: soma das DESPESAS do período nas categorias que
 *  a clínica marcou.
 *
 *  Devolve `null` — e não zero — quando nenhuma categoria está marcada. A
 *  diferença importa: zero significa "a clínica não investiu"; `null` significa
 *  "ninguém disse ao sistema o que é investimento", e a tela precisa dizer
 *  coisas diferentes nos dois casos. */
function investimentoEmCaptacao(razao, de, ate, categoriasMarcadas, base) {
  const r = investimentoDetalhado(razao, de, ate, categoriasMarcadas, base);
  return r.valor;
}

/** O mesmo cálculo, dizendo TAMBÉM quantos lançamentos entraram (M6.6).
 *
 *  ================================ POR QUE A CONTAGEM PASSOU A IMPORTAR
 *
 *  Numa apresentação, a clínica marcou as categorias de captação e o cartão
 *  continuou em **R$ 0,00** — sem dizer por quê. Zero ali tem três causas
 *  completamente diferentes, e a tela mostrava a mesma coisa nas três:
 *
 *    a) ninguém marcou categoria      -> `null`, e a tela já dizia isso
 *    b) marcou, mas NENHUMA despesa daquelas categorias caiu no período
 *    c) marcou, houve despesa, e ela soma zero de verdade
 *
 *  O caso (b) é o que acontece de verdade: a clínica marca a categoria hoje e
 *  o filtro da tela está em "últimos 7 dias", enquanto o anúncio foi lançado no
 *  mês passado. "R$ 0,00" lê-se como "não investimos nada", que é falso — e não
 *  há nada na tela apontando para o filtro.
 *
 *  Por isso a contagem volta junto, e o CPL de (b) é `null`: dividir zero pelos
 *  leads devolve um CPL de R$ 0,00 que parece um resultado excelente. */
function investimentoDetalhado(razao, de, ate, categoriasMarcadas, base) {
  const marcadas = categoriasMarcadas || [];
  if (!marcadas.length) return { valor: null, lancamentos: 0, marcadas: 0 };
  const alvo = new Set(marcadas);
  let total = 0, n = 0;
  for (const l of (razao || [])) {
    if (l.type !== 'DESPESA') continue;
    const quando = (base === 'caixa') ? dia(l.paid_at) : dia(l.entry_date);
    if (!dentro(quando, de, ate)) continue;
    if (alvo.has(l.category_id)) { total += Number(l.amount); n += 1; }
  }
  return { valor: centavos(total), lancamentos: n, marcadas: marcadas.length };
}

/** CPL = investimento em captação ÷ leads gerados no MESMO período.
 *
 *  A fórmula é a que o time comercial escreveu, e a restrição também é deles:
 *  **não entra OpEx**. Por isso a conta depende de a clínica marcar o que é
 *  captação, e não de somar toda a despesa do mês. */
function custoPorLead(investimento, leads) {
  if (investimento === null) return null;          // ninguém marcou categoria
  if (!leads) return null;                          // zero lead: divisão sem sentido
  /* ZERO INVESTIDO NÃO É CPL ZERO (M6.6). Dividir zero pelos leads devolve
     R$ 0,00 -- que na tela parece um resultado excelente, quando o que
     aconteceu foi nenhuma despesa das categorias marcadas ter caído no
     período. `null` obriga a tela a dizer o que falta. */
  if (!investimento) return null;
  return centavos(investimento / leads);
}

/** Ticket médio = receita do período ÷ pacientes DISTINTAS atendidas nele.
 *
 *  Substituiu o cartão de "LTV Médio", que dizia ser valor de vida do cliente e
 *  era outra coisa: dividia a receita histórica inteira pelo total de pacientes
 *  cadastradas e não mudava com o filtro de período — num painel cuja fileira
 *  toda promete um período. LTV de verdade não cabe numa janela de 7 dias; o
 *  ticket médio cabe, e é comparável. */
function ticketMedio(receitaDoPeriodo, pacientesAtendidas) {
  if (!pacientesAtendidas) return 0;
  return centavos(receitaDoPeriodo / pacientesAtendidas);
}

/* ------------------------------------------------------------------ o painel */

/** Monta a resposta inteira. Recebe tudo pronto e não toca em banco: é isso que
 *  permite testar cada regra acima sem MySQL. */
function painel(d) {
  const de = dia(d.de), ate = dia(d.ate);
  const ant = janelaAnterior(de, ate);
  const base = d.base === 'caixa' ? 'caixa' : 'competencia';
  const leads = d.leads || [];
  const razao = d.razao || [];
  const marcadas = d.categoriasDeCaptacao || [];

  const conv = conversao(leads, de, ate);
  const convAnt = conversao(leads, ant.de, ant.ate);

  const receitaAtual = receita(razao, de, ate, base);
  const receitaAnt = receita(razao, ant.de, ant.ate, base);

  const detalhe = investimentoDetalhado(razao, de, ate, marcadas, base);
  const invest = detalhe.valor;
  const investAnt = investimentoEmCaptacao(razao, ant.de, ant.ate, marcadas, base);

  const nLeads = contarLeads(leads, de, ate);
  const nLeadsAnt = contarLeads(leads, ant.de, ant.ate);

  const cpl = custoPorLead(invest, nLeads);
  const cplAnt = custoPorLead(investAnt, nLeadsAnt);

  return {
    periodo: { de: de, ate: ate, dias: diasDaJanela(de, ate), base: base },
    periodoAnterior: ant,

    leads: par(nLeads, nLeadsAnt),

    conversao: Object.assign(par(conv.pct, convAnt.pct),
      { fechados: conv.fechados, total: conv.total }),

    faturamento: Object.assign(par(receitaAtual, receitaAnt),
      { sessoes: d.sessoes || 0, sessoesAnterior: d.sessoesAnterior || 0 }),

    ticketMedio: Object.assign(
      par(ticketMedio(receitaAtual, d.pacientesAtendidas || 0),
          ticketMedio(receitaAnt, d.pacientesAtendidasAnterior || 0)),
      { pacientes: d.pacientesAtendidas || 0 }),

    custoPorLead: Object.assign(par(cpl, cplAnt), {
      investimento: invest,
      leads: nLeads,
      // A tela precisa distinguir "nao investiu" de "ninguem configurou" -- e,
      // desde a M6.6, de "marcou, mas nada caiu neste periodo".
      categoriasMarcadas: marcadas.length,
      lancamentos: detalhe.lancamentos
    }),

    serieDeLeads: serieDeLeads(leads, de, ate)
  };
}

module.exports = {
  diasDaJanela, janelaAnterior, par,
  contarLeads, conversao, funil, serieDeLeads,
  receita, investimentoEmCaptacao, investimentoDetalhado, custoPorLead, ticketMedio,
  painel
};

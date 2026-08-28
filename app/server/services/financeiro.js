'use strict';
/** Financeiro — razão único (T2.4 e T2.6).
 *
 *  A conta mora aqui, em funções puras que recebem as linhas do razão e
 *  devolvem números. A rota só busca e entrega. Isso existe por um motivo
 *  específico: relatório financeiro errado não quebra nada, ele mente — e a
 *  mentira mais comum tem nome.
 *
 *  COMPETÊNCIA E CAIXA SÃO NÚMEROS DIFERENTES E OS DOIS ESTÃO CERTOS.
 *
 *    competência = quando o fato aconteceu   -> entry_date, pago ou não
 *    caixa       = quando o dinheiro andou   -> paid_at, só o que foi pago
 *
 *  Uma despesa lançada e ainda não paga entra no resultado por competência e
 *  não entra no caixa. Somar os dois critérios no mesmo relatório é o jeito
 *  clássico de produzir dois "lucros" que não batem e destruir a confiança da
 *  pessoa no sistema inteiro. Por isso a base é sempre explícita, aqui e na
 *  tela.
 *
 *  Duas outras decisões que não devem ser redecididas:
 *  - Receita e despesa vivem na MESMA tabela, separadas por `type`.
 *  - `amount` é SEMPRE positivo; o sinal vem do `type`. Guardar despesa
 *    negativa parece prático e produz erro de soma em todo lugar que esquecer
 *    o ABS.
 */

const BASES = ['competencia', 'caixa'];

function centavos(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Normaliza para 'AAAA-MM-DD', aceitando Date ou string. */
function dia(v) {
  if (!v) return null;
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return v.getFullYear() + '-' + p(v.getMonth() + 1) + '-' + p(v.getDate());
  }
  return String(v).slice(0, 10);
}

/** A data que vale para a base escolhida. Em caixa, sem paid_at o lançamento
 *  simplesmente não existe ainda. */
function dataDaBase(linha, base) {
  return base === 'caixa' ? dia(linha.paid_at) : dia(linha.entry_date);
}

function dentro(data, de, ate) {
  if (!data) return false;
  if (de && data < de) return false;
  if (ate && data > ate) return false;
  return true;
}

function porCategoria(linhas, tipo) {
  const mapa = new Map();
  for (const l of linhas) {
    if (l.type !== tipo) continue;
    const chave = l.category_id || '__sem__';
    const atual = mapa.get(chave) || { categoryId: l.category_id || null, categoria: l.category_name || 'Sem categoria', total: 0, quantidade: 0 };
    atual.total += Number(l.amount);
    atual.quantidade += 1;
    mapa.set(chave, atual);
  }
  return Array.from(mapa.values())
    .map((c) => ({ ...c, total: centavos(c.total) }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Resultado do período.
 * @param {Array} linhas   linhas de cash_entries (com category_name opcional)
 * @param {object} opcoes  { de, ate, base, hoje }
 */
function resumo(linhas, opcoes) {
  opcoes = opcoes || {};
  const base = BASES.indexOf(opcoes.base) !== -1 ? opcoes.base : 'competencia';
  const de = dia(opcoes.de);
  const ate = dia(opcoes.ate);
  const hoje = dia(opcoes.hoje) || dia(new Date());

  const noPeriodo = (linhas || []).filter((l) => dentro(dataDaBase(l, base), de, ate));

  let receita = 0, despesa = 0;
  for (const l of noPeriodo) {
    if (l.type === 'RECEITA') receita += Number(l.amount);
    else if (l.type === 'DESPESA') despesa += Number(l.amount);
  }
  const resultado = receita - despesa;

  // Contas a pagar não dependem do período nem da base: é o que está em aberto
  // agora. Filtrar por período aqui esconderia justamente a conta atrasada.
  const emAberto = (linhas || []).filter((l) => l.type === 'DESPESA' && !dia(l.paid_at));
  const limite7 = somarDias(hoje, 7);
  let aPagarTotal = 0, vencido = 0, aVencer = 0, semVencimento = 0;
  for (const l of emAberto) {
    const valor = Number(l.amount);
    aPagarTotal += valor;
    const venc = dia(l.due_date);
    if (!venc) semVencimento += valor;
    else if (venc < hoje) vencido += valor;
    else if (venc <= limite7) aVencer += valor;
  }

  return {
    periodo: { inicio: de, fim: ate, base: base },
    receitaTotal: centavos(receita),
    despesaTotal: centavos(despesa),
    resultado: centavos(resultado),
    margemPct: receita > 0 ? centavos((resultado / receita) * 100) : 0,
    lancamentos: noPeriodo.length,
    receitaPorCategoria: porCategoria(noPeriodo, 'RECEITA'),
    despesaPorCategoria: porCategoria(noPeriodo, 'DESPESA'),
    aPagar: {
      total: centavos(aPagarTotal),
      vencido: centavos(vencido),
      aVencer7Dias: centavos(aVencer),
      semVencimento: centavos(semVencimento)
    }
  };
}

/** Variação percentual contra o período anterior. Sem base de comparação
 *  devolve null em vez de 0 — 0 leria como "não mudou", que é diferente de
 *  "não havia nada antes". */
function variacaoPct(atual, anterior) {
  if (!isFinite(atual) || !isFinite(anterior)) return null;
  if (anterior === 0) return atual === 0 ? 0 : null;
  return centavos(((atual - anterior) / Math.abs(anterior)) * 100);
}

function comparativo(resumoAtual, resumoAnterior) {
  if (!resumoAnterior) return null;
  return {
    receitaPct: variacaoPct(resumoAtual.receitaTotal, resumoAnterior.receitaTotal),
    despesaPct: variacaoPct(resumoAtual.despesaTotal, resumoAnterior.despesaTotal),
    resultadoPct: variacaoPct(resumoAtual.resultado, resumoAnterior.resultado),
    anterior: {
      receitaTotal: resumoAnterior.receitaTotal,
      despesaTotal: resumoAnterior.despesaTotal,
      resultado: resumoAnterior.resultado
    }
  };
}

/** Série do fluxo de caixa, com saldo acumulado.
 *  Devolve todos os intervalos do período, inclusive os vazios — buraco no
 *  eixo do tempo faz gráfico mentir sobre a forma da curva. */
function fluxo(linhas, opcoes) {
  opcoes = opcoes || {};
  const base = BASES.indexOf(opcoes.base) !== -1 ? opcoes.base : 'caixa';
  const porMes = opcoes.agruparPor === 'month';
  const de = dia(opcoes.de);
  const ate = dia(opcoes.ate);

  const balde = (d) => (porMes ? d.slice(0, 7) : d);
  const mapa = new Map();

  for (const l of linhas || []) {
    const d = dataDaBase(l, base);
    if (!dentro(d, de, ate)) continue;
    const chave = balde(d);
    const atual = mapa.get(chave) || { periodo: chave, receita: 0, despesa: 0 };
    if (l.type === 'RECEITA') atual.receita += Number(l.amount);
    else atual.despesa += Number(l.amount);
    mapa.set(chave, atual);
  }

  const chaves = de && ate ? intervalos(de, ate, porMes) : Array.from(mapa.keys()).sort();
  let acumulado = 0;
  return chaves.map((k) => {
    const v = mapa.get(k) || { periodo: k, receita: 0, despesa: 0 };
    const saldo = v.receita - v.despesa;
    acumulado += saldo;
    return {
      periodo: k,
      receita: centavos(v.receita),
      despesa: centavos(v.despesa),
      saldo: centavos(saldo),
      acumulado: centavos(acumulado)
    };
  });
}

function somarDias(dataIso, n) {
  const d = new Date(dataIso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return dia(d);
}

function intervalos(de, ate, porMes) {
  const saida = [];
  if (porMes) {
    let [a, m] = de.slice(0, 7).split('-').map(Number);
    const fim = ate.slice(0, 7);
    for (let i = 0; i < 240; i++) {
      const chave = a + '-' + String(m).padStart(2, '0');
      saida.push(chave);
      if (chave >= fim) break;
      m += 1;
      if (m > 12) { m = 1; a += 1; }
    }
  } else {
    let d = de;
    for (let i = 0; i < 400 && d <= ate; i++) {
      saida.push(d);
      d = somarDias(d, 1);
    }
  }
  return saida;
}

/** Chave lógica de idempotência de uma despesa recorrente: uma por mês.
 *  A chave única do banco é (source, source_id, type) — daí o formato. */
function chaveRecorrencia(recorrenciaId, dataIso) {
  return recorrenciaId + ':' + dia(dataIso).slice(0, 7);
}

/** Datas em que uma recorrência deveria gerar lançamento dentro do intervalo.
 *  Dia 31 num mês de 30 cai no último dia do mês, e não some. */
function ocorrencias(recorrencia, de, ate) {
  const inicio = dia(recorrencia.start_date);
  const fim = dia(recorrencia.end_date);
  const desde = dia(de);
  const ateA = dia(ate);
  const saida = [];
  if (!recorrencia.active) return saida;

  let [ano, mes] = desde.slice(0, 7).split('-').map(Number);
  for (let i = 0; i < 240; i++) {
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const d = Math.min(Number(recorrencia.day_of_month), ultimoDia);
    const data = ano + '-' + String(mes).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    if (data > ateA) break;
    if (data >= desde && (!inicio || data >= inicio) && (!fim || data <= fim)) saida.push(data);
    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
  }
  return saida;
}

module.exports = {
  resumo,
  comparativo,
  variacaoPct,
  fluxo,
  ocorrencias,
  chaveRecorrencia,
  centavos,
  dia,
  somarDias,
  BASES
};

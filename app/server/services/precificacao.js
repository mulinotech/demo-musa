'use strict';
/** Motor de precificacao (T2.2).
 *
 *  Funcao pura, sem banco: recebe tudo por parametro e devolve numeros. E assim
 *  que da para testar a formula centavo a centavo, que e a unica forma de
 *  confiar nela - o erro aqui nao quebra nada, so entrega margem menor do que a
 *  pedida, e aparece meses depois no fechamento.
 *
 *  A REGRA QUE MAIS SE ERRA: margem, comissao, taxa de cartao e imposto incidem
 *  sobre o PRECO DE VENDA, nao sobre o custo. Por isso o preco sai de
 *
 *      preco = custoDireto / (1 - percentuais)        <- markup divisor
 *
 *  e nunca de `custo * 1,30`. Com custo de 120 e 49,5% de percentuais, o divisor
 *  da 237,62 e a multiplicacao daria 156,00 - a clinica trabalharia de graca
 *  achando que tem 30% de margem. Se alguem "simplificar" esta conta para
 *  multiplicacao, o teste de referencia quebra. E para isso que ele existe.
 */

/** Arredonda para centavos. So na saida - nunca em valor intermediario. */
function centavos(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function ehNumero(v) {
  return typeof v === 'number' && isFinite(v);
}

/**
 * @param {object} e
 * @param {number} e.durationMin          duracao do servico em minutos
 * @param {number} e.totalFixedMonthly    soma dos custos fixos mensais ativos
 * @param {number} e.monthlyWorkingHours  horas produtivas por mes
 * @param {number} e.variableCost         insumos consumidos no servico, em R$
 * @param {number} e.marginPct            margem de lucro desejada (ex.: 30)
 * @param {number} e.commissionPct        comissao do profissional (ex.: 10)
 * @param {number} e.cardFeePct           taxa de cartao (ex.: 3.5)
 * @param {number} e.taxPct               imposto sobre o servico (ex.: 6)
 * @returns {{erro:string}|{custoFixoHora:number,custoFixoServico:number,custoDireto:number,
 *            percentuaisSobreVenda:number,precoSugerido:number,valorHora:number,lucroLiquido:number}}
 */
function calcularPreco(e) {
  e = e || {};
  const duracao = Number(e.durationMin);
  const fixoMensal = Number(e.totalFixedMonthly);
  const horas = Number(e.monthlyWorkingHours);
  const custoVariavel = Number(e.variableCost || 0);
  const margem = Number(e.marginPct || 0);
  const comissao = Number(e.commissionPct || 0);
  const cartao = Number(e.cardFeePct || 0);
  const imposto = Number(e.taxPct || 0);

  const entradas = [duracao, fixoMensal, horas, custoVariavel, margem, comissao, cartao, imposto];
  if (!entradas.every(ehNumero)) {
    return { erro: 'Todos os valores da simulacao precisam ser numeros.' };
  }
  if (entradas.some(function (n) { return n < 0; })) {
    return { erro: 'Nenhum valor da simulacao pode ser negativo.' };
  }
  if (duracao <= 0) {
    return { erro: 'Informe a duracao do servico em minutos.' };
  }
  if (horas <= 0) {
    return { erro: 'Informe quantas horas produtivas a clinica tem por mes.' };
  }

  const percentuaisSobreVenda = (margem + comissao + cartao + imposto) / 100;
  if (percentuaisSobreVenda >= 1) {
    return {
      erro: 'A soma de margem, comissao, taxa de cartao e imposto precisa ser menor que 100%.'
    };
  }

  const custoFixoHora = fixoMensal / horas;
  const custoFixoServico = custoFixoHora * (duracao / 60);
  const custoDireto = custoFixoServico + custoVariavel;

  const precoSugerido = custoDireto / (1 - percentuaisSobreVenda);
  const valorHora = precoSugerido / (duracao / 60);
  const descontosSobreVenda = (comissao + cartao + imposto) / 100;
  const lucroLiquido = precoSugerido - custoDireto - precoSugerido * descontosSobreVenda;

  return {
    custoFixoHora: centavos(custoFixoHora),
    custoFixoServico: centavos(custoFixoServico),
    custoDireto: centavos(custoDireto),
    percentuaisSobreVenda: percentuaisSobreVenda,
    precoSugerido: centavos(precoSugerido),
    valorHora: centavos(valorHora),
    lucroLiquido: centavos(lucroLiquido)
  };
}

/** Compara o preco praticado com o sugerido. Numero positivo em `deixandoNaMesa`
 *  significa que cada atendimento sai mais barato do que deveria. */
function compararComPraticado(precoSugerido, precoAtual) {
  const atual = Number(precoAtual);
  if (!ehNumero(atual) || atual <= 0) return null;
  const diferenca = precoSugerido - atual;
  return {
    precoAtual: centavos(atual),
    diferenca: centavos(diferenca),
    deixandoNaMesa: diferenca > 0 ? centavos(diferenca) : 0,
    variacaoPct: centavos((diferenca / atual) * 100)
  };
}

/** O catalogo guarda `duration` como VARCHAR e o conteudo e irregular: a tela de
 *  Cadastros grava "60", mas ha texto herdado como "40 a 60 minutos".
 *
 *  Nao chute. Numero puro vira minutos; qualquer coisa ambigua devolve null,
 *  para a tela pedir a duracao em vez de precificar em cima de um palpite. */
function interpretarDuracao(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'number') return isFinite(valor) && valor > 0 ? Math.round(valor) : null;

  const texto = String(valor).trim();
  if (!texto) return null;

  // "60", "60 min", "60 minutos", "1h30" nao - so o que for inequivoco.
  const soNumero = texto.match(/^(\d{1,4})(?:\s*(?:min|minutos?))?$/i);
  if (soNumero) {
    const n = parseInt(soNumero[1], 10);
    return n > 0 ? n : null;
  }
  return null;
}

module.exports = { calcularPreco, compararComPraticado, interpretarDuracao, centavos };

'use strict';
/** Custo fixo não é custo recorrente (M6.3, 24/09).
 *
 *  ===================================================== POR QUE ISTO EXISTE
 *
 *  Item do bloco de Precificação do PDF de 19/09: o time comercial disse que
 *  **misturam as duas coisas na aba de Custos fixos**. Não é preciosismo de
 *  nomenclatura — é um erro que sai caro e sai calado.
 *
 *  A aba de Custos fixos existe para responder UMA pergunta: *quanto custa
 *  manter a clínica aberta por uma hora?*. Ela soma o que a clínica paga **no
 *  mês, atenda ela ou não** — aluguel, salário, contador, software — e divide
 *  pelas horas produtivas. Esse número entra em TODO preço calculado.
 *
 *  ================================ O QUE ACONTECE QUANDO SE MISTURA AS DUAS
 *
 *  Lançar ali "ácido hialurônico — R$ 4.000/mês" parece certo: é recorrente, é
 *  todo mês, sai da conta da clínica. Mas insumo **já entra no preço pela outra
 *  porta** — a ficha técnica do serviço, item a item, com o custo médio de
 *  hoje. Somá-lo aqui o conta DUAS VEZES no mesmo preço.
 *
 *  E o erro não aparece: o preço sai mais alto, a margem na tela continua
 *  dizendo 30%, e ninguém tem como desconfiar olhando a tela. A clínica perde
 *  venda por estar cara sem saber por quê — ou, se descobrir e baixar o preço
 *  no olho, perde a margem de verdade.
 *
 *  Pior ainda com comissão e taxa de cartão: as duas são percentuais que a
 *  calculadora já aplica sobre o preço. Lançadas aqui como valor mensal, elas
 *  entram no custo por hora E no percentual — duas vezes, em duas contas
 *  diferentes, sem nenhuma delas saber da outra.
 *
 *  ============================================== A REGRA, EM UMA FRASE
 *
 *  **Entra no custo por hora o que a clínica paga mesmo sem atender.** O que só
 *  existe porque houve atendimento pertence ao procedimento, não à hora.
 *
 *  ======================================== O QUE ESTE ARQUIVO NÃO FAZ
 *
 *  **Não reclassifica o que já está lançado.** Toda linha existente nasce
 *  `FIXO`, que é como ela vinha sendo contada — o custo por hora da clínica não
 *  muda de um dia para o outro por causa desta tarefa. Adivinhar pelo nome que
 *  "Ácido" é insumo e "Aluguel" não é reescreveria o preço de uma clínica com
 *  base em palpite sobre texto livre, e é justamente o tipo de coisa que a
 *  M5.11 recusou fazer com equipamento.
 *
 *  A tela mostra a distinção e deixa a dona reclassificar. Quem sabe o que é
 *  cada linha é quem a lançou.
 */

/** As duas naturezas, e o que cada uma faz com o preço. */
const NATUREZAS = [
  {
    valor: 'FIXO',
    rotulo: 'Custo fixo da estrutura',
    ajuda: 'A clínica paga mesmo num mês sem atender ninguém: aluguel, salário, ' +
           'contador, software, internet, pró-labore.',
    entraNoCustoPorHora: true
  },
  {
    valor: 'VARIAVEL',
    rotulo: 'Custo recorrente por atendimento',
    ajuda: 'Só existe porque houve procedimento: insumo, descartável, comissão, ' +
           'taxa de cartão. Já entra no preço pela ficha técnica e pelos percentuais — ' +
           'somar aqui contaria duas vezes.',
    entraNoCustoPorHora: false
  }
];

const PADRAO = 'FIXO';

/** A natureza que este valor representa, ou o padrão. */
function natureza(valor) {
  const v = String(valor || '').trim().toUpperCase();
  return NATUREZAS.some((n) => n.valor === v) ? v : PADRAO;
}

function entraNoCustoPorHora(valor) {
  const n = NATUREZAS.filter((x) => x.valor === natureza(valor))[0];
  return !!(n && n.entraNoCustoPorHora);
}

/** Separa a lista nas duas naturezas e soma cada lado.
 *
 *  @param {Array} itens  { monthlyAmount|monthly_amount, active, natureza }
 *  @returns {object} { fixos, variaveis, totalFixo, totalVariavel }
 *
 *  **Item inativo não soma de nenhum lado.** Ele continua na lista porque a
 *  clínica quer lembrar que já pagou aquilo — apagar histórico de custo é como
 *  se perde a conta do ano passado —, mas custo desligado não entra em preço.
 */
function separar(itens) {
  const lista = Array.isArray(itens) ? itens : [];
  const fixos = [], variaveis = [];
  let totalFixo = 0, totalVariavel = 0;

  for (const i of lista) {
    const ativo = i.active === undefined ? true : !!i.active;
    const valor = Number(i.monthlyAmount !== undefined ? i.monthlyAmount : i.monthly_amount) || 0;
    if (entraNoCustoPorHora(i.natureza)) {
      fixos.push(i);
      if (ativo) totalFixo += valor;
    } else {
      variaveis.push(i);
      if (ativo) totalVariavel += valor;
    }
  }

  return {
    fixos: fixos,
    variaveis: variaveis,
    totalFixo: Math.round(totalFixo * 100) / 100,
    totalVariavel: Math.round(totalVariavel * 100) / 100
  };
}

/** O custo por hora — e `null` quando não dá para responder.
 *
 *  Zero horas produtivas não vale zero reais por hora: vale *não sei*. Devolver
 *  0 faria a calculadora somar nada à estrutura e o preço sair barato demais,
 *  em silêncio. */
function custoPorHora(totalFixo, horas) {
  const h = Number(horas);
  if (!isFinite(h) || h <= 0) return null;
  return Math.round((Number(totalFixo) / h) * 100) / 100;
}

module.exports = { NATUREZAS, PADRAO, natureza, entraNoCustoPorHora, separar, custoPorHora };

'use strict';
/** Estoque — regras puras (T3.2).
 *
 *  Recebe linhas, devolve decisões. Nada de banco, nada de rede. Quem grava é
 *  `routes/stock.js` e `services/efeitos-estoque.js`.
 *
 *  CUIDADO COM DECIMAL: o mysql2 devolve `DECIMAL` como STRING, não como
 *  número. `'10.000' + 5` dá `'10.0005'`. Todo valor que entra aqui passa por
 *  `num()`. Esse é o bug silencioso número um deste módulo — o saldo fica
 *  errado sem lançar erro nenhum.
 *
 *  QUATRO REGRAS QUE NÃO DEVEM SER REDECIDIDAS
 *
 *  1. Saldo é derivado do lote. Não existe `products.stock`. Duas fontes para
 *     o mesmo número divergem — a pergunta é só quando.
 *
 *  2. Saída é FEFO: sai primeiro o que VENCE primeiro, não o que entrou
 *     primeiro. Em produto com validade, FIFO joga fora dinheiro.
 *
 *  3. Lote vencido nunca sai automaticamente. Se o único saldo disponível
 *     estiver vencido, a operação FALHA. Consumir vencido "porque tinha
 *     saldo" é o pior desfecho possível: risco sanitário registrado pelo
 *     próprio sistema.
 *
 *  4. Quantidade é sempre positiva; o sinal vem do `type`. Guardar saída
 *     negativa parece prático e vira erro de soma no primeiro SUM sem ABS.
 */

const TIPOS_QUE_SOMAM = ['ENTRADA', 'ESTORNO'];
const TIPOS_QUE_SUBTRAEM = ['SAIDA', 'PERDA'];
const DIAS_ALERTA_VALIDADE = 30;

function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

/** Três casas: é a precisão de `quantity` no banco. Arredondar antes de
 *  comparar evita o clássico 0.09999999999 sobrando num lote "zerado". */
function q(v) {
  return Math.round(num(v) * 1000) / 1000;
}

function centavos(v) {
  return Math.round(num(v) * 100) / 100;
}

function hojeISO(hoje) {
  if (!hoje) return new Date().toISOString().slice(0, 10);
  if (hoje instanceof Date) {
    const z = (n) => String(n).padStart(2, '0');
    return hoje.getFullYear() + '-' + z(hoje.getMonth() + 1) + '-' + z(hoje.getDate());
  }
  return String(hoje).slice(0, 10);
}

function dataDoLote(l) {
  return l.expiry_date ? String(l.expiry_date).slice(0, 10) : null;
}

function vencido(lote, hoje) {
  const d = dataDoLote(lote);
  return !!d && d < hojeISO(hoje);
}

/* ------------------------------------------------------------- saldo */

function saldoDosLotes(lotes) {
  return q((lotes || []).reduce((s, l) => s + num(l.quantity), 0));
}

/** Saldo utilizável: o que está vencido continua no estoque físico e no saldo
 *  contábil, mas não pode ser aplicado em ninguém. Mostrar os dois números
 *  separados é o que impede a recepção de contar com um saldo que não existe
 *  para uso. */
function saldoUtilizavel(lotes, hoje) {
  return q((lotes || []).filter((l) => !vencido(l, hoje)).reduce((s, l) => s + num(l.quantity), 0));
}

/* -------------------------------------------------------------- FEFO */

/** Ordem de consumo: vence antes sai antes; sem validade fica para o fim
 *  (não se sabe quando vence, então não há urgência); empate desempata pelo
 *  mais antigo recebido. */
function ordemFEFO(a, b) {
  const da = dataDoLote(a), db = dataDoLote(b);
  if (da && db && da !== db) return da < db ? -1 : 1;
  if (da && !db) return -1;
  if (!da && db) return 1;
  const ra = String(a.received_at || '').slice(0, 10);
  const rb = String(b.received_at || '').slice(0, 10);
  if (ra !== rb) return ra < rb ? -1 : 1;
  return String(a.id) < String(b.id) ? -1 : 1;
}

/**
 * Distribui uma saída entre os lotes disponíveis.
 *
 * Devolve `{ ok: true, consumo: [{batchId, quantidade, unitCost}], custo }`
 * ou `{ ok: false, erro, faltando, vencidoDisponivel }`.
 *
 * Uma saída pode atravessar vários lotes — e nesse caso gera um movimento por
 * lote, porque é isso que mantém a rastreabilidade de pé. Registrar um
 * movimento só, com a soma, apagaria de qual lote saiu o que foi aplicado na
 * paciente.
 */
function escolherLotes(lotes, quantidade, op) {
  op = op || {};
  const hoje = hojeISO(op.hoje);
  const pedido = q(quantidade);

  if (!(pedido > 0)) return { ok: false, erro: 'Quantidade precisa ser maior que zero.' };

  const disponiveis = (lotes || [])
    .filter((l) => num(l.quantity) > 0)
    .filter((l) => op.permitirVencido || !vencido(l, hoje))
    .sort(ordemFEFO);

  const total = saldoDosLotes(disponiveis);
  if (total < pedido) {
    // Distinguir "não tem" de "tem, mas está vencido" muda o que a pessoa faz
    // em seguida: comprar, ou dar baixa da perda e comprar.
    const emVencidos = q((lotes || []).filter((l) => vencido(l, hoje)).reduce((s, l) => s + num(l.quantity), 0));
    return {
      ok: false,
      erro: 'Saldo insuficiente.',
      disponivel: total,
      faltando: q(pedido - total),
      vencidoDisponivel: emVencidos
    };
  }

  const consumo = [];
  let restante = pedido;
  let custo = 0;
  for (const l of disponiveis) {
    if (restante <= 0) break;
    const tira = q(Math.min(restante, num(l.quantity)));
    if (tira <= 0) continue;
    consumo.push({ batchId: l.id, quantidade: tira, unitCost: centavos(l.unit_cost) });
    custo += tira * num(l.unit_cost);
    restante = q(restante - tira);
  }

  return { ok: true, consumo: consumo, custo: centavos(custo) };
}

/* -------------------------------------------------------- custo médio */

/**
 * Custo médio ponderado depois de uma entrada.
 *
 * Média ponderada e não "o último preço pago": com o último preço, uma compra
 * pequena e caríssima de emergência passaria a valorizar todo o estoque
 * antigo, e a precificação subiria em cima de um custo que a clínica não tem.
 *
 * O caso de referência do módulo: 10 a R$ 20,00 + 10 a R$ 30,00 = R$ 25,00.
 */
function custoMedio(saldoAtual, custoAtual, qtdEntrada, custoEntrada) {
  const sa = q(saldoAtual), qe = q(qtdEntrada);
  const ca = num(custoAtual), ce = num(custoEntrada);
  const total = sa + qe;
  if (total <= 0) return centavos(ce);
  if (sa <= 0) return centavos(ce);              // estoque zerado: o custo é o da entrada
  return centavos((sa * ca + qe * ce) / total);
}

/* ------------------------------------------------------------ alertas */

function diasAte(data, hoje) {
  if (!data) return null;
  const a = new Date(String(data).slice(0, 10) + 'T12:00:00');
  const b = new Date(hojeISO(hoje) + 'T12:00:00');
  return Math.round((a - b) / 86400000);
}

/**
 * Alertas por produto. Um produto pode disparar mais de um.
 *
 * A ordem de gravidade é a que a tela usa: vencido com saldo primeiro, porque
 * é o único que representa risco sanitário e não apenas risco de faltar.
 */
function alertas(produtos, hoje) {
  const criticos = [], validade = [], reposicao = [];

  for (const p of (produtos || [])) {
    const lotes = p.lotes || [];
    const saldo = saldoDosLotes(lotes);
    const util = saldoUtilizavel(lotes, hoje);
    const minimo = q(p.min_stock);

    for (const l of lotes) {
      if (num(l.quantity) <= 0) continue;
      const d = diasAte(dataDoLote(l), hoje);
      if (d === null) continue;
      if (d < 0) {
        criticos.push({ tipo: 'VENCIDO', productId: p.id, produto: p.name, batchId: l.id,
                        lote: l.batch_number || null, validade: dataDoLote(l),
                        quantidade: q(l.quantity), diasVencido: -d });
      } else if (d <= DIAS_ALERTA_VALIDADE) {
        validade.push({ tipo: 'VENCENDO', productId: p.id, produto: p.name, batchId: l.id,
                        lote: l.batch_number || null, validade: dataDoLote(l),
                        quantidade: q(l.quantity), diasRestantes: d });
      }
    }

    // O mínimo compara com o saldo UTILIZÁVEL. Contar lote vencido aqui faria
    // o sistema dizer "tem estoque" para um produto que não pode ser aplicado.
    if (minimo > 0 && util < minimo) {
      reposicao.push({ tipo: 'ABAIXO_DO_MINIMO', productId: p.id, produto: p.name,
                       saldo: util, saldoTotal: saldo, minimo: minimo, faltando: q(minimo - util) });
    }
  }

  criticos.sort((a, b) => b.diasVencido - a.diasVencido);
  validade.sort((a, b) => a.diasRestantes - b.diasRestantes);
  reposicao.sort((a, b) => b.faltando - a.faltando);

  return { criticos: criticos, validade: validade, reposicao: reposicao,
           total: criticos.length + validade.length + reposicao.length };
}

/* --------------------------------------------- ficha técnica e custo */

/**
 * Custo variável de um serviço, a partir da ficha técnica.
 *
 * `origem` sai junto de propósito e a tela precisa mostrá-la: a profissional
 * tem de saber se está olhando para um custo somado dos insumos de verdade ou
 * para um número digitado há meses. Sem isso, um chute antigo passa a parecer
 * cálculo.
 */
function custoVariavelDaFicha(itens, custoDigitado) {
  const lista = itens || [];
  if (!lista.length) {
    return { valor: centavos(custoDigitado), origem: 'MANUAL', itens: 0 };
  }
  let soma = 0;
  const detalhe = lista.map(function (i) {
    const parcial = centavos(num(i.quantity) * num(i.unit_cost));
    soma += parcial;
    return { productId: i.product_id, produto: i.name, quantidade: q(i.quantity),
             unidade: i.unit, custoUnitario: centavos(i.unit_cost), parcial: parcial };
  });
  return { valor: centavos(soma), origem: 'FICHA_TECNICA', itens: lista.length, detalhe: detalhe };
}

/** Sinal do movimento no saldo. Existe para nunca mais alguém decidir isso
 *  num `if` espalhado pelo código. */
function sinal(tipo) {
  if (TIPOS_QUE_SOMAM.indexOf(tipo) !== -1) return 1;
  if (TIPOS_QUE_SUBTRAEM.indexOf(tipo) !== -1) return -1;
  return 0; // AJUSTE carrega o proprio sinal na intencao de quem ajusta
}

module.exports = {
  DIAS_ALERTA_VALIDADE: DIAS_ALERTA_VALIDADE,
  num: num, q: q, centavos: centavos, hojeISO: hojeISO,
  vencido: vencido, diasAte: diasAte,
  saldoDosLotes: saldoDosLotes, saldoUtilizavel: saldoUtilizavel,
  ordemFEFO: ordemFEFO, escolherLotes: escolherLotes,
  custoMedio: custoMedio, alertas: alertas,
  custoVariavelDaFicha: custoVariavelDaFicha, sinal: sinal
};

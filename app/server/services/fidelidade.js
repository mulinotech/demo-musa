'use strict';
/** Fidelização por pontos — regras puras (T5.2).
 *
 *  A DECISÃO QUE O CONTEXTO DEIXOU EM ABERTO, E QUE ESCOLHO AQUI
 *
 *  O contexto oferecia dois caminhos para saber quais pontos expiram: amarrar
 *  cada resgate aos acúmulos de onde ele saiu (tabela de ligação), ou aplicar a
 *  expiração sobre o saldo remanescente em ordem. Mandava escolher um e
 *  escrever a escolha no código, porque a diferença aparece em auditoria.
 *
 *  ESCOLHA: sem tabela de ligação. Os acúmulos formam uma fila ordenada por
 *  data de expiração — quem vence antes é consumido antes — e todo o consumo
 *  (resgate, expiração, ajuste negativo) é aplicado contra essa fila em
 *  memória, sempre que se calcula o saldo.
 *
 *  Por quê: com tabela de ligação, cada resgate precisa gravar N linhas e
 *  qualquer estorno tem de desfazer exatamente aquelas N — é mais uma
 *  estrutura para ficar inconsistente, para o volume de uma clínica que faz
 *  algumas centenas de atendimentos por mês. Sem ela, a fila é recalculada do
 *  extrato, que é a única fonte de verdade, e uma auditoria refaz a conta com
 *  os mesmos dados e chega no mesmo número.
 *
 *  O preço da escolha, dito na cara: o extrato não responde "esses 50 pontos
 *  resgatados saíram do acúmulo de março ou de abril". Responde "o saldo é X e
 *  Y vence em tal data", que é o que a recepção e a paciente perguntam.
 *
 *  DUAS OUTRAS REGRAS QUE NÃO DEVEM SER REDECIDIDAS
 *
 *  1. PISO, nunca arredondamento. R$ 249,90 com 1 ponto por real dá 249
 *     pontos, não 250. Creditar ponto que não foi conquistado é dívida
 *     silenciosa, e ela cresce sozinha.
 *
 *  2. O acúmulo usa o preço EFETIVAMENTE COBRADO, já descontado o resgate.
 *     Acumular sobre o valor cheio transforma a paciente numa máquina de gerar
 *     pontos com os próprios pontos — o programa se financia até quebrar.
 */

const TIPOS = ['ACUMULO', 'RESGATE', 'EXPIRACAO', 'AJUSTE', 'ESTORNO'];

const PADRAO = {
  active: true,
  pointsPerReal: 1,
  redemptionValue: 0.1,
  expiryDays: 90,
  minPointsToRedeem: 100
};

function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
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

function diasEntre(de, ate) {
  const a = new Date(hojeISO(de) + 'T12:00:00');
  const b = new Date(hojeISO(ate) + 'T12:00:00');
  return Math.round((b - a) / 86400000);
}

/** Normaliza a linha de configuração do banco. */
function config(linha) {
  if (!linha) return Object.assign({}, PADRAO);
  return {
    active: !!Number(linha.active),
    pointsPerReal: num(linha.points_per_real) || PADRAO.pointsPerReal,
    redemptionValue: num(linha.redemption_value),
    expiryDays: Math.max(0, Math.round(num(linha.expiry_days))),
    minPointsToRedeem: Math.max(0, Math.round(num(linha.min_points_to_redeem)))
  };
}

/* ------------------------------------------------------------- acúmulo */

/** Pontos que um atendimento gera. Devolve 0 quando não gera — bloqueio de
 *  horário, cortesia e atendimento sem preço não acumulam. */
function pontosDoAtendimento(ap, cfg) {
  const c = cfg || PADRAO;
  if (!c.active) return 0;
  if (!ap || ap.kind === 'BLOQUEIO') return 0;
  const preco = num(ap.price);
  if (preco <= 0) return 0;
  return Math.floor(preco * num(c.pointsPerReal));   // PISO, nao arredondamento
}

function validadeDoAcumulo(dataBase, cfg) {
  const c = cfg || PADRAO;
  if (!c.expiryDays) return null;                    // 0 = nao expira
  // EM DIAS, nao em meses. A clinica promete "90 dias" a paciente, e tres
  // meses nao sao 90 dias: de 31 de janeiro dao 89, de 1o de dezembro dao 90.
  // Guardar em meses e prometer em dias e o mesmo numero calculado de duas
  // formas -- e quem perde o dia de diferenca e sempre a paciente.
  return somarDias(hojeISO(dataBase), c.expiryDays);
}

/* ------------------------------------------------------ fila de acúmulos */

/** Ordem de consumo: vence antes sai antes; sem validade fica para o fim.
 *  Mesma lógica do FEFO do estoque, pelo mesmo motivo — o que vai virar pó
 *  primeiro é o que precisa ser gasto primeiro. */
function ordemDeConsumo(a, b) {
  const ea = a.expires_at ? String(a.expires_at).slice(0, 10) : null;
  const eb = b.expires_at ? String(b.expires_at).slice(0, 10) : null;
  if (ea && eb && ea !== eb) return ea < eb ? -1 : 1;
  if (ea && !eb) return -1;
  if (!ea && eb) return 1;
  const ca = String(a.created_at || '');
  const cb = String(b.created_at || '');
  if (ca !== cb) return ca < cb ? -1 : 1;
  return String(a.id) < String(b.id) ? -1 : 1;
}

/**
 * Reconstrói a fila de acúmulos com o quanto ainda resta de cada um.
 *
 * Entradas positivas (ACUMULO, AJUSTE positivo, ESTORNO positivo) formam a
 * fila. Tudo negativo é consumo e é aplicado contra a fila na ordem de
 * expiração. É aqui que a escolha documentada no topo se materializa.
 */
function filaDeAcumulos(transacoes) {
  const lista = transacoes || [];
  const entradas = lista.filter((t) => num(t.points) > 0).sort(ordemDeConsumo)
    .map((t) => ({
      id: t.id,
      pontos: Math.round(num(t.points)),
      restante: Math.round(num(t.points)),
      expiresAt: t.expires_at ? String(t.expires_at).slice(0, 10) : null,
      expired: !!Number(t.expired),
      tipo: t.type,
      descricao: t.description
    }));

  let consumo = lista.reduce((s, t) => s + (num(t.points) < 0 ? -num(t.points) : 0), 0);
  for (const e of entradas) {
    if (consumo <= 0) break;
    const tira = Math.min(consumo, e.restante);
    e.restante -= tira;
    consumo -= tira;
  }
  return entradas;
}

/** Saldo utilizável: o que resta e ainda não venceu.
 *
 *  Ponto vencido continua no extrato — o histórico não se apaga — mas não é
 *  saldo. Somar tudo faria a recepção prometer à paciente um resgate que o
 *  sistema vai recusar na hora. */
function saldo(transacoes, hoje) {
  const h = hojeISO(hoje);
  return filaDeAcumulos(transacoes)
    .filter((e) => !e.expiresAt || e.expiresAt >= h)
    .reduce((s, e) => s + e.restante, 0);
}

/** Quanto vence nos próximos N dias. É o número que justifica o programa: é o
 *  gancho para chamar a paciente de volta antes de o ponto virar pó. */
function aExpirar(transacoes, dias, hoje) {
  const h = hojeISO(hoje);
  const limite = somarDias(h, dias == null ? 30 : dias);
  return filaDeAcumulos(transacoes)
    .filter((e) => e.expiresAt && e.expiresAt >= h && e.expiresAt <= limite)
    .reduce((s, e) => s + e.restante, 0);
}

function somarDias(dataISO, n) {
  const d = new Date(String(dataISO).slice(0, 10) + 'T12:00:00');
  d.setDate(d.getDate() + Number(n || 0));
  const z = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}

/** O que o worker precisa expirar hoje: acúmulos vencidos que ainda têm
 *  restante e ainda não foram marcados. Devolve a lista, não o total, porque
 *  cada um gera uma transação própria — e é o id de cada um que serve de chave
 *  de idempotência para rodar duas vezes no mesmo dia não expirar em dobro. */
function paraExpirar(transacoes, hoje) {
  const h = hojeISO(hoje);
  return filaDeAcumulos(transacoes)
    .filter((e) => e.expiresAt && e.expiresAt < h && e.restante > 0 && !e.expired)
    .map((e) => ({ acumuloId: e.id, pontos: e.restante, expirouEm: e.expiresAt,
                   diasVencido: diasEntre(e.expiresAt, h) }));
}

function valorEmReais(pontos, cfg) {
  return centavos(Math.max(0, Math.round(num(pontos))) * num((cfg || PADRAO).redemptionValue));
}

/* -------------------------------------------------------------- resgate */

/** Desconto em reais que um prêmio dá neste atendimento.
 *
 *  Nunca passa do preço: prêmio maior que o procedimento não gera crédito
 *  a favor da paciente — gera confusão e, se virar negativo, receita negativa
 *  no financeiro. */
function descontoDoPremio(premio, precoDoAtendimento) {
  const preco = centavos(precoDoAtendimento);
  if (!premio || preco <= 0) return 0;
  let bruto = 0;
  if (premio.type === 'DESCONTO_VALOR') bruto = num(premio.value);
  else if (premio.type === 'DESCONTO_PCT') bruto = preco * num(premio.value) / 100;
  else if (premio.type === 'SERVICO') bruto = premio.value == null ? preco : num(premio.value);
  else if (premio.type === 'PRODUTO') bruto = 0;   // produto entregue em mao, nao abate preco
  return centavos(Math.min(Math.max(bruto, 0), preco));
}

/**
 * Pode resgatar? As duas travas, e a razão de cada uma na mensagem.
 *
 * Recusa também depois da conclusão, e essa é a trava mais importante: se o
 * resgate entrasse depois, o acúmulo já teria sido creditado sobre o valor
 * cheio e a conta ficaria errada em favor da paciente, silenciosamente.
 */
function podeResgatar(p) {
  p = p || {};
  const cfg = p.config || PADRAO;
  if (!cfg.active) return { ok: false, status: 409, error: 'O programa de fidelidade esta desativado.' };
  if (!p.premio) return { ok: false, status: 404, error: 'Recompensa nao encontrada.' };
  if (!Number(p.premio.active)) return { ok: false, status: 409, error: 'Esta recompensa esta inativa.' };
  if (!p.compromisso) return { ok: false, status: 404, error: 'Compromisso nao encontrado.' };
  if (!p.compromisso.client_id) {
    return { ok: false, status: 400, error: 'O compromisso precisa estar ligado a um paciente.' };
  }
  if (p.compromisso.completed_at) {
    return { ok: false, status: 409,
      error: 'Atendimento ja concluido: o resgate tem de entrar antes, senao os pontos sao creditados sobre o valor cheio.' };
  }
  if (p.jaResgatou) {
    return { ok: false, status: 409, error: 'Este atendimento ja tem um resgate. Desfaca o anterior para trocar de recompensa.' };
  }

  const custo = Math.round(num(p.premio.points_cost));
  const disponivel = Math.round(num(p.saldo));
  if (disponivel < cfg.minPointsToRedeem) {
    return { ok: false, status: 409,
      error: 'Saldo de ' + disponivel + ' ponto(s): o minimo para resgatar e ' + cfg.minPointsToRedeem + '.' };
  }
  if (disponivel < custo) {
    return { ok: false, status: 409,
      error: 'Faltam ' + (custo - disponivel) + ' ponto(s) para esta recompensa.' };
  }

  const desconto = descontoDoPremio(p.premio, p.compromisso.price);
  const precoFinal = centavos(num(p.compromisso.price) - desconto);
  return { ok: true, custo: custo, desconto: desconto, precoFinal: precoFinal,
           pontosDepois: disponivel - custo,
           // O acumulo cai sobre o valor final: e o mesmo numero que a tela mostra.
           acumuloPrevisto: Math.floor(precoFinal * num(cfg.pointsPerReal)) };
}

/** Frase de exemplo da tela de configuração. Ver o efeito da regra antes de
 *  salvar é o que evita programa mal calibrado — 1 ponto por real com resgate a
 *  R$ 0,50 devolve metade do faturamento em desconto, e isso não é óbvio
 *  olhando dois campos numéricos. */
function exemplo(cfg, precoExemplo) {
  const c = cfg || PADRAO;
  const preco = centavos(precoExemplo == null ? 250 : precoExemplo);
  const pontos = Math.floor(preco * num(c.pointsPerReal));
  const vale = valorEmReais(pontos, c);
  const pct = preco > 0 ? Math.round((vale / preco) * 1000) / 10 : 0;
  return {
    preco: preco, pontos: pontos, vale: vale, percentualDeVolta: pct,
    expiraEm: c.expiryDays ? c.expiryDays + ' dias' : 'nao expira'
  };
}

module.exports = {
  TIPOS: TIPOS, PADRAO: PADRAO,
  num: num, centavos: centavos, hojeISO: hojeISO, somarDias: somarDias,
  config: config,
  pontosDoAtendimento: pontosDoAtendimento, validadeDoAcumulo: validadeDoAcumulo,
  ordemDeConsumo: ordemDeConsumo, filaDeAcumulos: filaDeAcumulos,
  saldo: saldo, aExpirar: aExpirar, paraExpirar: paraExpirar,
  valorEmReais: valorEmReais, descontoDoPremio: descontoDoPremio,
  podeResgatar: podeResgatar, exemplo: exemplo
};

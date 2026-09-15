'use strict';
/** Efeito FIDELIDADE do evento "atendimento realizado" — contexto 02 + T5.2.
 *
 *  Terceiro e último efeito a preencher o encaixe que a T1.4 deixou pronto.
 *  Mesma forma dos outros dois: recebe o `tx` da transação por parâmetro, não
 *  abre transação própria, não usa o pool. Nada no serviço central mudou para
 *  isto entrar — que era exatamente a aposta do contexto 02.
 *
 *  M1.1c (08/09): o parâmetro virou um **escopo de clínica**. E a leitura da
 *  configuração mudou de comportamento de propósito — ver `lerConfig`.
 *
 *  A CONTA CAI SOBRE O PREÇO EFETIVAMENTE COBRADO.
 *
 *  `appointment.price` já vem líquido: o resgate desconta o preço ANTES da
 *  conclusão (T5.3), então quando este arquivo roda, o valor é o que a paciente
 *  pagou. Acumular sobre o valor cheio faria os pontos financiarem os próprios
 *  pontos — a paciente resgataria R$ 120, acumularia como se tivesse pago o
 *  cheio, e o programa se pagaria até quebrar. É por isso que a ordem do fluxo
 *  não é negociável.
 *
 *  ESTORNO É AJUSTE NEGATIVO, NUNCA EXCLUSÃO. O extrato da paciente precisa
 *  mostrar que houve o crédito e a correção; apagar o crédito faria o saldo
 *  fechar e a conversa na recepção não.
 */

const fid = require('./fidelidade');

function novoId(p) {
  return p + '_' + Math.random().toString(36).slice(2, 10);
}

/** A configuracao do programa de pontos DESTA clinica.
 *
 *  ================================ A MUDANCA DE COMPORTAMENTO DA M1.1c
 *
 *  A consulta era `WHERE id = 'default'` -- uma linha para a instalacao
 *  inteira. Agora ela filtra a clinica, e **clinica sem linha nao pontua**.
 *
 *  Parece detalhe e nao e. A alternativa seria a clinica nova herdar a
 *  configuracao da clinica 1: a regra de pontos de outro negocio, a validade
 *  de outro negocio, valendo dinheiro na recepcao dela sem ninguem ter
 *  decidido. Falhar fechado aqui significa "o programa nao esta configurado, e
 *  ninguem ganha ponto por engano" -- visivel no primeiro atendimento, e
 *  corrigivel numa tela.
 *
 *  A tabela ainda tem chave primaria em `id`, entao hoje existe UMA linha no
 *  banco (a da clinica `cl_1`, preenchida pela migration 018). Dar uma linha a
 *  cada clinica exige mudar a primaria para composta: e a tarefa M2.2.
 */
async function lerConfig(tx) {
  try {
    const [r] = await tx.q(
      "SELECT * FROM loyalty_settings WHERE clinica_id = :clinica AND id = 'default'");
    if (!r.length) return null;
    return fid.config(r[0]);
  } catch (e) {
    // Fidelizacao ainda nao migrada: o atendimento continua podendo ser
    // concluido. Modulo novo nao derruba modulo antigo.
    if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
    return null;
  }
}

async function creditarPontos(ap, tx, ctx) {
  ctx = ctx || {};
  const chave = ctx.chave || (ap && ap.id);

  const cfg = await lerConfig(tx);
  if (!cfg) return { creditado: false, motivo: 'programa de pontos nao configurado nesta clinica' };
  if (!cfg.active) return { creditado: false, motivo: 'programa desativado' };
  if (!ap || !ap.client_id) return { creditado: false, motivo: 'atendimento sem paciente' };

  const pontos = fid.pontosDoAtendimento(ap, cfg);
  if (pontos <= 0) return { creditado: false, motivo: 'atendimento sem valor a pontuar' };

  // ============================ DEFEITO ANTERIOR A M1.1c, ACHADO EM 08/09
  //
  // Aqui estava `String(ap.starts_at).slice(0, 10)`. O mysql2 devolve DATETIME
  // como objeto Date, e `String(Date)` da "Mon Sep 08 2026 ..." -- os dez
  // primeiros caracteres disso sao "Mon Sep 08", que nao e data nenhuma. A
  // validade saia `NaN-NaN-NaN` e o INSERT era RECUSADO pelo MySQL, derrubando
  // a conclusao inteira com "Falha ao mudar o status do compromisso".
  //
  // O conserto e nao mexer na data: `fid.validadeDoAcumulo` chama `hojeISO`,
  // que JA trata objeto Date corretamente. A conversao para texto no meio do
  // caminho era o problema, nao a solucao.
  //
  // Por que ninguem tinha visto: nenhuma conferencia deste projeto havia
  // exercitado a CONCLUSAO de um atendimento contra banco de verdade com o
  // programa de pontos ligado. Os testes usam banco de mentira, que aceita
  // qualquer coisa em qualquer coluna. Foi a ferramenta de vazamento da M1.1c,
  // ao gravar de propria conta, que fez o erro aparecer.
  const validade = fid.validadeDoAcumulo(ap.starts_at || ctx.hoje, cfg);

  try {
    await tx.q(
      `INSERT INTO loyalty_transactions
        (id, client_id, type, points, description, source, source_id, expires_at, created_by, clinica_id)
       VALUES (?,?, 'ACUMULO', ?, ?, 'APPOINTMENT', ?, ?, ?, :clinica)`,
      [novoId('lt'), ap.client_id, pontos,
       ('Atendimento: ' + (ap.title || ap.id)).slice(0, 255), chave, validade, ctx.usuarioId || null]
    );
  } catch (e) {
    // A trava contra clique duplo e o indice unico, nao o `if`.
    if (e.code === 'ER_DUP_ENTRY') return { creditado: false, motivo: 'ja creditado' };
    throw e;
  }

  return { creditado: true, pontos: pontos, expiraEm: validade,
           vale: fid.valorEmReais(pontos, cfg) };
}

async function estornarPontos(ap, tx, ctx) {
  ctx = ctx || {};
  const chave = ctx.chave || (ap && ap.id);

  const cfg = await lerConfig(tx);
  if (!cfg) return { estornado: false, motivo: 'programa de pontos nao configurado nesta clinica' };

  const [acs] = await tx.q(
    `SELECT id, client_id, points FROM loyalty_transactions
      WHERE clinica_id = :clinica AND source = 'APPOINTMENT' AND source_id = ? AND type = 'ACUMULO'`,
    [chave]
  );
  if (!acs.length) return { estornado: false, motivo: 'nao havia pontos creditados' };

  let total = 0;
  for (const a of acs) {
    try {
      await tx.q(
        `INSERT INTO loyalty_transactions
          (id, client_id, type, points, description, source, source_id, created_by, clinica_id)
         VALUES (?,?, 'ESTORNO', ?, ?, 'APPOINTMENT', ?, ?, :clinica)`,
        // Sinal NEGATIVO: este estorno desfaz um credito. O sinal segue o que
        // ele desfaz, nunca o tipo -- ver o comentario da migration 015.
        [novoId('lt'), a.client_id, -Math.abs(Math.round(Number(a.points))),
         ('Estorno de pontos: ' + (ctx.motivo || 'conclusao desfeita')).slice(0, 255),
         chave, ctx.usuarioId || null]
      );
      total += Math.abs(Math.round(Number(a.points)));
    } catch (e) {
      if (e.code !== 'ER_DUP_ENTRY') throw e;
    }
  }

  return { estornado: total > 0, pontos: total };
}

/** Devolve os pontos de um resgate. Usado quando o atendimento é cancelado —
 *  a paciente não recebeu o benefício, então o ponto volta. */
async function estornarResgate(apId, tx, ctx) {
  ctx = ctx || {};
  const cfg = await lerConfig(tx);
  if (!cfg) return { estornado: false, motivo: 'programa de pontos nao configurado nesta clinica' };

  const [rs] = await tx.q(
    `SELECT id, client_id, points, reward_id FROM loyalty_transactions
      WHERE clinica_id = :clinica AND source = 'APPOINTMENT' AND source_id = ? AND type = 'RESGATE'`,
    [apId]
  );
  if (!rs.length) return { estornado: false, motivo: 'nao havia resgate' };

  let total = 0;
  for (const r of rs) {
    try {
      await tx.q(
        `INSERT INTO loyalty_transactions
          (id, client_id, type, points, description, source, source_id, reward_id, created_by, clinica_id)
         VALUES (?,?, 'ESTORNO', ?, ?, 'MANUAL', ?, ?, ?, :clinica)`,
        // Sinal POSITIVO: este estorno desfaz um resgate, entao devolve pontos.
        // Mesmo tipo, sinal oposto ao de cima -- de novo: o sinal segue o fato.
        [novoId('lt'), r.client_id, Math.abs(Math.round(Number(r.points))),
         ('Devolucao de pontos: ' + (ctx.motivo || 'atendimento cancelado')).slice(0, 255),
         'estorno:' + apId, r.reward_id || null, ctx.usuarioId || null]
      );
      total += Math.abs(Math.round(Number(r.points)));
    } catch (e) {
      if (e.code !== 'ER_DUP_ENTRY') throw e;
    }
  }
  return { estornado: total > 0, pontos: total };
}

module.exports = {
  creditarPontos: creditarPontos,
  estornarPontos: estornarPontos,
  estornarResgate: estornarResgate,
  lerConfig: lerConfig
};

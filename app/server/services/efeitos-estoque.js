'use strict';
/** Efeito ESTOQUE do evento "atendimento realizado" — contexto 02 + T3.4.
 *
 *  Este arquivo era um stub vazio desde a T1.4. O encaixe não mudou: recebe a
 *  MESMA `conn` da transação, não abre transação própria, não usa o pool. É
 *  isso que faz a receita ser desfeita no mesmo rollback quando o insumo
 *  falta — e é isso que permite testar tudo sem banco.
 *
 *  A DECISÃO DE PRODUTO QUE ESTE ARQUIVO IMPLEMENTA
 *
 *  Saldo insuficiente LANÇA ERRO e derruba a conclusão inteira. O atendimento
 *  não é concluído, a receita não é lançada, e a recepção lê o nome do produto
 *  que falta.
 *
 *  A alternativa — concluir e deixar o estoque negativo — parece mais gentil e
 *  é pior em todos os desdobramentos: a clínica descobre a falta no meio do
 *  próximo procedimento, o custo do atendimento fica errado, e o inventário
 *  passa a ser um número em que ninguém confia. Travar dói uma vez, na hora
 *  certa, com a pessoa que pode resolver na frente da tela.
 *
 *  ESTORNO DEVOLVE AO MESMO LOTE. Devolver "para o estoque" sem dizer para
 *  qual lote acertaria o saldo e quebraria a rastreabilidade — que é o motivo
 *  de existir lote neste sistema.
 */

const est = require('./estoque');

function novoId(p) {
  return p + '_' + Math.random().toString(36).slice(2, 10);
}

/** Já existe baixa desta origem? O `completed_at` do contexto 02 já protege,
 *  mas esta checagem protege de chamada direta ao serviço — e é ela que
 *  garante a exigência do módulo: concluir duas vezes gera uma baixa só. */
async function jaBaixado(conn, chave) {
  const [r] = await conn.query(
    `SELECT COUNT(*) AS n FROM stock_movements
      WHERE source = 'APPOINTMENT' AND source_id = ? AND type = 'SAIDA'`,
    [chave]
  );
  return Number(r[0] && r[0].n) > 0;
}

async function fichaDoServico(conn, catalogId) {
  const [r] = await conn.query(
    `SELECT s.product_id, s.quantity, p.name, p.unit
       FROM service_supplies s
       JOIN products p ON p.id = s.product_id
      WHERE s.catalog_id = ? AND p.active = 1`,
    [catalogId]
  );
  return r;
}

async function lotesDoProduto(conn, productId) {
  const [r] = await conn.query(
    `SELECT id, product_id, batch_number, quantity, unit_cost,
            DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date,
            DATE_FORMAT(received_at, '%Y-%m-%d') AS received_at
       FROM stock_batches
      WHERE product_id = ? AND quantity > 0`,
    [productId]
  );
  return r;
}

async function baixarInsumosDoAtendimento(ap, conn, ctx) {
  ctx = ctx || {};
  const chave = ctx.chave || (ap && ap.id);

  if (!ap || ap.kind === 'BLOQUEIO') return { baixado: false, motivo: 'bloqueio nao consome insumo' };
  if (!ap.catalog_id) {
    // Compromisso digitado à mão, sem serviço do catálogo: não há ficha para
    // consultar. Não é erro — a clínica marca avaliação e retorno assim.
    return { baixado: false, motivo: 'compromisso sem servico do catalogo' };
  }

  if (await jaBaixado(conn, chave)) return { baixado: false, motivo: 'ja baixado' };

  const ficha = await fichaDoServico(conn, ap.catalog_id);
  if (!ficha.length) return { baixado: false, motivo: 'servico sem ficha tecnica cadastrada' };

  const movimentos = [];
  let custoTotal = 0;

  for (const item of ficha) {
    const lotes = await lotesDoProduto(conn, item.product_id);
    const plano = est.escolherLotes(lotes, item.quantity, { hoje: ctx.hoje });

    if (!plano.ok) {
      // Erro lançado de propósito: quem chama é o serviço transacional, e o
      // rollback dele desfaz tudo. A mensagem vai para a recepção.
      const e = new Error(mensagemDeFalta(item, plano));
      e.status = 409;
      e.estoque = { productId: item.product_id, produto: item.name, plano: plano };
      throw e;
    }

    for (const c of plano.consumo) {
      await conn.query(
        'UPDATE stock_batches SET quantity = quantity - ? WHERE id = ? AND quantity >= ?',
        [c.quantidade, c.batchId, c.quantidade]
      );
      await conn.query(
        `INSERT INTO stock_movements
          (id, product_id, batch_id, type, quantity, unit_cost, reason, source, source_id, created_by)
         VALUES (?,?,?,'SAIDA',?,?,?, 'APPOINTMENT', ?, ?)`,
        [novoId('mov'), item.product_id, c.batchId, c.quantidade, c.unitCost,
         'Atendimento: ' + (ap.title || ap.id), chave, ctx.usuarioId || null]
      );
      movimentos.push({ produto: item.name, batchId: c.batchId, quantidade: c.quantidade });
    }
    custoTotal += plano.custo;
  }

  return { baixado: true, itens: ficha.length, movimentos: movimentos.length,
           custo: est.centavos(custoTotal), detalhe: movimentos };
}

/** A mensagem é metade do valor desta trava. "Erro ao concluir" manda a pessoa
 *  chamar suporte; nomear o produto e dizer quanto falta a faz resolver. */
function mensagemDeFalta(item, plano) {
  const falta = plano.faltando != null ? plano.faltando : est.q(item.quantity);
  if (plano.vencidoDisponivel > 0) {
    return 'Estoque insuficiente de ' + item.name + ': faltam ' + falta + ' ' + (item.unit || 'un') +
           ' e ha ' + plano.vencidoDisponivel + ' vencido(s), que nao podem ser usados. ' +
           'De baixa da perda e reponha antes de concluir o atendimento.';
  }
  return 'Estoque insuficiente de ' + item.name + ': faltam ' + falta + ' ' + (item.unit || 'un') +
         '. Ajuste o estoque antes de concluir o atendimento.';
}

async function devolverInsumosDoAtendimento(ap, conn, ctx) {
  ctx = ctx || {};
  const chave = ctx.chave || (ap && ap.id);

  const [saidas] = await conn.query(
    `SELECT product_id, batch_id, quantity, unit_cost FROM stock_movements
      WHERE source = 'APPOINTMENT' AND source_id = ? AND type = 'SAIDA'`,
    [chave]
  );
  if (!saidas.length) return { devolvido: false, motivo: 'nao havia baixa para estornar' };

  for (const s of saidas) {
    await conn.query(
      'UPDATE stock_batches SET quantity = quantity + ? WHERE id = ?',
      [est.q(s.quantity), s.batch_id]
    );
    await conn.query(
      `INSERT INTO stock_movements
        (id, product_id, batch_id, type, quantity, unit_cost, reason, source, source_id, created_by)
       VALUES (?,?,?,'ESTORNO',?,?,?, 'APPOINTMENT', ?, ?)`,
      [novoId('mov'), s.product_id, s.batch_id, est.q(s.quantity), est.centavos(s.unit_cost),
       'Estorno: ' + (ctx.motivo || 'conclusao desfeita'), chave, ctx.usuarioId || null]
    );
  }

  return { devolvido: true, movimentos: saidas.length };
}

module.exports = {
  baixarInsumosDoAtendimento: baixarInsumosDoAtendimento,
  devolverInsumosDoAtendimento: devolverInsumosDoAtendimento,
  mensagemDeFalta: mensagemDeFalta,
  jaBaixado: jaBaixado
};

'use strict';
/** Efeito FINANCEIRO do evento "atendimento realizado" — contexto 02, T1.4.
 *
 *  Este arquivo não conhece o pool. Recebe `conn` por parâmetro, e é sempre a
 *  mesma conexão da transação aberta pelo serviço central. Isso não é
 *  preciosismo: é o que faz o estoque sem saldo desfazer a receita no mesmo
 *  rollback, e é o que permite testar o efeito inteiro sem banco nenhum.
 *
 *  DUAS DECISÕES QUE NÃO DEVEM SER REDECIDIDAS AQUI
 *
 *  1. Concluir atendimento NÃO é receber dinheiro.
 *     O lançamento nasce com `entry_date` (o fato aconteceu) e `paid_at` NULO
 *     (o dinheiro ainda não andou). Quem recebe é a recepção, pelo botão de
 *     pagar. Carimbar `paid_at` aqui inflaria o caixa com dinheiro que ninguém
 *     viu — o erro que o AGENTS.md §5.2 existe para evitar.
 *
 *  2. Estorno é lançamento novo, nunca DELETE.
 *     A receita errada continua na tabela e ganha uma despesa de estorno ao
 *     lado. O saldo volta ao lugar e o histórico mostra que houve o erro e a
 *     correção — é isso que permite auditar uma divergência depois.
 */

const CATEGORIA_RECEITA = 'cat_procedimentos';

function novoId(p) {
  return p + '_' + Math.random().toString(36).slice(2, 10);
}

function dia(v) {
  if (!v) return null;
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return v.getFullYear() + '-' + p(v.getMonth() + 1) + '-' + p(v.getDate());
  }
  return String(v).slice(0, 10);
}

/** O que SERIA lançado. Puro de propósito: a decisão "isso vira receita ou
 *  não" é a parte que erra, e ela fica testável sem subir banco.
 *  Devolve null quando o atendimento não é venda. */
function receitaDe(ap, chave, nomeDoCliente) {
  if (!ap) return null;
  if (ap.kind === 'BLOQUEIO') return null; // almoço não fatura
  const valor = Number(ap.price);
  if (!isFinite(valor) || valor <= 0) return null; // cortesia, retorno, avaliação

  const quando = dia(ap.starts_at);
  const descricao = String(ap.title || 'Atendimento') + (nomeDoCliente ? ' - ' + nomeDoCliente : '');
  return {
    type: 'RECEITA',
    category_id: CATEGORIA_RECEITA,
    description: descricao.slice(0, 255),
    amount: Math.round(valor * 100) / 100,
    entry_date: quando,
    due_date: quando,
    paid_at: null,
    source: 'APPOINTMENT',
    source_id: chave,
    client_id: ap.client_id || null,
    professional_id: ap.professional_id || null
  };
}

async function lancarReceitaDeAtendimento(ap, conn, ctx) {
  ctx = ctx || {};
  const linha = receitaDe(ap, ctx.chave, ctx.nomeDoCliente);
  if (!linha) return { lancado: false, motivo: 'sem valor a faturar' };

  const id = novoId('ce');
  try {
    await conn.query(
      `INSERT INTO cash_entries
        (id, type, category_id, description, amount, entry_date, due_date, paid_at,
         source, source_id, client_id, professional_id, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, linha.type, linha.category_id, linha.description, linha.amount,
       linha.entry_date, linha.due_date, linha.paid_at, linha.source, linha.source_id,
       linha.client_id, linha.professional_id, ctx.usuarioId || null]
    );
  } catch (e) {
    // A trava de verdade contra clique duplo é o índice único do banco, não o
    // `if` do código: duas requisições simultâneas esbarram aqui.
    if (e.code === 'ER_DUP_ENTRY') return { lancado: false, motivo: 'ja lancado' };
    throw e;
  }
  return { lancado: true, id: id, valor: linha.amount };
}

/** Estorno: despesa espelho amarrada ao lançamento original. */
async function estornarReceitaDeAtendimento(ap, conn, ctx) {
  ctx = ctx || {};
  const [r] = await conn.query(
    "SELECT * FROM cash_entries WHERE source = 'APPOINTMENT' AND source_id = ? AND type = 'RECEITA' LIMIT 1",
    [ctx.chave]
  );
  if (!r.length) return { estornado: false, motivo: 'nao havia receita lancada' };
  const original = r[0];

  const id = novoId('ce');
  try {
    await conn.query(
      `INSERT INTO cash_entries
        (id, type, category_id, description, amount, entry_date, paid_at,
         source, source_id, client_id, professional_id, notes, created_by)
       VALUES (?, 'DESPESA', ?, ?, ?, ?, ?, 'REVERSAL', ?, ?, ?, ?, ?)`,
      [id, original.category_id, ('Estorno - ' + original.description).slice(0, 255),
       original.amount, dia(ctx.hoje || new Date()), original.paid_at ? dia(ctx.hoje || new Date()) : null,
       original.id, original.client_id, original.professional_id,
       ctx.motivo || null, ctx.usuarioId || null]
    );
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return { estornado: false, motivo: 'ja estornado' };
    throw e;
  }
  return { estornado: true, id: id, valor: Number(original.amount) };
}

module.exports = {
  receitaDe: receitaDe,
  lancarReceitaDeAtendimento: lancarReceitaDeAtendimento,
  estornarReceitaDeAtendimento: estornarReceitaDeAtendimento,
  CATEGORIA_RECEITA: CATEGORIA_RECEITA
};

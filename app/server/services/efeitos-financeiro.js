'use strict';
/** Efeito FINANCEIRO do evento "atendimento realizado" — contexto 02, T1.4.
 *
 *  Este arquivo não conhece o pool. Recebe `tx` por parâmetro, e é sempre o
 *  mesmo escopo da transação aberta pelo serviço central. Isso não é
 *  preciosismo: é o que faz o estoque sem saldo desfazer a receita no mesmo
 *  rollback, e é o que permite testar o efeito inteiro sem banco nenhum.
 *
 *  M1.1c (08/09): o parâmetro era uma conexão crua e virou um **escopo de
 *  clínica**. A receita passa a nascer com `clinica_id`. Antes ela nascia com a
 *  clínica vazia — calada, e invisível para a clínica que a faturou.
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

async function lancarReceitaDeAtendimento(ap, tx, ctx) {
  ctx = ctx || {};
  const linha = receitaDe(ap, ctx.chave, ctx.nomeDoCliente);
  if (!linha) return { lancado: false, motivo: 'sem valor a faturar' };

  // ==================================== A CATEGORIA E DA CLINICA (M1.2, 09/09)
  //
  // `cat_procedimentos` e um id FIXO da migration 008, e existe uma linha so no
  // banco inteiro -- hoje da clinica `cl_1`. Gravar esse id na receita de outra
  // clinica faria a linha dela apontar para a categoria de um negocio alheio:
  // nao vaza dado, mas suja o relatorio das duas, e nenhum filtro de leitura
  // acusa.
  //
  // Entao a categoria e CONFERIDA. Sem categoria propria, a receita nasce sem
  // categoria -- visivel na tela, corrigivel num clique -- em vez de nascer
  // apontando para a categoria da vizinha. Categoria por clinica e a M1.2b.
  const [cat] = await tx.q(
    'SELECT id FROM finance_categories WHERE clinica_id = :clinica AND id = ?',
    [linha.category_id]);
  if (!cat.length) linha.category_id = null;

  const id = novoId('ce');
  try {
    await tx.q(
      `INSERT INTO cash_entries
        (id, type, category_id, description, amount, entry_date, due_date, paid_at,
         source, source_id, client_id, professional_id, created_by, clinica_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, :clinica)`,
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
async function estornarReceitaDeAtendimento(ap, tx, ctx) {
  ctx = ctx || {};
  // O filtro de clinica aqui nao e formalidade: a chave de origem e o id do
  // compromisso, e sem ele um id adivinhado estornaria a receita da vizinha.
  const [r] = await tx.q(
    "SELECT * FROM cash_entries WHERE clinica_id = :clinica AND source = 'APPOINTMENT' " +
    "AND source_id = ? AND type = 'RECEITA' LIMIT 1",
    [ctx.chave]
  );
  if (!r.length) return { estornado: false, motivo: 'nao havia receita lancada' };
  const original = r[0];

  const id = novoId('ce');
  try {
    await tx.q(
      `INSERT INTO cash_entries
        (id, type, category_id, description, amount, entry_date, paid_at,
         source, source_id, client_id, professional_id, notes, created_by, clinica_id)
       VALUES (?, 'DESPESA', ?, ?, ?, ?, ?, 'REVERSAL', ?, ?, ?, ?, ?, :clinica)`,
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

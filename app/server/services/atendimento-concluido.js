'use strict';
/** O EVENTO "ATENDIMENTO REALIZADO" — contexto 02, T1.4.
 *
 *  Três módulos precisam reagir ao mesmo fato: financeiro lança a receita,
 *  estoque baixa os insumos, fidelização credita pontos. Se cada um pendurar
 *  seu gatilho na rota de status, três coisas dão errado, e sempre dão:
 *  alguém conclui por outro caminho e um efeito não acontece; um efeito falha
 *  e os outros dois ficam aplicados; alguém clica duas vezes e o paciente
 *  ganha os pontos duas vezes.
 *
 *  Por isso existe UM único serviço, transacional e idempotente. Nenhum módulo
 *  cria gatilho próprio. Se aparecer um segundo caminho para concluir
 *  atendimento, ele chama daqui — não reimplementa.
 *
 *  IDEMPOTÊNCIA EM DOIS NÍVEIS, e os dois são necessários:
 *    1. `completed_at` no compromisso, lido sob SELECT ... FOR UPDATE. É o
 *       carimbo que diz "os efeitos já foram aplicados".
 *    2. Índice único por origem na tabela de cada efeito. É o que segura duas
 *       requisições que chegam no mesmo milissegundo — nível 1 sozinho é um
 *       `if`, e `if` não é trava.
 *
 *  A CHAVE DE ORIGEM E O REFAZER
 *
 *  Concluir por engano acontece toda semana em recepção; reverter e concluir
 *  de novo depois é rotina, não exceção. Como o estorno é lançamento novo e
 *  nunca DELETE, a receita da primeira conclusão continua na tabela — e a
 *  segunda conclusão bateria no índice único se a chave fosse só o id do
 *  compromisso. Por isso a chave carrega o número da conclusão:
 *
 *      1a conclusão -> "ap_x"      (igual ao id: mantém compatível o que já
 *                                   foi lançado antes desta task)
 *      2a conclusão -> "ap_x#2"
 *
 *  `appointments.completions` só cresce, nunca volta no estorno — senão a
 *  chave se repetiria e o refazer voltaria a esbarrar no índice.
 */

const efeitosFinanceiro = require('./efeitos-financeiro');
const efeitosEstoque = require('./efeitos-estoque');
const efeitosFidelidade = require('./efeitos-fidelidade');

/* ------------------------------------------------------------ puro */

/** A chave de origem da n-ésima conclusão (n a partir de 1). */
function chaveDeOrigem(appointmentId, n) {
  return n > 1 ? appointmentId + '#' + n : String(appointmentId);
}

/** Decide o que fazer com um compromisso que alguém mandou concluir.
 *  Separado da parte que fala com o banco porque é aqui que se erra. */
function decidirConclusao(ap) {
  if (!ap) return { acao: 'NAO_ENCONTRADO', status: 404, error: 'Compromisso nao encontrado.' };
  if (ap.completed_at) return { acao: 'JA_CONCLUIDO' };
  if (ap.kind === 'BLOQUEIO') return { acao: 'SO_STATUS' };
  return { acao: 'CONCLUIR', chave: chaveDeOrigem(ap.id, (Number(ap.completions) || 0) + 1) };
}

/** Decide se dá para reverter. O motivo é obrigatório: reverter sem motivo
 *  registrado é exatamente o buraco que a auditoria precisa fechar. */
function decidirReversao(ap, motivo) {
  if (!ap) return { acao: 'NAO_ENCONTRADO', status: 404, error: 'Compromisso nao encontrado.' };
  if (!ap.completed_at) {
    return { acao: 'NADA_A_DESFAZER', status: 409, error: 'Este compromisso nao esta concluido.' };
  }
  if (!motivo || !String(motivo).trim()) {
    return { acao: 'SEM_MOTIVO', status: 400, error: 'Informe o motivo do estorno.' };
  }
  return { acao: 'REVERTER', chave: chaveDeOrigem(ap.id, Number(ap.completions) || 1) };
}

/* --------------------------------------------------- transacional */

async function comTransacao(pool, tarefa) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const saida = await tarefa(conn);
    await conn.commit();
    return saida;
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* a conexão já pode ter caído */ }
    throw e;
  } finally {
    conn.release();
  }
}

async function carregar(conn, id) {
  const [r] = await conn.query('SELECT * FROM appointments WHERE id = ? FOR UPDATE', [id]);
  return r.length ? r[0] : null;
}

async function nomeDoCliente(conn, clientId) {
  if (!clientId) return null;
  const [r] = await conn.query('SELECT name FROM clients WHERE id = ? LIMIT 1', [clientId]);
  return r.length ? r[0].name : null;
}

/**
 * concluirAtendimento(pool, id, { usuarioId })
 * Um passo de cada vez, tudo na mesma transação. Qualquer erro em qualquer
 * efeito derruba o conjunto — inclusive a mudança de status.
 */
async function concluirAtendimento(pool, id, opcoes) {
  const op = opcoes || {};
  return comTransacao(pool, async function (conn) {
    const ap = await carregar(conn, id);
    const d = decidirConclusao(ap);

    if (d.acao === 'NAO_ENCONTRADO') return d;

    if (d.acao === 'JA_CONCLUIDO') {
      return { acao: 'JA_CONCLUIDO', jaConcluido: true, efeitos: {} };
    }

    if (d.acao === 'SO_STATUS') {
      await conn.query("UPDATE appointments SET status = 'REALIZADO' WHERE id = ?", [id]);
      return { acao: 'SO_STATUS', jaConcluido: false, efeitos: {} };
    }

    await conn.query(
      "UPDATE appointments SET status = 'REALIZADO', completed_at = NOW(), completions = ? WHERE id = ?",
      [(Number(ap.completions) || 0) + 1, id]
    );

    // A sessão clínica acompanha o compromisso, quando existe vínculo. A data
    // da sessão sai do compromisso: `appointments` é a fonte de verdade sobre
    // hora, e duplicar isso é como as duas datas passam a divergir.
    await conn.query(
      "UPDATE treatment_sessions SET status = 'REALIZADA', session_date = DATE(?) WHERE appointment_id = ?",
      [ap.starts_at, id]
    );

    const ctx = {
      chave: d.chave,
      usuarioId: op.usuarioId || null,
      nomeDoCliente: await nomeDoCliente(conn, ap.client_id)
    };

    const efeitos = {};
    efeitos.financeiro = await efeitosFinanceiro.lancarReceitaDeAtendimento(ap, conn, ctx);
    efeitos.estoque = await efeitosEstoque.baixarInsumosDoAtendimento(ap, conn, ctx);
    efeitos.fidelidade = await efeitosFidelidade.creditarPontos(ap, conn, ctx);

    return { acao: 'CONCLUIDO', jaConcluido: false, chave: d.chave, efeitos: efeitos };
  });
}

/**
 * reverterConclusao(pool, id, { usuarioId, motivo })
 * Estorna os três efeitos, limpa `completed_at` e volta o status para AGENDADO.
 * `completions` NÃO volta — ver o comentário do topo.
 */
async function reverterConclusao(pool, id, opcoes) {
  const op = opcoes || {};
  return comTransacao(pool, async function (conn) {
    const ap = await carregar(conn, id);
    const d = decidirReversao(ap, op.motivo);
    if (d.acao !== 'REVERTER') return d;

    await conn.query(
      "UPDATE appointments SET status = 'AGENDADO', completed_at = NULL WHERE id = ?",
      [id]
    );
    await conn.query(
      "UPDATE treatment_sessions SET status = 'AGENDADA' WHERE appointment_id = ?",
      [id]
    );

    const ctx = { chave: d.chave, usuarioId: op.usuarioId || null, motivo: String(op.motivo).trim() };

    const efeitos = {};
    efeitos.financeiro = await efeitosFinanceiro.estornarReceitaDeAtendimento(ap, conn, ctx);
    efeitos.estoque = await efeitosEstoque.devolverInsumosDoAtendimento(ap, conn, ctx);
    efeitos.fidelidade = await efeitosFidelidade.estornarPontos(ap, conn, ctx);

    return { acao: 'REVERTIDO', chave: d.chave, motivo: ctx.motivo, efeitos: efeitos };
  });
}

module.exports = {
  concluirAtendimento: concluirAtendimento,
  reverterConclusao: reverterConclusao,
  decidirConclusao: decidirConclusao,
  decidirReversao: decidirReversao,
  chaveDeOrigem: chaveDeOrigem,
  comTransacao: comTransacao
};

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

/* --------------------------------------------------- transacional
 *
 * ============================================ O QUE MUDOU NA M1.1c (08/09)
 *
 * O primeiro parâmetro era o `pool`; agora é um **escopo de clínica**
 * (`server/db/escopo.js`), e a `conn` que os três efeitos recebem passou a ser
 * o `tx` desse escopo. Toda consulta daqui para baixo carrega `:clinica`.
 *
 * Antes disso, cada linha que esta cadeia gravava — a receita do atendimento, a
 * baixa do insumo, o ponto da paciente — nascia com a clínica **vazia**. Não
 * dava erro: a linha simplesmente não pertencia a ninguém, e desapareceria da
 * clínica que a criou. Era o buraco maior da M1, e ele não aparecia na catraca
 * porque a varredura só olhava `server/routes/`.
 *
 * `comTransacao` deixou de existir como função própria: `db.transacao(fn)` faz
 * o mesmo e ainda recusa transação aninhada. Duas implementações do mesmo
 * begin/commit/rollback é como uma delas para de receber correção.
 */

async function carregar(tx, id) {
  const [r] = await tx.q(
    'SELECT * FROM appointments WHERE clinica_id = :clinica AND id = ? FOR UPDATE', [id]);
  return r.length ? r[0] : null;
}

async function nomeDoCliente(tx, clientId) {
  if (!clientId) return null;
  const [r] = await tx.q(
    'SELECT name FROM clients WHERE clinica_id = :clinica AND id = ? LIMIT 1', [clientId]);
  return r.length ? r[0].name : null;
}

/**
 * concluirAtendimento(db, id, { usuarioId })
 * `db` é um escopo de clínica. Um passo de cada vez, tudo na mesma transação.
 * Qualquer erro em qualquer efeito derruba o conjunto — inclusive a mudança de
 * status.
 */
async function concluirAtendimento(db, id, opcoes) {
  const op = opcoes || {};
  return db.transacao(async function (tx) {
    const ap = await carregar(tx, id);
    const d = decidirConclusao(ap);

    if (d.acao === 'NAO_ENCONTRADO') return d;

    if (d.acao === 'JA_CONCLUIDO') {
      return { acao: 'JA_CONCLUIDO', jaConcluido: true, efeitos: {} };
    }

    if (d.acao === 'SO_STATUS') {
      await tx.q("UPDATE appointments SET status = 'REALIZADO' " +
                 'WHERE clinica_id = :clinica AND id = ?', [id]);
      return { acao: 'SO_STATUS', jaConcluido: false, efeitos: {} };
    }

    await tx.q(
      "UPDATE appointments SET status = 'REALIZADO', completed_at = NOW(), completions = ? " +
      'WHERE clinica_id = :clinica AND id = ?',
      [(Number(ap.completions) || 0) + 1, id]
    );

    // A sessão clínica acompanha o compromisso, quando existe vínculo. A data
    // da sessão sai do compromisso: `appointments` é a fonte de verdade sobre
    // hora, e duplicar isso é como as duas datas passam a divergir.
    await tx.q(
      "UPDATE treatment_sessions SET status = 'REALIZADA', session_date = DATE(?) " +
      'WHERE clinica_id = :clinica AND appointment_id = ?',
      [ap.starts_at, id]
    );

    const ctx = {
      chave: d.chave,
      usuarioId: op.usuarioId || null,
      nomeDoCliente: await nomeDoCliente(tx, ap.client_id)
    };

    const efeitos = {};
    efeitos.financeiro = await efeitosFinanceiro.lancarReceitaDeAtendimento(ap, tx, ctx);
    efeitos.estoque = await efeitosEstoque.baixarInsumosDoAtendimento(ap, tx, ctx);
    efeitos.fidelidade = await efeitosFidelidade.creditarPontos(ap, tx, ctx);

    return { acao: 'CONCLUIDO', jaConcluido: false, chave: d.chave, efeitos: efeitos };
  });
}

/**
 * reverterConclusao(db, id, { usuarioId, motivo })
 * Estorna os três efeitos, limpa `completed_at` e volta o status para AGENDADO.
 * `completions` NÃO volta — ver o comentário do topo.
 */
async function reverterConclusao(db, id, opcoes) {
  const op = opcoes || {};
  return db.transacao(async function (tx) {
    const ap = await carregar(tx, id);
    const d = decidirReversao(ap, op.motivo);
    if (d.acao !== 'REVERTER') return d;

    await tx.q(
      "UPDATE appointments SET status = 'AGENDADO', completed_at = NULL " +
      'WHERE clinica_id = :clinica AND id = ?',
      [id]
    );
    await tx.q(
      "UPDATE treatment_sessions SET status = 'AGENDADA' " +
      'WHERE clinica_id = :clinica AND appointment_id = ?',
      [id]
    );

    const ctx = { chave: d.chave, usuarioId: op.usuarioId || null, motivo: String(op.motivo).trim() };

    const efeitos = {};
    efeitos.financeiro = await efeitosFinanceiro.estornarReceitaDeAtendimento(ap, tx, ctx);
    efeitos.estoque = await efeitosEstoque.devolverInsumosDoAtendimento(ap, tx, ctx);
    efeitos.fidelidade = await efeitosFidelidade.estornarPontos(ap, tx, ctx);

    return { acao: 'REVERTIDO', chave: d.chave, motivo: ctx.motivo, efeitos: efeitos };
  });
}

module.exports = {
  concluirAtendimento: concluirAtendimento,
  reverterConclusao: reverterConclusao,
  decidirConclusao: decidirConclusao,
  decidirReversao: decidirReversao,
  chaveDeOrigem: chaveDeOrigem
};

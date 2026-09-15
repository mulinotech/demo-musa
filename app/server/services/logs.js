'use strict';
/** Trilha de auditoria.
 *
 *  ======================================================= O QUE MUDOU NA M1.6
 *
 *  Antes existia uma função só, `logSystemEvent(tipo, descricao, autor, ip)`,
 *  e ela gravava sem clínica. Com uma clínica isso era invisível; com 50, a
 *  tela "Logs do Sistema" mostraria à proprietária da clínica A que a clínica
 *  B excluiu um lead chamado "Maria" — nome, telefone e tratamento inclusos,
 *  porque a descrição do log carrega tudo isso.
 *
 *  **Decisão da Silvia em 09/09: o log é POR CLÍNICA.** Cada registro carrega
 *  a clínica de quem agiu, e cada clínica vê só o que aconteceu na dela.
 *
 *  ============================================== POR QUE A ASSINATURA MUDOU
 *
 *  A saída óbvia seria acrescentar um quinto parâmetro. Ela foi recusada de
 *  propósito: com quatro parâmetros opcionais já existentes, um quinto
 *  esquecido não daria erro nenhum — gravaria sem clínica, e o registro
 *  sumiria da tela de quem o gerou. Seria a mesma classe de defeito que este
 *  projeto já encontrou sete vezes: **a falha silenciosa em vez da falha
 *  alta.**
 *
 *  Então a função antiga foi REMOVIDA, e no lugar entraram duas, que dizem no
 *  próprio nome de quem é o registro:
 *
 *    registrar(db, tipo, descricao)        -- o log de UMA clínica. `db` é o
 *                                             `escopo(req)`: a clínica, o autor
 *                                             e o IP saem dele, e não há como
 *                                             passar o autor de outra pessoa.
 *
 *    daInstalacao(motivo, tipo, descricao) -- o log SEM clínica, para o que é
 *                                             da instalação inteira: migration,
 *                                             rotina automática, falha de
 *                                             inicialização. Exige motivo
 *                                             escrito, como toda travessia.
 *
 *  Um ponto de chamada não atualizado quebra ALTO, e há teste varrendo o disco
 *  atrás de qualquer `logSystemEvent` remanescente. Os pontos de chamada foram
 *  convertidos todos de uma vez, justamente para não sobrar meia trilha.
 *
 *  ==================================================== OS REGISTROS ANTIGOS
 *
 *  Ficam sem clínica, e assim permanecem. Não se adivinha dono de log
 *  retroativo: carimbá-los com a clínica 1 seria inventar uma afirmação sobre
 *  quem fez o quê, e log é exatamente o lugar onde isso não se faz. Eles
 *  passam a ser "da instalação" — visíveis só para a Mulino, quando a M3
 *  construir essa visão.
 */
const escopo = require('../db/escopo');

function novoId() {
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
}

/** O log de uma clínica. `db` é o `escopo(req)` da rota que está agindo.
 *
 *  Falha ao gravar log NÃO derruba a operação que a originou — perder o
 *  registro de uma exclusão é ruim; deixar de excluir porque o registro falhou
 *  é pior, e ninguém entenderia o erro. Mas a falha aparece no console, em vez
 *  de sumir. */
async function registrar(db, actionType, description) {
  if (!db || typeof db.q !== 'function') {
    throw new TypeError(
      'logs.registrar(db, tipo, descricao): o primeiro argumento e o escopo da ' +
      'requisicao (escopo(req)), nao o tipo do evento.\n' +
      'A forma antiga -- logSystemEvent(tipo, descricao, autor, ip) -- gravava sem ' +
      'clinica, e o registro sumia da tela de quem o gerou. Se este evento e mesmo ' +
      'da instalacao inteira, use logs.daInstalacao(motivo, tipo, descricao).'
    );
  }
  try {
    await db.q(
      'INSERT INTO system_logs (id, action_type, description, author, ip_address, created_at, clinica_id)' +
      ' VALUES (?, ?, ?, ?, ?, NOW(), :clinica)',
      [novoId(), actionType, description, db.autor, db.ip]
    );
  } catch (err) {
    console.error('Erro ao gravar log de sistema:', err.message);
  }
}

/** O log SEM clínica: da instalação inteira.
 *
 *  Passa por `escopo.todasAsClinicas`, que é o único caminho autorizado a não
 *  filtrar — e que exige motivo escrito. O motivo aparece na mensagem de
 *  qualquer erro, e é o que alguém vai ler daqui a um ano para entender por que
 *  este registro não tem dono. */
async function daInstalacao(motivo, actionType, description, autor, ip) {
  try {
    const cru = escopo.todasAsClinicas(motivo);
    await cru.q(
      'INSERT INTO system_logs (id, action_type, description, author, ip_address, created_at, clinica_id)' +
      ' VALUES (?, ?, ?, ?, ?, NOW(), NULL)',
      [novoId(), actionType, description, autor || 'Sistema', ip || null]
    );
  } catch (err) {
    console.error('Erro ao gravar log da instalacao:', err.message);
  }
}

module.exports = { registrar: registrar, daInstalacao: daInstalacao };

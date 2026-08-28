'use strict';
/** Regras de guarda da gestao de usuarios (T0.5).
 *
 *  A tela de usuarios tornou clicavel uma operacao que antes exigia SSH: mudar
 *  papel e inativar conta. Duas dessas cliques tiram o sistema do ar de um jeito
 *  que so se conserta com SQL no servidor:
 *
 *    1. inativar (ou rebaixar) o unico administrador ativo - ninguem mais entra
 *       na area de usuarios para desfazer;
 *    2. o administrador remover o proprio acesso por engano.
 *
 *  A decisao mora aqui como funcao pura para poder ser testada sem banco. A
 *  rota so consulta o estado e pergunta.
 */

/**
 * @param {object} p
 * @param {string} p.solicitanteId  quem esta pedindo (claim `sub` do token)
 * @param {object} p.alvo           { id, name, role, status } como esta no banco
 * @param {object} p.mudanca        corpo do PATCH
 * @param {number} p.adminsAtivos   quantos admins ativos existem agora
 * @returns {null|{status:number, error:string}} null = pode seguir
 */
function verificarAlteracao(p) {
  const alvo = p.alvo || {};
  const mudanca = p.mudanca || {};

  const viraInativo = mudanca.status === 'inactive' && alvo.status === 'active';
  const perdeAdmin = !!mudanca.role && mudanca.role !== 'admin' && alvo.role === 'admin';

  // Trocar a propria senha e legitimo; tirar o proprio acesso, nao.
  if ((viraInativo || perdeAdmin) && p.solicitanteId && p.solicitanteId === alvo.id) {
    return {
      status: 400,
      error: 'Voce nao pode remover o proprio acesso. Peca a outro administrador.'
    };
  }

  if ((viraInativo || perdeAdmin) && alvo.role === 'admin' && alvo.status === 'active' && p.adminsAtivos <= 1) {
    return {
      status: 409,
      error: 'Este e o unico administrador ativo. Promova outra pessoa a administrador antes de alterar esta conta.'
    };
  }

  return null;
}

module.exports = { verificarAlteracao };

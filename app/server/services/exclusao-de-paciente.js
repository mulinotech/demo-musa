'use strict';
/** Apagar uma paciente (M6.5, 24/09).
 *
 *  ================================================ O QUE O SISTEMA FAZIA
 *
 *  `DELETE /api/clients/:id` apagava a linha e pronto. O que acontecia com o
 *  resto era decidido pelas chaves estrangeiras da migration 027, e o resultado
 *  era o pior dos dois mundos:
 *
 *    CASCATEAVAM (sumiam junto, em silêncio)
 *      client_documents   ← receitas, atestados e TERMOS ASSINADOS
 *      treatments, treatment_plans, treatment_sessions
 *      loyalty_transactions
 *
 *    FICAVAM ÓRFÃOS (apontando para uma paciente que não existe mais)
 *      appointments       ← a agenda dela
 *      interactions       ← as conversas de WhatsApp, com o conteúdo inteiro
 *      cash_entries       ← o dinheiro
 *
 *  Ou seja: **destruía justamente o que tem prazo legal de guarda e preservava
 *  justamente o que um pedido de exclusão quer alcançar.** E as duas metades em
 *  silêncio — a tela do front fazia `if (response.ok)` sem `else`.
 *
 *  ============================= POR QUE NÃO É "CASCATEAR TUDO" NEM "APAGAR TUDO"
 *
 *  `docs/LGPD.md`, seção 3, escrito antes desta tarefa:
 *
 *      "Exclusão a pedido. Não existe rota de 'apagar tudo', de propósito: em
 *       registro de saúde o direito de exclusão convive com obrigação legal de
 *       guarda, e a decisão caso a caso não deve ser automática."
 *
 *  Um atestado assinado é prova de um ato profissional; um prontuário tem prazo
 *  de guarda pela legislação sanitária. Apagar isso por um clique numa lista é
 *  uma decisão jurídica tomada por um botão.
 *
 *  ==================================================== A REGRA QUE FICOU
 *
 *  **Ficha com histórico não se apaga: a exclusão é RECUSADA, e a recusa diz o
 *  que existe.** Ficha vazia — a duplicata criada por engano, que é o caso real
 *  e frequente — continua sendo apagada num clique.
 *
 *  A recusa não é um beco: ela nomeia o que existe, lembra que a exportação
 *  (art. 18, V) entrega tudo à titular, e devolve a decisão a quem pode
 *  tomá-la. Recusar é reversível; apagar não.
 *
 *  ================================== E AS CONVERSAS CONTAM, MESMO SEM CHAVE
 *
 *  `interactions.client_id` guarda id de paciente **ou de lead** — o Atendimento
 *  trata os dois como contato e grava na mesma coluna. A migration 027 a listou
 *  como ponteiro para `clients`, e não é: uma chave estrangeira ali recusaria
 *  toda conversa de lead. Ela entra nesta contagem mesmo sem chave, porque o
 *  banco não vai segurá-la — e conversa de WhatsApp é onde o dado pessoal
 *  aparece por extenso.
 */

/** O que cada tabela significa na frase da recusa. A ordem é a da leitura:
 *  primeiro o que é clínico, depois o que é dinheiro. */
const HISTORICO = [
  { chave: 'documentos', singular: 'documento emitido', plural: 'documentos emitidos' },
  { chave: 'planos', singular: 'plano de tratamento', plural: 'planos de tratamento' },
  { chave: 'sessoes', singular: 'sessão lançada', plural: 'sessões lançadas' },
  { chave: 'procedimentos', singular: 'procedimento no histórico', plural: 'procedimentos no histórico' },
  { chave: 'compromissos', singular: 'compromisso na agenda', plural: 'compromissos na agenda' },
  { chave: 'conversas', singular: 'mensagem de WhatsApp', plural: 'mensagens de WhatsApp' },
  { chave: 'pontos', singular: 'lançamento de pontos', plural: 'lançamentos de pontos' },
  { chave: 'financeiro', singular: 'lançamento no financeiro', plural: 'lançamentos no financeiro' }
];

function contarUm(n) {
  const v = Number(n);
  return isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** Pode apagar esta ficha?
 *
 *  @param {object} contagens  { documentos, planos, sessoes, ... }
 *  @returns {object} { pode, itens, total, error }
 */
function decidir(contagens) {
  const c = contagens || {};
  const itens = [];
  let total = 0;
  for (const h of HISTORICO) {
    const n = contarUm(c[h.chave]);
    if (!n) continue;
    total += n;
    itens.push({ chave: h.chave, n: n, texto: n + ' ' + (n === 1 ? h.singular : h.plural) });
  }

  if (!total) {
    return { pode: true, itens: [], total: 0 };
  }

  return {
    pode: false,
    itens: itens,
    total: total,
    /* A frase inteira, montada aqui e não na tela: ela é a única coisa que a
       pessoa vai ler antes de decidir o que fazer, e duas versões dela — uma
       no servidor, outra no front — divergiriam na primeira mudança. */
    error: 'Esta paciente tem histórico e por isso a ficha não é apagada: ' +
      itens.map((i) => i.texto).join(', ') + '. ' +
      'Prontuário e documento assinado têm prazo legal de guarda, e apagá-los ' +
      'por um clique seria uma decisão jurídica tomada por um botão. ' +
      'Para atender a um pedido da paciente, use "Exportar dados" na ficha dela ' +
      '(entrega tudo o que a clínica guarda) e trate a exclusão caso a caso.'
  };
}

module.exports = { HISTORICO, decidir };

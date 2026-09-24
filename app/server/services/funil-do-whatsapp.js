'use strict';
/** Jogar a conversa do WhatsApp no funil (M6.2, 24/09).
 *
 *  ===================================================== POR QUE ISTO EXISTE
 *
 *  Pedido do bloco de Funil do PDF de 19/09: *"um botão para jogar a conversa
 *  no funil"*. Hoje a recepção conversa pelo WhatsApp, percebe que ali tem
 *  venda, e para chegar ao Kanban precisa abrir outra tela, clicar em novo
 *  lead e **redigitar nome e telefone** — que já estão na conversa aberta.
 *
 *  Redigitar não é só trabalho: é a porta da duplicata. O número redigitado sai
 *  `(11) 91111-2222` e o da conversa é `5511911112222`; o funil fica com dois
 *  cards da mesma mulher, e quem atende o segundo não sabe do primeiro.
 *
 *  ====================================== A PERGUNTA QUE ESTE ARQUIVO RESPONDE
 *
 *  Não é "criar ou não criar" — é **esta conversa já está no funil?**. As três
 *  respostas possíveis são diferentes o bastante para não poderem ser adivinhadas
 *  pela tela:
 *
 *    'jaNoFunil'        existe card ABERTO com este telefone. Criar outro
 *                       partiria a mesma negociação em dois cards, e o segundo
 *                       nasceria sem o histórico do primeiro.
 *    'criar'            ninguém está trabalhando este telefone agora.
 *    'telefoneInvalido' o número não é telefone. Ver abaixo.
 *
 *  ============================= POR QUE LEAD FECHADO NÃO IMPEDE UM LEAD NOVO
 *
 *  `arquivado` (venda fechada) e `perdido` são **fim de negociação, não fim de
 *  relação**. A paciente que comprou em março e volta em setembro é uma venda
 *  nova, e tem de virar card novo — senão o funil de setembro não a mostra e o
 *  faturamento do mês não a explica.
 *
 *  O que o lead fechado ainda faz é contar a história: ele volta em `historico`
 *  para a tela poder dizer *"já passou por aqui em março"* a quem vai atender.
 *
 *  ==================================== POR QUE TELEFONE RUIM É RECUSA, E NÃO CARD
 *
 *  Em toda a M5.10 a decisão foi *entre criar a ficha a mais e vincular à
 *  paciente errada, criar a ficha a mais*. Aqui a escolha é outra: um card de
 *  funil sem telefone válido **não é um card** — ninguém consegue retornar o
 *  contato, ele fica no Kanban para sempre e infla a contagem de leads do mês,
 *  que é justamente o número que divide o investimento no Custo por Lead.
 *
 *  Recusar com a frase certa devolve o problema a quem consegue resolvê-lo: a
 *  recepção, que tem a conversa aberta na frente.
 *
 *  ====================================== POR QUE O CARD JÁ NASCE APONTANDO PARA A FICHA
 *
 *  Se UMA paciente tem este telefone, o lead nasce com `client_id` preenchido.
 *  É a mesma coluna da M5.10, e preenchê-la agora evita a decisão de depois:
 *  quando este card for arrastado para "Venda Fechada", `escolherFicha` verá
 *  `clientId` e devolverá `jaVinculado` — sem criar a segunda ficha.
 *
 *  Se DUAS pacientes têm o telefone (a mãe e a filha, o casal), o lead nasce
 *  **sem vínculo**. Escolher uma das duas aqui seria adivinhar de quem é a
 *  conversa, e o preço do erro é o histórico clínico de uma no nome da outra.
 */

const { chaveDeTelefone } = require('./conversao-de-lead');

/** Os estados em que alguém ainda está trabalhando o lead. */
const ABERTOS = ['novo', 'contatado', 'agendado'];

/** O que fazer com esta conversa.
 *
 *  @param {object} contato   { nome, telefone }
 *  @param {Array}  leads     leads DESTA clínica: { id, name, whatsapp, status, date }
 *  @param {Array}  pacientes fichas DESTA clínica: { id, name, phone }
 *  @returns {object} { acao, lead, clienteId, candidatos, historico, porque }
 */
function decidirEntrada(contato, leads, pacientes) {
  const c = contato || {};
  const listaLeads = Array.isArray(leads) ? leads : [];
  const listaFichas = Array.isArray(pacientes) ? pacientes : [];

  const chave = chaveDeTelefone(c.telefone);
  if (!chave) {
    return {
      acao: 'telefoneInvalido', lead: null, clienteId: null,
      candidatos: [], historico: null,
      porque: 'O número "' + String(c.telefone || '').slice(0, 24) + '" não é um telefone ' +
              'com DDD. Um card sem telefone válido não pode ser retornado por ninguém.'
    };
  }

  const mesmos = listaLeads.filter((l) => chaveDeTelefone(l.whatsapp) === chave);
  const abertos = mesmos.filter((l) => ABERTOS.indexOf(String(l.status || '')) !== -1);

  if (abertos.length) {
    /* Mais de um card aberto com o mesmo telefone já é duplicata anterior a
       esta tela. Devolver o MAIS RECENTE é o que a recepção espera ver: é onde
       a conversa de hoje continua. */
    const lead = abertos.slice().sort(
      (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())[0];
    return {
      acao: 'jaNoFunil', lead: lead, clienteId: null,
      candidatos: [], historico: null,
      porque: 'Esta conversa já está no funil como "' + (lead.name || 'lead') + '".'
    };
  }

  const fichas = listaFichas.filter((p) => chaveDeTelefone(p.phone) === chave);
  const fechado = mesmos.slice().sort(
    (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())[0] || null;

  return {
    acao: 'criar',
    lead: null,
    clienteId: fichas.length === 1 ? fichas[0].id : null,
    candidatos: fichas,
    historico: fechado
      ? { id: fechado.id, status: fechado.status, date: fechado.date || null }
      : null,
    porque: fichas.length === 1
      ? 'Card novo, já apontando para a ficha de ' + fichas[0].name + '.'
      : (fichas.length > 1
        ? 'Card novo, sem ficha vinculada: ' + fichas.length + ' pacientes têm este ' +
          'telefone (' + fichas.map((f) => f.name).join(', ') + ').'
        : 'Card novo. Nenhuma ficha de paciente com este telefone.')
  };
}

/** O nome do card quando a conversa não tem nome — só número.
 *
 *  `WhatsApp 91111-2222` e não `Contato 1`: quem abrir o Kanban amanhã precisa
 *  reconhecer de quem é o card sem abrir a conversa. */
function nomeDoContato(nome, telefone) {
  const limpo = String(nome || '').trim();
  if (limpo && !/^\+?\d[\d\s()-]*$/.test(limpo)) return limpo.slice(0, 120);
  const chave = chaveDeTelefone(telefone);
  if (!chave) return limpo.slice(0, 120) || 'Contato do WhatsApp';
  return 'WhatsApp ' + chave.slice(2, 6) + '-' + chave.slice(6);
}

module.exports = { ABERTOS, decidirEntrada, nomeDoContato };

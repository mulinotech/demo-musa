'use strict';
/** De onde veio a mensagem do WhatsApp — pessoa, grupo ou transmissão (M5.9a).
 *
 *  ================================================= POR QUE ISTO É UM MÓDULO
 *
 *  Era uma linha dentro do webhook: `senderJid.split('@')[0]`. Ela jogava fora
 *  justamente a parte do endereço que diz **que tipo de origem é aquela**, e o
 *  resultado apareceu em produção em 18/09: o número da clínica estava num grupo
 *  de trabalho, alguém escreveu, e o CRM respondeu "Seja muito bem-vinda!" no
 *  grupo, na frente de um cliente. O id do grupo tinha virado "telefone", o
 *  sistema concluiu "contato novo", criou um lead e mandou a saudação.
 *
 *  A regra saiu de lá para cá por um motivo só: **assim ela pode ser testada
 *  sem banco, sem servidor e sem WhatsApp**, e um teste de sabotagem prova que
 *  ela recusa o que tem de recusar. Regra que mora no meio de um handler de 120
 *  linhas é regra que ninguém confere.
 *
 *  ============================================== O ENDEREÇO DO WHATSAPP (JID)
 *
 *      5511987654321@s.whatsapp.net       uma pessoa
 *      5511987654321@c.us                 o mesmo, na grafia antiga
 *      120363111222333@g.us               um grupo
 *      status@broadcast                   o "status" (recados)
 *      123@broadcast                      lista de transmissão
 *      55119876543210@lid                 identificador anônimo de grupo
 *
 *  O `@lid` entra na recusa de propósito: é o identificador que o WhatsApp
 *  passou a usar para participante de grupo sem expor o telefone. Ele **não é
 *  um número discável** — gravá-lo como telefone de paciente produziria uma
 *  ficha para a qual a clínica nunca conseguiria ligar nem responder.
 */

/** Classifica o JID. Devolve 'pessoa', 'grupo', 'transmissao', 'anonimo' ou
 *  'desconhecido' — e nunca lança, porque isto roda na entrada de dado externo,
 *  onde o payload pode vir de qualquer jeito. */
function origemDoJid(jid) {
  const s = String(jid || '').trim().toLowerCase();
  if (!s || s.indexOf('@') === -1) return 'desconhecido';
  const sufixo = s.slice(s.lastIndexOf('@') + 1);
  if (sufixo === 'g.us') return 'grupo';
  if (sufixo === 'broadcast' || sufixo === 'newsletter') return 'transmissao';
  if (sufixo === 'lid') return 'anonimo';
  if (sufixo === 's.whatsapp.net' || sufixo === 'c.us') return 'pessoa';
  return 'desconhecido';
}

/** Só conversa de UMA pessoa vira atendimento.
 *
 *  `desconhecido` também é recusado, e isso é deliberado: um sufixo que o
 *  WhatsApp inventar amanhã não pode entrar por padrão. A regra é lista de
 *  permissão, não lista de proibição — foi a lista de proibição implícita
 *  (`tudo o que não é telefone é telefone`) que produziu o defeito. */
function ehConversaDePessoa(jid) {
  return origemDoJid(jid) === 'pessoa';
}

/** O telefone, só quando o JID é de pessoa. Fora disso devolve `''` — o que
 *  garante que ninguém o use por engano para gravar um id de grupo. */
function telefoneDoJid(jid) {
  if (!ehConversaDePessoa(jid)) return '';
  const s = String(jid).trim();
  const antes = s.slice(0, s.lastIndexOf('@'));
  // O `:12` de `5511987654321:12@s.whatsapp.net` e' o numero do aparelho na
  // multi-sessao, e nao faz parte do telefone.
  return antes.split(':')[0].replace(/\D/g, '');
}

module.exports = { origemDoJid, ehConversaDePessoa, telefoneDoJid };

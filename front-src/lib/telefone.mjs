/**
 * O `+55` já vem escrito (M5.10, 21/09).
 *
 * Este arquivo é `.mjs`, e não `.ts`, por um motivo só: assim a suíte do
 * servidor (`node --test`, CommonJS) consegue carregá-lo com um `import()` e
 * testar a regra de verdade. Em `.ts` ele precisaria do esbuild na máquina
 * que roda os testes — e teste que depende de ferramenta de build é teste que
 * um dia some do servidor sem ninguém reparar. O Vite importa `.mjs` do mesmo
 * jeito que importaria `.ts`.
 *
 * ===================================================== POR QUE ISTO EXISTE
 *
 * Item 2 do bloco de Pacientes do PDF de 19/09. O campo de WhatsApp nascia
 * vazio, com um `placeholder` dizendo "Ex: 5511977776666" — e metade dos
 * cadastros saía sem o DDI, porque o exemplo desaparece no primeiro caractere
 * digitado.
 *
 * Telefone sem DDI não é só feio: é o número que o Evolution recusa na hora de
 * enviar, e a recepção descobre isso quando a mensagem não chega.
 *
 * ============================================ POR QUE NÃO É SÓ UM `useState('+55 ')`
 *
 * Porque o `+55 ` some no primeiro `Ctrl+A` seguido de colagem — e colar o
 * número de uma planilha é justamente o gesto mais comum aqui. `comDdi` põe o
 * prefixo de volta em toda digitação, e entende as três formas em que o número
 * colado já traz o país: `+55…`, `55…` e `0055…`.
 *
 * O que ela **não** faz é formatar máscara enquanto se digita. Máscara que
 * adivinha se o número tem 8 ou 9 dígitos briga com quem está no meio da
 * digitação, e o servidor já compara telefone por regra própria
 * (`server/services/conversao-de-lead.js`) — a máscara não mudaria nada lá.
 */

export const DDI_PADRAO = '+55 ';

/** O valor do campo, garantindo que o `+55 ` continue na frente.
 *
 *  A ordem aqui importa e já custou um defeito ao ser escrita ao contrário: o
 *  prefixo é retirado do que veio do campo **antes** de olhar os dígitos. Sem
 *  isso, alguém digitando o DDD 55 no campo `+55 ` produzia `5555` — o `55` do
 *  prefixo entrava na conta como se a pessoa o tivesse digitado. */
export function comDdi(valor) {
  let v = (valor || '').trim();
  if (v === '' || v === '+' || v === '+5' || v === '+55') return DDI_PADRAO;

  // 1) fora o prefixo que ESTE campo pôs; sobra só o que a pessoa tem lá.
  if (v.indexOf(DDI_PADRAO.trim()) === 0) v = v.slice(DDI_PADRAO.trim().length);

  let digitos = v.replace(/\D/g, '');

  // 2) "0055 11 ..." — como algumas agendas exportam.
  if (digitos.slice(0, 4) === '0055') digitos = digitos.slice(4);

  /* 3) Um `55` colado na frente só é DDI quando sobra número de gente depois
        dele. `55` também é o DDD de Santa Maria, e arrancá-lo de um telefone de
        10 dígitos daria OUTRO telefone — o da paciente errada. */
  if (digitos.slice(0, 2) === '55' && digitos.length >= 12) digitos = digitos.slice(2);

  return DDI_PADRAO + digitos;
}

/** O campo está preenchido de verdade, ou só tem o `+55 ` que já veio pronto? */
export function temNumero(valor) {
  return (valor || '').replace(/\D/g, '').replace(/^55/, '').length >= 10;
}

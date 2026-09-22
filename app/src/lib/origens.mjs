/**
 * De onde o lead veio (M5.13, 22/09).
 *
 * ===================================================== POR QUE ISTO EXISTE
 *
 * Item do bloco de Funil do PDF de 19/09: o time pediu **Meta, Google e
 * TikTok** na origem. A lista tinha quatro opções fixas, escritas dentro do
 * `<select>` do Kanban:
 *
 *     site · instagram · google · indicação
 *
 * Duas coisas erradas nela, e a segunda é a que importa de verdade:
 *
 * 1. **Faltavam as origens que a clínica usa.** Não havia TikTok, não havia
 *    Meta Ads, e não havia WhatsApp — apesar de o próprio sistema já gravar
 *    `source: 'whatsapp'` quando a paciente chega pela conversa. O card exibia
 *    "whatsapp" com o ícone genérico, porque a lista não conhecia o valor que a
 *    aplicação escrevia.
 *
 * 2. **"instagram" e "google" misturavam pago com orgânico.** É a mesma palavra
 *    para "ela viu o anúncio" e "ela achou no perfil". Isso não é preciosismo
 *    de nomenclatura: o **Custo por Lead** da Visão Geral divide o investimento
 *    em captação pelos leads do período, e é a origem paga que responde por
 *    aquele investimento. Somar o orgânico junto faz o CPL parecer melhor do
 *    que é — e foi justamente esse número que o time comercial atacou em 19/09.
 *
 * ================================== O QUE ESTÁ GRAVADO NUNCA SOME DA TELA
 *
 * Mesma regra de `selecao.mjs`: lead antigo com `source` fora desta lista
 * continua aparecendo, com o valor cru. Sumir da tela seria o sistema apagar de
 * onde veio uma paciente porque a lista mudou depois.
 */

/* Dois nomes por origem, e a razão é de espaço: no SELETOR cabe a versão que
   tira a dúvida ("Instagram (orgânico)" não é o anúncio), e na ETIQUETA DO CARD
   cabem poucas letras. A primeira versão usava o rótulo longo nos dois lugares
   e "Meta Ads (Facebook/Instagram)" empurrava o nome da paciente para duas
   linhas e vazava do card. Apareceu na conferência de navegador. */
export const ORIGENS = [
  { valor: 'site',        rotulo: 'Site / Formulário',             curto: 'Site',       paga: false },
  { valor: 'whatsapp',    rotulo: 'WhatsApp',                      curto: 'WhatsApp',   paga: false },
  { valor: 'meta_ads',    rotulo: 'Meta Ads (Facebook/Instagram)', curto: 'Meta Ads',   paga: true },
  { valor: 'google_ads',  rotulo: 'Google Ads',                    curto: 'Google Ads', paga: true },
  { valor: 'tiktok_ads',  rotulo: 'TikTok Ads',                    curto: 'TikTok Ads', paga: true },
  { valor: 'instagram',   rotulo: 'Instagram (orgânico)',          curto: 'Instagram',  paga: false },
  { valor: 'google',      rotulo: 'Google (busca orgânica)',       curto: 'Google',     paga: false },
  { valor: 'tiktok',      rotulo: 'TikTok (orgânico)',             curto: 'TikTok',     paga: false },
  { valor: 'indicação',   rotulo: 'Indicação',                     curto: 'Indicação',  paga: false },
  { valor: 'manual',      rotulo: 'Cadastro manual',               curto: 'Manual',     paga: false },
  { valor: 'outro',       rotulo: 'Outro',                         curto: 'Outro',      paga: false }
];

/** A origem, se esta lista a conhece. */
export function origem(valor) {
  const v = String(valor || '').trim().toLowerCase();
  return ORIGENS.find((o) => o.valor === v) || null;
}

/** O nome para a tela.
 *
 *  Origem desconhecida volta como veio — nunca como "Outro" e nunca vazia.
 *  Trocar o valor gravado por um rótulo genérico apagaria da tela de onde a
 *  paciente veio, só porque a lista mudou depois que ela entrou. */
export function rotuloDaOrigem(valor) {
  const o = origem(valor);
  if (o) return o.rotulo;
  const cru = String(valor || '').trim();
  return cru || 'Não informada';
}

/** O nome curto, para a etiqueta do card. Mesma regra do longo: origem
 *  desconhecida volta como veio. */
export function rotuloCurto(valor) {
  const o = origem(valor);
  if (o) return o.curto;
  const cru = String(valor || '').trim();
  return cru || 'Não informada';
}

/** É origem de mídia paga?
 *
 *  É esta resposta que separa o que o Custo por Lead pode dividir do que não
 *  pode. Origem desconhecida responde `false`: contar como paga um lead cuja
 *  origem ninguém sabe inflaria o denominador com chute. */
export function ehPaga(valor) {
  const o = origem(valor);
  return o ? o.paga : false;
}

/** As opções do seletor, com a origem já gravada incluída quando ela não está
 *  na lista — mesma regra dos campos da sessão em `selecao.mjs`. */
export function opcoesDeOrigem(gravada) {
  const opcoes = ORIGENS.map((o) => ({ valor: o.valor, rotulo: o.rotulo, legado: false }));
  const v = String(gravada || '').trim();
  if (v && !origem(v)) {
    opcoes.push({ valor: v, rotulo: v + ' — registrado antes', legado: true });
  }
  return opcoes;
}

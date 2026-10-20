'use strict';
/** Qual procedimento a paciente citou na primeira mensagem do WhatsApp.
 *
 *  Relatório de QA de 15/10, BUG-03: todo lead que chegava pela conversa era
 *  gravado com procedimento "Geral", inclusive quando a mensagem dizia "quanto
 *  custa o Bumbum Max?". O funil perdia a única informação que a paciente deu.
 *
 *  A regra é de propósito simples e conservadora: só vale o que é do CATÁLOGO
 *  da clínica, e só quando o nome (ou a primeira palavra marcante dele, como
 *  "Ultraformer" ou "Lavien") aparece na mensagem. Sem certeza, fica "Geral" —
 *  chutar um procedimento seria pior que não saber.
 *
 *  Pura, para o teste conferir sem banco.
 */

function normalizar(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Palavras que, sozinhas, não identificam procedimento nenhum. */
const GENERICAS = new Set(['protocolo', 'tratamento', 'procedimento', 'sessao', 'pacote',
  'premium', 'facial', 'corporal', 'laser', 'limpeza', 'pele', 'massagem', 'avaliacao']);

const ENFEITES = new Set(['premium', 'protocolo', 'pacote', 'sessao', 'vip']);

/** `catalogo` é uma lista de nomes. Devolve o nome do catálogo, ou `null`. */
function procedimentoDaMensagem(texto, catalogo) {
  const msg = ' ' + normalizar(texto) + ' ';
  if (msg.trim() === '') return null;

  let melhor = null;
  let peso = 0;
  for (const nome of catalogo || []) {
    const n = normalizar(nome);
    if (!n) continue;
    if (msg.indexOf(' ' + n + ' ') !== -1) {
      // nome inteiro citado: vence qualquer palavra solta
      if (n.length + 100 > peso) { melhor = nome; peso = n.length + 100; }
      continue;
    }
    // o nome sem os enfeites de vitrine: "Limpeza de Pele Premium" -> "limpeza de pele"
    const nucleo = n.split(' ').filter(function (p) { return !ENFEITES.has(p); }).join(' ');
    if (nucleo.length >= 5 && nucleo !== n && msg.indexOf(' ' + nucleo + ' ') !== -1) {
      if (nucleo.length + 50 > peso) { melhor = nome; peso = nucleo.length + 50; }
      continue;
    }
    const primeira = n.split(' ').filter(function (p) { return p.length >= 5 && !GENERICAS.has(p); })[0];
    if (primeira && msg.indexOf(' ' + primeira + ' ') !== -1 && primeira.length > peso) {
      melhor = nome; peso = primeira.length;
    }
  }
  return melhor;
}

module.exports = { procedimentoDaMensagem: procedimentoDaMensagem, normalizar: normalizar };

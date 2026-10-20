'use strict';
/** Data sem hora ("dia 15"), do jeito que ela tem de chegar ao banco.
 *
 *  Relatório de QA de 15/10, BUG-06 (bloqueador): a data da sessão recuava UM
 *  DIA a cada salvamento — 15 → 14 → 13/10, sem ninguém mexer nela.
 *
 *  A causa era `new Date("2026-10-15")`. O JavaScript lê essa forma como
 *  meia-noite em UTC; o servidor está em Brasília (UTC−3), e o driver gravou a
 *  data local daquele instante: 14/10 às 21h. A coluna é DATE, então sobrou
 *  "14/10". Na leitura volta como meia-noite de 14 em Brasília, a tela mostra
 *  14, o formulário reenvia "2026-10-14", e a conta se repete.
 *
 *  Dia não tem fuso. Ele vai para o banco como texto `AAAA-MM-DD`, que o MySQL
 *  grava exatamente como veio. Quando o que chega é um instante (`...T03:00Z`,
 *  que é como uma data lida do banco volta ao navegador), vale o dia em
 *  America/Sao_Paulo — o dia que a clínica vê no calendário.
 */

const FUSO = 'America/Sao_Paulo';

function diaEmBrasilia(instante) {
  // en-CA formata como AAAA-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(instante);
}

/** `AAAA-MM-DD`, ou `null` quando não há data válida. */
function dataPura(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) return isNaN(valor.getTime()) ? null : diaEmBrasilia(valor);
  const s = String(valor).trim();
  const so = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (so) return s;
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) {
    // "2026-10-15 00:00:00" (sem fuso) é texto de banco: o dia é o que está escrito.
    if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return s.slice(0, 10);
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : diaEmBrasilia(d);
  }
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (br) return br[3] + '-' + br[2] + '-' + br[1];
  return null;
}

/** Hoje, em Brasília. */
function hoje() {
  return diaEmBrasilia(new Date());
}

module.exports = { dataPura: dataPura, hoje: hoje, FUSO: FUSO };

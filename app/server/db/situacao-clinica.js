'use strict';
/** O status das clínicas, com cache curto (M3.2b).
 *
 *  O porteiro precisa saber, a CADA requisição, se a clínica da sessão ainda
 *  está ativa — senão suspender só valeria quando o token vencesse, 12 horas
 *  depois, e "suspendi o acesso" seria mentira durante o resto do dia.
 *
 *  Consultar o banco a cada requisição custaria uma ida por clique de cada
 *  pessoa. Então: um mapa em memória, recarregado a cada 15 segundos. O atraso
 *  máximo entre suspender e o acesso cair é isso — 15 segundos, e não 12 horas.
 *
 *  FALHA FECHADO: se a leitura do banco quebrar, o mapa antigo continua valendo
 *  por até um minuto e depois tudo é tratado como NÃO ativo. Um banco fora do ar
 *  já derruba o sistema de qualquer jeito; o que não pode é uma falha de leitura
 *  virar "todo mundo entra".
 */
const escopo = require('./escopo');

const VALIDADE_MS = 15000;
const TOLERANCIA_MS = 60000;

let mapa = null;
let lidoEm = 0;
let promessa = null;

/** De onde sai o mapa. É uma variável para o teste de unidade do porteiro poder
 *  trocar a origem — ele mede a lógica do token e não tem banco. Produção nunca
 *  chama `trocarOrigem`, e há teste cobrando que o padrão continua o do banco. */
let origem = lerDoBanco;

function trocarOrigem(fn) { origem = fn || lerDoBanco; esquecer(); }

async function lerDoBanco() {
  const cru = escopo.todasAsClinicas(
    'situacao das clinicas: o porteiro precisa saber se a clinica da sessao esta ativa, e essa ' +
    'pergunta e sobre o conjunto -- nao ha clinica atual de onde tirar escopo');
  const [linhas] = await cru.q('SELECT id, status FROM clinicas');
  const novo = {};
  for (const l of linhas) novo[l.id] = l.status;
  return novo;
}

async function recarregar() {
  mapa = await origem();
  lidoEm = Date.now();
  return mapa;
}

async function statusDe(clinicaId) {
  const idade = Date.now() - lidoEm;
  if (!mapa || idade > VALIDADE_MS) {
    if (!promessa) {
      promessa = recarregar().catch(function (e) {
        console.error('[situacao-clinica] falha ao ler status:', e && e.message);
        if (Date.now() - lidoEm > TOLERANCIA_MS) mapa = null;
        return mapa;
      }).then(function (r) { promessa = null; return r; });
    }
    await promessa;
  }
  if (!mapa) return null;

  /* CLINICA QUE NAO ESTA NO MAPA pode ser uma que acabou de nascer. Recarrega
   * uma vez antes de responder "nao existe" -- senao entrar numa clinica criada
   * ha menos de 15 segundos daria "acesso suspenso", que e a pior primeira
   * impressao possivel. Medido pelo ensaio em 14/09.
   *
   * A guarda de 1 segundo evita que um token apontando para clinica inexistente
   * vire um pedido de recarga por requisicao. */
  if (!mapa[clinicaId] && Date.now() - lidoEm > 1000) {
    try { await recarregar(); } catch (e) { /* o mapa antigo continua valendo */ }
  }

  return mapa[clinicaId] || null;
}

async function estaAtiva(clinicaId) {
  return (await statusDe(clinicaId)) === 'ativa';
}

/** Chamada por quem muda o status, para a mudança valer na hora e não em 15s. */
function esquecer() {
  mapa = null;
  lidoEm = 0;
}

module.exports = { statusDe, estaAtiva, esquecer, trocarOrigem, VALIDADE_MS };

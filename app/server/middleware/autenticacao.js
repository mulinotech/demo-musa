'use strict';
/** Porteiro unico da API: exige JWT em tudo, exceto as rotas publicas.
 *
 *  O 401 NAO leva cabecalho WWW-Authenticate de proposito: com ele, o navegador
 *  abre o dialogo nativo de usuario e senha por cima da tela de login do CRM.
 *
 *  Existe uma segunda forma de entrar, e so uma: o token de servico do
 *  agendador do sistema (`server/middleware/cron.js`), que vale para duas
 *  rotas de varredura e mais nada. Ele e conferido ANTES do JWT porque o cron
 *  nao tem sessao; e conferido DEPOIS das rotas publicas porque nao ha por que
 *  gastar consulta ao banco em rota que nem exige credencial.
 */
const auth = require('../../auth');
const cron = require('./cron');

const ROTAS_PUBLICAS = [
  { metodo: 'POST', caminho: '/api/leads' },
  { metodo: 'POST', caminho: '/api/auth/login' },
  { metodo: 'GET',  caminho: '/api/config' },
  { metodo: 'POST', caminho: '/api/webhook/whatsapp' }
];

function ehRotaPublica(metodo, caminho) {
  return ROTAS_PUBLICAS.some(function (r) {
    return r.metodo === metodo && r.caminho === caminho;
  });
}

async function porteiro(req, res, next) {
  res.set('X-Trava-Musa', 'v18');
  const caminho = req.originalUrl.split('?')[0];
  if (ehRotaPublica(req.method, caminho)) return next();

  const usuario = auth.usuarioDaRequisicao(req);
  if (usuario) { req.usuario = usuario; return next(); }

  // O `require` fica aqui dentro de proposito: so quem manda o cabecalho do
  // cron toca no banco, e a suite de teste do porteiro nao precisa de pool.
  if (req.headers[cron.CABECALHO]) {
    try {
      const { pool } = require('../db');
      const servico = await cron.identidadeDeCron(pool, req, caminho);
      if (servico) { req.usuario = servico; return next(); }
    } catch (e) {
      // Banco fora do ar na conferencia do token e 401, nunca 500: para quem
      // chama, "nao autentiquei" e a verdade, e o cron tenta de novo depois.
      //
      // MAS O ERRO PRECISA APARECER EM ALGUM LUGAR. A primeira versao disto
      // engolia a excecao calada, e foi assim que `require('../db')` -- que
      // devolve { pool }, nao o pool -- passou por um 401 identico ao de token
      // errado. Meia hora procurando token invalido quando o defeito era de
      // codigo. Log de servidor nao e detalhe: e a diferenca entre uma falha
      // que se acha e uma que se persegue.
      console.error('[cron] falha ao conferir o token de servico:', e.message);
    }
  }

  return res.status(401).json({ error: 'Sessao nao autenticada ou expirada.' });
}

module.exports = { ROTAS_PUBLICAS, ehRotaPublica, porteiro };

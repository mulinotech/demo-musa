'use strict';
/** Porteiro unico da API: exige JWT em tudo, exceto as rotas publicas.
 *
 *  O 401 NAO leva cabecalho WWW-Authenticate de proposito: com ele, o navegador
 *  abre o dialogo nativo de usuario e senha por cima da tela de login do CRM.
 */
const auth = require('../../auth');

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

function porteiro(req, res, next) {
  res.set('X-Trava-Musa', 'v5');
  const caminho = req.originalUrl.split('?')[0];
  if (ehRotaPublica(req.method, caminho)) return next();
  const usuario = auth.usuarioDaRequisicao(req);
  if (usuario) { req.usuario = usuario; return next(); }
  return res.status(401).json({ error: 'Sessao nao autenticada ou expirada.' });
}

module.exports = { ROTAS_PUBLICAS, ehRotaPublica, porteiro };

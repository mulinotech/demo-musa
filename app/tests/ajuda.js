'use strict';
/** Utilitarios dos testes. Sobe a aplicacao numa porta efemera e devolve um
 *  cliente HTTP simples. Sem dependencia externa: node:test + fetch nativo. */

// Precisa vir antes de qualquer require que leia o segredo.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-apenas-de-teste-nao-usar-em-producao';

const app = require('../server/app');
const auth = require('../auth');

function subirServidor() {
  return new Promise(function (resolve) {
    const servidor = app.listen(0, function () {
      const porta = servidor.address().port;
      resolve({
        servidor: servidor,
        base: 'http://127.0.0.1:' + porta,
        fechar: function () { return new Promise(function (r) { servidor.close(r); }); }
      });
    });
  });
}

function tokenPara(papel, extras) {
  return auth.gerarToken(Object.assign({
    id: 'u_teste', name: 'Usuario de Teste', role: papel, salesperson_id: null
  }, extras || {}));
}

async function chamar(ctx, metodo, caminho, token) {
  const cabecalhos = {};
  if (token) cabecalhos.Authorization = 'Bearer ' + token;
  const r = await fetch(ctx.base + caminho, { method: metodo, headers: cabecalhos });
  return r;
}

module.exports = { subirServidor, tokenPara, chamar };

'use strict';
/** Autorizacao por papel, dirigida por tabela.
 *
 *  Para proteger uma rota nova, acrescente uma linha em REGRAS_DE_PAPEL.
 *  Nao escreva verificacao de permissao dentro do handler.
 */

const REGRAS_DE_PAPEL = [
  { metodo: '*',      prefixo: '/api/_migrate',          papeis: ['admin'] },
  { metodo: '*',      prefixo: '/api/logs',              papeis: ['admin', 'gerente'] },
  { metodo: 'POST',   prefixo: '/api/salespeople',       papeis: ['admin', 'gerente'] },
  { metodo: 'PATCH',  prefixo: '/api/salespeople',       papeis: ['admin', 'gerente'] },
  { metodo: 'DELETE', prefixo: '/api/salespeople',       papeis: ['admin', 'gerente'] },
  { metodo: 'POST',   prefixo: '/api/treatment-catalog', papeis: ['admin', 'gerente'] },
  { metodo: 'PATCH',  prefixo: '/api/treatment-catalog', papeis: ['admin', 'gerente'] },
  { metodo: 'DELETE', prefixo: '/api/treatment-catalog', papeis: ['admin', 'gerente'] },
  { metodo: 'DELETE', prefixo: '/api/clients',           papeis: ['admin', 'gerente'] },
  { metodo: '*',      prefixo: '/api/users',             papeis: ['admin'] }
];

/** O prefixo casa com o caminho exato ou com um filho dele.
 *  Comparar por indexOf === 0 faria '/api/logs-publicos' herdar a regra de
 *  '/api/logs', o que e a classe de erro que passa despercebida em revisao. */
function casa(prefixo, caminho) {
  return caminho === prefixo || caminho.indexOf(prefixo + '/') === 0;
}

function regraPara(metodo, caminho) {
  return REGRAS_DE_PAPEL.find(function (r) {
    return (r.metodo === '*' || r.metodo === metodo) && casa(r.prefixo, caminho);
  }) || null;
}

function exigirPapel(req, res, next) {
  const caminho = req.originalUrl.split('?')[0];
  const regra = regraPara(req.method, caminho);
  if (!regra) return next();
  if (!req.usuario || regra.papeis.indexOf(req.usuario.papel) === -1) {
    return res.status(403).json({ error: 'Sem permissao para esta area.' });
  }
  next();
}

module.exports = { REGRAS_DE_PAPEL, regraPara, exigirPapel };

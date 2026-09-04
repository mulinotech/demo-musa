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
  { metodo: '*',      prefixo: '/api/users',             papeis: ['admin'] },
  // Preco e informacao sensivel de negocio: profissional e vendedor nao veem.
  { metodo: '*',      prefixo: '/api/pricing',           papeis: ['admin', 'gerente'] },
  { metodo: '*',      prefixo: '/api/fixed-costs',       papeis: ['admin', 'gerente'] },
  { metodo: '*',      prefixo: '/api/finance',           papeis: ['admin', 'gerente'] },
  { metodo: '*',      prefixo: '/api/recurring-expenses',papeis: ['admin', 'gerente'] },
  // Estoque: a profissional PRECISA consultar saldo e validade antes de
  // aplicar, entao a leitura e dela tambem. Mexer no saldo, nao.
  { metodo: 'GET',    prefixo: '/api/products',          papeis: ['admin', 'gerente', 'profissional'] },
  { metodo: '*',      prefixo: '/api/products',          papeis: ['admin', 'gerente'] },
  { metodo: 'GET',    prefixo: '/api/stock',             papeis: ['admin', 'gerente', 'profissional'] },
  { metodo: '*',      prefixo: '/api/stock',             papeis: ['admin', 'gerente'] },
  { metodo: 'GET',    prefixo: '/api/services',          papeis: ['admin', 'gerente', 'profissional'] },
  { metodo: '*',      prefixo: '/api/services',          papeis: ['admin', 'gerente'] },
  // Fidelidade: TODO papel autenticado le o saldo -- a recepcao precisa dizer
  // o saldo a paciente no fim do atendimento, e programa de pontos que so a
  // gerencia consulta nao muda comportamento nenhum. Configurar e ajustar
  // pontos a mao e de admin, porque ponto e credito em dinheiro.
  { metodo: 'GET',    prefixo: '/api/loyalty',           papeis: ['admin', 'gerente', 'profissional', 'vendedor'] },
  { metodo: '*',      prefixo: '/api/loyalty',           papeis: ['admin', 'gerente'] },

  /* DOCUMENTOS CLINICOS -- dado pessoal SENSIVEL (LGPD art. 5, II).
   *
   * O time comercial nao tem por que ver historico de saude de paciente, e por
   * isso `vendedor` fica FORA das quatro linhas abaixo. As duas primeiras usam
   * `padrao` porque a rota e aninhada em /api/clients: sem elas, a regra de
   * prefixo de /api/clients nao pegaria o filho e a leitura ficaria aberta. */
  { metodo: '*', padrao: /^\/api\/clients\/[^/]+\/documents(\/|$)/, prefixo: '/api/clients',
    papeis: ['admin', 'gerente', 'profissional'] },
  { metodo: '*', padrao: /^\/api\/clients\/[^/]+\/(alerts|export)(\/|$)/, prefixo: '/api/clients',
    papeis: ['admin', 'gerente', 'profissional'] },
  { metodo: '*',      prefixo: '/api/documents',         papeis: ['admin', 'gerente', 'profissional'] },
  { metodo: '*',      prefixo: '/api/document-templates',papeis: ['admin', 'gerente', 'profissional'] }
];

/** O prefixo casa com o caminho exato ou com um filho dele.
 *  Comparar por indexOf === 0 faria '/api/logs-publicos' herdar a regra de
 *  '/api/logs', o que e a classe de erro que passa despercebida em revisao. */
function casa(prefixo, caminho) {
  return caminho === prefixo || caminho.indexOf(prefixo + '/') === 0;
}

/** POR QUE EXISTE `padrao` (regex) ALEM DE `prefixo`
 *
 *  Prefixo nao expressa rota ANINHADA: `/api/clients/:id/documents` cai sob
 *  `/api/clients`, e se `/api/clients` nao tiver regra para o metodo, a rota
 *  filha fica liberada para qualquer autenticado. Foi exatamente o que
 *  aconteceria com os documentos clinicos -- o vendedor leria historico de saude
 *  de paciente sem nenhum erro aparecer.
 *
 *  O `padrao` casa o caminho inteiro por expressao regular, e a regra com
 *  `padrao` vem ANTES da regra de prefixo mais generica na tabela, porque
 *  `regraPara` devolve a primeira que serve.
 *
 *  Regra pratica para modulo novo: se a rota tem id no meio do caminho, use
 *  `padrao`. Prefixo so basta quando o recurso esta na raiz de /api. */
function casaPadrao(regra, caminho) {
  if (regra.padrao) return regra.padrao.test(caminho);
  return casa(regra.prefixo, caminho);
}

function regraPara(metodo, caminho) {
  return REGRAS_DE_PAPEL.find(function (r) {
    return (r.metodo === '*' || r.metodo === metodo) && casaPadrao(r, caminho);
  }) || null;
}

function exigirPapel(req, res, next) {
  // A rotina automatica ja foi limitada por LISTA DE ROTAS no porteiro
  // (server/middleware/cron.js): so chega aqui em uma das duas varreduras.
  // Fazer o token passar tambem por esta tabela nao acrescentaria seguranca e
  // acrescentaria risco -- um papel 'servico' herdaria toda rota que ainda nao
  // tem linha aqui, porque a regra logo abaixo e "sem regra, pode". Um lugar
  // so decide o que o cron alcanca.
  if (req.usuario && req.usuario.servico === true) return next();

  const caminho = req.originalUrl.split('?')[0];
  const regra = regraPara(req.method, caminho);
  if (!regra) return next();
  if (!req.usuario || regra.papeis.indexOf(req.usuario.papel) === -1) {
    return res.status(403).json({ error: 'Sem permissao para esta area.' });
  }
  next();
}

module.exports = { REGRAS_DE_PAPEL, regraPara, exigirPapel };

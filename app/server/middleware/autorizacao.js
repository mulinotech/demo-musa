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

  /* A AGENDA E DE LEITURA PARA O VENDEDOR (M5.2, 15/09).
   *
   * Decisao da Silvia depois de ver, MEDIDO, o que o papel alcancava: o
   * vendedor trabalha o que e COMERCIAL -- lead, conversa, o contato da
   * paciente e o plano de tratamento que ele vende -- e nao mexe no calendario
   * de quem atende.
   *
   * Ele CONTINUA LENDO a agenda, e isso e deliberado: sem ver disponibilidade
   * ele nao tem o que prometer ao fechar. O que sai e criar, remarcar, cancelar
   * e, sobretudo, CONCLUIR -- porque concluir um atendimento lanca receita,
   * baixa insumo e credita ponto. Quem nunca aplicou o procedimento nao e quem
   * deve declarar que ele aconteceu.
   *
   * Sao quatro linhas, e nao uma com `metodo: '*'`, porque o GET tem de passar:
   * a tabela casa por metodo exato, e `*` levaria a leitura junto. */
  { metodo: 'POST',   prefixo: '/api/appointments', papeis: ['admin', 'gerente', 'profissional'] },
  { metodo: 'PATCH',  prefixo: '/api/appointments', papeis: ['admin', 'gerente', 'profissional'] },
  { metodo: 'PUT',    prefixo: '/api/appointments', papeis: ['admin', 'gerente', 'profissional'] },
  { metodo: 'DELETE', prefixo: '/api/appointments', papeis: ['admin', 'gerente', 'profissional'] },

  { metodo: '*',      prefixo: '/api/users',             papeis: ['admin'] },

  /* O TIMBRE DA CLINICA (M5.6, 17/09): quem EDITA e a gestao; quem LE e todo
   * mundo, e isso e deliberado -- a profissional precisa ver o cabecalho que
   * vai sair impresso antes de escrever a receita. Endereco de clinica nao e
   * dado sensivel: esta no site dela e na porta.
   *
   * `/api/meu-timbre` fica FORA de regra: cada um le o proprio, e o id vem do
   * token. Uma regra de papel aqui so tiraria da profissional o acesso ao
   * proprio nome. */
  { metodo: 'PATCH',  prefixo: '/api/clinica',           papeis: ['admin', 'gerente'] },
  // Preco e informacao sensivel de negocio: profissional e vendedor nao veem.
  { metodo: '*',      prefixo: '/api/pricing',           papeis: ['admin', 'gerente'] },
  { metodo: '*',      prefixo: '/api/fixed-costs',       papeis: ['admin', 'gerente'] },
  { metodo: '*',      prefixo: '/api/finance',           papeis: ['admin', 'gerente'] },
  { metodo: '*',      prefixo: '/api/recurring-expenses',papeis: ['admin', 'gerente'] },

  /* A VISAO GERAL, EM DOIS PEDACOS (M5.8, 18/09).
   *
   * A tela e de admin, gerencia e profissional (ver components/navegacao.ts),
   * mas faturamento, ticket medio e CPL sao a mesma informacao que
   * /api/finance protege duas linhas acima. Separar em duas rotas e o que
   * permite a profissional manter a tela SEM que a decisao de quem ve dinheiro
   * desca para dentro do handler.
   *
   * A linha de /dinheiro vem ANTES da geral: a busca para na primeira que casa,
   * e /api/dashboard cobriria as duas. */
  { metodo: '*',      prefixo: '/api/dashboard/dinheiro', papeis: ['admin', 'gerente'] },
  { metodo: '*',      prefixo: '/api/dashboard',          papeis: ['admin', 'gerente', 'profissional'] },
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
  { metodo: '*',      prefixo: '/api/document-templates',papeis: ['admin', 'gerente', 'profissional'] },

  /* A CHAVE DE CAPTACAO e configuracao, nao trabalho de funil.
   *
   * O funil em si (`/api/leads`) e de todo papel autenticado -- vendedor
   * trabalha lead o dia inteiro. Mas quem mexe no endereco para onde o site
   * manda contato esta mexendo em infraestrutura da clinica, e isso e de gestao.
   *
   * Usa `padrao` porque a rota e filha de /api/leads: com `prefixo` sozinho a
   * regra valeria para o funil inteiro e o vendedor perderia a tela dele. E a
   * mesma armadilha das rotas aninhadas de /api/clients logo acima. */
  { metodo: 'GET', padrao: /^\/api\/leads\/captacao$/, prefixo: '/api/leads',
    papeis: ['admin', 'gerente'] },

  /* O PRIMEIRO OPERADOR DA PLATAFORMA -- `admin`, e ela se fecha sozinha.
   *
   * Repare que ela NAO mora em /api/plataforma: aquele caminho e recusado a
   * todo token de clinica, e esta rota e chamada justamente por um. O nome
   * separado nao e enfeite -- e o que a faz alcancavel.
   *
   * Havendo um operador, a rota recusa com 409 para sempre. Ver o cabecalho dela
   * em routes/plataforma.js, inclusive o risco que sobra, escrito. */
  { metodo: 'POST',   prefixo: '/api/primeiro-operador',  papeis: ['admin'] },

  /* CONCEDER E REVOGAR O ACESSO DE SUPORTE e do dono do dado: `admin` da
   * clinica. A LEITURA (GET) fica de fora da regra para o proprio suporte poder
   * ver ate quando foi autorizado -- ele ja esta limitado por lista de rotas. */
  { metodo: 'POST',   prefixo: '/api/suporte',            papeis: ['admin'] },
  { metodo: 'DELETE', prefixo: '/api/suporte',            papeis: ['admin'] },

  /* NAO ha linha para /api/plataforma AQUI, e isso e deliberado.
   *
   * O alcance do operador e uma LISTA DE ROTAS em server/middleware/plataforma.js,
   * conferida no porteiro, antes desta tabela. Pendurar tambem uma regra de papel
   * aqui daria a impressao de duas travas e entregaria meia: o operador nao tem
   * `papel`, entao qualquer regra escrita em termos de papel nao casaria com ele.
   *
   * A rota interina `POST /api/clinicas` (papel admin, 11/09) saiu junto com o
   * arquivo dela em 14/09: criar clinica virou operacao de plataforma de verdade. */
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

  // O OPERADOR DA PLATAFORMA passa direto aqui pela MESMA razao, e nunca por
  // confianca: ele ja foi limitado por lista de rotas no porteiro
  // (server/middleware/plataforma.js). Fazer o token dele atravessar tambem esta
  // tabela seria pior, e nao melhor: ele nao tem `papel`, entao cairia na regra
  // "sem regra, pode" e herdaria toda rota nova que ninguem lembrou de regrar.
  // Um lugar so decide o que a plataforma alcanca.
  if (req.usuario && req.usuario.plataforma === true) return next();

  // E a sessao de SUPORTE pela mesma razao: ela ja passou por lista de rotas E
  // pela conferencia da concessao no banco, no porteiro. Se ela atravessasse
  // esta tabela, o papel 'suporte' -- que nao esta em regra nenhuma -- herdaria
  // toda rota sem regra. Um lugar so decide o que o suporte alcanca.
  if (req.usuario && req.usuario.suporte === true) return next();

  const caminho = req.originalUrl.split('?')[0];
  const regra = regraPara(req.method, caminho);
  if (!regra) return next();
  if (!req.usuario || regra.papeis.indexOf(req.usuario.papel) === -1) {
    return res.status(403).json({ error: 'Sem permissao para esta area.' });
  }
  next();
}

module.exports = { REGRAS_DE_PAPEL, regraPara, exigirPapel };

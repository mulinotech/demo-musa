'use strict';
/** A IDENTIDADE DA PLATAFORMA, E A LISTA DO QUE ELA ALCANÇA (M3.1).
 *
 *  ================================================ O PAPEL MAIS PERIGOSO DO SISTEMA
 *
 *  Um operador da Mulino com acesso irrestrito abre a anamnese de qualquer
 *  paciente de qualquer uma das 50 clínicas. Isso não é hipótese: é o **desenho
 *  padrão** de quem constrói administração de plataforma sem pensar, porque
 *  "o admin vê tudo" é o caminho de menor esforço.
 *
 *  ====================== POR QUE UMA LISTA DE ROTAS, E NÃO UMA LINHA NA TABELA DE PAPÉIS
 *
 *  Porque `exigirPapel` tem um buraco conhecido e deliberado:
 *
 *      const regra = regraPara(req.method, caminho);
 *      if (!regra) return next();          // <- sem regra, PODE
 *
 *  Isso é conveniente para o CRM, onde todo papel é de dentro de uma clínica e a
 *  camada já filtra. É **veneno** para um papel novo: `plataforma` herdaria toda
 *  rota que ainda não tem linha na tabela, hoje e — pior — toda rota que alguém
 *  acrescentar amanhã sem lembrar deste arquivo.
 *
 *  Então a permissão aqui é **lista de permissão explícita**: o que não está
 *  escrito abaixo **não passa**. É o mesmo desenho do token do cron
 *  (`server/middleware/cron.js`), pelo mesmo motivo, e ele já foi provado uma
 *  vez.
 *
 *  ====================================== O CRITÉRIO PARA ENTRAR NESTA LISTA
 *
 *  Uma rota só entra aqui se couber nesta frase: **ela devolve contagem,
 *  situação ou configuração da instalação — nunca conteúdo de clínica.**
 *
 *  "Quantas pacientes a Clínica B tem" é informação de plataforma: é a conta do
 *  mês, é o dimensionamento do servidor, é o suporte sabendo se a clínica
 *  começou a usar. **"Quem são elas" não é.** A fronteira é essa, e ela é a
 *  razão de a listagem de clínicas devolver números e não linhas.
 *
 *  ============================================== E O SUPORTE, QUANDO PRECISAR?
 *
 *  Decidido em 14/09: entrar numa clínica para dar suporte **existe, mas é
 *  acesso concedido pela clínica, com prazo e registro** — não poder permanente
 *  do operador. Isso é tarefa própria, e ela encaixa aqui **sem retrabalho**
 *  justamente porque esta lista nega por padrão: conceder acesso passará a ser a
 *  única coisa capaz de alargá-la, por tempo determinado.
 *
 *  Enquanto essa porta não existir, a resposta para "o operador consegue ver a
 *  ficha da paciente?" é **não**, e há teste provando rota por rota.
 */
const jwt = require('jsonwebtoken');

const EXPIRACAO = '8h';

/** As rotas que o operador alcança. Prefixo não serve aqui: `/api/plataforma`
 *  como prefixo liberaria qualquer rota futura pendurada nele — o buraco que
 *  esta lista existe para não ter. Caminho exato, ou expressão regular quando há
 *  id no meio. */
const ROTAS_DA_PLATAFORMA = [
  { metodo: 'GET',  caminho: '/api/plataforma/eu' },
  { metodo: 'GET',  caminho: '/api/plataforma/clinicas' },
  { metodo: 'POST', caminho: '/api/plataforma/clinicas' },
  { metodo: 'GET',  padrao: /^\/api\/plataforma\/clinicas\/[^/]+\/conferencia$/ },
  { metodo: 'POST', padrao: /^\/api\/plataforma\/clinicas\/[^/]+\/entrar$/ }
];

/** A SESSAO DE SUPORTE (M3.1b): so leitura, e o prontuario fica fora.
 *
 *  Prefixos de GET que o operador alcanca DENTRO de uma clinica que o autorizou.
 *  Tudo que nao esta aqui e recusado -- inclusive todo POST, PUT e DELETE:
 *  suporte investiga, nao mexe.
 *
 *  FICHA DE PACIENTE E DOCUMENTO CLINICO NAO ENTRAM NESTA LISTA, e nao entram
 *  nem com autorizacao. Dado de saude e o que este projeto inteiro existe para
 *  separar; liberar por conveniencia de suporte seria desfazer isso com um
 *  clique de quem esta com um problema na mao e pressa. Se um dia for mesmo
 *  necessario, e decisao com nome, prazo e outra tarefa -- nao um prefixo a mais
 *  nesta lista. */
const PREFIXOS_DE_SUPORTE = [
  '/api/appointments', '/api/leads', '/api/products', '/api/stock', '/api/services',
  '/api/treatment-catalog', '/api/salespeople', '/api/users', '/api/lembretes',
  '/api/evolution', '/api/pricing', '/api/fixed-costs', '/api/finance',
  '/api/recurring-expenses', '/api/loyalty', '/api/logs', '/api/reports', '/api/config',
  '/api/treatments', '/api/treatment-plans', '/api/suporte'
];

/** Prontuario, explicito: estes vencem os prefixos acima. `/api/clients` nao esta
 *  na lista, mas escrever a negacao aqui deixa o motivo visivel para quem for
 *  mexer, e ha teste cobrando cada um. */
const NUNCA_NO_SUPORTE = [
  '/api/clients', '/api/documents', '/api/document-templates'
];

function ehRotaDeSuporte(metodo, caminho) {
  if (metodo !== 'GET') return false;
  if (NUNCA_NO_SUPORTE.some(function (p) { return caminho === p || caminho.indexOf(p + '/') === 0; })) {
    return false;
  }
  return PREFIXOS_DE_SUPORTE.some(function (p) {
    return caminho === p || caminho.indexOf(p + '/') === 0;
  });
}

function ehRotaDaPlataforma(metodo, caminho) {
  return ROTAS_DA_PLATAFORMA.some(function (r) {
    if (r.metodo !== metodo) return false;
    return r.padrao ? r.padrao.test(caminho) : r.caminho === caminho;
  });
}

function segredo() {
  const s = process.env.JWT_SECRET || '';
  if (!s) throw new Error('JWT_SECRET nao configurado no .env');
  return s;
}

/** O token do operador.
 *
 *  NÃO tem `clinicaId` e NÃO tem `papel`, e as duas ausências são de propósito:
 *
 *   - sem `clinicaId`, o porteiro do CRM recusa este token em toda rota de
 *     clínica, e `escopo(req)` estoura se alguém tentar usá-lo para consultar.
 *     A separação não depende de ninguém lembrar dela;
 *   - sem `papel`, ele não pode cair por acidente numa regra de `exigirPapel`
 *     que aceite 'admin'. O que ele é se lê na marca `plataforma`, e em mais
 *     nada.
 *
 *  A validade é mais curta que a do CRM (8h contra 12h): esta credencial enxerga
 *  as 50 clínicas, e sessão esquecida aberta é o risco mais banal que existe. */
function gerarToken(op) {
  return jwt.sign({
    sub: op.id,
    nome: op.nome,
    email: op.email,
    plataforma: true
  }, segredo(), { expiresIn: EXPIRACAO });
}

/** A identidade que as rotas enxergam. Não é usuário de clínica, e a forma dela
 *  diz isso: `clinicaId` ausente, `papel` ausente, `plataforma: true`. */
function identidade(carga) {
  return Object.freeze({
    sub: carga.sub,
    nome: carga.nome,
    email: carga.email,
    plataforma: true
  });
}

/** Lê o token da requisição. Devolve a carga só se ela for de plataforma; token
 *  de usuário de clínica devolve null aqui, e é tratado pelo caminho normal. */
function cargaDaRequisicao(req) {
  const h = req.headers.authorization || '';
  if (!/^Bearer /i.test(h)) return null;
  try {
    const carga = jwt.verify(h.replace(/^Bearer /i, ''), segredo());
    // Token de suporte tem clinica e NAO e credencial de plataforma.
    return carga && carga.plataforma === true && !carga.suporte ? carga : null;
  } catch (e) {
    return null;
  }
}

/** O token de suporte: tem clinica (para `escopo` funcionar como sempre) e a
 *  marca `suporte`. Vida curta de proposito -- a concessao ainda e conferida no
 *  banco a cada requisicao, mas token curto reduz a janela de um token copiado. */
function gerarTokenDeSuporte(op, clinicaId) {
  return jwt.sign({
    sub: op.sub || op.id,
    nome: op.nome,
    email: op.email,
    papel: 'suporte',
    clinicaId: clinicaId,
    suporte: true
  }, segredo(), { expiresIn: '30m' });
}

function cargaDeSuporte(req) {
  const h = req.headers.authorization || '';
  if (!/^Bearer /i.test(h)) return null;
  try {
    const carga = jwt.verify(h.replace(/^Bearer /i, ''), segredo());
    return carga && carga.suporte === true && carga.clinicaId ? carga : null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  EXPIRACAO: EXPIRACAO,
  PREFIXOS_DE_SUPORTE: PREFIXOS_DE_SUPORTE,
  NUNCA_NO_SUPORTE: NUNCA_NO_SUPORTE,
  ehRotaDeSuporte: ehRotaDeSuporte,
  gerarTokenDeSuporte: gerarTokenDeSuporte,
  cargaDeSuporte: cargaDeSuporte,
  ROTAS_DA_PLATAFORMA: ROTAS_DA_PLATAFORMA,
  ehRotaDaPlataforma: ehRotaDaPlataforma,
  gerarToken: gerarToken,
  identidade: identidade,
  cargaDaRequisicao: cargaDaRequisicao
};

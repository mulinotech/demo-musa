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

  /* EQUIPAMENTOS (M5.11) -- mesmo desenho do catalogo, e pelo mesmo motivo:
   * cadastrar e' gestao, escolher e' trabalho de quem atende.
   *
   * A LEITURA fica FORA da tabela de proposito. Quem lanca a sessao e a
   * profissional, e sem a lista ela nao teria o que escolher -- o campo voltaria
   * a ser texto livre na pratica, que e exatamente o que esta tarefa veio
   * desfazer. */
  { metodo: 'POST',   prefixo: '/api/equipments',        papeis: ['admin', 'gerente'] },
  { metodo: 'PATCH',  prefixo: '/api/equipments',        papeis: ['admin', 'gerente'] },
  { metodo: 'DELETE', prefixo: '/api/equipments',        papeis: ['admin', 'gerente'] },

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

  /* LEVAR AS SESSOES DO PLANO PARA A AGENDA (M6.3) cria compromissos -- e criar
   * compromisso e' das quatro linhas de `/api/appointments` acima, que o
   * vendedor nao alcanca desde a M5.2. Sem esta linha, a rota seria a porta dos
   * fundos daquela decisao: o mesmo vendedor que nao pode marcar UM horario
   * marcaria DEZ de uma vez por dentro do plano.
   *
   * Usa `padrao` porque a rota e' filha de `/api/treatment-plans`: com prefixo
   * sozinho, a regra pegaria tambem criar e editar plano, que e' trabalho
   * comercial. Mesma armadilha de rota aninhada das regras de /api/clients. */
  { metodo: 'POST', padrao: /^\/api\/treatment-plans\/[^/]+\/agendar$/,
    prefixo: '/api/treatment-plans', papeis: ['admin', 'gerente', 'profissional'] },

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
  /* O LOGO (M6.2) entra pela mesma porta: `PUT` e `DELETE` em `/api/clinica/logo`
   * caem neste prefixo. Sao duas linhas, e nao um `metodo: '*'`, porque o GET
   * tem de continuar passando para todo papel -- a profissional le o timbre
   * inteiro, logo incluso, antes de escrever a receita. */
  { metodo: 'PUT',    prefixo: '/api/clinica',           papeis: ['admin', 'gerente'] },
  { metodo: 'DELETE', prefixo: '/api/clinica',           papeis: ['admin', 'gerente'] },
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
  /* LIGAR A ENTRADA DE MENSAGENS e' configuracao da clinica, nao operacao do
   * dia (M5.9). A LEITURA do diagnostico fica fora de regra de proposito: quem
   * atende precisa saber que as mensagens nao estao chegando -- e' justamente
   * essa pessoa que percebe o silencio primeiro. */
  { metodo: 'POST',   prefixo: '/api/evolution/entrada/ligar', papeis: ['admin', 'gerente'] },

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

/* ============================================================================
 *  OS PAPÉIS ESTREITOS (M6.7) E POR QUE A TABELA ACIMA NÃO BASTAVA
 *
 *  A tabela `REGRAS_DE_PAPEL` funciona por NEGAÇÃO: uma rota sem linha ali é
 *  alcançável por qualquer papel autenticado. Isso é razoável para quatro
 *  papéis largos — admin, gerente, profissional, vendedor — porque os quatro
 *  trabalham dentro da clínica e o acesso amplo é o esperado.
 *
 *  Para `secretaria`, `financeiro` e `contador` a regra se inverte: o que eles
 *  alcançam é um pedaço PEQUENO do sistema, e enumerar tudo o que eles NÃO
 *  alcançam daria uma tabela que apodrece na primeira rota nova — a rota nasce
 *  sem linha, e o contador passa a ler o prontuário sem que nada apareça.
 *
 *  Por isso existe uma segunda tabela, conferida ANTES daquela:
 *
 *  - `modo: 'somente'` — o papel só alcança o que está listado. Rota nova nasce
 *    FECHADA para ele. O sintoma de esquecer de listar é alguém dizendo "não
 *    consigo abrir", que se resolve em uma linha; o sintoma do contrário é um
 *    vazamento que ninguém percebe.
 *  - `modo: 'exceto'` — o papel alcança tudo menos o listado. É para quem é
 *    gerente de verdade e tem um recorte a menos.
 *
 *  Papel que NÃO está nesta tabela passa direto: `admin`, `gerente`,
 *  `gerente_admin`, `profissional` e `vendedor` continuam exatamente como
 *  estavam antes desta tarefa.
 * ========================================================================== */

/** Com que papel ANTIGO cada papel novo é julgado na tabela de cima.
 *
 *  Reescrever as 44 linhas de `REGRAS_DE_PAPEL` para citar os papéis novos
 *  seria a outra forma de fazer isto — e a forma que erra: bastaria esquecer um
 *  `papeis: [...]` para o papel novo perder (ou ganhar) uma área em silêncio.
 *  Aqui a equivalência é declarada UMA vez, e o alcance de verdade é recortado
 *  pela tabela logo abaixo.
 *
 *  `gerente_admin` responde como `gerente` E não aparece em ALCANCE_DO_PAPEL:
 *  ele é o gerente de hoje, com outro nome. Era isso que a clínica queria dizer
 *  ao pedir a divisão — o administrativo é quem ficou com tudo. */
const RESPONDE_COMO = {
  gerente_admin: 'gerente',
  gerente_comercial: 'gerente',
  financeiro: 'gerente',
  contador: 'gerente',
  // A secretária marca, remarca e conclui horário: é `profissional` na agenda.
  // O que ela NÃO alcança está recortado em ALCANCE_DO_PAPEL, inclusive o
  // prontuário — que `profissional` alcança e ela não.
  secretaria: 'profissional'
};

function papelEfetivo(papel) {
  return RESPONDE_COMO[papel] || papel;
}

const ALCANCE_DO_PAPEL = {
  /* SECRETÁRIA(O) — a recepção. Agenda, paciente, funil e conversa.
   *
   * FORA de propósito: dinheiro (finance, pricing, custos, relatórios),
   * usuários, e o PRONTUÁRIO. As duas linhas de `/api/clients` abaixo usam
   * `padrao` justamente para isso: `/api/clients` e `/api/clients/:id` passam,
   * `/api/clients/:id/documents` não — um prefixo solto levaria o filho junto,
   * que é a armadilha já anotada no topo deste arquivo.
   *
   * Se a clínica decidir que a recepção imprime receita, o conserto é uma linha
   * aqui, e não mexer na tabela de cima. */
  secretaria: { modo: 'somente', rotas: [
    { metodo: '*', prefixo: '/api/auth' },
    { metodo: '*', prefixo: '/api/config' },
    { metodo: '*', prefixo: '/api/meu-timbre' },
    { metodo: 'GET', prefixo: '/api/clinica' },
    { metodo: '*', prefixo: '/api/profissionais' },
    { metodo: '*', prefixo: '/api/appointments' },
    { metodo: '*', prefixo: '/api/availability' },
    { metodo: '*', padrao: /^\/api\/clients(\/[^/]+)?$/ },
    { metodo: '*', prefixo: '/api/interactions' },
    { metodo: '*', prefixo: '/api/leads' },
    { metodo: '*', prefixo: '/api/evolution' },
    { metodo: 'GET', prefixo: '/api/loyalty' },
    { metodo: 'GET', prefixo: '/api/treatment-catalog' },
    { metodo: '*', prefixo: '/api/treatments' },
    { metodo: '*', prefixo: '/api/treatment-plans' },
    { metodo: '*', prefixo: '/api/treatment-sessions' }
  ] },

  /* FINANCEIRO — caixa, contas, custo e preço. Não abre prontuário, não mexe
   * na agenda (lê, para conferir o que gerou receita) e não cadastra ninguém.
   *
   * `/api/clients` entra em GET e recortado pelo mesmo `padrao` da secretária:
   * conciliar um pagamento exige o NOME da paciente, não a ficha clínica. */
  financeiro: { modo: 'somente', rotas: [
    { metodo: '*', prefixo: '/api/auth' },
    { metodo: '*', prefixo: '/api/config' },
    { metodo: '*', prefixo: '/api/meu-timbre' },
    { metodo: 'GET', prefixo: '/api/clinica' },
    { metodo: '*', prefixo: '/api/finance' },
    { metodo: '*', prefixo: '/api/fixed-costs' },
    { metodo: '*', prefixo: '/api/recurring-expenses' },
    { metodo: '*', prefixo: '/api/pricing' },
    { metodo: '*', prefixo: '/api/reports' },
    { metodo: '*', prefixo: '/api/dashboard' },
    { metodo: 'GET', prefixo: '/api/products' },
    { metodo: 'GET', prefixo: '/api/stock' },
    { metodo: 'GET', prefixo: '/api/services' },
    { metodo: 'GET', prefixo: '/api/treatment-catalog' },
    { metodo: 'GET', prefixo: '/api/appointments' },
    { metodo: 'GET', padrao: /^\/api\/clients(\/[^/]+)?$/ }
  ] },

  /* CONTADOR — de fora da clínica, e por isso SÓ LEITURA.
   *
   * Todas as linhas são `GET`, menos `/api/auth` (ele precisa entrar) e
   * `/api/config`. Não há paciente nenhum nesta lista: o contador trabalha com
   * lançamento, categoria e total — nome de paciente não entra em livro
   * contábil, e dar acesso "porque é mais fácil" é o caminho mais curto para
   * dado de saúde sair da clínica dentro de uma planilha. */
  contador: { modo: 'somente', rotas: [
    { metodo: '*', prefixo: '/api/auth' },
    { metodo: '*', prefixo: '/api/config' },
    { metodo: 'GET', prefixo: '/api/meu-timbre' },
    { metodo: 'GET', prefixo: '/api/clinica' },
    { metodo: 'GET', prefixo: '/api/finance' },
    { metodo: 'GET', prefixo: '/api/fixed-costs' },
    { metodo: 'GET', prefixo: '/api/recurring-expenses' },
    { metodo: 'GET', prefixo: '/api/reports' },
    { metodo: 'GET', prefixo: '/api/dashboard' }
  ] },

  /* GERENTE COMERCIAL — gerente em tudo, menos na estrutura de custo.
   *
   * Aqui o modo é `exceto` de propósito, e a diferença importa: ele é gerente,
   * então rota nova tem de nascer ABERTA para ele, como nasce para o gerente de
   * hoje. Uma lista `somente` o deixaria de fora de cada módulo novo até alguém
   * lembrar de acrescentar a linha.
   *
   * `/api/reports` NÃO está na lista, e é escolha: o relatório é onde ele vê
   * conversão, origem de lead e ticket — o resultado do trabalho dele. O que
   * fica fora é a estrutura de custo da clínica (o que cada hora custa, a
   * margem praticada, o caixa), que é do administrativo. */
  gerente_comercial: { modo: 'exceto', rotas: [
    { metodo: '*', prefixo: '/api/finance' },
    { metodo: '*', prefixo: '/api/pricing' },
    { metodo: '*', prefixo: '/api/fixed-costs' },
    { metodo: '*', prefixo: '/api/recurring-expenses' },
    { metodo: '*', prefixo: '/api/dashboard/dinheiro' }
  ] }
};

/** O papel alcança este caminho? Papel sem recorte alcança tudo (e continua
 *  sujeito à tabela REGRAS_DE_PAPEL, que é a outra metade da decisão). */
function alcanca(papel, metodo, caminho) {
  const r = ALCANCE_DO_PAPEL[papel];
  if (!r) return true;
  const bate = r.rotas.some(function (linha) {
    return (linha.metodo === '*' || linha.metodo === metodo) && casaPadrao(linha, caminho);
  });
  return r.modo === 'exceto' ? !bate : bate;
}

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
  const papel = req.usuario && req.usuario.papel;

  // O RECORTE VEM PRIMEIRO. Ele é o que fecha a rota que ninguém regrou: sem
  // esta conferência, um papel estreito cairia na regra "sem regra, pode" e
  // herdaria cada módulo novo em silêncio.
  if (!alcanca(papel, req.method, caminho)) {
    return res.status(403).json({ error: 'Sem permissao para esta area.' });
  }

  const regra = regraPara(req.method, caminho);
  if (!regra) return next();
  if (!papel || regra.papeis.indexOf(papelEfetivo(papel)) === -1) {
    return res.status(403).json({ error: 'Sem permissao para esta area.' });
  }
  next();
}

module.exports = {
  REGRAS_DE_PAPEL, regraPara, exigirPapel,
  ALCANCE_DO_PAPEL, RESPONDE_COMO, alcanca, papelEfetivo
};

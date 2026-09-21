'use strict';
/** A camada de acesso por clínica (M0.4) e a catraca da M1.
 *
 *  O coração aqui é o analisador de SQL. Se ele contar um `?` a mais ou a
 *  menos, todos os parâmetros seguintes deslizam uma casa — e deslizar
 *  parâmetro não dá erro de sintaxe: dá **resultado errado**. Um `WHERE
 *  clinica_id = ?` que recebe o valor da coluna seguinte devolve linhas da
 *  clínica errada, calado. Por isso os casos abaixo são chatos de propósito.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const escopo = require('../server/db/escopo');
const naoConvertidos = require('../server/db/nao-convertidos');

const CL = 'cl_1';

/* ============================================================ o analisador */

test('a marca vira ? e o valor da clinica entra na posicao dela', function () {
  const p = escopo.preparar(
    'SELECT * FROM clients WHERE clinica_id = :clinica AND status = ?', ['ativo'], CL);
  assert.strictEqual(p.sql, 'SELECT * FROM clients WHERE clinica_id = ? AND status = ?');
  assert.deepStrictEqual(p.params, [CL, 'ativo']);
});

test('a marca no MEIO nao desalinha os parametros', function () {
  const p = escopo.preparar(
    'SELECT * FROM a WHERE x = ? AND clinica_id = :clinica AND y = ?', [1, 2], CL);
  assert.deepStrictEqual(p.params, [1, CL, 2]);
});

test('a marca no FIM tambem', function () {
  const p = escopo.preparar('SELECT * FROM a WHERE x = ? AND clinica_id = :clinica', [9], CL);
  assert.deepStrictEqual(p.params, [9, CL]);
});

test('a marca repetida entra em todas as posicoes', function () {
  const p = escopo.preparar(
    'SELECT * FROM a JOIN b ON b.clinica_id = :clinica WHERE a.clinica_id = :clinica AND z = ?',
    ['z'], CL);
  assert.deepStrictEqual(p.params, [CL, CL, 'z']);
});

test('dois-pontos dentro de literal NAO vira marca', function () {
  // O caso real deste projeto: DATE_FORMAT(x, '%Y-%m-%d %H:%i:%s'). Se o
  // analisador enxergasse `:s` ou `:i` como marca, tudo desliza.
  const sql = "SELECT DATE_FORMAT(x, '%Y-%m-%d %H:%i:%s') AS q FROM a " +
              'WHERE clinica_id = :clinica AND id = ?';
  const p = escopo.preparar(sql, ['x1'], CL);
  assert.deepStrictEqual(p.params, [CL, 'x1']);
  assert.ok(p.sql.includes("'%Y-%m-%d %H:%i:%s'"), 'o literal tem de sair intacto');
});

test('interrogacao dentro de literal NAO conta como parametro', function () {
  const sql = "SELECT * FROM a WHERE clinica_id = :clinica AND msg = 'tudo bem?' AND id = ?";
  const p = escopo.preparar(sql, ['x1'], CL);
  assert.deepStrictEqual(p.params, [CL, 'x1']);
});

test('aspas escapadas nao confundem o fim do literal', function () {
  const sql = "SELECT * FROM a WHERE clinica_id = :clinica AND n = 'D''Avila' AND id = ?";
  const p = escopo.preparar(sql, [7], CL);
  assert.deepStrictEqual(p.params, [CL, 7]);

  const sql2 = 'SELECT * FROM a WHERE clinica_id = :clinica AND n = "D\\"Avila" AND id = ?';
  assert.deepStrictEqual(escopo.preparar(sql2, [7], CL).params, [CL, 7]);
});

test('crase (nome de coluna) tambem e literal para o analisador', function () {
  const p = escopo.preparar('SELECT `a?b` FROM t WHERE clinica_id = :clinica AND id = ?', [3], CL);
  assert.deepStrictEqual(p.params, [CL, 3]);
});

test('comentario nao vira marca nem parametro', function () {
  const sql = 'SELECT * FROM a\n' +
              '-- por que? porque :clinica aqui e comentario\n' +
              '/* e ? aqui tambem */\n' +
              'WHERE clinica_id = :clinica AND id = ?';
  const p = escopo.preparar(sql, [5], CL);
  assert.deepStrictEqual(p.params, [CL, 5]);
});

test('`:clinicas` NAO e a marca `:clinica`', function () {
  // Sem a checagem do caractere seguinte, `:clinica` casaria dentro de
  // `:clinicas` e deixaria um `s` solto na SQL.
  assert.throws(() => escopo.exigirFiltro('SELECT * FROM a WHERE x = :clinicas'),
    /sem `:clinica`/);
});

test('parametro a mais ou a menos e acusado com mensagem util', function () {
  assert.throws(
    () => escopo.preparar('SELECT * FROM a WHERE clinica_id = :clinica AND x = ?', [], CL),
    /1 parametro\(s\) `\?` e voce passou 0/);
  assert.throws(
    () => escopo.preparar('SELECT * FROM a WHERE clinica_id = :clinica', [1, 2], CL),
    /0 parametro\(s\) `\?` e voce passou 2/);
});

/* ==================================================== as duas conferencias */

test('consulta SEM a marca e recusada', function () {
  assert.throws(() => escopo.exigirFiltro('SELECT * FROM clients'), /sem `:clinica`/);
});

test('a recusa ensina o que fazer, inclusive a saida legitima', function () {
  try {
    escopo.exigirFiltro('SELECT * FROM clients');
    assert.fail('devia ter recusado');
  } catch (e) {
    assert.match(e.message, /WHERE clinica_id = :clinica/);
    assert.match(e.message, /todasAsClinicas/);
  }
});

test('marca sem a COLUNA nao passa', function () {
  // `SELECT :clinica AS x FROM clients` tem a marca e nao filtra nada. Era o
  // atalho obvio para calar a camada.
  assert.throws(() => escopo.exigirFiltro('SELECT :clinica AS x FROM clients'),
    /nao menciona a coluna `clinica_id`/);
});

test('a coluna citada so dentro de literal nao vale', function () {
  assert.throws(
    () => escopo.exigirFiltro("SELECT :clinica AS x, 'clinica_id' AS y FROM clients"),
    /nao menciona a coluna `clinica_id`/);
});

test('consulta correta passa nas duas conferencias', function () {
  escopo.exigirFiltro('SELECT * FROM clients WHERE clinica_id = :clinica');
  escopo.exigirFiltro('SELECT * FROM a JOIN b ON b.clinica_id = a.clinica_id ' +
                      'WHERE a.clinica_id = :clinica');
});

/* ========================================================= a clinica vem da sessao */

test('escopo(req) recusa requisicao sem sessao', function () {
  assert.throws(() => escopo({}), /sem clinica na sessao/);
  assert.throws(() => escopo({ usuario: {} }), /sem clinica na sessao/);
  assert.throws(() => escopo(null), /sem clinica na sessao/);
});

test('a clinica NAO pode vir do corpo nem do endereco', function () {
  // Se viesse, bastaria trocar um numero na requisicao para ler a clinica do
  // vizinho. O teste finge a tentativa mais obvia.
  const req = { body: { clinicaId: 'cl_9' }, params: { clinicaId: 'cl_9' }, query: { clinicaId: 'cl_9' } };
  assert.throws(() => escopo(req), /sem clinica na sessao/);
});

test('com sessao, o escopo usa a clinica da sessao', async function () {
  const visto = [];
  const db = escopo.fazerEscopo('cl_7', { query: async (s, p) => { visto.push({ s, p }); return [[]]; } });
  await db.q('SELECT * FROM clients WHERE clinica_id = :clinica AND id = ?', ['c1']);
  assert.deepStrictEqual(visto[0].p, ['cl_7', 'c1']);
});

test('escopo sem clinica nao chega a existir', function () {
  assert.throws(() => escopo.fazerEscopo(null, { query: async () => [[]] }), /sem clinica/);
  assert.throws(() => escopo.fazerEscopo('', { query: async () => [[]] }), /sem clinica/);
});

test('a consulta so chega ao banco depois de conferida', async function () {
  let chegou = false;
  const db = escopo.fazerEscopo(CL, { query: async () => { chegou = true; return [[]]; } });
  await assert.rejects(() => db.q('SELECT * FROM clients', []), /sem `:clinica`/);
  assert.strictEqual(chegou, false, 'consulta sem filtro nao pode nem tocar o banco');
});

/* ==================================================================== transacao */

test('a transacao usa a conexao do executor, nao o pool do modulo', async function () {
  // Sem isto, um escopo montado sobre executor de mentira abre conexao de
  // verdade -- e teste de servico passa a precisar de MySQL. Travou a suite
  // duas vezes neste projeto.
  let pegou = 0;
  let comitou = false;
  const vistas = [];
  const conn = {
    query: async (s, p) => { vistas.push({ s: s, p: p }); return [[]]; },
    beginTransaction: async () => {},
    commit: async () => { comitou = true; },
    rollback: async () => {},
    release: () => {}
  };
  const db = escopo.fazerEscopo(CL, {
    query: async () => [[]],
    getConnection: async () => { pegou += 1; return conn; }
  });

  await db.transacao(async function (tx) {
    await tx.q('INSERT INTO clients (id, clinica_id) VALUES (?, :clinica)', ['c1']);
  });

  assert.strictEqual(pegou, 1, 'tinha de pedir a conexao ao executor');
  assert.strictEqual(comitou, true);
  assert.deepStrictEqual(vistas[0].p, ['c1', CL], 'o tx tambem carimba a clinica');
});

test('transacao dentro de transacao e recusada, e a mensagem diz por que', async function () {
  // O caso grave: o escopo de dentro pegaria OUTRA conexao, e o rollback de
  // fora nao desfaria o que ela gravou. Metade do efeito aplicada, em silencio.
  const conn = {
    query: async () => [[]],
    beginTransaction: async () => {}, commit: async () => {},
    rollback: async () => {}, release: () => {}
  };
  const db = escopo.fazerEscopo(CL, {
    query: async () => [[]],
    getConnection: async () => conn
  });

  await assert.rejects(
    () => db.transacao(async (tx) => tx.transacao(async () => {})),
    /transacao dentro de transacao/);
});

test('a transacao desfaz e propaga o erro', async function () {
  let desfez = false;
  const conn = {
    query: async () => [[]],
    beginTransaction: async () => {}, commit: async () => {},
    rollback: async () => { desfez = true; }, release: () => {}
  };
  const db = escopo.fazerEscopo(CL, {
    query: async () => [[]], getConnection: async () => conn });

  await assert.rejects(() => db.transacao(async () => { throw new Error('estoque faltou'); }),
    /estoque faltou/);
  assert.strictEqual(desfez, true, 'erro dentro da transacao tem de desfazer');
});

/* ================================================= a saida para todas as clinicas */

test('todasAsClinicas exige motivo escrito', function () {
  assert.throws(() => escopo.todasAsClinicas(), /motivo escrito/);
  assert.throws(() => escopo.todasAsClinicas(''), /motivo escrito/);
  assert.throws(() => escopo.todasAsClinicas('porque sim'), /motivo escrito/);
});

test('com motivo, ela existe e guarda o motivo', function () {
  const t = escopo.todasAsClinicas('varredura de lembretes percorre todas as clinicas');
  assert.match(t.motivo, /varredura de lembretes/);
  assert.strictEqual(typeof t.q, 'function');
});

/* ================================================================== a catraca */

const DIR_SERVIDOR = path.join(__dirname, '..', 'server');

/** As pastas onde a catraca vale. `server/db/` fica FORA de propósito: é onde a
 *  camada mora, e ela é quem pode falar com o driver. */
const PASTAS = ['routes', 'services', 'workers', 'middleware'];

/** Ligação crua com o banco. Procura `.query(` e `.getConnection(` -- e não
 *  `pool.query(`, como fazia antes.
 *
 *  A diferença não é estética: `services/*` usam `conexao.query(` e
 *  `routes/migrate.js` usa outro nome ainda, e os dois passavam batidos pelo
 *  padrão antigo. O que a camada substitui é a CHAMADA (`.query`), não o nome
 *  da variável -- a camada oferece `.q(`, que este padrão não casa.
 *
 *  Comentário conta como uso, de propósito: `.query(` comentado é sinal de
 *  conversão pela metade (alguém comentou em vez de converter). */
function usaBancoDireto(relativo) {
  const fonte = fs.readFileSync(path.join(DIR_SERVIDOR, relativo), 'utf8');

  // ============================ O TERCEIRO FURO DA VARREDURA (09/09, M1.4)
  //
  // Faltava o caso de **entregar o pool a outra pessoa**.
  // `routes/expiracao-pontos.js` nao chama `.query(` em lugar nenhum: ele
  // importa o pool e o passa para o worker. Pela busca anterior, o arquivo
  // parecia convertido -- e a catraca acusou o contrario, porque ele estava na
  // lista de proposito.
  //
  // Entao o sinal certo nao e so a CHAMADA: e ter acesso cru ao banco. Arquivo
  // convertido importa `../db/escopo`; arquivo nao convertido importa `../db`.
  // A distincao entre os dois caminhos e o que este padrao mede.
  if (/require\(['"]\.\.\/db['"]\)/.test(fonte)) return true;

  return /\.query\s*\(|\.getConnection\s*\(/.test(fonte);
}

/** O fonte sem comentario, para varredura que procura CHAMADA de funcao.
 *
 *  Nasceu de um tropeço meu: o cabeçalho de `routes/expiracao-pontos.js`
 *  explica que a varredura do cron vai passar a usar `todasAsClinicas`, e a
 *  busca por `todasAsClinicas(` casou dentro do próprio comentário. A guarda
 *  acusou um arquivo que só FALAVA da função.
 *
 *  Não é um analisador de JavaScript e não precisa ser: apaga bloco `/* *\/`
 *  e linha `//`. Uma barra dupla dentro de texto (um endereço, por exemplo)
 *  também vai embora, e isso não afeta nada que esta varredura procure. */
function semComentarios(fonte) {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

/** Todos os arquivos das quatro pastas, como `pasta/arquivo.js`. */
function arquivosDoServidor() {
  const saida = [];
  for (const pasta of PASTAS) {
    const dir = path.join(DIR_SERVIDOR, pasta);
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.js')) saida.push(pasta + '/' + f);
    }
  }
  return saida;
}

test('a varredura da catraca enxerga codigo de verdade', function () {
  // Guarda da guarda. Se um nome de pasta mudar, `arquivosDoServidor` devolve
  // menos arquivos, a lista de "usa banco direto" encurta, e os dois testes
  // abaixo passariam APROVANDO tudo. Ja aconteceu quatro vezes neste projeto
  // uma conferencia passar sem exercitar nada; aqui a contagem minima acusa.
  //
  // Os pisos sao FOLGADOS de proposito (39 e 25 hoje). Piso justo teria de ser
  // corrigido a cada arquivo novo, e piso que se corrige toda semana deixa de
  // ser conferido. O que ele precisa pegar e a queda brusca -- pasta renomeada,
  // padrao que parou de casar --, nao a variacao de um arquivo.
  const todos = arquivosDoServidor();
  assert.ok(todos.length >= 30, 'a varredura achou so ' + todos.length +
    ' arquivo(s) em server/{' + PASTAS.join(',') + '}. Pasta renomeada?');

  // O piso do OUTRO lado nao pode ser um numero fixo: ele cai a cada tarefa da
  // M1, e piso que se corrige toda semana deixa de ser conferido -- foi por
  // isso que este teste falhou na M1.2, sem nada ter piorado.
  //
  // O piso certo e a propria catraca: a varredura tem de achar pelo menos
  // tantos arquivos quantos a lista conhece. Se o padrao parar de casar, este
  // numero desaba junto e a conferencia acusa -- e ele se ajusta sozinho a cada
  // modulo convertido, sem ninguem ter de lembrar.
  const comBanco = todos.filter(usaBancoDireto);
  assert.ok(comBanco.length >= naoConvertidos.length,
    'a varredura achou ' + comBanco.length + ' arquivo(s) falando com o banco direto, ' +
    'e a catraca conhece ' + naoConvertidos.length + '. O padrao de busca ' +
    'provavelmente parou de casar.');
});

test('a varredura pega quem ENTREGA o pool, e nao so quem o chama', function () {
  // O EXEMPLO MUDOU DE ARQUIVO, e a troca vale ser lida.
  //
  // Este teste nasceu apontando para `routes/expiracao-pontos.js`, que importava
  // o pool e o passava ao worker sem nunca chamar `.query` -- pela busca antiga
  // ele parecia convertido. Na M2.3 aquele arquivo passou a usar a camada e
  // deixou de servir de exemplo.
  //
  // O sujeito passou a ser `middleware/autenticacao.js`, que faz exatamente a
  // mesma coisa e por um motivo permanente: ele entrega o pool a
  // `cron.identidadeDeCron`, que precisa ler o token do cron ANTES de existir
  // sessao. Ele nunca chamou `.query` e nunca vai chamar.
  //
  // Guarda contra o teste apodrecer: se o sujeito passar a chamar `.query`, o
  // primeiro assert derruba o teste em vez de deixa-lo medir outra coisa. Foi
  // assim que este teste avisou, hoje, que o exemplo antigo tinha sumido.
  const alvo = 'middleware/autenticacao.js';
  const fonte = semComentarios(fs.readFileSync(path.join(DIR_SERVIDOR, alvo), 'utf8'));
  assert.ok(!/\.query\s*\(/.test(fonte),
    'este teste depende de ' + alvo + ' NAO chamar .query -- se passou a chamar, ' +
    'escolha outro entregador de pool e explique a troca aqui');
  assert.ok(/require\(['"]\.\.\/db['"]\)/.test(fonte),
    alvo + ' precisa continuar importando `../db` para este teste fazer sentido');
  assert.strictEqual(usaBancoDireto(alvo), true,
    'quem importa `../db` tem acesso cru ao banco, chame .query ou nao');
});

test('a varredura nao confunde `../db` com `../db/escopo`', function () {
  // Se o padrao casasse os dois, TODO arquivo convertido voltaria a parecer
  // cru, a catraca reclamaria de tudo, e o jeito facil de calar seria afrouxar
  // o padrao de novo.
  const fonte = fs.readFileSync(path.join(DIR_SERVIDOR, 'routes/clients.js'), 'utf8');
  assert.ok(/require\(['"]\.\.\/db\/escopo['"]\)/.test(fonte), 'clients.js importa a camada');
  assert.strictEqual(usaBancoDireto('routes/clients.js'), false);
});

test('a varredura distingue convertido de nao convertido', function () {
  // O outro lado da moeda: um padrao que casa TUDO tambem passaria nos testes
  // acima. Estes tres arquivos estao convertidos e nao podem ser detectados.
  for (const f of ['routes/clients.js', 'routes/treatments.js', 'routes/treatment-plans.js',
                   'routes/appointments.js', 'services/atendimento-concluido.js',
                   'services/efeitos-financeiro.js', 'services/efeitos-estoque.js',
                   'services/efeitos-fidelidade.js',
                   'routes/finance.js', 'routes/pricing.js', 'routes/reports.js',
                   'routes/stock.js', 'routes/loyalty.js', 'routes/documents.js']) {
    assert.strictEqual(usaBancoDireto(f), false,
      f + ' esta convertido e a varredura o detectou como cru -- o padrao casa demais.');
  }
});

test('todo arquivo que fala com o banco direto esta na catraca', function () {
  const fora = arquivosDoServidor()
    .filter(usaBancoDireto)
    .filter((f) => naoConvertidos.indexOf(f) === -1);

  assert.deepStrictEqual(fora, [],
    'Estes arquivos falam com o banco direto sem estar na catraca:\n  ' + fora.join('\n  ') +
    '\nOu converta para escopo(req) / escopo.todasAsClinicas(motivo), ou acrescente a ' +
    'server/db/nao-convertidos.js com o numero da tarefa da M1. Arquivo novo NAO entra ' +
    'na catraca: ja nasce convertido.');
});

test('a catraca so encolhe: item que nao usa mais o banco direto tem de sair', function () {
  const sobrando = naoConvertidos.filter(function (f) {
    if (!fs.existsSync(path.join(DIR_SERVIDOR, f))) return true;   // arquivo sumiu
    return !usaBancoDireto(f);
  });

  assert.deepStrictEqual(sobrando, [],
    'Estes ja nao falam com o banco direto e continuam na catraca:\n  ' + sobrando.join('\n  ') +
    '\nTire-os de server/db/nao-convertidos.js. Lista que nao encolhe vira decoracao, ' +
    'e ninguem percebe quando ela para de proteger.');
});

test('a catraca nao tem nome repetido nem arquivo inexistente', function () {
  assert.strictEqual(new Set(naoConvertidos).size, naoConvertidos.length, 'nome repetido');
  for (const f of naoConvertidos) {
    assert.ok(fs.existsSync(path.join(DIR_SERVIDOR, f)), f + ' nao existe em server/');
  }
});

test('a catraca usa caminho com pasta, nao so o nome do arquivo', function () {
  // `logs.js` existe em routes/ E em services/. Nome solto na lista deixaria
  // ambiguo qual dos dois foi convertido -- e o teste de cima aprovaria o
  // errado.
  for (const f of naoConvertidos) {
    assert.match(f, /^(routes|services|workers|middleware)\/[a-z0-9-]+\.js$/,
      f + ': escreva o caminho a partir de server/, com a pasta.');
  }
});

test('o tamanho da catraca hoje, para o progresso da M1 ser visivel', function () {
  // Este numero DEVE cair a cada tarefa da M1. Quando chegar a zero, apague
  // nao-convertidos.js e os testes acima.
  assert.strictEqual(naoConvertidos.length, 4,
    'a catraca mudou de tamanho -- atualize este numero junto, de proposito: ' +
    'e o registro de que alguem olhou.');
});

/* ================================================ todo arquivo de rota e montado
 *
 * Guarda nascida de um erro meu em 08/09: `routes/lembretes.js` foi criado,
 * enviado ao servidor com o hash conferido, e **nunca montado no app.js** --
 * a edicao do app.js estava atras de um `&&` num comando que falhou antes, e eu
 * nao conferi a saida.
 *
 * O sintoma foi o pior possivel: as quatro rotas de lembrete simplesmente nao
 * existiam. Nenhum erro no boot, nenhum teste vermelho, e a conferencia de hash
 * passou -- porque hash prova que o arquivo CHEGOU inteiro, nao que ele foi
 * LIGADO em coisa nenhuma.
 *
 * Arquivo de rota nao montado e codigo morto que parece vivo. Este teste conta
 * os dois lados: rota no disco que ninguem monta, e rota montada que nao existe
 * mais no disco.
 */

const APP = path.join(DIR_SERVIDOR, 'app.js');

test('todo arquivo de server/routes/ esta montado no app.js', function () {
  const fonte = fs.readFileSync(APP, 'utf8');
  const noDisco = fs.readdirSync(path.join(DIR_SERVIDOR, 'routes'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => f.replace(/\.js$/, ''));

  assert.ok(noDisco.length >= 15, 'so ' + noDisco.length + ' arquivo(s) em server/routes/?');

  const naoMontados = noDisco.filter(function (nome) {
    return fonte.indexOf("./routes/" + nome + "'") === -1 &&
           fonte.indexOf('./routes/' + nome + '"') === -1;
  });

  assert.deepStrictEqual(naoMontados, [],
    'Estes arquivos de rota NAO estao montados em server/app.js:\n  ' + naoMontados.join('\n  ') +
    '\nAs rotas deles nao existem para o mundo, e nada da erro: nem o boot, nem a ' +
    'suite, nem a conferencia de hash do envio. Acrescente o `app.use(require(...))`.');
});

test('todo require de rota no app.js aponta para arquivo que existe', function () {
  const fonte = fs.readFileSync(APP, 'utf8');
  const montados = (fonte.match(/\.\/routes\/[a-z0-9-]+/g) || [])
    .map((m) => m.replace('./routes/', ''));

  assert.ok(montados.length >= 15, 'o app.js monta so ' + montados.length + ' rota(s)?');

  const sumidos = montados.filter(function (nome) {
    return !fs.existsSync(path.join(DIR_SERVIDOR, 'routes', nome + '.js'));
  });
  assert.deepStrictEqual(sumidos, [],
    'O app.js monta rotas que nao existem no disco:\n  ' + sumidos.join('\n  ') +
    '\nIsso derruba o boot inteiro -- mas so no servidor, e so na hora de publicar.');
});

test('as rotas recortadas sao montadas ANTES do modulo de onde sairam', function () {
  // Duas vezes o mesmo padrao: uma rota que o cron chama foi recortada para
  // arquivo proprio, e o caminho dela comeca com o prefixo do modulo original.
  // Hoje nao colidem (dois segmentos contra um), mas o dia em que alguem criar
  // `/api/loyalty/:id` a ordem passa a decidir -- e o sintoma sera um 404 que
  // manda procurar o defeito no lugar errado.
  const fonte = fs.readFileSync(APP, 'utf8');
  for (const [antes, depois] of [
    ['./routes/expiracao-pontos', './routes/loyalty'],
    // `leads-publico` declara POST /api/leads, o MESMO caminho que o modulo de
    // onde saiu. Aqui a colisao nao e hipotetica como as outras duas: se
    // `leads.js` viesse antes e um dia declarasse um POST, a captacao publica
    // pararia de gravar -- e o sintoma seria "o site parou de trazer cliente",
    // sem erro nenhum em tela.
    ['./routes/leads-publico', './routes/leads'],
    // `webhook-whatsapp` declara POST /api/webhook/whatsapp, caminho que
    // `evolution.js` nao declara mais -- entao hoje nao colidem. A ordem esta
    // fixada porque o recorte foi feito por ausencia de sessao, e o dia em que
    // alguem devolver uma rota `/api/webhook/...` ao modulo original, a ordem
    // decide qual responde.
    ['./routes/webhook-whatsapp', './routes/evolution']
  ]) {
    // A busca e pela EXPRESSAO INTEIRA, e nao pelo prefixo: `'./routes/leads'`
    // e substring de `'./routes/leads-publico'`, entao a versao por prefixo
    // encontrava o recorte quando procurava o original e o teste falhava
    // apontando o contrario do que era verdade. Pego pelo proprio teste, em
    // 09/09, no minuto em que ele nasceu.
    const i = fonte.indexOf("require('" + antes + "')");
    const j = fonte.indexOf("require('" + depois + "')");
    assert.ok(i !== -1 && j !== -1, antes + ' e ' + depois + ' tem de estar montados');
    assert.ok(i < j, antes + ' tem de vir antes de ' + depois + ' no app.js');
  }
});

test('as rotas de lembrete sao montadas ANTES das da agenda', function () {
  // As quatro comecam com /api/appointments/. Hoje elas tem dois segmentos e o
  // `/api/appointments/:id` da agenda tem um, entao nao colidem -- mas o dia em
  // que alguem criar `/api/appointments/reminders` com um segmento so, a ordem
  // passa a decidir, e o sintoma sera um 404 "compromisso nao encontrado" que
  // manda procurar o defeito no lugar errado.
  const fonte = fs.readFileSync(APP, 'utf8');
  const iLembretes = fonte.indexOf('./routes/lembretes');
  const iAgenda = fonte.indexOf('./routes/appointments');
  assert.ok(iLembretes !== -1 && iAgenda !== -1, 'as duas tem de estar montadas');
  assert.ok(iLembretes < iAgenda,
    'routes/lembretes tem de vir antes de routes/appointments no app.js');
});


/* ================== QUEM AINDA MANDA WHATSAPP SEM DIZER DE QUE NUMERO -- M2.1b
 *
 * `sendWhatsappText(numero, texto, instancia)` ganhou o terceiro argumento na
 * M2.1a. Sem ele, a funcao resolve a instancia GLOBALMENTE -- o que estava certo
 * com uma clinica e vira, com 50, a mensagem saindo do numero de WhatsApp de
 * outro consultorio. A paciente responde para a clinica errada, e ela e a unica
 * pessoa que nunca vai entender o que aconteceu.
 *
 * A queda global nao foi removida na M2.1a porque tres pontos de chamada ainda
 * nao sabem a clinica. Ela GRITA no console a cada uso, e esta lista existe para
 * a divida nao virar permanente. **Tem de chegar a zero na M2.1b.**
 */

/** Quantos argumentos cada chamada de `nome(` recebe, contando de verdade:
 *  parenteses aninhados e virgulas dentro deles nao confundem.
 *
 *  Existe porque a versao por expressao regular errava para
 *  `f(a, String(b), c)` -- parava no `)` interno e via dois argumentos onde ha
 *  tres. Virgula nao e separador confiavel em texto de codigo. */
function argumentosDe(fonte, nome) {
  const contagens = [];
  let i = 0;
  while ((i = fonte.indexOf(nome + '(', i)) !== -1) {
    let j = i + nome.length + 1;
    let nivel = 1, args = 1, vazio = true;
    while (j < fonte.length && nivel > 0) {
      const ch = fonte[j];
      if (ch === '(') nivel += 1;
      else if (ch === ')') nivel -= 1;
      else if (ch === ',' && nivel === 1) args += 1;
      else if (nivel === 1 && !/\s/.test(ch)) vazio = false;
      j += 1;
    }
    contagens.push(vazio ? 0 : args);
    i = j;
  }
  return contagens;
}

const SEM_INSTANCIA = {
  // VAZIO desde a M2.1b. Os quatro que estavam aqui foram resolvidos:
  // `routes/interactions.js` e `routes/evolution.js` passaram a ler a instância
  // da clínica; `routes/lembretes.js` e `index.js` entregam a função ao worker,
  // e o worker passou a chamá-la com a instância de cada clínica que percorre.
  //
  // A lista fica: é ela que impede a queda global de voltar em silêncio.
};

test('a divida do envio sem instancia e exatamente a declarada', function () {
  // `index.js` NAO esta em `arquivosDoServidor()` -- a varredura da catraca olha
  // as quatro pastas de codigo, e a raiz do servidor nao e uma delas. Mas e la
  // que o worker de lembretes e ligado (`lembretes.iniciar(pool,
  // sendWhatsappText)`), ou seja e o quarto responsavel. Terceira vez neste
  // projeto que uma varredura precisou ser alargada, e sempre pelo mesmo
  // motivo: ela olhava onde o autor esperava encontrar.
  const alvos = arquivosDoServidor().concat(['index.js']);

  const achados = alvos.filter(function (f) {
    if (f === 'services/evolution.js') return false;      // e quem define a funcao
    const fonte = semComentarios(fs.readFileSync(path.join(DIR_SERVIDOR, f), 'utf8'));

    // 1) quem CHAMA com menos de tres argumentos.
    //
    // Contar virgulas NAO serve, e isto foi medido: `sendWhatsappText(numero,
    // String(texto), instancia)` tem tres argumentos -- mas a expressao regular
    // parava no primeiro `)`, que e o do `String(`, e a chamada aparecia com
    // dois. A varredura acusou uma rota que estava CERTA.
    //
    // Entao os argumentos sao contados de verdade, respeitando parenteses.
    if (argumentosDe(fonte, 'sendWhatsappText').some((n) => n > 0 && n < 3)) return true;

    // 2) quem ENTREGA a funcao para outro chamar sai desta conta desde a M2.1b,
    // e a razao esta escrita para ninguem "restaurar" a checagem sem pensar:
    // quem recebe a funcao e o worker, e ele agora a chama COM a instancia de
    // cada clinica que percorre. Marcar quem entrega passaria a ser um alarme
    // falso permanente -- e alarme que nao pode ser resolvido e alarme que
    // alguem desliga.
    //
    // O que garante o caminho indireto e o assert abaixo, sobre a chamada do
    // proprio worker. Ele e especifico de proposito: e o unico lugar onde a
    // instancia atravessa a indirecao.
    return false;
  });

  const naoDeclarados = achados.filter((f) => !SEM_INSTANCIA[f]);
  assert.deepStrictEqual(naoDeclarados, [],
    'Estes mandam WhatsApp sem dizer de qual instancia, e nao estao declarados:\n  ' +
    naoDeclarados.join('\n  ') +
    '\nCom mais de uma clinica, a mensagem sai do numero do consultorio errado.');

  const jaResolvidos = Object.keys(SEM_INSTANCIA).filter((f) => achados.indexOf(f) === -1);
  assert.deepStrictEqual(jaResolvidos, [],
    'Estes estao declarados como "mandam sem instancia" mas ja passam a instancia:\n  ' +
    jaResolvidos.join('\n  ') + '\nTire-os de SEM_INSTANCIA. A lista so encolhe.');

  assert.strictEqual(Object.keys(SEM_INSTANCIA).length, 0,
    'a divida mudou de tamanho -- atualize este numero de proposito. Zero aqui e ' +
    'o WhatsApp por clinica fechado.');
});

test('o worker de lembrete manda a instancia da clinica junto', function () {
  // Este e o assert que cobre a INDIRECAO: `routes/lembretes.js` e `index.js`
  // entregam a funcao de envio ao worker, e e o worker quem a chama. Uma
  // varredura de chamadas nao ve isso -- e foi por nao ver que a primeira
  // versao da conta acima marcava quem entrega, gerando alarme que ninguem
  // poderia resolver.
  const fonte = semComentarios(
    fs.readFileSync(path.join(DIR_SERVIDOR, 'workers', 'lembretes.js'), 'utf8'));
  const chamada = (fonte.match(/op\.enviar\(([^)]*)\)/) || [])[1];
  assert.ok(chamada, 'o worker precisa chamar `op.enviar(...)`');
  assert.strictEqual(chamada.split(',').length, 3,
    'op.enviar tem de receber telefone, texto E instancia. Com dois argumentos, ' +
    '`sendWhatsappText` resolve a instancia globalmente -- e o lembrete da ' +
    'clinica A sai do numero da clinica B.');
  assert.match(chamada, /cfg\.instancia/,
    'a instancia tem de vir da configuracao daquela clinica, e nao de outro lugar');
});

/* ============================ QUEM AINDA GRAVA SEM CLINICA -- o portao da M1.7
 *
 * A M1.7 volta a exigir `clinica_id NOT NULL`. O plano dizia que ela podia ser
 * feita "depois de a catraca esvaziar" -- e isso estava ERRADO, medido em 09/09,
 * ao fim da M1.6b.
 *
 * A catraca lista quem fala com o banco direto. Sobraram nove arquivos, e todos
 * sao excecao declarada: login, migrations, o porteiro, o token do cron, as duas
 * varreduras e o webhook. Ela nunca vai esvaziar -- essas excecoes sao
 * permanentes ou de M2. Esperar por isso seria esperar para sempre.
 *
 * O portao correto e outro, e mais estreito: **nenhum caminho pode INSERIR numa
 * tabela de clinica sem carimbar a clinica.** Com a coluna obrigatoria, um
 * INSERT sem ela nao fica invisivel: ele FALHA. E falhar aqui significa coisas
 * concretas -- a mensagem da paciente que chega pelo WhatsApp nao e gravada, e a
 * expiracao de pontos para de rodar.
 *
 * Este teste e a lista desse portao. Enquanto ela nao estiver vazia, a M1.7
 * quebra producao -- e o nome de quem falta esta escrito, com a tarefa que
 * resolve.
 */

/** Tabelas em que `clinica_id` sera obrigatoria na M1.7. Vem da migration 018,
 *  a mesma lista, e nao uma copia -- duas listas da mesma coisa divergem na
 *  terceira semana. */
const OBRIGATORIA = require(path.join(__dirname, '..', 'db', 'migrations', '018_clinicas.js'))
  .LISTAS.OBRIGATORIA;

/** Quem ainda grava sem clinica, e a tarefa que resolve. Esta lista SO ENCOLHE. */
const ESCREVEM_SEM_CLINICA = {
  // ================================================ VAZIO EM 10/09. O PORTAO ABRIU.
  //
  // Os dois que estavam aqui saíram por caminhos diferentes, e a diferença é o
  // que este projeto aprendeu:
  //
  //  - `routes/webhook-whatsapp.js` (M2.1a) faltava INFORMACAO, não filtro. A
  //    clínica passou a vir da instância que recebeu a mensagem -- o dado
  //    sempre esteve no envelope. Solução de esquema.
  //  - `workers/expiracao-pontos.js` (M2.3) faltava ESTRUTURA. A varredura virou
  //    duas camadas: o laço atravessa clínicas com motivo escrito, o trabalho de
  //    cada uma roda no escopo dela.
  //
  // Com a lista vazia, **a M1.7 está liberada**: nenhum caminho grava em tabela
  // de clínica sem carimbar a clínica, então tornar `clinica_id` obrigatória
  // não quebra nada em silêncio.
  //
  // A lista fica. Ela é o portão, e portão sem tranca não é portão: qualquer
  // gravação nova sem carimbo, em arquivo da catraca, volta a fechá-lo.
};

test('a M1.7 esta travada enquanto alguem gravar sem clinica', function () {
  const achados = {};

  for (const f of naoConvertidos) {
    const caminho = path.join(DIR_SERVIDOR, f);
    if (!fs.existsSync(caminho)) continue;
    const fonte = semComentarios(fs.readFileSync(caminho, 'utf8'));

    for (const m of fonte.matchAll(/INSERT INTO\s+([a-z_]+)\s*\(([^)]*)\)/gi)) {
      const tabela = m[1].toLowerCase();
      if (OBRIGATORIA.indexOf(tabela) === -1) continue;      // system_logs e settings: vazio tem significado
      if (/clinica_id/i.test(m[2])) continue;                 // carimba: tudo certo
      if (!achados[f]) achados[f] = [];
      if (achados[f].indexOf(tabela) === -1) achados[f].push(tabela);
    }
  }

  const inesperados = Object.keys(achados).filter((f) => !ESCREVEM_SEM_CLINICA[f]);
  assert.deepStrictEqual(inesperados, [],
    'Estes gravam em tabela de clinica SEM carimbar a clinica, e nao estao declarados:\n  ' +
    inesperados.map((f) => f + ' -> ' + achados[f].join(', ')).join('\n  ') +
    '\nOu passam a carimbar, ou entram em ESCREVEM_SEM_CLINICA com a tarefa que resolve.');

  // E o outro lado, para a lista nao virar decoracao: quem esta declarado tem de
  // estar mesmo gravando sem clinica. Resolveu? Sai daqui, e a M1.7 fica um
  // arquivo mais perto.
  const jaResolvidos = Object.keys(ESCREVEM_SEM_CLINICA).filter((f) => !achados[f]);
  assert.deepStrictEqual(jaResolvidos, [],
    'Estes estao declarados como "gravam sem clinica" mas nao gravam mais:\n  ' +
    jaResolvidos.join('\n  ') + '\nTire-os de ESCREVEM_SEM_CLINICA. A lista so encolhe.');
});

test('o portao da M1.7 diz, em numero, o que falta', function () {
  // Numero explicito para a queda aparecer, como o tamanho da catraca. Zero aqui
  // e a autorizacao para a M1.7 -- e ela nao chega esvaziando a catraca, chega
  // fechando a M2.1 e a M2.3.
  assert.strictEqual(Object.keys(ESCREVEM_SEM_CLINICA).length, 0,
    'o portao da M1.7 mudou de tamanho -- atualize este numero de proposito, e ' +
    'reveja no plano se a M1.7 ja pode ser feita. ZERO aqui e a autorizacao.');
});

/* ================================ o relatorio da migration volta na RESPOSTA
 *
 * Historia curta e vale por si: em 09/09 a migration 021 contou quantas linhas
 * preencheu e mandou a contagem para o `console.log`. O console do Node nao e
 * guardado em arquivo nenhum nesta instalacao, e o numero se perdeu.
 *
 * A regra que saiu dai foi "migration grava o relatorio em `system_logs`". E na
 * MESMA TARDE, a M1.6a fez a tela de logs filtrar por clinica -- e registro sem
 * clinica (que e o caso de todo relatorio de migration) deixou de aparecer em
 * tela nenhuma. A regra virou letra morta no dia em que foi escrita, por causa
 * de outra mudanca minha, feita uma hora antes.
 *
 * Por isso o relatorio agora volta TAMBEM na resposta de quem rodou a migration.
 * Este teste existe para que ninguem "simplifique" o runner descartando o
 * retorno: e o unico caminho que nao depende de haver tela.
 */

test('o runner devolve o que a migration devolveu, e a 022 devolve o numero', async function () {
  const runner = require(path.join(__dirname, '..', 'db', 'run-migrations.js'));

  // Banco de mentira: a 022 faz duas contagens e duas gravacoes, nada mais. Nao
  // ha MySQL nesta suite de proposito -- o ensaio contra banco de verdade e o
  // `scripts/verificar-vazamento.mjs`, que roda as 22 migrations do zero.
  let restantes = 3;
  const gravou = [];
  const conn = {
    query: async function (sql, params) {
      if (/SELECT COUNT\(\*\) AS n FROM salespeople/.test(sql)) {
        return [[{ n: restantes }]];
      }
      if (/UPDATE salespeople SET password = NULL/.test(sql)) { restantes = 0; return [{}]; }
      gravou.push(sql);
      return [[]];
    }
  };

  const relatorio = await runner.aplicar(conn, '022_apagar_senha_em_texto_puro.js');

  assert.ok(relatorio, 'aplicar() tem de devolver o retorno da migration, e nao descarta-lo');
  assert.strictEqual(relatorio.senhasApagadas, 3,
    'o relatorio tem de dizer QUANTAS senhas foram apagadas -- e esse numero a ' +
    'unica resposta para "quantas contas tinham senha legivel no banco"');
  assert.match(relatorio.observacao, /reutilizada em outro servico/,
    'o relatorio tem de dizer o que fazer com a informacao, e nao so o numero');
  assert.ok(gravou.some((sql) => /INSERT INTO system_logs/.test(sql)),
    'o relatorio continua sendo gravado tambem: a resposta se le agora, o banco guarda depois');
});

test('a 023 devolve os logs orfaos mas NAO toca os de MIGRATION', async function () {
  // A janela cega ia de 04/09 (quando `clinica_id` nasceu) a 09/09 (quando a
  // tela passou a filtrar). Tudo o que `logSystemEvent` gravou nesse intervalo
  // ficou sem clinica e desapareceu da tela.
  //
  // A parte delicada e o que NAO se devolve: registro de `MIGRATION` e da
  // instalacao de verdade -- DDL nao pertence a clinica nenhuma. Sem esta
  // exclusao, o relatorio de cada migration passaria a aparecer na tela de uma
  // clinica como se fosse acao dela.
  const runner = require(path.join(__dirname, '..', 'db', 'run-migrations.js'));
  const consultas = [];
  let orfaos = 4;
  const conn = {
    query: async function (sql, params) {
      consultas.push(sql.replace(/\s+/g, ' ').trim());
      if (/FROM clinicas/.test(sql)) return [[{ id: 'cl_1' }]];
      if (/LIKE 'Migration 022:%'/.test(sql)) {
        return [[{ description: 'Migration 022: 7 senha(s)...', quando: '09/09/2026 16:00' }]];
      }
      if (/COUNT\(\*\)[\s\S]*action_type <> 'MIGRATION'/.test(sql)) {
        return [[{ n: orfaos }]];
      }
      if (/^UPDATE system_logs/.test(sql.trim())) {
        const mexidos = orfaos; orfaos = 0;
        return [{ affectedRows: mexidos }];
      }
      if (/COUNT\(\*\) AS n FROM system_logs WHERE clinica_id IS NULL/.test(sql.replace(/\s+/g,' '))) {
        return [[{ n: 1 }]];   // sobra o de MIGRATION, e e o certo
      }
      return [[]];
    }
  };

  const r = await runner.aplicar(conn, '023_recuperar_logs_sem_clinica.js');
  assert.strictEqual(r.registrosDevolvidos, 4);
  assert.strictEqual(r.seguemDaInstalacao, 1,
    'o registro de MIGRATION tem de continuar sem clinica');
  assert.match(r.relatorioDa022, /Migration 022/,
    'a 023 existe tambem para LER DE VOLTA o relatorio da 022, que nasceu invisivel');

  const update = consultas.find((q) => q.startsWith('UPDATE system_logs'));
  assert.ok(update, 'a 023 precisa devolver os orfaos');
  assert.ok(/action_type <> 'MIGRATION'/.test(update),
    'o UPDATE da 023 NAO pode tocar os registros de MIGRATION: esses sao da ' +
    'instalacao, e apareceriam na tela de uma clinica como se fossem acao dela.');
});

/* ============================================ a trilha de auditoria por clinica
 *
 * Na M1.6 `logSystemEvent(tipo, descricao, autor, ip)` foi REMOVIDA e trocada
 * por duas funcoes que dizem no nome de quem e o registro: `logs.registrar(db,
 * ...)` para o log de uma clinica, e `logs.daInstalacao(motivo, ...)` para o
 * que e da instalacao inteira.
 *
 * A troca mexeu em 56 pontos de chamada, em 12 arquivos. Um ponto esquecido nao
 * daria erro no boot nem teste vermelho -- so quebraria na hora em que aquela
 * rota especifica fosse usada, possivelmente semanas depois. Este teste e a
 * guarda: varre o disco atras da forma antiga.
 */

test('ninguem mais chama a forma antiga logSystemEvent', function () {
  const sobrando = arquivosDoServidor().filter(function (f) {
    // `services/logs.js` e o unico isento, e de proposito: a mensagem de erro
    // que ele LANCA cita a forma antiga por extenso, para quem tropecar nela
    // entender o que aconteceu. Como e string e nao comentario, `semComentarios`
    // nao a remove -- e a varredura acusava o proprio arquivo que fez a troca.
    if (f === 'services/logs.js') return false;
    const fonte = semComentarios(fs.readFileSync(path.join(DIR_SERVIDOR, f), 'utf8'));
    // A CHAMADA, com o parentese: o nome aparece em comentario explicando a
    // troca, e comentario nao executa nada. Foi por confundir os dois que dois
    // asserts deste arquivo tropecaram nos proprios comentarios em 09/09.
    return fonte.indexOf('logSystemEvent(') !== -1;
  });
  assert.deepStrictEqual(sobrando, [],
    'Estes ainda chamam logSystemEvent, que nao existe mais:\n  ' + sobrando.join('\n  ') +
    '\nUse logs.registrar(db, tipo, descricao) -- ou, se o evento for mesmo da ' +
    'instalacao inteira, logs.daInstalacao(motivo, tipo, descricao).');
});

/* ============================ E A FORMA ANTIGA COM O NOME NOVO (M4.3, 14/09)
 *
 * O teste acima varre o NOME antigo, e por isso deixou passar o defeito que
 * custou cinco dias de trilha: `routes/clients.js` já chamava `logs.registrar`
 * -- nome novo, guarda satisfeita -- mas com os CINCO argumentos da forma
 * antiga e um `db` que não existia naquele escopo.
 *
 * O resultado: cadastrar, editar e excluir paciente gravavam no banco e
 * devolviam 500, sem nenhum registro de auditoria. Um ReferenceError que o
 * `catch` da rota transformava em erro genérico, e que o front engolia.
 *
 * A assinatura nova tem exatamente TRÊS argumentos: autor e IP saem do próprio
 * escopo, e é essa a razão de ela existir. Quem passa mais está com a chamada
 * convertida pela metade.
 */
test('nenhuma chamada a logs.registrar ficou com a forma antiga de argumentos', function () {
  /** Tira comentários E literais de texto: vírgula dentro de string não separa
   *  argumento, e foi assim que uma contagem anterior acusou quatro chamadas
   *  boas.
   *
   *  As QUEBRAS DE LINHA são preservadas -- cada trecho removido vira a mesma
   *  quantidade de `\n`. Sem isso o arquivo encolhe e a mensagem de erro aponta
   *  uma linha que não é a da chamada: na primeira sabotagem deste teste ele
   *  acusou a linha 48 de um defeito que estava na 76. Número de linha errado
   *  em mensagem de erro custa a meia hora de quem for procurar. */
  const mesmasLinhas = (t) => t.replace(/[^\n]/g, '');
  const soCodigo = (fonte) => fonte
    .replace(/\/\*[\s\S]*?\*\//g, mesmasLinhas)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, (t) => '`' + mesmasLinhas(t) + '`')
    .replace(/'(?:\\[\s\S]|[^'\\])*'/g, "''")
    .replace(/"(?:\\[\s\S]|[^"\\])*"/g, '""');

  const erradas = [];
  for (const f of arquivosDoServidor()) {
    const fonte = soCodigo(fs.readFileSync(path.join(DIR_SERVIDOR, f), 'utf8'));
    const re = /logs\.registrar\(/g;
    let m;
    while ((m = re.exec(fonte))) {
      let i = m.index + m[0].length;
      let prof = 1;
      const ini = i;
      while (i < fonte.length && prof > 0) {
        const c = fonte[i];
        if (c === '(') prof++;
        else if (c === ')') prof--;
        i++;
      }
      const args = fonte.slice(ini, i - 1);
      let d = 0;
      let quantos = 1;
      for (const c of args) {
        if ('([{'.indexOf(c) !== -1) d++;
        else if (')]}'.indexOf(c) !== -1) d--;
        else if (c === ',' && d === 0) quantos++;
      }
      const linha = fonte.slice(0, m.index).split('\n').length;
      if (quantos !== 3) erradas.push(f + ':' + linha + ' (' + quantos + ' argumentos)');
    }
  }

  assert.deepStrictEqual(erradas, [],
    'Estas chamadas nao tem os 3 argumentos de logs.registrar(db, tipo, descricao):\n  ' +
    erradas.join('\n  ') +
    '\nAutor e IP vem do escopo, e nao se passam a mao.');
});

test('logs.registrar recusa alto quem passa o tipo no lugar do escopo', function () {
  // A forma antiga tinha o tipo do evento como primeiro argumento. Um ponto de
  // chamada convertido pela metade passaria uma string aqui -- e, sem esta
  // recusa, gravaria sem clinica: o registro sumiria da tela de quem o gerou,
  // que e exatamente a falha silenciosa que a troca de assinatura existe para
  // impedir.
  const logs = require(path.join(DIR_SERVIDOR, 'services', 'logs.js'));
  assert.rejects(
    () => logs.registrar('AGENDA', 'descricao qualquer', 'Silvia'),
    /primeiro argumento e o escopo/,
    'passar o tipo no lugar do escopo tem de estourar, nao gravar sem clinica');
});

test('a listagem de vendedores nao devolve a coluna de senha', function () {
  // `salespeople.password` guarda texto puro (coluna legada, nao autentica mais
  // nada desde a migration 004). `SELECT *` a entregava ao navegador -- e esta
  // rota nao tem regra de papel, entao um `vendedor` lia a senha dos colegas.
  //
  // O assert e sobre o `SELECT *`, e nao sobre a palavra `password`: e o
  // curinga que entregaria tambem qualquer coluna sensivel acrescentada depois.
  const fonte = semComentarios(
    fs.readFileSync(path.join(DIR_SERVIDOR, 'routes', 'salespeople.js'), 'utf8'));
  assert.ok(fonte.indexOf('SELECT * FROM salespeople') === -1,
    'routes/salespeople.js voltou a usar SELECT *: isso devolve a coluna password ' +
    'em texto puro para qualquer sessao autenticada.');
  assert.ok(!/password/i.test(fonte),
    'routes/salespeople.js voltou a mexer na coluna password. Senha de acesso se ' +
    'define em /api/users, com bcrypt.');
});

/* ============================================ quem pode atravessar clinicas
 *
 * O cabeçalho de escopo.js diz "há teste conferindo a lista de quem chama".
 * Até 08/09 não havia — a frase era verdadeira sobre a intenção e falsa sobre o
 * repositório. Este é o teste.
 */

/** Arquivos que chamam `escopo.todasAsClinicas(`, com o caminho a partir de
 *  server/. Só as varreduras do cron e o painel da plataforma podem. */
const PODEM_ATRAVESSAR = [
  // As varreduras do cron ainda estão na catraca (M2.3), usando o pool direto.
  // Quando saírem, entram aqui -- e este teste é o lugar onde alguém tem de
  // escrever, de propósito, que a exceção foi autorizada.
  //
  // Os dois primeiros nasceram na M1.6, e a razão de cada um está escrita no
  // cabeçalho do arquivo:
  'routes/leads-publico.js',   // o formulário do site posta sem sessão, e um
                               // formulário público não sabe de qual clínica
                               // ele é. Grava na única clínica que existir e
                               // RECUSA se houver mais de uma. Ver a M2 e o
                               // aviso na M3.1.
  'routes/plataforma.js',      // M3.1, 14/09: o operador NAO tem clínica -- é o
                               // que o define -- e a pergunta dele é sobre o
                               // conjunto ("quantas pacientes cada uma tem").
                               // Não há `:clinica` que caiba. O que ele pode
                               // perguntar é limitado por LISTA DE ROTAS
                               // (middleware/plataforma.js), e não por filtro:
                               // a resposta é sempre contagem, nunca conteúdo.
  'workers/expiracao-pontos.js', // idem: o laço percorre as clínicas ativas e
                               // trata cada uma no escopo dela. Aqui a
                               // separação evita um defeito específico -- a
                               // fila de acúmulos é por paciente, e misturar
                               // clínicas faria o consumo de uma apagar o
                               // ponto de outra.
  'workers/lembretes.js',      // a varredura percorre as clínicas ativas que têm
                               // instância, e trata cada uma no escopo dela. O
                               // laço é a travessia; o trabalho, não.
  'routes/webhook-whatsapp.js', // descobre a clínica pela INSTANCIA que recebeu a
                               // mensagem. Lê uma linha de `clinicas` por um
                               // valor que veio de fora, e nada mais: tudo
                               // depois disso é escopado.
  'routes/evolution.js',       // conta quantas clínicas existem para decidir se
                               // a caixa de entrada COMPARTILHADA do WhatsApp
                               // pode ser mostrada. Não lê dado de clínica
                               // nenhuma: lê a contagem, e recusa se for > 1.
  'services/logs.js',          // `daInstalacao` grava o log que não é de
                               // clínica nenhuma: cron, migration, falha de
                               // inicialização. O outro caminho do arquivo --
                               // `registrar` -- é escopado.
  'services/nascimento-clinica.js' // no início deste trabalho a clínica AINDA
                               // NÃO EXISTE: não há sessão, não há clínica
                               // atual, e o identificador é justamente o que
                               // está sendo criado. Tudo corre numa transação
                               // só, com `clinica_id` explícito -- usar
                               // `paraClinica` pegaria outra conexão do pool e
                               // as gravações rodariam FORA da transação,
                               // deixando meia clínica gravada se algo falhasse.
];

test('so quem esta autorizado atravessa clinica', function () {
  const chamam = arquivosDoServidor().filter(function (f) {
    const fonte = semComentarios(fs.readFileSync(path.join(DIR_SERVIDOR, f), 'utf8'));
    return /todasAsClinicas\s*\(/.test(fonte);
  });

  const naoAutorizados = chamam.filter((f) => PODEM_ATRAVESSAR.indexOf(f) === -1);
  assert.deepStrictEqual(naoAutorizados, [],
    'Estes atravessam clinica sem autorizacao:\n  ' + naoAutorizados.join('\n  ') +
    '\nAtravessar clinica e excecao de duas: varredura do cron e painel da plataforma. ' +
    'Se for uma delas, acrescente o caminho a PODEM_ATRAVESSAR aqui -- a lista existe ' +
    'para a excecao ser uma decisao escrita, e nao um require esquecido.');
});

/* ============================================ a porta do timbre (M5.6, 17/09)
 *
 * `clinicas` é a única tabela sem `clinica_id` — ela É a lista de clínicas —, e
 * por isso `db.q` recusa qualquer consulta a ela. `atualizarMinhaClinica` é a
 * porta estreita por onde a clínica edita a PRÓPRIA linha, e ela precisa
 * continuar estreita: três colunas daquela tabela não são decisão da clínica.
 */
test('atualizarMinhaClinica grava so as colunas do timbre, e sempre na propria linha',
  async function () {
    const vistas = [];
    const db = escopo.fazerEscopo(CL, {
      query: async (s, p) => { vistas.push({ s: s, p: p }); return [{ affectedRows: 1 }]; }
    });

    await db.atualizarMinhaClinica({ endereco: 'Rua A, 1', telefone: '(11) 1234-5678' });
    assert.match(vistas[0].s, /UPDATE clinicas SET/);
    assert.match(vistas[0].s, /WHERE id = \?$/);
    assert.deepStrictEqual(vistas[0].p, ['Rua A, 1', '(11) 1234-5678', CL],
      'a clinica alvo e a da sessao, e ela e sempre o ULTIMO parametro');
  });

test('atualizarMinhaClinica IGNORA status, chave de captacao e instancia', async function () {
  // As tres que nao sao decisao da clinica, e cada uma por uma razao diferente:
  // suspender e da plataforma; trocar a chave DESLIGA o formulario do site; e
  // apontar para a instancia da vizinha faz mensagem de paciente cair na
  // clinica errada. Uma porta generica de gravacao alcancaria as tres.
  const vistas = [];
  const db = escopo.fazerEscopo(CL, {
    query: async (s, p) => { vistas.push({ s: s, p: p }); return [{ affectedRows: 1 }]; }
  });

  const tentou = await db.atualizarMinhaClinica({
    status: 'ativa', chave_captacao: 'roubada', evolution_instance: 'da-vizinha', id: 'cl_b'
  });
  assert.strictEqual(tentou, 0, 'sem coluna permitida, nao pode haver UPDATE nenhum');
  assert.strictEqual(vistas.length, 0, 'nao pode nem chegar a montar SQL');

  // E misturada com uma permitida, a proibida nao pega carona.
  await db.atualizarMinhaClinica({ endereco: 'Rua B, 2', status: 'encerrada' });
  assert.strictEqual(vistas.length, 1);
  assert.ok(!/status/.test(vistas[0].s), 'status nao pode entrar no SET');
  assert.deepStrictEqual(vistas[0].p, ['Rua B, 2', CL]);
});

test('campo vazio no timbre vira NULL, e nao a string vazia', async function () {
  // Apagar o telefone tem de apagar de verdade: string vazia imprimiria um
  // separador solto no rodape do papel.
  const vistas = [];
  const db = escopo.fazerEscopo(CL, {
    query: async (s, p) => { vistas.push({ s: s, p: p }); return [{ affectedRows: 1 }]; }
  });
  await db.atualizarMinhaClinica({ telefone: '', contato: null });
  assert.deepStrictEqual(vistas[0].p, [null, null, CL]);
});

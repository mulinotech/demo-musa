'use strict';
/** M0.1 — a classificação das tabelas e a trava contra tabela esquecida.
 *
 *  O que estes testes existem para impedir: uma tabela ficar sem coluna de
 *  inquilino. Tabela sem `clinica_id` tem o conteúdo compartilhado pelas 50
 *  clínicas, a consulta simplesmente não filtra, e nada dá erro em lugar
 *  nenhum — é a forma mais silenciosa de vazar dado neste projeto.
 */
const test = require('node:test');
const assert = require('node:assert');

const up = require('../db/migrations/018_clinicas.js');
const L = up.LISTAS;

/* ------------------------------------------------------- a lista está sã */

test('a migration continua sendo uma funcao para o runner', function () {
  // `db/run-migrations.js` exige `typeof up === 'function'`. Pendurar as
  // listas como propriedade nao pode ter quebrado isso.
  assert.strictEqual(typeof up, 'function');
});

test('nenhuma tabela aparece em duas listas', function () {
  assert.deepStrictEqual(L.duplicadas(), []);
});

test('as 28 tabelas de dados recebem a coluna', function () {
  assert.strictEqual(L.OBRIGATORIA.length, 26);
  assert.strictEqual(L.NULAVEL.length, 2);
  assert.strictEqual(L.COM_COLUNA.length, 28);
});

test('so duas tabelas ficam de fora, e ambas sao da instalacao', function () {
  // `schema_migrations` e o controle do runner; `clinicas` e a propria clinica.
  // Qualquer terceira tabela nesta lista precisa de justificativa escrita.
  assert.deepStrictEqual(L.SEM_COLUNA, ['schema_migrations', 'clinicas']);
});

test('as null-aveis sao exatamente as duas da instalacao', function () {
  // Vazio nao significa "vale para todas": significa "nao e de nenhuma".
  // Acrescentar tabela aqui e afrouxar o isolamento -- tem de doer.
  assert.deepStrictEqual(L.NULAVEL, ['system_settings', 'system_logs']);
});

test('as tabelas de dado de paciente estao entre as OBRIGATORIAS', function () {
  // As que, vazando, expoem pessoa: ficha, prontuario, documento assinado,
  // agenda e financeiro. Nenhuma delas pode ser null-avel.
  for (const t of ['clients', 'client_documents', 'appointments', 'treatment_sessions',
                   'treatment_plans', 'cash_entries', 'loyalty_transactions', 'users']) {
    assert.strictEqual(L.OBRIGATORIA.includes(t), true, t + ' tem de ser obrigatoria');
    assert.strictEqual(L.NULAVEL.includes(t), false, t + ' nao pode aceitar vazio');
  }
});

test('a lista esta em ordem alfabetica', function () {
  // Para conferir a olho contra SHOW TABLES. Fora de ordem, ninguem compara.
  const ordenada = L.OBRIGATORIA.slice().sort();
  assert.deepStrictEqual(L.OBRIGATORIA, ordenada);
});

/* ------------------------------------------- a trava contra tabela esquecida */

test('tabela nova no banco e acusada, nao ignorada', function () {
  const doBanco = L.CLASSIFICADAS.concat(['assinaturas', 'faturas']);
  assert.deepStrictEqual(L.naoClassificadas(doBanco), ['assinaturas', 'faturas']);
});

test('banco exatamente igual a lista nao acusa nada', function () {
  assert.deepStrictEqual(L.naoClassificadas(L.CLASSIFICADAS), []);
});

test('tabela da lista ausente do banco e avisada, nao fatal', function () {
  const doBanco = L.CLASSIFICADAS.filter((t) => t !== 'client_documents');
  assert.deepStrictEqual(L.classificadasQueFaltam(doBanco), ['client_documents']);
});

/* --------------------------------------------------- ensaio da migration
                                                        contra banco de mentira */

/** Banco de mentira: registra o SQL recebido e responde o mínimo para a
 *  migration andar. Não valida SQL — valida a SEQUÊNCIA, que é onde o erro
 *  desta tarefa moraria. */
function bancoFalso(op) {
  op = op || {};
  const sql = [];
  const linhas = op.linhas == null ? 7 : op.linhas;
  let contagens = 0;

  return {
    sql: sql,
    query: async function (q, params) {
      sql.push({ q: String(q).replace(/\s+/g, ' ').trim(), params: params });

      if (/FROM information_schema\.TABLES/.test(q)) {
        return [(op.tabelas || L.CLASSIFICADAS).map((t) => ({ t: t }))];
      }
      if (/FROM information_schema\.COLUMNS/.test(q)) {
        return [[{ n: op.jaTemColuna ? 1 : 0 }]];
      }
      if (/FROM information_schema\.STATISTICS/.test(q)) {
        return [[{ n: op.jaTemIndice ? 1 : 0 }]];
      }
      if (/WHERE clinica_id IS NULL OR clinica_id = ''/.test(q)) {
        return [[{ n: op.orfas ? 3 : 0 }]];
      }
      if (/SELECT COUNT\(\*\) AS n FROM/.test(q)) {
        contagens += 1;
        // op.perdeLinha faz a contagem de DEPOIS vir menor, simulando o
        // desastre que a migration tem de recusar. A migration conta apenas as
        // tabelas COM coluna -- contar todas do banco erraria o ponto de virada
        // e o teste passaria sem exercitar nada (foi o que aconteceu na
        // primeira versao deste arquivo).
        const comColuna = (op.tabelas || L.CLASSIFICADAS)
          .filter((t) => L.COM_COLUNA.indexOf(t) !== -1).length;
        const ehDepois = contagens > comColuna;
        return [[{ n: ehDepois && op.perdeLinha ? linhas - 1 : linhas }]];
      }
      if (/^INSERT IGNORE INTO clinicas/i.test(q)) {
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 0 }];
    }
  };
}

test('a migration roda de ponta a ponta e cria a clinica 1', async function () {
  const db = bancoFalso();
  await up(db);

  const criouTabela = db.sql.some((x) => /CREATE TABLE IF NOT EXISTS clinicas/.test(x.q));
  assert.strictEqual(criouTabela, true);

  const inseriu = db.sql.find((x) => /INSERT IGNORE INTO clinicas/.test(x.q));
  assert.deepStrictEqual(inseriu.params, [L.ID_PRIMEIRA, L.NOME_PRIMEIRA]);
});

test('a coluna nasce aceitando vazio, e SO DEPOIS vira obrigatoria', async function () {
  // A ordem DENTRO da 018 esta certa e continua valendo: acrescentar direto
  // como NOT NULL numa tabela com linhas obriga o MySQL a inventar um valor
  // padrao, e a linha existente fica com inquilino errado.
  //
  // O que estava errado era a 018 APERTAR a coluna, e isso a 020 desfaz: nao
  // havia codigo preenchendo clinica_id, e os 45 INSERT do sistema pararam de
  // gravar. Expandir, migrar, apertar -- nesta ordem. Ver o cabecalho da 020.
  const db = bancoFalso({ tabelas: ['schema_migrations', 'clinicas', 'clients'] });
  await up(db);

  const daClients = db.sql.map((x) => x.q).filter((q) => /`clients`/.test(q));
  const iAdd = daClients.findIndex((q) => /ADD COLUMN clinica_id VARCHAR\(50\) NULL/.test(q));
  const iSet = daClients.findIndex((q) => /UPDATE `clients` SET clinica_id/.test(q));
  const iNot = daClients.findIndex((q) => /MODIFY clinica_id VARCHAR\(50\) NOT NULL/.test(q));

  assert.ok(iAdd >= 0 && iSet >= 0 && iNot >= 0, 'os tres passos precisam existir');
  assert.ok(iAdd < iSet, 'a coluna vem antes do preenchimento');
  assert.ok(iSet < iNot, 'o preenchimento vem ANTES de virar obrigatoria');
});

test('a null-avel NAO recebe NOT NULL', async function () {
  const db = bancoFalso({ tabelas: ['schema_migrations', 'clinicas', 'system_settings'] });
  await up(db);
  const virouObrigatoria = db.sql.some((x) =>
    /`system_settings`/.test(x.q) && /NOT NULL/.test(x.q));
  assert.strictEqual(virouObrigatoria, false,
    'system_settings precisa aceitar vazio: e onde vive o cron_token');
});

test('toda tabela com a coluna ganha indice', async function () {
  const db = bancoFalso({ tabelas: ['schema_migrations', 'clinicas', 'clients', 'appointments'] });
  await up(db);
  for (const t of ['clients', 'appointments']) {
    const indexou = db.sql.some((x) =>
      x.q === 'ALTER TABLE `' + t + '` ADD INDEX idx_clinica (clinica_id)');
    assert.strictEqual(indexou, true, t + ' sem indice faz toda tela varrer a tabela inteira');
  }
});

test('rodar de novo nao repete ALTER nenhum', async function () {
  // Idempotencia: a migration nao deve rodar duas vezes pelo runner, mas
  // aplicar a mao em banco meio-convertido acontece.
  const db = bancoFalso({ jaTemColuna: true, jaTemIndice: true });
  await up(db);
  const alterou = db.sql.some((x) => /ADD COLUMN clinica_id|ADD INDEX idx_clinica/.test(x.q));
  assert.strictEqual(alterou, false);
});

test('tabela nao classificada PARA a migration', async function () {
  const db = bancoFalso({ tabelas: L.CLASSIFICADAS.concat(['assinaturas']) });
  await assert.rejects(() => up(db), function (e) {
    assert.match(e.message, /assinaturas/);
    assert.match(e.message, /nenhuma lista/);
    return true;
  });
  const alterou = db.sql.some((x) => /ALTER TABLE/.test(x.q));
  assert.strictEqual(alterou, false, 'para ANTES de alterar qualquer coisa');
});

test('contagem de linhas diferente PARA a migration', async function () {
  const db = bancoFalso({ tabelas: ['schema_migrations', 'clinicas', 'clients'], perdeLinha: true });
  await assert.rejects(() => up(db), function (e) {
    assert.match(e.message, /contagem de linhas MUDOU/);
    assert.match(e.message, /clients/);
    return true;
  });
});

test('linha orfa PARA a migration', async function () {
  const db = bancoFalso({ tabelas: ['schema_migrations', 'clinicas', 'clients'], orfas: true });
  await assert.rejects(() => up(db), /linhas sem clinica/);
});

/* ==================================================================== M0.2
   As unicidades que atravessam clínicas, e a recusa que não conta demais. */

const fs = require('node:fs');
const path = require('node:path');
const up19 = require('../db/migrations/019_unicidade_por_clinica.js');

test('019 continua sendo uma funcao para o runner', function () {
  assert.strictEqual(typeof up19, 'function');
});

test('as quatro unicidades a converter, e nenhuma a mais', function () {
  assert.deepStrictEqual(up19.ALVOS.map((a) => a.tabela), [
    'products', 'cash_entries', 'loyalty_transactions', 'service_supplies'
  ]);
});

test('users.email NAO esta entre as convertidas', function () {
  // Decisao de produto de 04/09: o e-mail e unico entre as 50. Se alguem
  // acrescentar `users` a ALVOS, o login fica ambiguo -- dois usuarios com o
  // mesmo e-mail em clinicas diferentes, e `WHERE email = ?` devolvendo dois.
  assert.strictEqual(up19.ALVOS.some((a) => a.tabela === 'users'), false);
  assert.deepStrictEqual(up19.GLOBAL_POR_DECISAO, [{ tabela: 'users', colunas: ['email'] }]);
});

test('as duas chaves de idempotencia estao na lista', function () {
  // Sao a trava que faz ER_DUP_ENTRY significar "isso ja foi feito". Colisao
  // entre clinicas ali nao da erro: some com uma receita, calada.
  for (const t of ['cash_entries', 'loyalty_transactions']) {
    const alvo = up19.ALVOS.find((a) => a.tabela === t);
    assert.deepStrictEqual(alvo.colunas, ['source', 'source_id', 'type']);
  }
});

test('o indice e achado pelas COLUNAS, nao pelo nome', function () {
  // O indice do sku tem nome automatico do MySQL, que pode mudar entre
  // versoes. Procurar por nome quebraria em silencio.
  const mapa = new Map([
    ['PRIMARY_naoentra', ['id']],
    ['sku', ['sku']],
    ['uq_cash_source', ['source', 'source_id', 'type']]
  ]);
  assert.strictEqual(up19.nomeDoIndice(mapa, ['sku']), 'sku');
  assert.strictEqual(up19.nomeDoIndice(mapa, ['source', 'source_id', 'type']), 'uq_cash_source');
  assert.strictEqual(up19.nomeDoIndice(mapa, ['clinica_id', 'sku']), null);
});

test('ordem diferente das colunas NAO casa', function () {
  const mapa = new Map([['x', ['source_id', 'source', 'type']]]);
  assert.strictEqual(up19.nomeDoIndice(mapa, ['source', 'source_id', 'type']), null);
});

/* ------------------------------------------------- ensaio da 019 */

/** Banco de mentira COM ESTADO. A primeira versao respondia sempre o mesmo,
 *  entao a conferencia final da migration -- que le os indices de novo depois de
 *  alterar -- nunca podia passar. Falso negativo de bancada: o teste acusava a
 *  migration por um defeito do teste. Aqui o DROP e o CREATE mudam o mapa. */
function banco19(op) {
  op = op || {};
  const sql = [];

  // tabela -> [{ nome, cols }]
  const indices = new Map();
  indices.set('users', [{ nome: 'email', cols: ['email'] }]);
  for (const alvo of up19.ALVOS) {
    if (op.semIndice) indices.set(alvo.tabela, []);
    else if (op.convertido) {
      indices.set(alvo.tabela, [{ nome: alvo.novo, cols: ['clinica_id'].concat(alvo.colunas) }]);
    } else {
      indices.set(alvo.tabela, [{ nome: alvo.novo, cols: alvo.colunas.slice() }]);
    }
  }

  return {
    sql: sql,
    indices: indices,
    query: async function (q, params) {
      const texto = String(q).replace(/\s+/g, ' ').trim();
      sql.push({ q: texto, params: params });

      if (/FROM information_schema\.STATISTICS/.test(q)) {
        const linhas = [];
        for (const ix of (indices.get(params[0]) || [])) {
          ix.cols.forEach((c, i) => linhas.push({ nome: ix.nome, coluna: c, ordem: i + 1 }));
        }
        return [linhas];
      }
      if (/HAVING COUNT\(\*\) > 1/.test(q)) {
        return [[{ n: op.duplicatas ? 2 : 0 }]];
      }

      const drop = texto.match(/^ALTER TABLE `(\w+)` DROP INDEX `(\w+)`$/);
      if (drop) {
        const [, tabela, nome] = drop;
        indices.set(tabela, (indices.get(tabela) || []).filter((ix) => ix.nome !== nome));
      }
      const cria = texto.match(/^CREATE UNIQUE INDEX `(\w+)` ON `(\w+)` \((.+)\)$/);
      if (cria) {
        const [, nome, tabela, cols] = cria;
        const lista = cols.split(',').map((c) => c.trim().replace(/`/g, ''));
        indices.set(tabela, (indices.get(tabela) || []).concat([{ nome: nome, cols: lista }]));
      }
      return [{ affectedRows: 0 }];
    }
  };
}

test('a 019 troca as quatro, com clinica_id NA FRENTE', async function () {
  const db = banco19();
  await up19(db);
  for (const alvo of up19.ALVOS) {
    const criou = db.sql.find((x) =>
      x.q.startsWith('CREATE UNIQUE INDEX') && x.q.includes('`' + alvo.tabela + '`'));
    assert.ok(criou, alvo.tabela + ' sem indice novo');
    // clinica_id primeiro faz o mesmo indice servir "tudo desta clinica".
    assert.match(criou.q, new RegExp('\\(`clinica_id`, ' +
      alvo.colunas.map((c) => '`' + c + '`').join(', ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '\\)'));
  }
});

test('derruba o antigo ANTES de criar o novo', async function () {
  const db = banco19();
  await up19(db);
  const daProducts = db.sql.map((x) => x.q).filter((q) => /`products`/.test(q) && /INDEX/.test(q));
  const iDrop = daProducts.findIndex((q) => /DROP INDEX/.test(q));
  const iCria = daProducts.findIndex((q) => /CREATE UNIQUE INDEX/.test(q));
  assert.ok(iDrop >= 0 && iCria >= 0);
  assert.ok(iDrop < iCria, 'o indice antigo impediria o novo de nascer');
});

test('banco ja convertido: nao mexe em nada', async function () {
  const db = banco19({ convertido: true });
  await up19(db);
  const mexeu = db.sql.some((x) => /DROP INDEX|CREATE UNIQUE INDEX/.test(x.q));
  assert.strictEqual(mexeu, false);
});

test('duplicata dentro da clinica PARA a migration', async function () {
  const db = banco19({ duplicatas: true });
  await assert.rejects(() => up19(db), function (e) {
    assert.match(e.message, /se repetem dentro da mesma clinica/);
    return true;
  });
  const mexeu = db.sql.some((x) => /DROP INDEX/.test(x.q));
  assert.strictEqual(mexeu, false, 'para ANTES de derrubar o indice');
});

test('indice ausente PARA a migration em vez de seguir', async function () {
  // Tabela sem trava de unicidade nenhuma significa que alguem mexeu por fora.
  // Seguir em frente poderia deixa-la sem trava alguma.
  const db = banco19({ semIndice: true });
  await assert.rejects(() => up19(db), /nao achei em `products` indice unico/);
});

/* ------------------------------- a frase da recusa, conferida no proprio fonte

   Teste de FONTE, nao de comportamento, e de proposito: o risco aqui nao e o
   codigo errar hoje, e alguem reescrever a mensagem daqui a seis meses para
   ser "mais util". Um teste de rota nao pegaria isso sem banco; este pega. */

test('a recusa de e-mail duplicado nao revela que ele existe', function () {
  // Olha SO as mensagens que saem para o cliente (`error: '...'`), nao o fonte
  // inteiro. A primeira versao varria o arquivo todo e acusou o proprio
  // comentario que manda NAO usar a frase vazada -- o aviso continha a frase.
  // Comentario nao chega a navegador nenhum; string de resposta chega.
  const fonte = fs.readFileSync(
    path.join(__dirname, '..', 'server', 'routes', 'users.js'), 'utf8');

  const mensagens = Array.from(fonte.matchAll(/error:\s*'([^']*)'/g)).map((m) => m[1]);
  assert.ok(mensagens.length >= 5, 'esperava varias mensagens de erro no arquivo');

  assert.ok(mensagens.includes('Este e-mail nao esta disponivel. Use outro endereco.'),
    'a frase neutra tem de ser a resposta da recusa');

  for (const m of mensagens) {
    assert.strictEqual(/ja existe|ja cadastrad|already (exists|registered)/i.test(m), false,
      'mensagem que revela cadastro em outra clinica: ' + JSON.stringify(m));
  }
});

/* ==================================================== 020 — o conserto da 018

   Escrever teste para o conserto e menos importante do que escrever teste que
   pegasse o defeito. O que faltava era exercitar GRAVACAO, nao leitura: a
   verificacao pos-018 chamou cinco rotas GET e passou com o sistema incapaz de
   inserir uma linha. Fica registrado na regra 8 do TASKS-MULTI. */

const up20 = require('../db/migrations/020_clinica_id_volta_a_aceitar_vazio.js');

test('020 continua sendo uma funcao para o runner', function () {
  assert.strictEqual(typeof up20, 'function');
});

function banco20(op) {
  op = op || {};
  const sql = [];
  const nulavel = new Map();          // tabela -> 'YES' | 'NO'
  for (const t of L.OBRIGATORIA) nulavel.set(t, op.jaAfrouxadas ? 'YES' : 'NO');

  return {
    sql: sql,
    nulavel: nulavel,
    query: async function (q, params) {
      const texto = String(q).replace(/\s+/g, ' ').trim();
      sql.push({ q: texto, params: params });

      if (/FROM information_schema\.TABLES/.test(q)) {
        return [(op.tabelas || L.CLASSIFICADAS).map((t) => ({ t: t }))];
      }
      if (/IS_NULLABLE/.test(q)) {
        const v = nulavel.get(params[0]);
        return [v ? [{ nulavel: v }] : []];
      }
      if (/INDEX_NAME = 'idx_clinica'/.test(q)) {
        return [[{ n: op.semIndice ? 0 : 1 }]];
      }
      const mod = texto.match(/^ALTER TABLE `(\w+)` MODIFY clinica_id VARCHAR\(50\) NULL$/);
      if (mod) nulavel.set(mod[1], 'YES');
      return [{ affectedRows: 0 }];
    }
  };
}

test('as 26 obrigatorias voltam a aceitar vazio', async function () {
  const db = banco20();
  await up20(db);
  for (const t of L.OBRIGATORIA) {
    assert.strictEqual(db.nulavel.get(t), 'YES', t + ' continua exigindo a coluna');
  }
});

test('as duas null-aveis NAO sao tocadas', async function () {
  // Para system_settings e system_logs o vazio sempre significou "e da
  // instalacao". Elas nunca foram apertadas, e nao entram aqui.
  const db = banco20();
  await up20(db);
  for (const t of L.NULAVEL) {
    const mexeu = db.sql.some((x) => x.q.includes('`' + t + '`') && /MODIFY/.test(x.q));
    assert.strictEqual(mexeu, false, t + ' nao deveria ser alterada pela 020');
  }
});

test('banco ja afrouxado: nao mexe em nada', async function () {
  const db = banco20({ jaAfrouxadas: true });
  await up20(db);
  const mexeu = db.sql.some((x) => /MODIFY/.test(x.q));
  assert.strictEqual(mexeu, false);
});

test('a 020 NAO cria valor padrao para a coluna', async function () {
  // O ponto da decisao: vazio falha FECHADO -- a linha desaparece de quem a
  // criou. Valor padrao falharia ABERTO -- o dado da clinica X seria arquivado
  // debaixo da clinica 1, em silencio, e apareceria para o inquilino errado.
  const db = banco20();
  await up20(db);
  const temDefault = db.sql.some((x) => /DEFAULT/i.test(x.q));
  assert.strictEqual(temDefault, false,
    'DEFAULT em clinica_id transforma esquecimento em vazamento silencioso');
});

test('indice desaparecido PARA a migration', async function () {
  const db = banco20({ semIndice: true });
  await assert.rejects(() => up20(db), /indice idx_clinica desapareceu/);
});

/* ================================================= M0.3 — o token e a clinica

   A clinica vem do TOKEN, que e assinado. Se viesse do endereco ou do corpo da
   requisicao, bastaria trocar um valor para ler a clinica do vizinho. Estes
   testes existem para impedir que alguem "facilite" isso depois. */

const auth = require('../auth');
const { porteiro } = require('../server/middleware/autenticacao');
const cronMid = require('../server/middleware/cron');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-apenas-de-teste-nao-usar-em-producao';

function reqCom(usuarioParaToken, caminho, metodo) {
  const cab = {};
  if (usuarioParaToken) cab.authorization = 'Bearer ' + auth.gerarToken(usuarioParaToken);
  return { headers: cab, method: metodo || 'GET', originalUrl: caminho || '/api/clients' };
}

function resEspiao() {
  const r = { codigo: null, corpo: null, cabecalhos: {} };
  r.set = function (k, v) { r.cabecalhos[k] = v; return r; };
  r.status = function (c) { r.codigo = c; return r; };
  r.json = function (b) { r.corpo = b; return r; };
  return r;
}

async function passaNoPorteiro(req) {
  const res = resEspiao();
  let seguiu = false;
  await porteiro(req, res, function () { seguiu = true; });
  return { seguiu: seguiu, res: res };
}

const USUARIO = { id: 'u_1', name: 'Silvia', role: 'admin', salesperson_id: null, clinica_id: 'cl_1' };

test('o token carrega a clinica', function () {
  const t = auth.gerarToken(USUARIO);
  const lido = auth.usuarioDaRequisicao({ headers: { authorization: 'Bearer ' + t } });
  assert.strictEqual(lido.clinicaId, 'cl_1');
  assert.strictEqual(lido.papel, 'admin');
});

test('o token NAO carrega o nome da clinica', function () {
  // Dado mutavel em token e dado que envelhece escondido: renomear a clinica
  // deixaria o nome velho valendo ate a pessoa sair e entrar de novo.
  const t = auth.gerarToken(Object.assign({}, USUARIO, { clinica_nome: 'Clinica X' }));
  const lido = auth.usuarioDaRequisicao({ headers: { authorization: 'Bearer ' + t } });
  assert.strictEqual(lido.clinicaNome, undefined);
  assert.strictEqual(lido.clinica_nome, undefined);
});

test('sessao COM clinica passa no porteiro', async function () {
  const { seguiu } = await passaNoPorteiro(reqCom(USUARIO));
  assert.strictEqual(seguiu, true);
});

test('sessao SEM clinica e recusada com 401', async function () {
  // Todo token emitido antes da M0.3 cai aqui. E deliberado: aceitar sessao sem
  // inquilino seria consulta sem filtro rodando com identidade de gente real.
  const semClinica = Object.assign({}, USUARIO, { clinica_id: null });
  const { seguiu, res } = await passaNoPorteiro(reqCom(semClinica));
  assert.strictEqual(seguiu, false);
  assert.strictEqual(res.codigo, 401);
  assert.match(res.corpo.error, /Sessao sem clinica/);
});

test('clinica vazia tambem nao vale', async function () {
  for (const vazio of ['', 0, false, undefined]) {
    const u = Object.assign({}, USUARIO, { clinica_id: vazio });
    const { seguiu } = await passaNoPorteiro(reqCom(u));
    assert.strictEqual(seguiu, false, JSON.stringify(vazio) + ' nao pode virar sessao');
  }
});

test('token de PESSOA sem clinica nao cai no caminho do cron', async function () {
  // O caminho do cron aceita identidade sem clinica -- as varreduras percorrem
  // todas. Se o porteiro deixasse um token de pessoa sem clinica "cair" para
  // esse bloco, bastaria um token velho para virar rotina automatica.
  const semClinica = Object.assign({}, USUARIO, { clinica_id: null });
  const req = reqCom(semClinica, '/api/loyalty/expire', 'POST');
  req.headers[cronMid.CABECALHO] = 'f'.repeat(64);
  const { seguiu, res } = await passaNoPorteiro(req);
  assert.strictEqual(seguiu, false);
  assert.strictEqual(res.codigo, 401);
});

test('a rotina automatica continua sem clinica, e isso e o desenho', function () {
  // As duas varreduras rodam para todas as clinicas; identidade de servico com
  // clinica fixa seria um erro, nao uma protecao.
  assert.strictEqual(cronMid.IDENTIDADE.clinicaId, undefined);
  assert.strictEqual(cronMid.IDENTIDADE.servico, true);
});

test('rota publica continua aberta, sem token nenhum', async function () {
  const { seguiu } = await passaNoPorteiro({ headers: {}, method: 'GET', originalUrl: '/api/config' });
  assert.strictEqual(seguiu, true);
});

test('o marcador de versao sai mesmo na recusa', async function () {
  // O marcador e a unica prova de que o codigo novo esta no ar. Se ele saisse
  // so na resposta de sucesso, um deploy quebrado ficaria indistinguivel de um
  // deploy que nao aconteceu.
  const semClinica = Object.assign({}, USUARIO, { clinica_id: null });
  const { res } = await passaNoPorteiro(reqCom(semClinica));
  assert.match(res.cabecalhos['X-Trava-Musa'], /^v\d+$/);
});

/* ------------------------- a clinica do novo usuario vem da SESSAO */

test('a criacao de usuario grava a clinica, e a le da sessao', function () {
  const fonte = fs.readFileSync(
    path.join(__dirname, '..', 'server', 'routes', 'users.js'), 'utf8');

  assert.match(fonte, /INSERT INTO users \([^)]*clinica_id[^)]*\)/,
    'sem gravar a coluna, o usuario novo nasce sem clinica e nao consegue entrar');

  // ATUALIZADO NA M1.6b. Antes este assert exigia `req.usuario...clinicaId` no
  // proprio arquivo -- e era o certo enquanto esta rota era a UNICA que gravava
  // a coluna, antes de a camada existir.
  //
  // Agora a rota usa `escopo(req)`, e quem le `req.usuario.clinicaId` e a
  // camada, num lugar so. Exigir a leitura aqui obrigaria a rota a ter a propria
  // copia da regra -- que e exatamente o que a camada existe para impedir.
  //
  // O que o teste passou a exigir e mais forte, nao mais fraco: a rota tem de
  // usar a camada, e o INSERT tem de trazer a marca que a camada substitui.
  // Sem a marca, a camada RECUSA a consulta antes de ela chegar ao banco.
  assert.match(fonte, /escopo\(req\)/,
    'a rota tem de montar o escopo da requisicao: e ele que conhece a clinica');
  assert.match(fonte, /INSERT INTO users[\s\S]{0,200}:clinica/,
    'o INSERT tem de carimbar a clinica pela marca da camada (:clinica)');

  // E NAO do corpo da requisicao: aceitar clinica_id do cliente deixaria a
  // proprietaria da clinica A criar um acesso dentro da clinica B.
  assert.strictEqual(/b\.clinica_?[Ii]d|body\.clinica/.test(fonte), false,
    'clinica_id nunca vem do corpo da requisicao');
});

/* ============================================ a 021: preencher o que ficou vazio */

/* ============================================ a 025: a M1.7, a do incidente */

test('a 025 usa a MESMA lista da 018, e nao uma copia', function () {
  // Duas listas da mesma coisa divergem na terceira semana -- e aqui a
  // divergencia seria apertar uma tabela de menos (e deixar linha vazia
  // possivel) ou uma de mais (e apertar `system_logs`, onde vazio significa
  // "e da instalacao").
  const m025 = require('../db/migrations/025_clinica_id_obrigatoria.js');
  const m018 = require('../db/migrations/018_clinicas.js');
  assert.strictEqual(m025.ALVOS, m018.LISTAS.OBRIGATORIA,
    'a 025 tem de apontar para a MESMA lista, nao a uma igual');
  assert.strictEqual(m025.ALVOS.length, 26);
});

test('a 025 NAO aperta as duas tabelas em que vazio tem significado', function () {
  const m025 = require('../db/migrations/025_clinica_id_obrigatoria.js');
  for (const t of ['system_settings', 'system_logs']) {
    assert.strictEqual(m025.ALVOS.indexOf(t), -1,
      t + ' nao pode entrar na lista da 025: ali `clinica_id` vazio significa "e da ' +
      'instalacao inteira" -- e o token do cron e o relatorio das migrations vivem nisso.');
  }
});

test('a 025 aborta com linha vazia e NAO altera nada antes de conferir', async function () {
  // Este e o teste do incidente de 04/09: a M0.1 apertou a coluna enquanto o
  // codigo ainda gravava sem ela, e todo INSERT do sistema passou a falhar.
  //
  // A garantia que importa nao e "ela aborta": e que ela aborta ANTES de
  // qualquer ALTER. Uma migration que apertasse cinco tabelas e depois
  // desistisse deixaria o banco em estado misto, com metade das gravacoes
  // falhando -- pior do que nao ter rodado.
  const up = require('../db/migrations/025_clinica_id_obrigatoria.js');
  const comandos = [];
  const conn = {
    async query(sql, params) {
      const t = String(sql).replace(/\s+/g, ' ').trim();
      comandos.push(t);
      if (/FROM information_schema.TABLES/.test(t)) {
        return [[{ t: 'clients' }, { t: 'leads' }]];
      }
      if (/FROM information_schema.COLUMNS/.test(t)) return [[{ n: 'YES' }]];
      if (/COUNT\(\*\) AS n FROM `leads` WHERE clinica_id IS NULL/.test(t)) {
        return [[{ n: 1 }]];                       // a linha vazia
      }
      if (/WHERE clinica_id IS NULL/.test(t)) return [[{ n: 0 }]];
      if (/LEFT JOIN clinicas/.test(t)) return [[{ n: 0 }]];
      if (/COUNT\(\*\)/.test(t)) return [[{ n: 3 }]];
      return [[]];
    }
  };

  await assert.rejects(() => up(conn), /clinica vazia em leads: 1/,
    'com linha vazia, ela tem de parar e dizer onde');

  const alteracoes = comandos.filter((c) => /^ALTER TABLE/.test(c));
  assert.deepStrictEqual(alteracoes, [],
    'ela nao pode ter alterado NADA antes de abortar. Banco em estado misto -- metade ' +
    'das tabelas apertada -- e pior do que a migration nao ter rodado: parte das ' +
    'gravacoes passa a falhar e a outra nao, e o sintoma fica impossivel de ler.');
});

test('a volta da M1.7 existe, e esta DESLIGADA', function () {
  // Ela existe porque a Silvia nao tem como rodar SQL cru no servidor (o `.env`
  // tem credencial velha), e em 04/09 a falta de um caminho de volta preparado
  // custou uma hora de sistema sem gravar. A decisao sob pressao tem de ser
  // `mv` + um clique, e nao improviso.
  //
  // E ela esta desligada porque migration pendente RODA: o runner aplica tudo o
  // que ainda nao foi aplicado. Um arquivo de reversao com nome normal desfaria
  // a M1.7 no primeiro deploy seguinte, em silencio.
  const fs = require('fs');
  const dir = path.join(__dirname, '..', 'db', 'migrations');
  const arquivos = fs.readdirSync(dir);

  assert.ok(arquivos.indexOf('026_reverter_m17.js.desligada') !== -1,
    'o caminho de volta da M1.7 tem de existir em db/migrations/');
  assert.strictEqual(arquivos.filter((f) => /^026_.*\.(js|sql)$/.test(f)).length, 0,
    'o arquivo de reversao NAO pode terminar em .js: o runner o aplicaria no proximo ' +
    'deploy e desfaria a M1.7 sozinho, sem ninguem pedir.');

  // E o runner tem de concordar com esse raciocinio -- o filtro dele e o que
  // mantem o arquivo inerte, e este assert amarra os dois.
  const fonteRunner = fs.readFileSync(
    path.join(__dirname, '..', 'db', 'run-migrations.js'), 'utf8');
  assert.match(fonteRunner, /\/\\\.\(sql\|js\)\$\//,
    'o runner tem de filtrar por extensao .sql/.js -- e o que deixa o .desligada inerte');
});

test('a 021 usa a MESMA lista da 018, e nao uma copia', function () {
  // Duas listas da mesma coisa divergem na terceira semana: alguem acrescenta
  // tabela numa e esquece a outra, e o preenchimento passa a deixar linha
  // vazia sem ninguem notar. A 021 importa a lista da 018.
  const m021 = require('../db/migrations/021_preencher_clinica_vazia.js');
  const m018 = require('../db/migrations/018_clinicas.js');
  assert.strictEqual(m021.ALVOS, m018.LISTAS.OBRIGATORIA,
    'a 021 tem de apontar para a MESMA lista, nao a uma igual');
  assert.strictEqual(m021.ALVOS.length, 26);
});

test('a 021 nao toca as duas tabelas em que vazio tem significado', function () {
  const m021 = require('../db/migrations/021_preencher_clinica_vazia.js');
  for (const t of ['system_settings', 'system_logs']) {
    assert.strictEqual(m021.ALVOS.indexOf(t), -1,
      t + ': ali vazio significa "e da instalacao". Preencher faria o token do ' +
      'cron aparecer na configuracao de alguem.');
  }
});

/* ================================== a 027: a M1.8, a terceira barreira */

test('a 027 usa a MESMA lista da 018, e nao uma copia', function () {
  const m027 = require('../db/migrations/027_chaves_compostas.js');
  const m018 = require('../db/migrations/018_clinicas.js');
  assert.strictEqual(m027.ALVOS, m018.LISTAS.OBRIGATORIA,
    'a 027 tem de apontar para a MESMA lista, nao a uma igual');
  assert.strictEqual(m027.ALVOS.length, 26);
});

test('a 027 NAO poe chave de clinica nas duas tabelas da instalacao', function () {
  const m027 = require('../db/migrations/027_chaves_compostas.js');
  for (const t of ['system_settings', 'system_logs']) {
    assert.strictEqual(m027.ALVOS.indexOf(t), -1,
      t + ' nao pode entrar: ali `clinica_id` vazio significa "e da instalacao inteira", e ' +
      'chave estrangeira em coluna vazia nao e conferida -- entao a chave nao protegeria ' +
      'nada e ainda impediria apagar clinica por causa de um log.');
  }
});

test('o mapa PONTEIROS da 027 aponta so para tabelas de clinica', function () {
  // O mapa mede o BURACO (as relacoes que seguem sem chave estrangeira). Mapa
  // errado sobre o proprio esquema e pior do que nenhum: ele produz um
  // relatorio de cobertura que ninguem consegue conferir.
  const m027 = require('../db/migrations/027_chaves_compostas.js');
  const dentro = m027.ALVOS;
  for (const chave of Object.keys(m027.PONTEIROS)) {
    const partes = chave.split('.');
    assert.strictEqual(partes.length, 2, chave + ': a chave do mapa e `tabela.coluna`');
    assert.ok(dentro.indexOf(partes[0]) !== -1,
      chave + ': `' + partes[0] + '` nao e uma das 26 tabelas de clinica');
    assert.ok(dentro.indexOf(m027.PONTEIROS[chave]) !== -1,
      chave + ': o pai `' + m027.PONTEIROS[chave] + '` nao e uma das 26 tabelas de clinica');
    assert.strictEqual(m027.POLIMORFICOS.indexOf(chave), -1,
      chave + ': esta nos dois mapas. Escolha um.');
  }
  assert.ok(Object.keys(m027.PONTEIROS).length >= 30,
    'o mapa tem de cobrir todas as colunas que apontam para um pai');
});

/** Um banco de mentira que anda o caminho inteiro da 027.
 *
 *  `opcoes.cruzadas` faz a conferencia de linha cruzada achar uma linha.
 *  A segunda leitura das chaves estrangeiras devolve o estado DEPOIS, porque as
 *  conferencias finais da migration leem tudo de novo do banco -- e um teste que
 *  devolvesse o estado de antes reprovaria a migration por engano. */
function bancoDa027(opcoes) {
  opcoes = opcoes || {};
  const m027 = require('../db/migrations/027_chaves_compostas.js');
  const ALVOS = m027.ALVOS;
  const comandos = [];
  let leiturasDeChaves = 0;

  const antiga = { nome: 'stock_batches_ibfk_1', tab: 'stock_batches', col: 'clinica_id',
                   pai: 'products', paiCol: 'id', del: 'CASCADE', upd: 'RESTRICT' };
  function linhasDaChaveAntiga() {
    return [{ nome: 'stock_batches_ibfk_1', tab: 'stock_batches', col: 'product_id',
              pai: 'products', paiCol: 'id', pos: 1, del: 'CASCADE', upd: 'RESTRICT' }];
  }
  function linhasDepois() {
    const l = [];
    for (const t of ALVOS) {
      l.push({ nome: 'fk_' + t + '_clinica', tab: t, col: 'clinica_id', pai: 'clinicas',
               paiCol: 'id', pos: 1, del: 'RESTRICT', upd: 'RESTRICT' });
    }
    l.push({ nome: 'fk_stock_batches_product_id_clinica', tab: 'stock_batches',
             col: 'clinica_id', pai: 'products', paiCol: 'clinica_id', pos: 1,
             del: 'CASCADE', upd: 'RESTRICT' });
    l.push({ nome: 'fk_stock_batches_product_id_clinica', tab: 'stock_batches',
             col: 'product_id', pai: 'products', paiCol: 'id', pos: 2,
             del: 'CASCADE', upd: 'RESTRICT' });
    return l;
  }

  const conn = {
    async query(sql) {
      const t = String(sql).replace(/\s+/g, ' ').trim();
      comandos.push(t);
      if (/FROM information_schema.TABLES/.test(t)) {
        return [ALVOS.concat(['clinicas']).map((x) => ({ t: x }))];
      }
      if (/COLLATION_NAME AS co/.test(t)) {
        return [[{ co: 'utf8mb4_unicode_ci', cs: 'utf8mb4', ty: 'varchar(50)' }]];
      }
      if (/FROM information_schema.COLUMNS/.test(t)) {
        return [[{ t: 'stock_batches', c: 'product_id' }]];
      }
      if (/FROM information_schema.KEY_COLUMN_USAGE/.test(t)) {
        leiturasDeChaves += 1;
        return [leiturasDeChaves === 1 ? linhasDaChaveAntiga() : linhasDepois()];
      }
      if (/FROM information_schema.STATISTICS/.test(t)) {
        // Todo indice de que a migration precisa ja existe: o teste mede a
        // ordem dos ALTER, e nao a criacao de indice.
        return [[{ i: 'idx_clinica', c: 'clinica_id', s: 1 },
                 { i: 'uq_x', c: 'clinica_id', s: 1 }, { i: 'uq_x', c: 'id', s: 2 },
                 { i: 'ix_y', c: 'clinica_id', s: 1 }, { i: 'ix_y', c: 'product_id', s: 2 }]];
      }
      if (/LEFT JOIN clinicas/.test(t)) return [[{ n: 0 }]];
      if (/SELECT x.id AS id FROM/.test(t)) {
        return [opcoes.cruzadas ? [{ id: 'lt_b_cruz' }] : []];
      }
      if (/LEFT JOIN `products` p/.test(t) || /LEFT JOIN `\w+` p ON p.id/.test(t)) {
        return [[{ n: opcoes.cruzadas ? 1 : 0 }]];
      }
      if (/COUNT\(\*\)/.test(t)) return [[{ n: 3 }]];
      return [[]];
    }
  };
  return { conn: conn, comandos: comandos, antiga: antiga };
}

test('a 027 aborta com linha cruzada e NAO cria chave nenhuma', async function () {
  // A garantia que importa nao e "ela aborta": e que ela aborta ANTES de
  // qualquer ADD CONSTRAINT. Meio caminho andado deixa parte das gravacoes
  // recusada e a outra nao, e o sintoma na tela fica impossivel de ler.
  const up = require('../db/migrations/027_chaves_compostas.js');
  const b = bancoDa027({ cruzadas: true });
  await assert.rejects(() => up(b.conn), /NADA foi alterado/,
    'com linha cruzada, ela para e diz que nada mudou');
  const criadas = b.comandos.filter((c) => /ADD CONSTRAINT/.test(c));
  assert.deepStrictEqual(criadas, [],
    'ela nao pode ter criado chave nenhuma antes de abortar');
});

test('a 027 acrescenta a chave composta ANTES de apagar a de uma coluna', async function () {
  // Esta ordem e a unica sem estado ruim. Se o ADD falhar, a chave antiga
  // continua inteira; se o DROP falhar, sobram as duas conferindo a mesma
  // coisa, que e redundancia e nao defeito.
  //
  // A ordem contraria -- apagar e depois criar -- deixa a relacao SEM chave
  // nenhuma se o passo de tras falhar. E o passo de tras falha justamente na
  // hora em que ninguem esta olhando.
  const up = require('../db/migrations/027_chaves_compostas.js');
  const b = bancoDa027();
  const r = await up(b.conn);

  const iAdd = b.comandos.findIndex((c) =>
    /ADD CONSTRAINT `fk_stock_batches_product_id_clinica`/.test(c));
  const iDrop = b.comandos.findIndex((c) => /DROP FOREIGN KEY `stock_batches_ibfk_1`/.test(c));
  assert.ok(iAdd !== -1, 'a chave composta tem de ser criada');
  assert.ok(iDrop !== -1, 'a chave de uma coluna tem de ser apagada');
  assert.ok(iAdd < iDrop,
    'a composta tem de ser criada ANTES de a antiga ser apagada -- a ordem contraria deixa ' +
    'a relacao sem chave nenhuma se o segundo comando falhar');

  // E a chave nova tem de apagar como a antiga apagava.
  const add = b.comandos[iAdd];
  assert.match(add, /ON DELETE CASCADE/,
    'a chave nova herda o ON DELETE da antiga. Trocar isso por RESTRICT vira "erro ao ' +
    'excluir paciente" na tela -- e essa sabotagem passou o ensaio inteiro verde em 10/09.');
  assert.match(add, /FOREIGN KEY \(clinica_id, `product_id`\)/,
    'a chave tem de ser das DUAS colunas');
  assert.strictEqual(r.chavesCompostas.length, 1);
});

test('a volta da M1.8 existe, e esta DESLIGADA', function () {
  const fs = require('fs');
  const dir = path.join(__dirname, '..', 'db', 'migrations');
  const arquivos = fs.readdirSync(dir);
  assert.ok(arquivos.indexOf('028_reverter_m18.js.desligada') !== -1,
    'o caminho de volta da M1.8 tem de existir em db/migrations/');
  assert.strictEqual(arquivos.filter((f) => /^028_.*\.(js|sql)$/.test(f)).length, 0,
    'o arquivo de reversao NAO pode terminar em .js: o runner o aplicaria no proximo deploy ' +
    'e desfaria a M1.8 sozinho.');
});

test('quem desliga foreign_key_checks no ensaio tem de religar E conferir a contencao',
  function (t) {
    /* A semente do ensaio precisa criar linha cruzada para medir os filtros de
     * leitura -- e desde a M1.8 o banco recusa linha cruzada. A saida foi
     * desligar a conferencia so no trecho das cruzadas.
     *
     * O risco disso e a regra 20: a 3a barreira (contencao) apagaria a medicao
     * da 1a (o filtro do SELECT), e a resposta facil -- desligar e esquecer --
     * deixaria a contencao sem NENHUMA conferencia. Este teste amarra as tres
     * coisas: desligou, religou, e o bloco [P] mede que com a conferencia
     * ligada o banco recusa. */
    const fs = require('fs');
    const arq = path.join(__dirname, '..', 'scripts', 'verificar-vazamento.mjs');

    /* O ensaio de vazamento e de REPOSITORIO: ele cria e derruba banco, e nao
     * vai para o servidor. Numa copia sem ele nao ha nada a cobrar -- mas o
     * jeito de dizer isso e `t.skip`, e nao um `return` calado.
     *
     * A diferenca importa: com `skip`, o `npm test` mostra `# skipped 1` e
     * qualquer um ve que uma conferencia nao rodou. Com `return`, ela conta
     * como aprovada. Teste que se cala sem avisar e exatamente o defeito que
     * este projeto passa o dia cacando. */
    if (!fs.existsSync(arq)) {
      t.skip('scripts/verificar-vazamento.mjs nao esta nesta copia (ele e de repositorio e ' +
             'nao vai para o servidor). No repositorio esta conferencia roda.');
      return;
    }

    const fonte = fs.readFileSync(arq, 'utf8');
    assert.match(fonte, /foreign_key_checks = 0/,
      'o ensaio precisa desligar a conferencia para semear as linhas cruzadas -- sem elas ' +
      'ele passa verde sem exercitar filtro nenhum, que e o defeito de 09/09.');
    assert.match(fonte, /foreign_key_checks = 1/,
      'o ensaio desliga foreign_key_checks e nao religa. Tudo que vier depois das linhas ' +
      'cruzadas deixa de ser conferido pelo banco, em silencio.');
    assert.match(fonte, /\[P\] a terceira barreira/,
      'o ensaio desliga foreign_key_checks e nao tem o bloco [P]. "Desliguei para semear" ' +
      'nao pode virar "nunca mais conferi se a contencao existe": sem o bloco, apagar as ' +
      'oito chaves compostas por acidente nao deixaria nenhuma conferencia vermelha.');
    assert.ok(fonte.indexOf('foreign_key_checks = 0') <
              fonte.indexOf('foreign_key_checks = 1'),
      'religar tem de vir DEPOIS de desligar');
  });

/* ============ a captacao publica por clinica (029 + leads-publico), 11/09 */

test('a chave de captacao leva o lead para a clinica dela', function () {
  const decidir = require('../server/routes/leads-publico.js').decidirClinica;
  const clinicas = [
    { id: 'cl_1', chave_captacao: 'cap_aaa' },
    { id: 'cl_b', chave_captacao: 'cap_bbb' }
  ];
  assert.strictEqual(decidir('cap_bbb', clinicas).clinicaId, 'cl_b');
  assert.strictEqual(decidir('cap_aaa', clinicas).clinicaId, 'cl_1');
});

test('chave que nao existe e RECUSA, com uma clinica ou com cinquenta', function () {
  // Este e o caso do site mal configurado. Com uma clinica so, seria tentador
  // "cair na unica que existe" -- e aí ninguem descobriria que a chave estava
  // errada ate existir a segunda, quando os leads comecariam a sumir.
  const decidir = require('../server/routes/leads-publico.js').decidirClinica;
  const uma = [{ id: 'cl_1', chave_captacao: 'cap_aaa' }];
  const duas = uma.concat([{ id: 'cl_b', chave_captacao: 'cap_bbb' }]);
  for (const lista of [uma, duas]) {
    const r = decidir('cap_inventada', lista);
    assert.ok(r.recusa, 'chave inexistente tem de recusar (lista de ' + lista.length + ')');
    assert.strictEqual(r.clinicaId, undefined);
    assert.match(r.recusa, /cap_inventada/,
      'a recusa tem de nomear a chave: e ela que diz qual site esta configurado errado');
  }
});

test('sem chave: aceita com UMA clinica, recusa a partir da segunda', function () {
  // A ponte e a promessa central desta tarefa. O formulario que esta no ar hoje
  // nao manda chave, e nao pode parar de gravar no dia em que a migration rodar.
  // Mas no instante em que existir a segunda clinica, "de quem e este lead?"
  // deixa de ter resposta -- e chutar arquiva dinheiro debaixo do nome errado.
  const decidir = require('../server/routes/leads-publico.js').decidirClinica;
  const uma = [{ id: 'cl_1', chave_captacao: 'cap_aaa' }];
  assert.strictEqual(decidir('', uma).clinicaId, 'cl_1');
  assert.strictEqual(decidir(undefined, uma).clinicaId, 'cl_1');

  const duas = uma.concat([{ id: 'cl_b', chave_captacao: 'cap_bbb' }]);
  const r = decidir('', duas);
  assert.ok(r.recusa, 'com duas clinicas e sem chave, tem de recusar');
  assert.match(r.recusa, /captacao/,
    'a recusa tem de dizer o que fazer, nao so que falhou');

  assert.ok(decidir('cap_aaa', []).recusa, 'sem clinica nenhuma, recusa');
});

test('a chave de captacao nasce unica e reconhecivel', function () {
  const m029 = require('../db/migrations/029_chave_de_captacao.js');
  const vistas = new Set();
  for (let i = 0; i < 200; i++) {
    const c = m029.novaChave();
    assert.match(c, /^cap_[0-9a-f]{24}$/,
      'a chave tem de ter prefixo reconhecivel: ela vai aparecer solta num HTML e alguem vai ' +
      'se perguntar o que e');
    assert.ok(!vistas.has(c), 'chave repetida: mandaria o lead de uma clinica para a outra');
    vistas.add(c);
  }
});

test('a regra de papel da captacao NAO fecha o funil inteiro', function () {
  /* A armadilha das rotas aninhadas, pela terceira vez neste projeto: uma regra
   * com `prefixo: '/api/leads'` valeria para `/api/leads` tambem, e o vendedor
   * -- que trabalha lead o dia inteiro -- perderia a tela dele. Por isso a
   * regra da chave usa `padrao`. */
  const { regraPara } = require('../server/middleware/autorizacao.js');

  const daChave = regraPara('GET', '/api/leads/captacao');
  assert.ok(daChave, 'a rota da chave precisa de regra: ela e configuracao, nao trabalho de funil');
  assert.deepStrictEqual(daChave.papeis.slice().sort(), ['admin', 'gerente']);

  const doFunil = regraPara('GET', '/api/leads');
  assert.ok(!doFunil || doFunil.papeis.indexOf('vendedor') !== -1,
    'o funil tem de continuar aberto ao vendedor -- e ele quem trabalha lead');
});

/* ============ o operador da plataforma (M3.1, 14/09) */

test('o token da plataforma NAO tem clinica e NAO tem papel', function () {
  /* As duas ausencias sao a tarefa inteira, e nao detalhe de implementacao:
   *
   *  - sem `clinicaId`, o porteiro do CRM recusa este token em toda rota de
   *    clinica e `escopo(req)` estoura se alguem tentar consultar com ele. A
   *    separacao nao depende de ninguem lembrar dela;
   *  - sem `papel`, ele nao cai por acidente numa regra de `exigirPapel` que
   *    aceite 'admin' -- que e como um operador de plataforma vira, sem querer,
   *    administrador de todas as clinicas. */
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
  const plataforma = require('../server/middleware/plataforma.js');
  const jwt = require('jsonwebtoken');

  const token = plataforma.gerarToken({ id: 'op_1', nome: 'Fulana', email: 'f@mulino.invalido' });
  const carga = jwt.verify(token, process.env.JWT_SECRET);

  assert.strictEqual(carga.plataforma, true, 'o token precisa se identificar como de plataforma');
  assert.strictEqual(carga.clinicaId, undefined, 'operador de plataforma NAO pode ter clinica no token');
  assert.strictEqual(carga.papel, undefined, 'operador de plataforma NAO pode ter papel no token');
});

test('a lista da plataforma nega por padrao, inclusive o vizinho de prefixo', function () {
  const { ehRotaDaPlataforma } = require('../server/middleware/plataforma.js');

  assert.ok(ehRotaDaPlataforma('GET', '/api/plataforma/clinicas'), 'a listagem tem de passar');
  assert.ok(ehRotaDaPlataforma('POST', '/api/plataforma/clinicas'), 'o cadastro tem de passar');
  assert.ok(ehRotaDaPlataforma('GET', '/api/plataforma/clinicas/cl_9/conferencia'));

  // O que NAO pode passar, e cada um por um motivo diferente:
  assert.ok(!ehRotaDaPlataforma('GET', '/api/clients'), 'ficha de paciente jamais');
  assert.ok(!ehRotaDaPlataforma('GET', '/api/documents'), 'documento clinico jamais');
  assert.ok(!ehRotaDaPlataforma('DELETE', '/api/plataforma/clinicas'),
    'metodo que nao esta na lista nao herda o caminho que esta');
  assert.ok(!ehRotaDaPlataforma('GET', '/api/plataforma/clinicas/cl_9/pacientes'),
    'rota FUTURA pendurada no mesmo caminho nao pode nascer liberada -- e a razao de nao usar prefixo');
  assert.ok(!ehRotaDaPlataforma('GET', '/api/plataformax'),
    'vizinho de prefixo nao herda: a armadilha do /api/logs-publicos, de novo');
});

test('TODA rota montada na plataforma esta na lista de permissao', function () {
  /* Esta e a conferencia que sobrevive a mim. Daqui a tres meses alguem
   * acrescenta `GET /api/plataforma/clinicas/:id/pacientes` "so para o suporte
   * ver", e o porteiro nao tem como saber que aquilo nao devia existir -- a rota
   * responderia normalmente se estivesse na lista, e daria 403 se nao estivesse.
   *
   * O que este teste cobra e o contrario: rota montada que NAO esta na lista e
   * erro de quem a escreveu, e o teste falha na hora, dizendo o nome dela. A
   * lista deixa de ser documentacao e vira contrato. */
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
  const router = require('../server/routes/plataforma.js');
  const { ehRotaDaPlataforma } = require('../server/middleware/plataforma.js');
  const { ehRotaPublica } = require('../server/middleware/autenticacao.js');

  const montadas = [];
  for (const camada of router.stack) {
    if (!camada.route) continue;
    for (const metodo of Object.keys(camada.route.methods)) {
      if (camada.route.methods[metodo]) {
        montadas.push({ metodo: metodo.toUpperCase(), caminho: camada.route.path });
      }
    }
  }

  assert.ok(montadas.length >= 4, 'esperava ao menos 4 rotas montadas, achei ' + montadas.length +
    ' -- zero aqui faria este teste passar sem conferir nada');

  /* Cada rota deste arquivo tem de ser governada por ALGUMA coisa, e o teste
   * cobra qual. Sao tres possibilidades legitimas, e nenhuma outra:
   *
   *   - estar na LISTA DA PLATAFORMA (o operador alcanca);
   *   - ser PUBLICA (a porta de entrada, que existe para obter o token);
   *   - ter REGRA DE PAPEL (o caso do primeiro operador, chamado por um admin de
   *     clinica -- e por isso ele mora fora de /api/plataforma, que e recusado a
   *     todo token de clinica).
   *
   * Rota sem nenhuma das tres e rota que ninguem decidiu proteger. */
  const { regraPara } = require('../server/middleware/autorizacao.js');

  const semGoverno = montadas.filter(function (r) {
    // `:id` vira um valor qualquer para a expressao regular da lista poder casar.
    const concreto = r.caminho.replace(/:[^/]+/g, 'valor_de_teste');
    if (ehRotaPublica(r.metodo, concreto)) return false;
    if (ehRotaDaPlataforma(r.metodo, concreto)) return false;
    return !regraPara(r.metodo, concreto);
  });

  assert.deepStrictEqual(semGoverno, [],
    'rota(s) em routes/plataforma.js que ninguem protege: ' +
    semGoverno.map(function (r) { return r.metodo + ' ' + r.caminho; }).join(', ') +
    '. Acrescente a lista da plataforma (e explique por que ela nao le dado de clinica), ' +
    'ou uma regra de papel, ou tire a rota.');

  /* E o contrario, que e o que pega o descuido de verdade: nenhuma rota sob
   * /api/plataforma pode depender SO de regra de papel. Aquele caminho e recusado
   * a todo token de clinica, entao uma regra de papel ali seria letra morta -- e
   * quem a escrevesse acharia estar protegendo alguma coisa. */
  const enganosas = montadas.filter(function (r) {
    const concreto = r.caminho.replace(/:[^/]+/g, 'valor_de_teste');
    if (concreto.indexOf('/api/plataforma/') !== 0) return false;
    if (ehRotaPublica(r.metodo, concreto)) return false;
    return !ehRotaDaPlataforma(r.metodo, concreto);
  });
  assert.deepStrictEqual(enganosas, [],
    'rota(s) sob /api/plataforma fora da lista de permissao: ' +
    enganosas.map(function (r) { return r.metodo + ' ' + r.caminho; }).join(', '));
});

test('a senha minima do operador e a mesma nos DOIS caminhos que criam um', function () {
  /* Ha duas portas para nascer um operador -- o comando no servidor e a rota do
   * primeiro -- e cada uma confere a senha por conta propria. Duas verdades sobre
   * a mesma regra divergem na terceira semana: alguem aperta uma e esquece a
   * outra, e passa a existir um caminho com a regra frouxa. O teste nao unifica o
   * codigo (sao contextos diferentes); ele cobra que os NUMEROS nao divirjam. */
  const fs = require('fs');
  const p = require('path');
  const daRota = fs.readFileSync(
    p.join(__dirname, '..', 'server', 'routes', 'plataforma.js'), 'utf8');
  const doComando = fs.readFileSync(
    p.join(__dirname, '..', 'scripts', 'criar-operador.js'), 'utf8');

  const naRota = (daRota.match(/SENHA_MINIMA_DO_OPERADOR\s*=\s*(\d+)/) || [])[1];
  const noComando = (doComando.match(/SENHA_MINIMA\s*=\s*(\d+)/) || [])[1];

  assert.ok(naRota, 'nao achei a senha minima em routes/plataforma.js');
  assert.ok(noComando, 'nao achei a senha minima em scripts/criar-operador.js');
  assert.strictEqual(naRota, noComando,
    'as duas portas que criam operador exigem senhas de tamanhos diferentes: rota ' + naRota +
    ', comando ' + noComando);
  assert.ok(Number(naRota) >= 12,
    'a senha do operador abre a lista de TODAS as clinicas: 12 caracteres e o piso');
});

test('so o LOGIN da plataforma e publico', function () {
  const { ehRotaPublica } = require('../server/middleware/autenticacao.js');

  assert.ok(ehRotaPublica('POST', '/api/plataforma/login'),
    'sem isto ninguem consegue entrar: o porteiro exigiria um token para pedir um token');
  assert.ok(!ehRotaPublica('GET', '/api/plataforma/clinicas'),
    'a lista das clinicas NAO pode ser publica');
  assert.ok(!ehRotaPublica('POST', '/api/plataforma/clinicas'),
    'cadastrar clinica sem credencial seria a pior rota publica ja escrita neste projeto');
});

test('a rota interina POST /api/clinicas foi APAGADA, e nao desativada', function () {
  /* Ela nasceu em 11/09 com papel `admin` e o cabecalho dizia, em letras
   * grandes, que era interina -- criar clinica e operacao de plataforma, e quem
   * administra a Clinica A nao deveria poder criar a Clinica C.
   *
   * Aviso em comentario nao barra ninguem: isso ja custou caro neste projeto em
   * 10/09, quando um aviso escrito desde 04/09 nao impediu a perda do CASCADE.
   * Entao o teste cobra a ausencia do arquivo, e nao a boa intencao dele. */
  const fs = require('fs');
  const path = require('path');
  const raiz = path.join(__dirname, '..');

  assert.ok(!fs.existsSync(path.join(raiz, 'server', 'routes', 'clinicas.js')),
    'server/routes/clinicas.js voltou a existir: criar clinica e da plataforma desde 14/09');

  const app = fs.readFileSync(path.join(raiz, 'server', 'app.js'), 'utf8');
  assert.ok(!/require\(['"]\.\/routes\/clinicas['"]\)/.test(app),
    'app.js ainda monta routes/clinicas');
  assert.ok(/require\(['"]\.\/routes\/plataforma['"]\)/.test(app),
    'app.js precisa montar routes/plataforma');
});

test('a autorizacao por papel NAO tenta regrar a plataforma', function () {
  /* Parece prudente pendurar tambem uma regra de papel em /api/plataforma. Seria
   * pior: o operador nao tem `papel`, entao a regra nunca casaria com ele e
   * daria a impressao de duas travas entregando meia. E, se alguem escrevesse a
   * regra com papeis: ['admin'], o administrador de uma clinica passaria a
   * alcancar a plataforma -- exatamente o que esta tarefa veio desfazer. */
  const { regraPara } = require('../server/middleware/autorizacao.js');

  const daLista = regraPara('GET', '/api/plataforma/clinicas');
  assert.strictEqual(daLista, null,
    'nao pode haver regra de PAPEL para /api/plataforma: o alcance e lista de rotas, um lugar so');

  const daInterina = regraPara('POST', '/api/clinicas');
  assert.strictEqual(daInterina, null,
    'a regra da rota interina tem de ter saido junto com a rota');
});

test('o teto de requisicoes por minuto continua 120 quando ninguem configura', function () {
  /* A variavel existe para o ENSAIO poder afrouxar o limite, e essa e a unica
   * razao dela. Producao nao a define -- e este teste e a trava para ela nao
   * virar, num dia apressado, um `|| '100000'` que desliga a protecao de todo
   * mundo porque "estava atrapalhando os testes". */
  const fs = require('fs');
  const app = fs.readFileSync(
    require('path').join(__dirname, '..', 'server', 'app.js'), 'utf8');

  const linha = app.split('\n').filter((l) => l.indexOf('LIMITE_API_POR_MINUTO') !== -1)[0] || '';
  assert.ok(/\|\|\s*'120'/.test(linha),
    'o padrao do teto por minuto tem de ser 120; achei: ' + linha.trim());
});

/* ============ o acesso de suporte, com prazo (M3.1b, 14/09) */

test('a lista de suporte e so de LEITURA, e o prontuario fica fora', function () {
  const p = require('../server/middleware/plataforma.js');

  // O que o suporte alcanca:
  assert.ok(p.ehRotaDeSuporte('GET', '/api/appointments'), 'a agenda e o caso de uso numero 1');
  assert.ok(p.ehRotaDeSuporte('GET', '/api/logs'), 'a trilha e onde se investiga');
  assert.ok(p.ehRotaDeSuporte('GET', '/api/users'), 'problema de acesso e o chamado mais comum');

  // Prontuario: nao entra nem com autorizacao.
  for (const rota of ['/api/clients', '/api/clients/c_1', '/api/clients/c_1/documents',
                      '/api/clients/c_1/alerts', '/api/documents', '/api/document-templates']) {
    assert.ok(!p.ehRotaDeSuporte('GET', rota),
      rota + ' NAO pode entrar na lista de suporte: dado de saude e o que este projeto separa');
  }

  // Escrita: nenhuma.
  for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.ok(!p.ehRotaDeSuporte(metodo, '/api/appointments'),
      metodo + ' nao pode passar: suporte investiga, nao mexe');
  }
});

test('o token de suporte NAO e aceito como token de plataforma', function () {
  /* Os dois lados, de novo (regra 26): se `cargaDaRequisicao` aceitasse um token
   * de suporte, uma sessao de leitura de UMA clinica viraria credencial de
   * plataforma sobre TODAS. */
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
  const p = require('../server/middleware/plataforma.js');
  const jwt = require('jsonwebtoken');

  const tokenSup = p.gerarTokenDeSuporte(
    { sub: 'op_1', nome: 'Fulana', email: 'f@mulino.invalido' }, 'cl_1');
  const carga = jwt.verify(tokenSup, process.env.JWT_SECRET);

  assert.strictEqual(carga.suporte, true);
  assert.strictEqual(carga.clinicaId, 'cl_1', 'ele PRECISA de clinica: e assim que escopo funciona');
  assert.strictEqual(carga.plataforma, undefined, 'e NAO pode se declarar plataforma');

  const req = { headers: { authorization: 'Bearer ' + tokenSup } };
  assert.strictEqual(p.cargaDaRequisicao(req), null,
    'o porteiro nao pode tratar uma sessao de suporte como credencial de plataforma');
  assert.ok(p.cargaDeSuporte(req), 'mas tem de reconhece-la como suporte');
});

test('conceder e revogar suporte e de admin; ler, nao', function () {
  const { regraPara } = require('../server/middleware/autorizacao.js');

  assert.deepStrictEqual(regraPara('POST', '/api/suporte').papeis, ['admin'],
    'quem abre a porta da propria clinica e o dono dela');
  assert.deepStrictEqual(regraPara('DELETE', '/api/suporte').papeis, ['admin']);
  assert.strictEqual(regraPara('GET', '/api/suporte'), null,
    'a leitura fica aberta para o proprio suporte ver ate quando foi autorizado');
});

test('a concessao tem prazo obrigatorio, e teto', function () {
  const fs = require('fs');
  const fonte = fs.readFileSync(
    require('path').join(__dirname, '..', 'server', 'routes', 'suporte.js'), 'utf8');

  assert.ok(/HORAS_MAXIMAS\s*=\s*(\d+)/.test(fonte), 'precisa existir um teto de horas');
  assert.ok(/expira_em/.test(fonte), 'a concessao tem de gravar quando expira');
  assert.ok(/DATE_ADD\(NOW\(\)/.test(fonte),
    'o prazo sai do relogio do BANCO, e nao do relogio de quem chamou');
  assert.ok(!/INTERVAL\s+(NULL|0)/.test(fonte), 'nao pode haver concessao sem prazo');
});

test('o porteiro confere a concessao NO BANCO, e nao so no token', function () {
  /* Se a conferencia ficasse so na emissao, revogar nao teria efeito nenhum
   * pelos 30 minutos seguintes -- e "revogar" que demora meia hora nao e
   * revogar, e um pedido. */
  const fs = require('fs');
  const fonte = fs.readFileSync(
    require('path').join(__dirname, '..', 'server', 'middleware', 'autenticacao.js'), 'utf8');

  const i = fonte.indexOf('cargaDeSuporte');
  assert.ok(i !== -1, 'o porteiro precisa tratar a sessao de suporte');
  const bloco = fonte.slice(i, fonte.indexOf('const usuario = auth.usuarioDaRequisicao', i));

  assert.ok(/concessaoViva/.test(bloco),
    'a cada requisicao de suporte, a concessao tem de ser lida do banco');
  assert.ok(/ehRotaDeSuporte/.test(bloco),
    'e a rota tem de estar na lista de leitura');
});

/* ============ a porta de dentro: criar lead com sessao (11/09) */

test('a rota de cadastro manual de lead NAO e publica', function () {
  /* O defeito que ela conserta: duas telas do CRM -- o "iniciar conversa" do
   * Atendimento e o "adicionar lead" do Kanban -- criavam lead pela rota
   * PUBLICA do formulario do site. Funcionou enquanto havia uma clinica so,
   * porque a rota publica sem chave respondia "a unica que existe"; no dia da
   * segunda clinica as duas telas passaram a receber 503 em producao.
   *
   * A rota de dentro so tem valor se ela for de dentro: se alguem a acrescentar
   * as rotas publicas "para facilitar um teste", ela vira uma segunda porta de
   * rua, e essa sem nem a chave de captacao. */
  const { ehRotaPublica } = require('../server/middleware/autenticacao.js');

  assert.ok(!ehRotaPublica('POST', '/api/leads/manual'),
    'a rota de cadastro com sessao NAO pode estar na lista de rotas publicas');
  assert.ok(ehRotaPublica('POST', '/api/leads'),
    'e a captacao do site continua publica -- se esta falhar, o formulario parou de gravar');
});

test('a rota de cadastro manual tira a clinica da sessao, e nao do pedido', function () {
  /* Ela grava lead, entao a marca `:clinica` tem de estar na insercao -- a
   * camada recusaria sem ela, mas o teste fixa o desenho: a clinica sai de
   * `escopo(req)`, e nao de um campo do corpo que o navegador poderia escolher. */
  const fonte = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'server', 'routes', 'leads.js'), 'utf8');

  const i = fonte.indexOf("router.post('/api/leads/manual'");
  assert.ok(i !== -1, 'a rota autenticada de cadastro de lead precisa existir em routes/leads.js');
  const corpo = fonte.slice(i, fonte.indexOf('\n});', i));

  assert.ok(/escopo\(req\)/.test(corpo),
    'a rota tem de usar escopo(req): e de la que a clinica vem');
  assert.ok(/:clinica/.test(corpo),
    'a insercao tem de carimbar :clinica');
  assert.ok(!/req\.body[^\n]*clinica/i.test(corpo) && !/req\.query[^\n]*clinica/i.test(corpo),
    'a clinica NAO pode sair do corpo nem da URL: bastaria trocar um campo para gravar na vizinha');
  assert.ok(!/captacao/i.test(corpo),
    'chave de captacao e coisa da porta publica; aqui ha sessao, e sessao e melhor que chave');
});

/* ===================== o IP da trilha de auditoria (11/09) */

test('a aplicacao declara trust proxy, e NAO por numero de saltos', function () {
  /* Medido em producao em 11/09: sem esta declaracao, a trilha de auditoria
   * inteira tinha um unico `ip_address` -- `127.0.0.1`, o do proxy. Desde
   * sempre. "De onde veio esta acao?" nao tinha resposta em registro nenhum.
   *
   * E o teste cobra mais do que a existencia: cobra que NAO seja um numero.
   * `trust proxy: 1` confia nos N primeiros enderecos da lista sem olhar quem
   * sao -- e se a topologia mudar, o Express passa a acreditar no endereco que
   * o proprio visitante escreveu em `X-Forwarded-For`. Aí qualquer um forja o
   * proprio IP na trilha e no limite de envios, e a linha que existia para dar
   * identidade passa a dar disfarce. */
  const app = require('../server/app.js');
  const valor = app.get('trust proxy');
  assert.ok(valor !== undefined && valor !== false,
    'sem `app.set("trust proxy", ...)`, req.ip e o do proxy e a coluna ip_address da trilha ' +
    'de auditoria nao diz nada');
  assert.notStrictEqual(typeof valor, 'number',
    'numero de saltos confia sem olhar quem e. Use `loopback` (ou a lista de enderecos do ' +
    'proxy): assim, se a topologia mudar, isto para de confiar sozinho em vez de confiar demais');
});

/* ================= o nascimento de uma clinica (M2.4 + migration 030), 11/09 */

test('a clinica so nasce com nome, administrador, e-mail e senha de 10', function () {
  const { conferirDados, SENHA_MINIMA } = require('../server/services/nascimento-clinica.js');
  const bom = { nome: 'Clinica X', adminNome: 'Fulana', adminEmail: 'f@x.com',
                adminSenha: 'senha-longa-1' };
  assert.strictEqual(conferirDados(bom).erro, undefined);
  assert.strictEqual(conferirDados(bom).adminEmail, 'f@x.com');

  assert.match(conferirDados({ ...bom, nome: '  ' }).erro, /nome/i);
  assert.match(conferirDados({ ...bom, adminNome: '' }).erro, /administrar/i);
  assert.match(conferirDados({ ...bom, adminEmail: 'sem-arroba' }).erro, /e-mail/i);
  assert.match(conferirDados({ ...bom, adminSenha: 'curta' }).erro, /senha/i);
  assert.strictEqual(SENHA_MINIMA, 10, 'o minimo tem de bater com o da rota de usuarios');

  // O e-mail e normalizado: `users.email` e unico na plataforma inteira, e
  // "Fulana@X.com" e "fulana@x.com" seriam duas contas para a mesma pessoa.
  assert.strictEqual(conferirDados({ ...bom, adminEmail: '  Fulana@X.COM ' }).adminEmail,
    'fulana@x.com');
});

test('a senha da clinica nova NAO aparece em log nem na resposta', function () {
  /* Ela entra por uma requisicao e sai como hash. Em nenhum ponto ela pode ser
   * registrada, devolvida ou guardada em texto -- e este projeto ja teve quatro
   * senhas em texto puro no banco (apagadas pela migration 022, sem que ninguem
   * soubesse de quem eram). Guarda de codigo-fonte porque o defeito nasce de um
   * "vamos so ecoar o corpo para depurar". */
  const fs = require('fs');
  const servico = fs.readFileSync(
    path.join(__dirname, '..', 'server', 'services', 'nascimento-clinica.js'), 'utf8');
  /* A rota mudou de casa em 14/09: `routes/clinicas.js` (interina, papel admin)
   * virou `routes/plataforma.js`. O teste segue a rota, e nao o nome do arquivo. */
  const rota = fs.readFileSync(
    path.join(__dirname, '..', 'server', 'routes', 'plataforma.js'), 'utf8');

  const semComentario = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  assert.ok(!/adminSenha/.test(semComentario(rota)),
    'a rota nao deve tocar na senha: ela so repassa o corpo para o servico');
  const corpo = semComentario(servico);
  assert.ok(!/(logs|console)[^\n]*adminSenha/.test(corpo),
    'a senha nao pode entrar em log nenhum');
  assert.ok(/bcrypt\.hashSync\(d\.adminSenha/.test(corpo),
    'a senha tem de virar hash antes de chegar ao banco');
  /* O que interessa e o objeto que `criarClinica` DEVOLVE -- e nao qualquer
   * `return` do arquivo. `conferirDados` devolve os dados normalizados por
   * dentro, senha inclusive, e isso e legitimo: e o caminho que leva a senha ate
   * o `hashSync`. A primeira versao deste teste nao fazia essa distincao e
   * ficava vermelha pelo motivo errado. */
  // Corta no fecho do objeto: sem isso a fatia segue ate o fim do arquivo e
  // esbarra em `SENHA_MINIMA` no module.exports -- que e uma constante, nao uma
  // senha. Foi o que deixou este teste vermelho pelo motivo errado na primeira
  // tentativa.
  const bruto = corpo.split('return {').filter((p) => /chaveCaptacao/.test(p))[0] || '';
  const retorno = bruto.indexOf('};') === -1 ? bruto : bruto.slice(0, bruto.indexOf('};'));
  assert.ok(retorno, 'nao achei o retorno de criarClinica (o que traz `chaveCaptacao`) -- ' +
    'o teste precisa ser ajustado, nao ignorado');
  /* Procura o VALOR, e nao a palavra.
   *
   * A primeira versao proibia /senha/i e ficou vermelha por causa da frase
   * "Entre com o e-mail e a senha informados" -- texto para a pessoa ler, e
   * util. Cheque que reprova pelo motivo errado e cheque que se aprende a
   * ignorar. O que nao pode aparecer e o campo: `adminSenha`, `senha:` ou
   * `password:` como propriedade do que sai. */
  const vazaSenha = (t) => /adminSenha|(^|[^a-zA-Z])(senha|password)\s*:/.test(t);
  assert.ok(!vazaSenha(retorno),
    'o que criarClinica devolve nao pode carregar a senha: essa resposta vai para a tela');

  const resposta = semComentario(rota).slice(semComentario(rota).indexOf('res.status(201)'));
  assert.ok(!vazaSenha(resposta),
    'a resposta da rota nao pode carregar a senha');
});

test('a 030 troca a primaria SO das tres tabelas de configuracao', function () {
  const m030 = require('../db/migrations/030_configuracao_por_clinica.js');
  assert.deepStrictEqual(m030.ALVOS.slice().sort(),
    ['finance_categories', 'loyalty_settings', 'pricing_settings']);

  // Nenhuma tabela de DADO pode entrar aqui: trocar a primaria de `clients` ou
  // de `appointments` mexeria no indice agrupado da tabela inteira, e a M1.8 ja
  // deu a essas tabelas o que elas precisavam -- um indice unico
  // (clinica_id, id) para as chaves compostas apontarem.
  for (const t of ['clients', 'appointments', 'products', 'treatment_plans', 'users']) {
    assert.strictEqual(m030.ALVOS.indexOf(t), -1, t + ' nao pode ter a primaria trocada aqui');
  }
});

test('o nascimento usa as MESMAS listas das migrations, nao copias', function () {
  // Duas listas da mesma coisa divergem na terceira semana: foi por isso que a
  // 025 importou a lista da 018 em vez de repeti-la. Aqui o risco e a clinica
  // nova nascer com 15 categorias enquanto a primeira tem 16, e ninguem notar.
  const fs = require('fs');
  const fonte = fs.readFileSync(
    path.join(__dirname, '..', 'server', 'services', 'nascimento-clinica.js'), 'utf8');
  assert.match(fonte, /require\(.*008_financeiro\.js.*\)\.CATEGORIAS/,
    'as categorias vem da migration 008');
  assert.match(fonte, /require\(.*016_documentos\.js.*\)/,
    'os modelos de documento vem da migration 016');
  assert.match(fonte, /require\(.*029_chave_de_captacao\.js.*\)\.novaChave/,
    'a chave de captacao vem do gerador da 029');
  assert.ok(!/cat_procedimentos'\s*,\s*'Procedimentos'/.test(fonte),
    'a lista de categorias NAO pode estar copiada dentro do servico');
});

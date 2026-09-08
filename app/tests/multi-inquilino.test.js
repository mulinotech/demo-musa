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
  assert.match(fonte, /req\.usuario[\s\S]{0,40}clinicaId/,
    'a clinica tem de vir da sessao');

  // E NAO do corpo da requisicao: aceitar clinica_id do cliente deixaria a
  // proprietaria da clinica A criar um acesso dentro da clinica B.
  assert.strictEqual(/b\.clinica_?[Ii]d|body\.clinica/.test(fonte), false,
    'clinica_id nunca vem do corpo da requisicao');
});

'use strict';
/** 018 — M0.1: a tabela `clinicas` e a coluna `clinica_id` em 28 tabelas.
 *
 *  ================================================================= O NOME
 *
 *  A coluna se chama `clinica_id`. NUNCA `client_id`: esse nome já existe em
 *  sete tabelas deste banco e significa **paciente** (`clients` é a tabela de
 *  pacientes). Reaproveitá-lo faria a mesma palavra valer para duas coisas, e
 *  o erro que isso produz não aparece em tela — alguém escreve um filtro
 *  achando que separa clínicas quando separa pacientes, e o sistema mostra a
 *  ficha errada para a pessoa errada, calado.
 *
 *  ============================================ A TRAVA CONTRA TABELA ESQUECIDA
 *
 *  A parte mais importante deste arquivo não são os ALTERs: é a conferência.
 *  Toda tabela do banco tem de estar em EXATAMENTE UMA das três listas abaixo.
 *  Se aparecer uma que não está em nenhuma, a migration **para** e diz o nome.
 *
 *  Por quê: uma tabela sem coluna de inquilino é uma tabela cujo conteúdo é
 *  compartilhado por todas as 50 clínicas — e ninguém descobre isso lendo
 *  código de rota, porque a consulta simplesmente não filtra e nunca dá erro.
 *  Esquecer uma tabela aqui é a forma mais silenciosa de vazar dado neste
 *  projeto. A lista explícita transforma o esquecimento em falha na hora de
 *  aplicar a migration.
 *
 *  ======================================================= AS DUAS NULL-ÁVEIS
 *
 *  `system_settings` e `system_logs` aceitam `clinica_id` vazio, e vazio tem
 *  significado: **a linha pertence à instalação, não a clínica nenhuma**. É
 *  onde vive o `cron_token` (que não é de clínica alguma) e onde vão os
 *  registros de ação do operador da plataforma — "criou a clínica X" não é
 *  evento da clínica X nem de nenhuma outra.
 *
 *  Consequência para quem consultar essas duas: linha com `clinica_id` vazio
 *  NUNCA entra em listagem de clínica. Não é "vale para todas": é "não é de
 *  nenhuma".
 *
 *  ============================================================== O QUE FICOU
 *
 *  Esta migration NÃO faz, de propósito, e cada um tem tarefa própria:
 *
 *  - `products.sku` continua único no sistema inteiro → M0.2. Duas clínicas
 *    ainda disputam um código de produto até lá.
 *  - `uq_cash_source` e `uq_loyalty_source` não incluem a clínica → M0.2. Na
 *    prática colidir é improvável (o `source_id` é id sorteado), mas
 *    "improvável" não é garantia.
 *  - `pricing_settings` e `loyalty_settings` têm CHAVE PRIMÁRIA em `id`, e a
 *    linha única se chama `'default'`. Com 50 clínicas isso colide → M2.2 tem
 *    de trocar a chave primária, não só preencher a coluna.
 *  - Chaves estrangeiras compostas `(clinica_id, id)` → M0.5.
 *  - As 220 consultas continuam sem filtro → M1. **Até a M1 terminar, este
 *    banco tem a coluna e não a usa.** Não é meio-caminho perigoso porque só
 *    existe uma clínica; passa a ser no minuto em que a segunda entrar.
 */

const ID_PRIMEIRA = 'cl_1';
const NOME_PRIMEIRA = 'Dra. Musa Estética de Elite';

/** Não recebem a coluna. `schema_migrations` é o controle do próprio runner —
 *  pertence à instalação. `clinicas` é a própria clínica. */
const SEM_COLUNA = ['schema_migrations', 'clinicas'];

/** Recebem a coluna aceitando vazio. Ver "AS DUAS NULL-ÁVEIS" acima. */
const NULAVEL = ['system_settings', 'system_logs'];

/** Recebem `clinica_id` obrigatório. Ordem alfabética para conferir a olho
 *  contra `SHOW TABLES` sem esforço. */
const OBRIGATORIA = [
  'appointments',
  'cash_entries',
  'client_documents',
  'clients',
  'document_templates',
  'finance_categories',
  'fixed_costs',
  'interactions',
  'leads',
  'loyalty_rewards',
  'loyalty_settings',
  'loyalty_transactions',
  'pricing_settings',
  'pricing_simulations',
  'products',
  'professional_availability',
  'recurring_expenses',
  'salespeople',
  'service_supplies',
  'stock_batches',
  'stock_movements',
  'treatment_catalog',
  'treatment_plans',
  'treatment_sessions',
  'treatments',
  'users'
];

const COM_COLUNA = OBRIGATORIA.concat(NULAVEL);
const CLASSIFICADAS = COM_COLUNA.concat(SEM_COLUNA);

/* ------------------------------------------------------------- puro, testável */

/** Tabelas do banco que ninguém classificou. É o que faz a migration parar. */
function naoClassificadas(doBanco) {
  return doBanco.filter((t) => CLASSIFICADAS.indexOf(t) === -1);
}

/** Tabelas classificadas que não existem no banco — lista desatualizada. */
function classificadasQueFaltam(doBanco) {
  return CLASSIFICADAS.filter((t) => doBanco.indexOf(t) === -1);
}

/** Nome em mais de uma lista. Erro de digitação que passaria despercebido. */
function duplicadas() {
  const vistas = new Map();
  for (const t of CLASSIFICADAS) vistas.set(t, (vistas.get(t) || 0) + 1);
  return Array.from(vistas.entries()).filter(([, n]) => n > 1).map(([t]) => t);
}

/* ------------------------------------------------------------------ ajudantes */

async function tabelasDoBanco(conn) {
  const [r] = await conn.query(
    `SELECT TABLE_NAME AS t FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME`
  );
  return r.map((x) => x.t);
}

async function temColuna(conn, tabela, coluna) {
  const [r] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tabela, coluna]
  );
  return Number(r[0].n) > 0;
}

async function temIndice(conn, tabela, indice) {
  const [r] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [tabela, indice]
  );
  return Number(r[0].n) > 0;
}

async function contar(conn, tabelas) {
  const mapa = {};
  for (const t of tabelas) {
    const [r] = await conn.query('SELECT COUNT(*) AS n FROM `' + t + '`');
    mapa[t] = Number(r[0].n);
  }
  return mapa;
}

/* ----------------------------------------------------------------------- up */

module.exports = async function up(conn) {
  // ---------------------------------------------------- 0. a lista está sã?
  const dup = duplicadas();
  if (dup.length) {
    throw new Error('018: tabela em mais de uma lista: ' + dup.join(', '));
  }

  const doBanco = await tabelasDoBanco(conn);

  const orfas = naoClassificadas(doBanco);
  if (orfas.length) {
    throw new Error(
      '018 PAROU: ' + orfas.length + ' tabela(s) do banco não estão em nenhuma lista desta ' +
      'migration: ' + orfas.join(', ') + '. Tabela sem coluna de inquilino é tabela ' +
      'compartilhada pelas 50 clínicas, e isso não dá erro em lugar nenhum. Classifique cada ' +
      'uma em OBRIGATORIA, NULAVEL ou SEM_COLUNA e rode de novo.'
    );
  }

  const faltando = classificadasQueFaltam(doBanco);
  if (faltando.length) {
    // Não é motivo para parar: pode ser instalação nova onde uma migration
    // posterior ainda não criou a tabela. Mas precisa aparecer.
    console.log('   ! na lista e ausentes do banco: ' + faltando.join(', '));
  }

  // ------------------------------------------------- 1. a contagem de ANTES
  const presentes = COM_COLUNA.filter((t) => doBanco.indexOf(t) !== -1);
  const antes = await contar(conn, presentes);

  // -------------------------------------------------- 2. a tabela `clinicas`
  await conn.query(`
    CREATE TABLE IF NOT EXISTS clinicas (
      id VARCHAR(50) PRIMARY KEY,
      nome VARCHAR(160) NOT NULL,
      documento VARCHAR(20) NULL COMMENT 'CNPJ, sem mascara',
      -- ativa | suspensa | encerrada. Suspensa perde o acesso e mantem os
      -- dados; encerrada tambem -- prontuario tem prazo legal de guarda, e
      -- apagar e ato separado e deliberado (ver M3.2 e docs/LGPD.md).
      status VARCHAR(20) NOT NULL DEFAULT 'ativa',
      criada_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizada_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_clinicas_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [ins] = await conn.query(
    'INSERT IGNORE INTO clinicas (id, nome) VALUES (?, ?)',
    [ID_PRIMEIRA, NOME_PRIMEIRA]
  );
  console.log(ins.affectedRows
    ? '   + clinicas, com a instalacao atual como ' + ID_PRIMEIRA
    : '   = clinicas ja existia; ' + ID_PRIMEIRA + ' mantida');

  // ----------------------------------------------------- 3. a coluna, tabela
  //                                                          por tabela
  //
  // Em TRES passos por tabela, e a ordem importa: acrescentar direto como
  // NOT NULL numa tabela com linhas obriga o MySQL a inventar um valor
  // padrao. Aqui a coluna nasce aceitando vazio, TODAS as linhas recebem a
  // clinica 1, e so entao ela vira obrigatoria. Assim nenhuma linha existente
  // fica com inquilino errado ou vazio.
  let criadas = 0, jaTinham = 0, indexadas = 0;

  for (const t of presentes) {
    const obrigatoria = OBRIGATORIA.indexOf(t) !== -1;

    if (await temColuna(conn, t, 'clinica_id')) {
      jaTinham += 1;
    } else {
      await conn.query('ALTER TABLE `' + t + '` ADD COLUMN clinica_id VARCHAR(50) NULL');
      if (obrigatoria) {
        await conn.query('UPDATE `' + t + '` SET clinica_id = ? WHERE clinica_id IS NULL', [ID_PRIMEIRA]);
        await conn.query('ALTER TABLE `' + t + '` MODIFY clinica_id VARCHAR(50) NOT NULL');
      } else {
        // Nas null-aveis, o que existe hoje E da clinica 1 -- sao as
        // configuracoes e os logs da instalacao atual. O vazio fica
        // reservado para o que nascer depois pertencendo a plataforma.
        await conn.query('UPDATE `' + t + '` SET clinica_id = ? WHERE clinica_id IS NULL', [ID_PRIMEIRA]);
      }
      criadas += 1;
    }

    // Indice sempre: daqui em diante TODA consulta passa a filtrar por esta
    // coluna. Sem indice, cada tela do sistema varre a tabela inteira.
    if (!(await temIndice(conn, t, 'idx_clinica'))) {
      await conn.query('ALTER TABLE `' + t + '` ADD INDEX idx_clinica (clinica_id)');
      indexadas += 1;
    }
  }

  console.log('   + clinica_id em ' + criadas + ' tabela(s)' +
    (jaTinham ? ', ' + jaTinham + ' ja tinham' : '') +
    '; ' + indexadas + ' indice(s) criado(s)');
  console.log('   i null-aveis (vazio = da instalacao, nao de clinica): ' + NULAVEL.join(', '));

  // ------------------------------------- 4. o critério de aprovação, cobrado
  //                                          pela própria migration
  const depois = await contar(conn, presentes);
  const divergentes = presentes
    .filter((t) => antes[t] !== depois[t])
    .map((t) => t + ' ' + antes[t] + '->' + depois[t]);

  if (divergentes.length) {
    throw new Error(
      '018: a contagem de linhas MUDOU em ' + divergentes.length + ' tabela(s): ' +
      divergentes.join(', ') + '. Alterar 28 tabelas com dados dentro nao pode criar nem ' +
      'perder linha nenhuma. Restaure o backup e investigue antes de tentar de novo.'
    );
  }
  console.log('   = contagem de linhas identica em ' + presentes.length + ' tabela(s)');

  // ------------------------------------------- 5. e nenhuma linha sem clinica
  const semClinica = [];
  for (const t of OBRIGATORIA.filter((x) => doBanco.indexOf(x) !== -1)) {
    const [r] = await conn.query(
      'SELECT COUNT(*) AS n FROM `' + t + '` WHERE clinica_id IS NULL OR clinica_id = \'\''
    );
    if (Number(r[0].n)) semClinica.push(t + '=' + r[0].n);
  }
  if (semClinica.length) {
    throw new Error('018: linhas sem clinica em ' + semClinica.join(', '));
  }
  console.log('   = nenhuma linha orfa nas ' + OBRIGATORIA.length + ' tabelas obrigatorias');
};

// Expostas para `tests/multi-inquilino.test.js` conferir a classificação sem
// precisar de banco. A funcao continua sendo a exportacao principal, que e o
// que o runner (db/run-migrations.js) exige.
module.exports.LISTAS = {
  ID_PRIMEIRA: ID_PRIMEIRA,
  NOME_PRIMEIRA: NOME_PRIMEIRA,
  SEM_COLUNA: SEM_COLUNA,
  NULAVEL: NULAVEL,
  OBRIGATORIA: OBRIGATORIA,
  COM_COLUNA: COM_COLUNA,
  CLASSIFICADAS: CLASSIFICADAS,
  naoClassificadas: naoClassificadas,
  classificadasQueFaltam: classificadasQueFaltam,
  duplicadas: duplicadas
};

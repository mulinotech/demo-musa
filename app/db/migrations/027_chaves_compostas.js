'use strict';
/** A M1.8: a TERCEIRA BARREIRA. O banco passa a recusar linha cruzada.
 *
 *  ========================================================= AS TRÊS BARREIRAS
 *
 *  1ª **prevenção** — `server/db/escopo.js`. Toda consulta nasce carimbada.
 *  2ª **detecção** — `scripts/verificar-vazamento.mjs`. Se a prevenção falhar,
 *     o ensaio grita antes de a coisa subir.
 *  3ª **contenção** — esta migration. Se as duas primeiras falharem, o banco
 *     recusa a gravação.
 *
 *  Faltava a terceira. Hoje, um defeito de gravação consegue criar uma linha da
 *  clínica B apontando para o paciente da clínica A, e **nada no banco impede**
 *  — está escrito assim, com essas palavras, no comentário da semente do ensaio
 *  desde 09/09. Depois desta migration, essa linha é recusada com erro.
 *
 *  ============================================================= AS DUAS METADES
 *
 *  **Metade A — a clínica tem de existir.** As 26 tabelas ganham
 *  `clinica_id -> clinicas(id)`. Hoje `clinica_id` é obrigatória (M1.7), mas
 *  aceita qualquer texto: `'cl_999'` entra sem reclamação e a linha fica órfã,
 *  invisível para todas as clínicas. É por isso que a M1.7 media linha órfã e
 *  dizia que ela **impede a M1.8** — é aqui que ela impediria.
 *
 *  **Metade B — o pai tem de ser da mesma clínica.** As chaves estrangeiras que
 *  já existem entre duas tabelas de clínica deixam de ser `(filho_id)` e passam
 *  a ser `(clinica_id, filho_id)`. `products.id` é única no sistema inteiro,
 *  então hoje o lote da clínica B **pode** apontar para o produto da clínica A:
 *  a chave de uma coluna confere se o produto existe, e não de quem ele é.
 *
 *  ============================================== `RESTRICT`, E NÃO `CASCADE`
 *
 *  A chave da metade A é `ON DELETE RESTRICT`: apagar uma clínica que ainda tem
 *  dado é **recusado**.
 *
 *  A escolha é assimétrica de propósito. Com `CASCADE`, um
 *  `DELETE FROM clinicas WHERE id = ?` digitado errado — ou uma rota com
 *  defeito — apaga o prontuário inteiro de um consultório, em 26 tabelas, sem
 *  desfazer. Com `RESTRICT`, o preço é trabalho: encerrar uma clínica de
 *  verdade passa a ser uma operação com nome, e não um `DELETE`. Trabalho a
 *  mais se recupera; prontuário apagado não.
 *
 *  (`clinica_settings` fica de fora e mantém o `CASCADE` que a 024 lhe deu:
 *  configuração sem clínica não é dado, é lixo.)
 *
 *  ==================================== A ORDEM QUE NÃO TEM ESTADO RUIM
 *
 *  DDL no MySQL não é transacional. Então na metade B cada relação é convertida
 *  nesta ordem, e a ordem importa:
 *
 *      1. índice único `(clinica_id, id)` no pai   (o filho vai apontar para ele)
 *      2. índice `(clinica_id, coluna)` no filho   (o MySQL exige)
 *      3. ACRESCENTA a chave composta                 <-- com nome novo
 *      4. APAGA a chave antiga, de uma coluna
 *
 *  Acrescentar antes de apagar não tem estado ruim: se 3 falhar, a chave antiga
 *  continua inteira; se 4 falhar, sobram as duas, e duas chaves conferindo a
 *  mesma coisa é redundância, não defeito. A ordem contrária — apagar e depois
 *  acrescentar — deixa a relação **sem chave nenhuma** se o passo de trás
 *  falhar, que é justamente a hora em que ninguém está olhando.
 *
 *  ============================== O QUE ELA CONFERE ANTES (e aborta sem tocar)
 *
 *  1. **Linha órfã** — `clinica_id` que não existe em `clinicas`.
 *  2. **Linha cruzada** — filho de uma clínica apontando para pai de outra, ou
 *     para pai que não existe. Aborta nomeando tabela, coluna, quantidade e até
 *     cinco ids de exemplo — porque "existe linha cruzada" sem os ids obriga
 *     a próxima pessoa a redescobrir a consulta.
 *  3. **Colação igual nas duas pontas.** Chave estrangeira exige colação
 *     idêntica, e a 024 quebrou exatamente aqui: o ensaio pegou porque o banco
 *     de teste tinha outro padrão. Aqui a colação é **lida** de cada ponta e
 *     comparada, e não presumida.
 *
 *  ========================= A LISTA QUE PODE ESTAR ERRADA SÓ VIRA RELATÓRIO
 *
 *  As relações convertidas na metade B são **descobertas no banco**
 *  (`information_schema`), e não escritas aqui. Se alguém acrescentar uma nona
 *  chave estrangeira amanhã, ela é convertida sem ninguém editar esta lista.
 *
 *  O mapa `PONTEIROS` abaixo existe para outra coisa: medir o **buraco**. São as
 *  30 colunas que apontam para um pai, das quais só 8 têm chave estrangeira
 *  hoje. As outras 22 continuam sem contenção depois desta migration, e o
 *  relatório diz quais são e quantas linhas cruzadas cada uma já tem. Um erro
 *  no mapa erra o relatório; nunca o DDL.
 *
 *  Por que as 22 não entram agora: criar chave estrangeira onde não havia
 *  **muda o que acontece num DELETE**, e isso é decisão de negócio, uma por
 *  relação ("apagar um serviço do catálogo deve recusar, ou desligar o
 *  agendamento?"). Chutar 22 dessas de uma vez é o tipo de mudança que só
 *  aparece no dia em que a recepção não consegue apagar algo.
 */

const LISTAS = require('./018_clinicas.js').LISTAS;
const ALVOS = LISTAS.OBRIGATORIA;

/** Toda coluna `%_id` que aponta para um pai, e para quem ela aponta.
 *
 *  Serve só para MEDIR (ver o cabeçalho). A migration confere que toda coluna
 *  `%_id` do banco está aqui ou em `POLIMORFICOS` — coluna nova não
 *  classificada aborta, porque senão ela nasce fora do relatório e ninguém
 *  descobre que ela existe. */
const PONTEIROS = {
  'appointments.catalog_id': 'treatment_catalog',
  'appointments.client_id': 'clients',
  'appointments.professional_id': 'users',
  'cash_entries.category_id': 'finance_categories',
  'cash_entries.client_id': 'clients',
  'cash_entries.professional_id': 'users',
  'client_documents.appointment_id': 'appointments',
  'client_documents.client_id': 'clients',
  'client_documents.template_id': 'document_templates',
  'document_templates.catalog_id': 'treatment_catalog',
  'finance_categories.parent_id': 'finance_categories',
  'interactions.client_id': 'clients',
  'leads.salesperson_id': 'salespeople',
  'loyalty_rewards.catalog_id': 'treatment_catalog',
  'loyalty_rewards.product_id': 'products',
  'loyalty_transactions.client_id': 'clients',
  'loyalty_transactions.reward_id': 'loyalty_rewards',
  'pricing_simulations.catalog_id': 'treatment_catalog',
  'professional_availability.professional_id': 'users',
  'recurring_expenses.category_id': 'finance_categories',
  'service_supplies.catalog_id': 'treatment_catalog',
  'service_supplies.product_id': 'products',
  'stock_batches.product_id': 'products',
  'stock_movements.batch_id': 'stock_batches',
  'stock_movements.product_id': 'products',
  'treatments.client_id': 'clients',
  'treatment_plans.client_id': 'clients',
  'treatment_sessions.appointment_id': 'appointments',
  'treatment_sessions.plan_id': 'treatment_plans',
  'users.salesperson_id': 'salespeople'
};

/** `source_id` guarda o id de origens de tipos diferentes (o `source` diz de
 *  qual) — hoje atendimento, sessão, venda. Chave estrangeira não existe para
 *  "aponta para uma de três tabelas", e é por isso que estas três estão de fora
 *  em vez de esquecidas. */
const POLIMORFICOS = [
  'cash_entries.source_id',
  'loyalty_transactions.source_id',
  'stock_movements.source_id'
];

/* --------------------------------------------------------------- leitura pura */

async function tabelasDoBanco(conn) {
  const [l] = await conn.query(
    'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  return l.map((x) => x.t);
}

/** Colação e conjunto de caracteres de uma coluna, ou `null` se ela não existe. */
async function colacaoDe(conn, tabela, coluna) {
  const [r] = await conn.query(
    'SELECT COLLATION_NAME AS co, CHARACTER_SET_NAME AS cs, COLUMN_TYPE AS ty' +
    ' FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()' +
    ' AND TABLE_NAME = ? AND COLUMN_NAME = ?', [tabela, coluna]);
  return r.length ? r[0] : null;
}

/** As chaves estrangeiras deste banco, uma por restrição, com as colunas em
 *  ordem e a regra de apagar/atualizar. */
async function chavesDe(conn) {
  const [l] = await conn.query(
    'SELECT k.CONSTRAINT_NAME AS nome, k.TABLE_NAME AS tab, k.COLUMN_NAME AS col,' +
    ' k.REFERENCED_TABLE_NAME AS pai, k.REFERENCED_COLUMN_NAME AS paiCol,' +
    ' k.ORDINAL_POSITION AS pos, rc.DELETE_RULE AS del, rc.UPDATE_RULE AS upd' +
    ' FROM information_schema.KEY_COLUMN_USAGE k' +
    ' JOIN information_schema.REFERENTIAL_CONSTRAINTS rc' +
    '   ON rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME' +
    '  AND rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA' +
    ' WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL' +
    ' ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION');
  const porNome = new Map();
  for (const f of l) {
    const chave = f.tab + '|' + f.nome;
    if (!porNome.has(chave)) {
      porNome.set(chave, {
        nome: f.nome, tab: f.tab, pai: f.pai, cols: [], paiCols: [],
        del: f.del, upd: f.upd
      });
    }
    const c = porNome.get(chave);
    c.cols.push(f.col);
    c.paiCols.push(f.paiCol);
  }
  return Array.from(porNome.values());
}

/** Existe índice cujas primeiras colunas são exatamente `cols`? */
async function temIndicePrefixo(conn, tabela, cols) {
  const [l] = await conn.query(
    'SELECT INDEX_NAME AS i, COLUMN_NAME AS c, SEQ_IN_INDEX AS s' +
    ' FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()' +
    ' AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX', [tabela]);
  const porIndice = new Map();
  for (const x of l) {
    if (!porIndice.has(x.i)) porIndice.set(x.i, []);
    porIndice.get(x.i)[x.s - 1] = x.c;
  }
  for (const nomes of porIndice.values()) {
    let combina = true;
    for (let i = 0; i < cols.length; i++) {
      if (nomes[i] !== cols[i]) { combina = false; break; }
    }
    if (combina) return true;
  }
  return false;
}

/** InnoDB trata `NO ACTION` e `RESTRICT` do mesmo jeito, e o
 *  `information_schema` devolve os dois. Escrever de volta o que foi lido
 *  mantém a regra que a chave já tinha em vez de eu decidir por ela. */
function regra(r) {
  return (r === 'NO ACTION' || !r) ? 'RESTRICT' : r;
}

/* ------------------------------------------------------------------- migration */

module.exports = async function up(conn) {
  const doBanco = await tabelasDoBanco(conn);
  const tabelas = ALVOS.filter((t) => doBanco.indexOf(t) !== -1);

  if (doBanco.indexOf('clinicas') === -1) {
    throw new Error('027 PAROU: nao existe a tabela `clinicas`. A migration 018 rodou?');
  }

  // ============================================================ 0. o mapa esta completo?
  //
  // Coluna `%_id` nova que ninguem classificou fica fora do relatorio -- e o
  // relatorio e a unica coisa que diz onde a contencao ainda nao chegou.
  const [colunas] = await conn.query(
    "SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS" +
    " WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME LIKE '%\\_id'" +
    " AND COLUMN_NAME <> 'clinica_id'");
  const naoClassificadas = [];
  for (const x of colunas) {
    if (ALVOS.indexOf(x.t) === -1) continue;          // fora das 26, fora do escopo
    const chave = x.t + '.' + x.c;
    if (PONTEIROS[chave] || POLIMORFICOS.indexOf(chave) !== -1) continue;
    naoClassificadas.push(chave);
  }
  if (naoClassificadas.length) {
    throw new Error(
      '027 PAROU, e NADA foi alterado: coluna(s) que apontam para algo e que ninguem ' +
      'classificou: ' + naoClassificadas.join(', ') + '.\n' +
      'Acrescente cada uma em PONTEIROS (com a tabela pai) ou em POLIMORFICOS (se ela ' +
      'guarda o id de origens de tipos diferentes), em db/migrations/027_chaves_compostas.js. ' +
      'Coluna fora dos dois mapas nao aparece no relatorio de cobertura, e o relatorio e o ' +
      'unico lugar que diz onde a terceira barreira ainda nao chegou.');
  }

  // Pai citado no mapa e que nao existe no banco: o mapa esta errado, e um mapa
  // errado sobre o proprio esquema e pior do que nenhum.
  const paisInvalidos = [];
  for (const chave of Object.keys(PONTEIROS)) {
    const filho = chave.split('.')[0];
    if (ALVOS.indexOf(filho) === -1) continue;
    if (doBanco.indexOf(PONTEIROS[chave]) === -1) paisInvalidos.push(chave + ' -> ' + PONTEIROS[chave]);
  }
  if (paisInvalidos.length) {
    throw new Error(
      '027 PAROU, e NADA foi alterado: PONTEIROS aponta para tabela que nao existe: ' +
      paisInvalidos.join('; ') + '. Corrija o mapa.');
  }

  // ============================================================ 1. as conferencias
  const antes = {};
  const orfas = [];
  for (const t of tabelas) {
    const [c] = await conn.query('SELECT COUNT(*) AS n FROM `' + t + '`');
    antes[t] = Number(c[0].n);
    const [o] = await conn.query(
      'SELECT COUNT(*) AS n FROM `' + t + '` x' +
      ' LEFT JOIN clinicas c ON c.id = x.clinica_id' +
      ' WHERE x.clinica_id IS NOT NULL AND c.id IS NULL');
    if (Number(o[0].n) > 0) orfas.push(t + ': ' + o[0].n);
  }
  if (orfas.length) {
    throw new Error(
      '027 PAROU, e NADA foi alterado: ha linha(s) apontando para clinica que nao existe em ' +
      orfas.join('; ') + '.\n' +
      'A chave estrangeira clinica_id -> clinicas(id) recusaria essas linhas, e a migration ' +
      'nao vai apaga-las por conta propria: linha orfa e dado de alguem que ficou invisivel, ' +
      'e decidir sozinho o que fazer com ela e o tipo de conserto que ninguem descobre.\n' +
      'Descubra de quem sao (SELECT DISTINCT clinica_id FROM <tabela> x LEFT JOIN clinicas c ' +
      'ON c.id = x.clinica_id WHERE c.id IS NULL) e, ou cadastre a clinica, ou corrija o ' +
      'carimbo das linhas.');
  }

  // As relacoes a converter vem DO BANCO, e nao do mapa: filho e pai entre as
  // 26, chave de uma coluna so.
  const todas = await chavesDe(conn);
  const converter = todas.filter((f) =>
    f.cols.length === 1 &&
    f.cols[0] !== 'clinica_id' &&
    ALVOS.indexOf(f.tab) !== -1 &&
    ALVOS.indexOf(f.pai) !== -1);

  // Linha cruzada: filho de uma clinica apontando para pai de outra (ou para pai
  // que nao existe -- a chave antiga ja impedia, mas conferir custa uma consulta
  // e a alternativa e descobrir no meio do ALTER).
  const cruzadas = [];
  for (const f of converter) {
    const col = f.cols[0];
    const [r] = await conn.query(
      'SELECT x.id AS id FROM `' + f.tab + '` x' +
      ' LEFT JOIN `' + f.pai + '` p ON p.' + f.paiCols[0] + ' = x.`' + col + '`' +
      '  AND p.clinica_id = x.clinica_id' +
      ' WHERE p.' + f.paiCols[0] + ' IS NULL AND x.`' + col + '` IS NOT NULL' +
      ' LIMIT 6');
    if (r.length) {
      const [c] = await conn.query(
        'SELECT COUNT(*) AS n FROM `' + f.tab + '` x' +
        ' LEFT JOIN `' + f.pai + '` p ON p.' + f.paiCols[0] + ' = x.`' + col + '`' +
        '  AND p.clinica_id = x.clinica_id' +
        ' WHERE p.' + f.paiCols[0] + ' IS NULL AND x.`' + col + '` IS NOT NULL');
      cruzadas.push(f.tab + '.' + col + ' -> ' + f.pai + ': ' + c[0].n +
                    ' linha(s), ex.: ' + r.slice(0, 5).map((x) => x.id).join(', '));
    }
  }
  if (cruzadas.length) {
    throw new Error(
      '027 PAROU, e NADA foi alterado: ha linha(s) de uma clinica apontando para o pai de ' +
      'OUTRA clinica: ' + cruzadas.join(' | ') + '.\n' +
      'E exatamente isto que a chave composta vai passar a recusar, e por isso ela nao pode ' +
      'ser criada enquanto essas linhas existirem -- o proprio ALTER falharia, e no meio do ' +
      'caminho.\n' +
      'Cada linha dessas e um dado que aparece na tela da clinica errada, ou que nao aparece ' +
      'em nenhuma. Olhe os ids acima, decida de quem e cada uma, e corrija o carimbo. Depois ' +
      'rode isto de novo.');
  }

  // Colacao: chave estrangeira exige colacao IGUAL nas duas pontas, e a 024
  // quebrou aqui. Conferir antes vale mais do que ler
  // "Foreign key constraint is incorrectly formed" no meio do lote.
  const colacoes = [];
  const clinicasId = await colacaoDe(conn, 'clinicas', 'id');
  for (const t of tabelas) {
    const c = await colacaoDe(conn, t, 'clinica_id');
    if (c && c.co !== clinicasId.co) {
      colacoes.push(t + '.clinica_id (' + c.co + ') != clinicas.id (' + clinicasId.co + ')');
    }
  }
  for (const f of converter) {
    const filho = await colacaoDe(conn, f.tab, f.cols[0]);
    const pai = await colacaoDe(conn, f.pai, f.paiCols[0]);
    if (filho && pai && filho.co !== pai.co) {
      colacoes.push(f.tab + '.' + f.cols[0] + ' (' + filho.co + ') != ' +
                    f.pai + '.' + f.paiCols[0] + ' (' + pai.co + ')');
    }
    const filhoCl = await colacaoDe(conn, f.tab, 'clinica_id');
    const paiCl = await colacaoDe(conn, f.pai, 'clinica_id');
    if (filhoCl && paiCl && filhoCl.co !== paiCl.co) {
      colacoes.push(f.tab + '.clinica_id (' + filhoCl.co + ') != ' +
                    f.pai + '.clinica_id (' + paiCl.co + ')');
    }
  }
  if (colacoes.length) {
    throw new Error(
      '027 PAROU, e NADA foi alterado: colacao diferente entre as pontas de uma chave ' +
      'estrangeira: ' + colacoes.join('; ') + '.\n' +
      'O MySQL recusa a chave, com a mensagem "Foreign key constraint is incorrectly ' +
      'formed", que nao diz nada sobre colacao. Iguale as colunas ' +
      '(ALTER TABLE <t> MODIFY <c> VARCHAR(50) CHARACTER SET <cs> COLLATE <co>) e rode de novo.');
  }

  // ============================================================ 2. metade A
  const chavesDeClinica = [];
  const jaTinhamClinica = [];
  for (const t of tabelas) {
    const jaTem = todas.some((f) =>
      f.tab === t && f.pai === 'clinicas' && f.cols.length === 1 && f.cols[0] === 'clinica_id');
    if (jaTem) { jaTinhamClinica.push(t); continue; }
    if (!(await temIndicePrefixo(conn, t, ['clinica_id']))) {
      await conn.query('CREATE INDEX idx_clinica ON `' + t + '` (clinica_id)');
    }
    try {
      await conn.query(
        'ALTER TABLE `' + t + '` ADD CONSTRAINT `fk_' + t + '_clinica`' +
        ' FOREIGN KEY (clinica_id) REFERENCES clinicas(id)' +
        ' ON DELETE RESTRICT ON UPDATE RESTRICT');
      chavesDeClinica.push(t);
    } catch (e) {
      throw new Error(
        '027 PAROU na metade A, em `' + t + '`: ' + e.message + '\n' +
        'JA GANHARAM a chave de clinica (e continuam com ela): ' +
        (chavesDeClinica.length ? chavesDeClinica.join(', ') : 'nenhuma') + '.\n' +
        'Nenhuma chave composta foi criada ainda -- a metade B nem comecou. ' +
        'Para desfazer cada uma: ALTER TABLE <t> DROP FOREIGN KEY fk_<t>_clinica');
    }
  }

  // ============================================================ 3. metade B
  const compostas = [];
  const redundantes = [];
  for (const f of converter) {
    const col = f.cols[0];
    const paiCol = f.paiCols[0];
    const nova = 'fk_' + f.tab + '_' + col + '_clinica';

    // 1. o pai precisa de indice unico em (clinica_id, id) -- o MySQL exige que
    //    as colunas apontadas sejam prefixo de algum indice do pai, e nem a
    //    primaria (id) nem idx_clinica (clinica_id) servem.
    if (!(await temIndicePrefixo(conn, f.pai, ['clinica_id', paiCol]))) {
      await conn.query('CREATE UNIQUE INDEX `uq_' + f.pai + '_clinica_' + paiCol +
                       '` ON `' + f.pai + '` (clinica_id, `' + paiCol + '`)');
    }
    // 2. e o filho precisa de indice nas colunas da chave.
    if (!(await temIndicePrefixo(conn, f.tab, ['clinica_id', col]))) {
      await conn.query('CREATE INDEX `idx_' + f.tab + '_clinica_' + col +
                       '` ON `' + f.tab + '` (clinica_id, `' + col + '`)');
    }

    const jaExiste = todas.some((x) => x.tab === f.tab && x.nome === nova);
    if (!jaExiste) {
      try {
        // 3. ACRESCENTA a composta. Se falhar aqui, a antiga esta inteira.
        await conn.query(
          'ALTER TABLE `' + f.tab + '` ADD CONSTRAINT `' + nova + '`' +
          ' FOREIGN KEY (clinica_id, `' + col + '`)' +
          ' REFERENCES `' + f.pai + '` (clinica_id, `' + paiCol + '`)' +
          ' ON DELETE ' + regra(f.del) + ' ON UPDATE ' + regra(f.upd));
      } catch (e) {
        throw new Error(
          '027 PAROU na metade B, criando `' + nova + '`: ' + e.message + '\n' +
          'A chave ANTIGA de ' + f.tab + '.' + col + ' continua no lugar -- nenhuma relacao ' +
          'ficou sem protecao.\n' +
          'JA CONVERTIDAS: ' + (compostas.length ? compostas.join(', ') : 'nenhuma') + '. ' +
          'A metade A ja rodou inteira.');
      }
    }
    // 4. APAGA a antiga. Se falhar aqui, sobram as duas, e isso e redundancia.
    try {
      await conn.query('ALTER TABLE `' + f.tab + '` DROP FOREIGN KEY `' + f.nome + '`');
    } catch (e) {
      redundantes.push(f.tab + '.' + col + ' (' + f.nome + '): ' + e.message);
    }
    compostas.push(f.tab + '.' + col + ' -> ' + f.pai);
  }

  // ============================== 4. o critério de aprovação, cobrado pela migration
  //
  // "Rodou sem erro" nao e "funcionou". Le tudo de novo do banco e confere.
  const depois = await chavesDe(conn);
  const faltandoClinica = [];
  for (const t of tabelas) {
    const tem = depois.some((f) =>
      f.tab === t && f.pai === 'clinicas' && f.cols.indexOf('clinica_id') !== -1);
    if (!tem) faltandoClinica.push(t);
  }
  if (faltandoClinica.length) {
    throw new Error(
      '027: estas tabelas continuam sem chave estrangeira de clinica depois do ALTER: ' +
      faltandoClinica.join(', ') + '. O comando rodou e nao surtiu efeito.');
  }

  const naoCompostas = [];
  const regraTrocada = [];
  for (const f of converter) {
    const agora = depois.filter((x) => x.tab === f.tab && x.pai === f.pai &&
                                       x.cols.indexOf(f.cols[0]) !== -1);
    const nova = agora.filter((x) => x.cols.length === 2 && x.cols.indexOf('clinica_id') !== -1)[0];
    if (!nova) { naoCompostas.push(f.tab + '.' + f.cols[0] + ' -> ' + f.pai); continue; }
    // A chave nova tem de apagar do MESMO jeito que a antiga apagava.
    //
    // Conferir isto nao foi ideia: foi resultado de sabotagem. Trocando
    // `regra(f.del)` por `RESTRICT` na criacao, TODO o ensaio de vazamento
    // passou verde -- 156 conferencias, zero falhas -- e o que teria ido para
    // producao e "erro ao excluir paciente" na tela, porque as fichas dela
    // passariam a impedir a exclusao em vez de ir com ela.
    if (regra(nova.del) !== regra(f.del) || regra(nova.upd) !== regra(f.upd)) {
      regraTrocada.push(f.tab + '.' + f.cols[0] + ': era ON DELETE ' + regra(f.del) +
                        ' / ON UPDATE ' + regra(f.upd) + ', ficou ON DELETE ' + regra(nova.del) +
                        ' / ON UPDATE ' + regra(nova.upd));
    }
  }
  if (naoCompostas.length) {
    throw new Error(
      '027: estas relacoes continuam com chave de uma coluna so: ' + naoCompostas.join('; ') +
      '. A contencao NAO esta no lugar para elas.');
  }
  if (regraTrocada.length) {
    throw new Error(
      '027: a chave nova apaga de um jeito diferente da antiga em ' + regraTrocada.join('; ') +
      '.\nA M1.8 mudou o ALCANCE da chave (de uma coluna para duas), e NAO o que acontece num ' +
      'DELETE. Perder o CASCADE aqui vira "erro ao excluir paciente" na tela, porque as fichas ' +
      'dela passam a impedir a exclusao em vez de ir com ela.');
  }

  const perderamLinha = [];
  for (const t of tabelas) {
    const [c] = await conn.query('SELECT COUNT(*) AS n FROM `' + t + '`');
    if (Number(c[0].n) !== antes[t]) perderamLinha.push(t + ': ' + antes[t] + ' -> ' + c[0].n);
  }
  if (perderamLinha.length) {
    throw new Error(
      '027: a contagem de linhas mudou em ' + perderamLinha.join('; ') +
      '. Criar chave estrangeira nao apaga linha. NAO rode mais nada e investigue.');
  }

  // ============================== 5. o buraco que sobrou, medido e nomeado
  const protegidas = new Set();
  for (const f of depois) {
    if (f.cols.length !== 2) continue;
    const outra = f.cols.filter((c) => c !== 'clinica_id')[0];
    if (outra) protegidas.add(f.tab + '.' + outra);
  }
  const semProtecao = [];
  for (const chave of Object.keys(PONTEIROS)) {
    const filho = chave.split('.')[0];
    const col = chave.split('.')[1];
    if (ALVOS.indexOf(filho) === -1) continue;
    if (protegidas.has(chave)) continue;
    const pai = PONTEIROS[chave];
    const [c] = await conn.query(
      'SELECT COUNT(*) AS n FROM `' + filho + '` x' +
      ' LEFT JOIN `' + pai + '` p ON p.id = x.`' + col + '` AND p.clinica_id = x.clinica_id' +
      ' WHERE x.`' + col + '` IS NOT NULL AND p.id IS NULL');
    semProtecao.push({ relacao: chave + ' -> ' + pai, cruzadasHoje: Number(c[0].n) });
  }
  const jaCruzadas = semProtecao.filter((x) => x.cruzadasHoje > 0);

  console.log('   = metade A: ' + chavesDeClinica.length + ' tabela(s) ganharam ' +
              'clinica_id -> clinicas(id)' +
              (jaTinhamClinica.length ? ', ' + jaTinhamClinica.length + ' ja tinham' : ''));
  console.log('   = metade B: ' + compostas.length + ' chave(s) agora sao (clinica_id, id)');
  console.log('   i apagar uma clinica com dado passa a ser RECUSADO. Encerrar uma clinica ' +
              'de verdade e operacao com nome, e nao um DELETE.');
  console.log('   i ' + semProtecao.length + ' relacao(oes) seguem SEM chave estrangeira ' +
              '(ver relatorio: `semProtecao`).');
  if (jaCruzadas.length) {
    console.log('   ! e ' + jaCruzadas.length + ' dela(s) JA tem linha cruzada hoje: ' +
                jaCruzadas.map((x) => x.relacao + ' (' + x.cruzadasHoje + ')').join('; '));
  }
  if (redundantes.length) {
    console.log('   ! chave(s) antiga(s) que nao deu para apagar (a composta esta no lugar, ' +
                'as duas conferem junto): ' + redundantes.join('; '));
  }

  await conn.query(
    'INSERT INTO system_logs (id, action_type, description, author, created_at, clinica_id)' +
    ' VALUES (?, ?, ?, ?, NOW(), NULL)',
    ['lg_027_' + Date.now().toString(36), 'MIGRATION',
     'Migration 027 (M1.8): terceira barreira no banco. ' +
     chavesDeClinica.length + ' tabela(s) ganharam clinica_id -> clinicas(id) ON DELETE ' +
     'RESTRICT (' + jaTinhamClinica.length + ' ja tinham), e ' + compostas.length +
     ' chave(s) estrangeira(s) passaram a ser (clinica_id, id). ' +
     'Linha de uma clinica apontando para o pai de outra passa a ser RECUSADA pelo banco. ' +
     'Seguem sem chave estrangeira ' + semProtecao.length + ' relacao(oes)' +
     (jaCruzadas.length ? ', ' + jaCruzadas.length + ' delas com linha cruzada hoje' : '') + '. ' +
     'Apagar clinica com dado agora e recusado.',
     'Sistema']);

  return {
    chavesDeClinica: chavesDeClinica,
    jaTinhamChaveDeClinica: jaTinhamClinica.length,
    chavesCompostas: compostas,
    chavesAntigasQueSobraram: redundantes,
    semProtecao: semProtecao,
    observacao:
      'A terceira barreira esta no lugar para as ' + compostas.length + ' relacoes que ja ' +
      'tinham chave estrangeira, e a clinica de toda linha das ' + tabelas.length +
      ' tabelas agora tem de existir. ' +
      (jaCruzadas.length
        ? 'ATENCAO: ' + jaCruzadas.length + ' relacao(oes) sem chave estrangeira JA tem linha ' +
          'cruzada: ' + jaCruzadas.map((x) => x.relacao + ' (' + x.cruzadasHoje + ')').join('; ') +
          '. Sao dados na tela da clinica errada, ou invisiveis. Olhe antes de seguir. '
        : 'Nenhuma das relacoes sem chave estrangeira tem linha cruzada hoje. ') +
      'As outras ' + semProtecao.length + ' relacoes seguem contidas apenas pelo codigo ' +
      '(1a e 2a barreiras): criar chave estrangeira nelas muda o que acontece num DELETE, ' +
      'e isso e uma decisao por relacao, nao um lote.'
  };
};

module.exports.ALVOS = ALVOS;
module.exports.PONTEIROS = PONTEIROS;
module.exports.POLIMORFICOS = POLIMORFICOS;

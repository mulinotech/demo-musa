'use strict';
/** A M1.7: `clinica_id` volta a ser OBRIGATÓRIA nas 26 tabelas de clínica.
 *
 *  ============================================ ESTA É A MIGRATION DO INCIDENTE
 *
 *  Em 04/09 a M0.1 fez exatamente isto — e **parou todas as gravações do
 *  sistema por uma hora**. A coluna virou obrigatória enquanto o código ainda
 *  gravava sem ela, então todo `INSERT` passou a ser recusado pelo banco. A
 *  tela dizia "erro ao salvar" e mais nada.
 *
 *  O conserto daquele dia foi a migration 020, que devolveu a coluna a
 *  "aceita vazio". Esta migration desfaz esse conserto — de propósito, e só
 *  agora, porque a condição que faltava finalmente é verdadeira.
 *
 *  ================================================ A CONDIÇÃO, E O QUE MUDOU
 *
 *  O plano dizia que bastava "a catraca esvaziar". **Isso estava errado**, e foi
 *  medido em 09/09: a catraca lista quem fala com o banco direto, e sobraram
 *  quatro arquivos que são exceção permanente (login, migrations, porteiro,
 *  token do cron). Ela nunca vai esvaziar.
 *
 *  A condição certa é mais estreita: **nenhum caminho pode INSERIR numa tabela
 *  de clínica sem carimbar a clínica.** Isso passou a ser verdade em 10/09,
 *  quando a M2.3 converteu a última varredura. A lista que mede isso
 *  (`ESCREVEM_SEM_CLINICA`, em `tests/camada.test.js`) está vazia, e ela falha
 *  o `npm test` se voltar a ter alguém.
 *
 *  ==================================================== O QUE ELA CONFERE ANTES
 *
 *  Nada aqui confia em mim. Antes de tocar em qualquer tabela:
 *
 *  1. **Linha com clínica vazia** — se houver uma, aborta nomeando a tabela e a
 *     quantidade. Uma linha vazia significa que algum caminho ainda grava sem
 *     carimbar, e apertar agora repetiria 04/09.
 *  2. **Linha órfã** — clínica preenchida que não existe em `clinicas`. Não
 *     impede o aperto, mas impede a M1.8 (chaves compostas) depois, então
 *     aparece agora, com nome e contagem.
 *  3. **A lista de tabelas** vem da migration 018, a MESMA lista, e não uma
 *     cópia. Duas listas da mesma coisa divergem na terceira semana.
 *
 *  ===================================================== O QUE ELA NÃO FAZ
 *
 *  **Não cria valor padrão.** Vazio falha fechado; padrão falha aberto — uma
 *  linha que nasce com a clínica errada é pior do que uma linha que não nasce.
 *
 *  **Não toca `system_settings` nem `system_logs`.** Ali vazio tem significado:
 *  é da instalação inteira (o token do cron, o relatório das migrations).
 *
 *  ==================================================== SE ALGO DER ERRADO
 *
 *  DDL no MySQL não é transacional: cada tabela é apertada por conta própria. Se
 *  a quinta falhar, as quatro anteriores já mudaram. O relatório diz **quais
 *  foram apertadas**, e o comando de volta para cada uma é
 *  `ALTER TABLE <t> MODIFY clinica_id VARCHAR(50) NULL`.
 *
 *  A migration é idempotente: tabela que já está `NOT NULL` é pulada.
 */

const LISTAS = require('./018_clinicas.js').LISTAS;
const ALVOS = LISTAS.OBRIGATORIA;

/** As tabelas que existem no banco, entre as que nos interessam. */
async function presentes(conn) {
  const [linhas] = await conn.query(
    'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  const doBanco = linhas.map((l) => l.t);
  return ALVOS.filter((t) => doBanco.indexOf(t) !== -1);
}

async function ehObrigatoria(conn, tabela) {
  const [r] = await conn.query(
    "SELECT IS_NULLABLE AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()" +
    " AND TABLE_NAME = ? AND COLUMN_NAME = 'clinica_id'", [tabela]);
  if (!r.length) return null;                 // a coluna nao existe
  return r[0].n === 'NO';
}

module.exports = async function up(conn) {
  const tabelas = await presentes(conn);
  const faltando = ALVOS.filter((t) => tabelas.indexOf(t) === -1);
  if (faltando.length) {
    console.log('   ! na lista e ausentes do banco: ' + faltando.join(', '));
  }

  // ---------------------------------------- 1. a conferencia que decide tudo
  const vazias = [];
  const orfas = [];
  const antes = {};

  for (const t of tabelas) {
    const temColuna = await ehObrigatoria(conn, t);
    if (temColuna === null) {
      throw new Error(
        '025 PAROU: a tabela `' + t + '` nao tem a coluna clinica_id. A migration 018 ' +
        'rodou nesta instalacao? Apertar sem a coluna nao faz sentido.');
    }

    const [c] = await conn.query('SELECT COUNT(*) AS n FROM `' + t + '`');
    antes[t] = Number(c[0].n);

    const [v] = await conn.query(
      'SELECT COUNT(*) AS n FROM `' + t + '` WHERE clinica_id IS NULL');
    if (Number(v[0].n) > 0) vazias.push(t + ': ' + v[0].n);

    const [o] = await conn.query(
      'SELECT COUNT(*) AS n FROM `' + t + '` x' +
      ' LEFT JOIN clinicas c ON c.id = x.clinica_id' +
      ' WHERE x.clinica_id IS NOT NULL AND c.id IS NULL');
    if (Number(o[0].n) > 0) orfas.push(t + ': ' + o[0].n);
  }

  if (vazias.length) {
    throw new Error(
      '025 PAROU, e NADA foi alterado: ha linha(s) com clinica vazia em ' +
      vazias.join('; ') + '.\n' +
      'Linha vazia significa que algum caminho do sistema ainda grava sem carimbar a ' +
      'clinica -- e apertar a coluna agora faria esse caminho falhar em producao, que e ' +
      'exatamente o incidente de 04/09.\n' +
      'Rode a migration 021 (ela preenche o que ficou vazio) e descubra QUEM gravou: ' +
      'a lista ESCREVEM_SEM_CLINICA em tests/camada.test.js e o portao desta tarefa.'
    );
  }

  if (orfas.length) {
    // Nao impede o aperto -- a coluna pode ser NOT NULL com valor invalido --,
    // mas impede a M1.8. Aparece alto agora, e nao dentro de seis semanas.
    console.log('   ! ATENCAO: linha(s) apontando para clinica que nao existe: ' +
                orfas.join('; ') + '. Isto NAO impede a M1.7, mas impede a M1.8 ' +
                '(chaves estrangeiras compostas).');
  }

  // ---------------------------------------- 2. o aperto, tabela por tabela
  const apertadas = [];
  const jaEstavam = [];

  for (const t of tabelas) {
    if (await ehObrigatoria(conn, t)) { jaEstavam.push(t); continue; }
    try {
      await conn.query('ALTER TABLE `' + t + '` MODIFY clinica_id VARCHAR(50) NOT NULL');
      apertadas.push(t);
    } catch (e) {
      throw new Error(
        '025 PAROU em `' + t + '`: ' + e.message + '\n' +
        'JA FORAM APERTADAS (e continuam apertadas): ' +
        (apertadas.length ? apertadas.join(', ') : 'nenhuma') + '.\n' +
        'Para voltar cada uma: ALTER TABLE <t> MODIFY clinica_id VARCHAR(50) NULL'
      );
    }
  }

  // ------------------------- 3. o critério de aprovação, cobrado pela migration
  //
  // "Rodou sem erro" nao e a mesma coisa que "funcionou". Duas conferencias:
  // a coluna esta mesmo NOT NULL, e nenhuma linha desapareceu no caminho.
  const naoApertaram = [];
  const perderamLinha = [];
  for (const t of tabelas) {
    if (!(await ehObrigatoria(conn, t))) naoApertaram.push(t);
    const [c] = await conn.query('SELECT COUNT(*) AS n FROM `' + t + '`');
    if (Number(c[0].n) !== antes[t]) {
      perderamLinha.push(t + ': ' + antes[t] + ' -> ' + c[0].n);
    }
  }

  if (naoApertaram.length) {
    throw new Error(
      '025: estas continuam aceitando vazio depois do ALTER: ' + naoApertaram.join(', ') +
      '. O comando rodou sem erro e nao surtiu efeito -- confira se ha view, trigger ' +
      'ou permissao no caminho.');
  }
  if (perderamLinha.length) {
    throw new Error(
      '025: a contagem de linhas mudou em ' + perderamLinha.join('; ') +
      '. Um ALTER nao deveria mexer em linha nenhuma. NAO rode mais nada e investigue.');
  }

  console.log('   = ' + apertadas.length + ' tabela(s) apertada(s)' +
              (jaEstavam.length ? ', ' + jaEstavam.length + ' ja estavam' : ''));
  console.log('   i system_settings e system_logs NAO foram tocadas: ali vazio significa');
  console.log('     "e da instalacao", e nao "esqueceram".');
  console.log('   i a partir de agora, INSERT sem clinica FALHA -- e e para isso que ela serve.');

  await conn.query(
    'INSERT INTO system_logs (id, action_type, description, author, created_at, clinica_id)' +
    ' VALUES (?, ?, ?, ?, NOW(), NULL)',
    ['lg_025_' + Date.now().toString(36), 'MIGRATION',
     'Migration 025 (M1.7): clinica_id agora e OBRIGATORIA em ' +
     (apertadas.length + jaEstavam.length) + ' tabela(s) -- ' + apertadas.length +
     ' apertada(s) agora, ' + jaEstavam.length + ' ja estavam. ' +
     (orfas.length ? 'ATENCAO: linhas orfas em ' + orfas.join('; ') + '. ' : '') +
     'A partir daqui, gravacao sem clinica falha no banco.',
     'Sistema']);

  return {
    apertadasAgora: apertadas,
    jaEstavam: jaEstavam.length,
    totalObrigatorias: apertadas.length + jaEstavam.length,
    linhasOrfas: orfas,
    observacao: orfas.length
      ? 'APERTADA, mas ha linha(s) apontando para clinica inexistente: ' + orfas.join('; ') +
        '. Isto nao quebra nada hoje e IMPEDE a M1.8 (chaves compostas). Resolva antes dela.'
      : 'A coluna e obrigatoria nas ' + (apertadas.length + jaEstavam.length) +
        ' tabelas de clinica, e nenhuma linha aponta para clinica inexistente. ' +
        'A M1.8 (chaves estrangeiras compostas) esta liberada.'
  };
};

module.exports.ALVOS = ALVOS;

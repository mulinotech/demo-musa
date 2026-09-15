'use strict';
/** A M2.2 e a M1.2b, juntas: a configuração de linha única passa a ser por clínica.
 *
 *  ============================================= O QUE IMPEDIA A SEGUNDA CLÍNICA
 *
 *  Três tabelas guardam configuração com **id literal fixo**:
 *
 *      pricing_settings   → uma linha, `id = 'default'`
 *      loyalty_settings   → uma linha, `id = 'default'`
 *      finance_categories → 16 linhas, `cat_procedimentos`, `cat_aluguel`, ...
 *
 *  Os ids são fixos de propósito — o código lança a receita do atendimento em
 *  `cat_procedimentos` pelo nome, e a fidelidade lê `'default'` pelo nome. Só
 *  que **a chave primária dessas tabelas é o `id` sozinho**, e por isso o banco
 *  recusa um segundo `'default'`. Quer dizer: por mais que as consultas já
 *  filtrem por clínica, a segunda clínica **não conseguia ter as suas**.
 *
 *  Foi medido em 08/09 e virou a pendência que faltava para o nascimento de uma
 *  clínica: sem esta migration, a clínica nova não lança a primeira despesa
 *  (não tem categoria), não simula preço e não credita ponto.
 *
 *  ====================================== A CORREÇÃO É PEQUENA, E ISSO É O PONTO
 *
 *  As consultas **já estão certas** — `WHERE clinica_id = :clinica AND
 *  id = 'default'` desde a M1.2 e a M1.4. Não há uma linha de código a mudar:
 *  o que falta é o esquema deixar a mesma chave existir uma vez **por clínica**.
 *
 *  A chave primária passa a ser `(clinica_id, id)`. Os ids continuam fixos, e é
 *  isso que mantém o código funcionando: cada clínica tem **o seu**
 *  `cat_procedimentos`, e a receita de cada uma cai na categoria dela.
 *
 *  ==================================================== POR QUE ISTO É SEGURO
 *
 *  Nenhuma chave estrangeira aponta para estas três tabelas — conferido na M1.8,
 *  que listou as 30 colunas que apontam para um pai: `cash_entries.category_id`
 *  e `recurring_expenses.category_id` estão entre as 22 **sem** chave. Então
 *  trocar a primária não arrasta ninguém.
 *
 *  (E é bom que estejam sem chave por enquanto: uma chave estrangeira para
 *  `finance_categories` teria de ser composta desde o início, e a M1.9 vai
 *  tratar disso com a lista inteira de uma vez.)
 *
 *  O `DROP` e o `ADD` vão **na mesma instrução**. Em dois comandos existiria um
 *  instante sem chave primária nenhuma, e nesse instante duas linhas iguais
 *  poderiam entrar.
 */

const ALVOS = ['finance_categories', 'loyalty_settings', 'pricing_settings'];

async function chavePrimariaDe(conn, tabela) {
  const [r] = await conn.query(
    "SELECT COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE" +
    " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'" +
    " ORDER BY ORDINAL_POSITION", [tabela]);
  return r.map((x) => x.c);
}

module.exports = async function up(conn) {
  const [doBanco] = await conn.query(
    'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  const existem = ALVOS.filter((t) => doBanco.some((x) => x.t === t));

  // ------------------------------------------- 1. as conferencias de antes
  const antes = {};
  const duplicadas = [];
  const semColuna = [];

  for (const t of existem) {
    const [c] = await conn.query('SELECT COUNT(*) AS n FROM `' + t + '`');
    antes[t] = Number(c[0].n);

    const [col] = await conn.query(
      "SELECT IS_NULLABLE AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()" +
      " AND TABLE_NAME = ? AND COLUMN_NAME = 'clinica_id'", [t]);
    if (!col.length || col[0].n !== 'NO') semColuna.push(t);

    // Nao pode haver (clinica_id, id) repetido -- e com `id` sendo primaria hoje
    // isso e impossivel. Confere mesmo assim: se um dia esta migration rodar
    // numa instalacao com esquema diferente, e aqui que se descobre, e nao no
    // meio do ALTER.
    const [d] = await conn.query(
      'SELECT COUNT(*) AS n FROM (SELECT clinica_id, id FROM `' + t + '`' +
      ' GROUP BY clinica_id, id HAVING COUNT(*) > 1) x');
    if (Number(d[0].n) > 0) duplicadas.push(t + ': ' + d[0].n + ' par(es) repetido(s)');
  }

  if (semColuna.length) {
    throw new Error(
      '030 PAROU, e NADA foi alterado: `clinica_id` nao e obrigatoria em ' + semColuna.join(', ') +
      '. Coluna que aceita vazio NAO pode entrar em chave primaria (foi o que impediu o plano ' +
      'original da 024). Rode a migration 025 antes desta.');
  }
  if (duplicadas.length) {
    throw new Error(
      '030 PAROU, e NADA foi alterado: ha (clinica_id, id) repetido em ' + duplicadas.join('; ') +
      '. A chave primaria composta recusaria essas linhas.');
  }

  // ------------------------------------------- 2. a troca da chave primaria
  const trocadas = [];
  const jaEstavam = [];

  for (const t of existem) {
    const atual = await chavePrimariaDe(conn, t);
    if (atual.length === 2 && atual.indexOf('clinica_id') !== -1) { jaEstavam.push(t); continue; }
    try {
      // DROP e ADD na MESMA instrucao: em dois comandos existiria um instante
      // sem chave primaria, e nesse instante duas linhas iguais entrariam.
      await conn.query('ALTER TABLE `' + t + '` DROP PRIMARY KEY, ADD PRIMARY KEY (clinica_id, id)');
      trocadas.push(t);
    } catch (e) {
      throw new Error(
        '030 PAROU em `' + t + '`: ' + e.message + '\n' +
        'JA FORAM TROCADAS (e continuam trocadas): ' +
        (trocadas.length ? trocadas.join(', ') : 'nenhuma') + '.\n' +
        'Para voltar cada uma: ALTER TABLE <t> DROP PRIMARY KEY, ADD PRIMARY KEY (id)');
    }
  }

  // ------------------- 3. o criterio de aprovacao, cobrado pela migration
  const erradas = [];
  const perderamLinha = [];
  for (const t of existem) {
    const pk = await chavePrimariaDe(conn, t);
    if (pk.length !== 2 || pk.indexOf('clinica_id') === -1 || pk.indexOf('id') === -1) {
      erradas.push(t + ': (' + pk.join(', ') + ')');
    }
    const [c] = await conn.query('SELECT COUNT(*) AS n FROM `' + t + '`');
    if (Number(c[0].n) !== antes[t]) perderamLinha.push(t + ': ' + antes[t] + ' -> ' + c[0].n);
  }
  if (erradas.length) {
    throw new Error(
      '030: estas tabelas nao ficaram com a chave primaria composta: ' + erradas.join('; ') +
      '. Sem isso, a segunda clinica continua sem conseguir ter a configuracao dela.');
  }
  if (perderamLinha.length) {
    throw new Error(
      '030: a contagem de linhas mudou em ' + perderamLinha.join('; ') +
      '. Trocar chave primaria nao apaga linha. NAO rode mais nada e investigue.');
  }

  console.log('   = ' + trocadas.length + ' tabela(s) com chave primaria (clinica_id, id)' +
              (jaEstavam.length ? ', ' + jaEstavam.length + ' ja estavam' : ''));
  console.log('   i os ids continuam FIXOS -- cada clinica tem o SEU cat_procedimentos,');
  console.log('     o SEU pricing "default" e o SEU loyalty "default". E e isso que');
  console.log('     mantem o codigo funcionando sem uma linha de mudanca.');

  await conn.query(
    'INSERT INTO system_logs (id, action_type, description, author, created_at, clinica_id)' +
    ' VALUES (?, ?, ?, ?, NOW(), NULL)',
    ['lg_030_' + Date.now().toString(36), 'MIGRATION',
     'Migration 030 (M1.2b + M2.2): chave primaria composta (clinica_id, id) em ' +
     trocadas.length + ' tabela(s) de configuracao (' + jaEstavam.length + ' ja estavam). ' +
     'Cada clinica passa a poder ter as proprias 16 categorias financeiras, a propria ' +
     'configuracao de preco e o proprio programa de pontos. Era o que faltava para uma ' +
     'segunda clinica conseguir trabalhar.',
     'Sistema']);

  return {
    chavesTrocadas: trocadas,
    jaEstavam: jaEstavam.length,
    observacao:
      'As tres tabelas de configuracao aceitam agora uma linha POR CLINICA, com os mesmos ids ' +
      'fixos de sempre. Nenhuma consulta mudou -- elas ja filtravam por clinica desde a M1.2/M1.4; ' +
      'o que faltava era o esquema permitir. A partir daqui, uma clinica nova pode nascer com a ' +
      'configuracao dela.'
  };
};

module.exports.ALVOS = ALVOS;
module.exports.chavePrimariaDe = chavePrimariaDe;

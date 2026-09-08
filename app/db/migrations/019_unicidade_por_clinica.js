'use strict';
/** 019 — M0.2: as unicidades que atravessam clínicas.
 *
 *  ===================================================== O QUE ESTÁ EM JOGO
 *
 *  Uma restrição de unicidade que não inclui a clínica faz uma de duas coisas
 *  ruins, e as duas são difíceis de diagnosticar depois:
 *
 *  a) **BLOQUEIA.** A clínica B não consegue cadastrar o código de produto
 *     `TOX-100` porque a clínica A já usou. A recepcionista da B vê "código já
 *     existe" olhando uma lista onde ele não existe.
 *
 *  b) **SILENCIA.** As chaves de origem (`source`, `source_id`, `type`) são a
 *     trava de idempotência do sistema: `ER_DUP_ENTRY` significa "isso já foi
 *     feito". Se a chave da clínica B colidir com a da A, a receita da B é
 *     tratada como já lançada e **não entra** — sem erro, sem log, sem
 *     sintoma, até o fechamento do mês não bater.
 *
 *  O (b) é improvável: `source_id` é id sorteado. Mas "improvável" não é
 *  garantia, e o custo de incluir a clínica na chave é uma linha.
 *
 *  ============================================== `users.email` FICA GLOBAL
 *
 *  Decisão de produto de 04/09, e é a única exceção desta migration. O e-mail
 *  continua único entre as 50 clínicas, o login segue `WHERE email = ?`, e a
 *  linha do usuário é que diz de qual clínica ele é. Profissional que atende em
 *  duas usa dois endereços.
 *
 *  A consequência disso NÃO é de banco, é de texto, e está tratada em
 *  `server/routes/users.js`: a recusa de e-mail duplicado não pode contar à
 *  clínica A que o endereço existe na clínica B.
 *
 *  ===================================================== COMO ELA SE PROTEGE
 *
 *  O índice não é procurado pelo NOME e sim pelo CONJUNTO DE COLUNAS que
 *  cobre. O índice do `sku` foi criado pelo MySQL com nome automático, e nome
 *  automático é o tipo de coisa que muda entre versões. Procurar pelas colunas
 *  não depende disso.
 *
 *  E antes de criar cada índice único novo, ela conta duplicatas dentro da
 *  clínica. Se houvesse, o `CREATE UNIQUE INDEX` falharia com uma mensagem do
 *  MySQL que não diz onde está o problema; aqui a migration para dizendo a
 *  tabela e quantas linhas.
 */

/** As quatro que passam a incluir a clínica.
 *
 *  `colunas` é o conjunto EXATO do índice de hoje — é por ele que o índice é
 *  encontrado. `novo` é o nome que o índice composto recebe. */
const ALVOS = [
  {
    tabela: 'products',
    colunas: ['sku'],
    novo: 'uq_produto_sku',
    porque: 'duas clinicas nao podem disputar um codigo de produto'
  },
  {
    tabela: 'cash_entries',
    colunas: ['source', 'source_id', 'type'],
    novo: 'uq_cash_source',
    porque: 'chave de idempotencia: colisao entre clinicas some com uma receita'
  },
  {
    tabela: 'loyalty_transactions',
    colunas: ['source', 'source_id', 'type'],
    novo: 'uq_loyalty_source',
    porque: 'chave de idempotencia: colisao entre clinicas some com um acumulo'
  },
  {
    tabela: 'service_supplies',
    colunas: ['catalog_id', 'product_id'],
    novo: 'uq_service_product',
    porque: 'ficha tecnica e da clinica; o par so faz sentido dentro dela'
  }
];

/** Fica de fora, e não por esquecimento. Ver "users.email FICA GLOBAL". */
const GLOBAL_POR_DECISAO = [{ tabela: 'users', colunas: ['email'] }];

/* ---------------------------------------------------------------- ajudantes */

/** Índices únicos de uma tabela, com as colunas na ordem do índice. */
async function indicesUnicos(conn, tabela) {
  const [r] = await conn.query(
    `SELECT INDEX_NAME AS nome, COLUMN_NAME AS coluna, SEQ_IN_INDEX AS ordem
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY'
      ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    [tabela]
  );
  const mapa = new Map();
  for (const linha of r) {
    if (!mapa.has(linha.nome)) mapa.set(linha.nome, []);
    mapa.get(linha.nome).push(linha.coluna);
  }
  return mapa;
}

/** Nome do índice único que cobre EXATAMENTE estas colunas, nesta ordem.
 *  Procurar por coluna e não por nome: o índice do `sku` tem nome automático. */
function nomeDoIndice(mapa, colunas) {
  for (const [nome, cols] of mapa) {
    if (cols.length === colunas.length && cols.every((c, i) => c === colunas[i])) return nome;
  }
  return null;
}

/** Duplicatas que impediriam o índice composto de nascer. Linhas com qualquer
 *  coluna vazia ficam de fora: em índice único do MySQL, vazio não colide com
 *  vazio — e é o que permite vários produtos sem código na mesma clínica. */
async function duplicatasDentroDaClinica(conn, tabela, colunas) {
  const lista = colunas.map((c) => '`' + c + '`').join(', ');
  const naoVazias = colunas.map((c) => '`' + c + '` IS NOT NULL').join(' AND ');
  const [r] = await conn.query(
    'SELECT COUNT(*) AS n FROM (' +
      'SELECT 1 FROM `' + tabela + '` WHERE ' + naoVazias +
      ' GROUP BY clinica_id, ' + lista + ' HAVING COUNT(*) > 1' +
    ') AS d'
  );
  return Number(r[0].n);
}

/* ----------------------------------------------------------------------- up */

module.exports = async function up(conn) {
  let trocados = 0, jaEstavam = 0;

  for (const alvo of ALVOS) {
    const mapa = await indicesUnicos(conn, alvo.tabela);
    const comClinica = ['clinica_id'].concat(alvo.colunas);

    // Já convertido? Sai sem tocar em nada.
    if (nomeDoIndice(mapa, comClinica)) {
      jaEstavam += 1;
      continue;
    }

    const antigo = nomeDoIndice(mapa, alvo.colunas);
    if (!antigo) {
      throw new Error(
        '019 PAROU: nao achei em `' + alvo.tabela + '` indice unico sobre (' +
        alvo.colunas.join(', ') + '), nem a versao com clinica_id. Alguem mexeu ' +
        'nos indices desta tabela por fora das migrations. Confira ' +
        '`SHOW INDEX FROM ' + alvo.tabela + '` antes de seguir -- rodar as cegas ' +
        'aqui pode deixar a tabela sem trava de unicidade nenhuma.'
      );
    }

    const dup = await duplicatasDentroDaClinica(conn, alvo.tabela, alvo.colunas);
    if (dup) {
      throw new Error(
        '019 PAROU: `' + alvo.tabela + '` tem ' + dup + ' grupo(s) de linhas que se ' +
        'repetem dentro da mesma clinica em (' + alvo.colunas.join(', ') + '). O indice ' +
        'unico novo nao nasceria. Resolva as duplicatas antes -- e note que elas nao ' +
        'deveriam existir, porque a trava atual e MAIS restritiva que a nova.'
      );
    }

    // A ordem importa: derrubar depois de criar seria impossivel (o antigo
    // impediria o novo de existir em tabela com dados), e derrubar antes deixa
    // a tabela alguns milissegundos sem trava. Numa instalacao de uma clinica
    // so, com a aplicacao no ar, esse intervalo e aceitavel; se um dia isto
    // rodar com 50 clinicas gravando, faca em janela de manutencao.
    await conn.query('ALTER TABLE `' + alvo.tabela + '` DROP INDEX `' + antigo + '`');
    await conn.query(
      'CREATE UNIQUE INDEX `' + alvo.novo + '` ON `' + alvo.tabela + '` (' +
      comClinica.map((c) => '`' + c + '`').join(', ') + ')'
    );
    console.log('   ~ ' + alvo.tabela + ': (' + alvo.colunas.join(',') + ') -> (' +
      comClinica.join(',') + ')  [' + alvo.porque + ']');
    trocados += 1;
  }

  console.log('   + ' + trocados + ' unicidade(s) agora por clinica' +
    (jaEstavam ? ', ' + jaEstavam + ' ja estava(m)' : ''));

  // -------------------------------------------------------- a conferência
  const faltando = [];
  for (const alvo of ALVOS) {
    const mapa = await indicesUnicos(conn, alvo.tabela);
    if (!nomeDoIndice(mapa, ['clinica_id'].concat(alvo.colunas))) {
      faltando.push(alvo.tabela);
    }
    if (nomeDoIndice(mapa, alvo.colunas)) {
      faltando.push(alvo.tabela + ' (o indice global ainda existe)');
    }
  }
  if (faltando.length) {
    throw new Error('019: conferencia falhou em ' + faltando.join(', '));
  }
  console.log('   = as ' + ALVOS.length + ' unicidades conferidas, e nenhuma global sobrou');

  // E a que fica global de propósito continua global.
  for (const g of GLOBAL_POR_DECISAO) {
    const mapa = await indicesUnicos(conn, g.tabela);
    if (!nomeDoIndice(mapa, g.colunas)) {
      throw new Error(
        '019: `' + g.tabela + '`.(' + g.colunas.join(',') + ') deveria continuar unico no ' +
        'sistema inteiro (decisao de produto de 04/09) e nao esta. Sem essa trava, duas ' +
        'clinicas cadastram o mesmo e-mail e o login fica ambiguo.'
      );
    }
  }
  console.log('   = users.email segue unico no sistema inteiro, por decisao');
};

module.exports.ALVOS = ALVOS;
module.exports.GLOBAL_POR_DECISAO = GLOBAL_POR_DECISAO;
module.exports.nomeDoIndice = nomeDoIndice;

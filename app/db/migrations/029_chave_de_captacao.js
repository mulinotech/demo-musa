'use strict';
/** Cada clínica ganha uma CHAVE DE CAPTAÇÃO para o formulário do site dela.
 *
 *  =================================================== O PROBLEMA QUE ISTO RESOLVE
 *
 *  `POST /api/leads` é a única rota de gravação sem sessão: é o formulário do
 *  site e o quiz que postam ali, de fora, sem ninguém logado. **Um formulário
 *  público não sabe de qual clínica ele é** — o pedido chega sem token, sem
 *  sessão e sem nada que identifique o consultório.
 *
 *  Hoje a rota grava na única clínica que existe e **recusa com 503 se houver
 *  mais de uma**, de propósito: chutar arquivaria o lead de uma clínica debaixo
 *  de outra, e lead é dinheiro entrando pela porta. A consequência é dura e está
 *  escrita no cabeçalho da rota desde a M1.6: **no dia em que a segunda clínica
 *  for cadastrada, o formulário público para de gravar.**
 *
 *  Esta migration é a saída, decidida em 11/09: **chave pública por clínica**.
 *  O formulário passa a postar em `/api/leads?captacao=<chave>`.
 *
 *  ============================================ ESTA CHAVE NÃO É UMA SENHA
 *
 *  E o comentário existe porque a palavra "chave" engana. Ela **vive no código
 *  da página** de quem a usa — qualquer visitante do site consegue lê-la
 *  apertando Ctrl+U. Isso é da natureza da solução, não um descuido:
 *
 *  - o que ela permite é **criar um lead naquela clínica**, e nada mais. Ela não
 *    lê paciente, não lê agenda, não lê nada;
 *  - o risco real é **lead falso** (alguém enche o funil de uma clínica com
 *    cadastros inventados), e o remédio é o limite de envios por IP na rota, não
 *    o sigilo da chave;
 *  - portanto ela pode aparecer em tela, em relatório de migration e em log sem
 *    problema. **Não a trate como credencial, e não a reaproveite para nada.**
 *
 *  A alternativa que seria realmente secreta — token de integração, enviado pelo
 *  servidor do site da clínica — foi descartada em 11/09 pelo motivo prático: a
 *  maioria das clínicas tem landing page com formulário em JavaScript, que não
 *  guarda segredo nenhum. Ela travaria a captação da maior parte delas.
 *
 *  ========================================================= EXPANDIR, MIGRAR, APERTAR
 *
 *  A coluna nasce aceitando vazio, é preenchida para todas as clínicas, e só
 *  então vira obrigatória e única. Mesma disciplina da M1.7, e pelo mesmo
 *  motivo: apertar antes de preencher é o incidente de 04/09.
 */

const crypto = require('crypto');

/** 96 bits de aleatoriedade, com prefixo para a chave ser reconhecível quando
 *  alguém a encontrar solta num HTML e se perguntar o que é. */
function novaChave() {
  return 'cap_' + crypto.randomBytes(12).toString('hex');
}

async function colunaExiste(conn, tabela, coluna) {
  const [r] = await conn.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()' +
    ' AND TABLE_NAME = ? AND COLUMN_NAME = ?', [tabela, coluna]);
  return r.length > 0;
}

async function indiceExiste(conn, tabela, indice) {
  const [r] = await conn.query(
    'SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()' +
    ' AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1', [tabela, indice]);
  return r.length > 0;
}

module.exports = async function up(conn) {
  // ------------------------------------------------------- 1. EXPANDIR
  if (!(await colunaExiste(conn, 'clinicas', 'chave_captacao'))) {
    await conn.query('ALTER TABLE clinicas ADD COLUMN chave_captacao VARCHAR(40) NULL');
  }

  // ------------------------------------------------------- 2. MIGRAR
  //
  // Uma chave por clinica, gerada aqui. Se duas colidirem -- o que exigiria
  // sorte de 2^96 --, o indice unico do passo 3 recusa e a migration para com a
  // mensagem do banco, que e o certo: chave repetida mandaria o lead de uma
  // clinica para a outra.
  const [semChave] = await conn.query(
    'SELECT id, nome FROM clinicas WHERE chave_captacao IS NULL OR chave_captacao = ""');
  const geradas = [];
  for (const c of semChave) {
    const chave = novaChave();
    await conn.query('UPDATE clinicas SET chave_captacao = ? WHERE id = ?', [chave, c.id]);
    geradas.push({ clinica: c.id, nome: c.nome, chave: chave });
  }

  // ------------------------------------------------------- 3. APERTAR
  const [vazias] = await conn.query(
    'SELECT COUNT(*) AS n FROM clinicas WHERE chave_captacao IS NULL OR chave_captacao = ""');
  if (Number(vazias[0].n) > 0) {
    throw new Error(
      '029 PAROU: ' + vazias[0].n + ' clinica(s) continuam sem chave de captacao depois do ' +
      'preenchimento. Apertar a coluna agora faria o cadastro de clinica nova falhar. ' +
      'Investigue antes de rodar de novo.');
  }

  await conn.query('ALTER TABLE clinicas MODIFY chave_captacao VARCHAR(40) NOT NULL');
  if (!(await indiceExiste(conn, 'clinicas', 'uq_clinica_captacao'))) {
    await conn.query('CREATE UNIQUE INDEX uq_clinica_captacao ON clinicas (chave_captacao)');
  }

  // --------------------------- 4. o criterio de aprovacao, cobrado pela migration
  const [conf] = await conn.query(
    "SELECT COUNT(*) AS total, COUNT(DISTINCT chave_captacao) AS distintas," +
    " SUM(chave_captacao IS NULL OR chave_captacao = '') AS vazias FROM clinicas");
  if (Number(conf[0].vazias) > 0 || Number(conf[0].total) !== Number(conf[0].distintas)) {
    throw new Error(
      '029: depois de tudo, ha ' + conf[0].vazias + ' clinica(s) sem chave e ' +
      (Number(conf[0].total) - Number(conf[0].distintas)) + ' chave(s) repetida(s). ' +
      'Chave repetida manda o lead de uma clinica para a outra.');
  }

  const [col] = await conn.query(
    "SELECT IS_NULLABLE AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()" +
    " AND TABLE_NAME = 'clinicas' AND COLUMN_NAME = 'chave_captacao'");
  if (!col.length || col[0].n !== 'NO') {
    throw new Error('029: a coluna continua aceitando vazio depois do ALTER.');
  }

  console.log('   + chave de captacao em ' + conf[0].total + ' clinica(s) (' +
              geradas.length + ' gerada(s) agora)');
  console.log('   i a chave e PUBLICA: ela vive no codigo da pagina de quem a usa.');
  console.log('     O que ela permite e criar lead naquela clinica, e nada mais.');

  await conn.query(
    'INSERT INTO system_logs (id, action_type, description, author, created_at, clinica_id)' +
    ' VALUES (?, ?, ?, ?, NOW(), NULL)',
    ['lg_029_' + Date.now().toString(36), 'MIGRATION',
     'Migration 029: chave de captacao publica criada para ' + conf[0].total + ' clinica(s) (' +
     geradas.length + ' gerada(s) nesta execucao). O formulario do site passa a postar em ' +
     '/api/leads?captacao=<chave>. Sem a chave, e havendo mais de uma clinica, a rota recusa ' +
     'com 503 em vez de escolher.',
     'Sistema']);

  return {
    chavesGeradas: geradas,
    totalDeClinicas: Number(conf[0].total),
    observacao:
      'Cada clinica tem agora uma chave publica de captacao. O formulario do site tem de postar ' +
      'em /api/leads?captacao=<chave> -- enquanto houver UMA clinica so, a rota continua aceitando ' +
      'sem chave, para o site atual nao parar. Assim que a segunda clinica existir, formulario sem ' +
      'chave passa a ser recusado com 503. A chave NAO e senha: ela fica visivel no codigo da ' +
      'pagina, e o que ela permite e criar lead naquela clinica, nada mais.'
  };
};

module.exports.novaChave = novaChave;

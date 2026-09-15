'use strict';
/** A instância de WhatsApp e a configuração passam a ser DA CLÍNICA.
 *
 *  ======================================================= AS DUAS MUDANÇAS
 *
 *  1. `clinicas.evolution_instance` — o nome da instância na Evolution. O
 *     servidor da Evolution continua um só (é `EVOLUTION_API_URL` e
 *     `EVOLUTION_API_KEY` que autenticam nele); o que passa a ser por clínica é
 *     a **instância**, que é onde mora o número de WhatsApp e a sessão.
 *
 *     É esta coluna que resolve o problema do webhook: a Evolution informa, em
 *     cada mensagem recebida, **qual instância a recebeu**. Com a instância
 *     ligada à clínica, a mensagem que chega passa a ter dono — hoje ela traz
 *     só um telefone, e telefone repetido entre clínicas é caso real.
 *
 *  2. `clinica_settings` — a configuração que é de UMA clínica.
 *
 *  ================== POR QUE UMA TABELA NOVA, E NÃO CHAVE PRIMÁRIA COMPOSTA
 *
 *  O plano previa transformar a primária de `system_settings` em
 *  `(chave, clinica_id)`. **Não dá, e o motivo é do MySQL:** coluna que aceita
 *  vazio não pode entrar em chave primária. E `system_settings.clinica_id`
 *  precisa aceitar vazio, porque a tabela guarda dois tipos de linha que não
 *  são a mesma coisa:
 *
 *  - o **token do cron**, que é da instalação inteira — não existe "o token da
 *    clínica A";
 *  - a **configuração de lembrete**, que é de cada clínica.
 *
 *  Forçar as duas na mesma tabela exigiria inventar uma clínica-fantasma para
 *  as linhas da instalação, e aí "de quem é esta linha?" voltaria a depender de
 *  quem lê. Separar deixa a distinção no **esquema**, e não num comentário:
 *  `clinica_settings.clinica_id` é NOT NULL e tem chave estrangeira; o que
 *  sobra em `system_settings` é, por definição, da instalação.
 *
 *  ============================================================= FALHA FECHADO
 *
 *  Se não der para descobrir a instância desta instalação, os lembretes são
 *  **desligados** para a clínica, e a migration diz isso em voz alta. Lembrete
 *  disparado pela instância errada é mensagem enviada para paciente real, pelo
 *  número de outro consultório, e mensagem enviada não tem desfazer. Religar é
 *  um clique depois de escolher a instância na tela; desfazer um envio não é
 *  nada.
 */

const CHAVES_DE_CLINICA = ['lembretes_ativos', 'lembrete_template', 'lembrete_antecedencia_h'];

module.exports = async function up(conn) {
  const [clinicas] = await conn.query('SELECT id FROM clinicas ORDER BY id');
  if (clinicas.length !== 1) {
    throw new Error(
      '024 PAROU: ' + clinicas.length + ' clinica(s) cadastrada(s). Esta migration move a ' +
      'configuracao de lembrete da instalacao para a UNICA clinica que existe. Com duas ou ' +
      'mais, nao ha como saber de quem era a configuracao -- e atribui-la no chute liga o ' +
      'WhatsApp de uma clinica com o texto de outra.'
    );
  }
  const clinica = clinicas[0].id;

  // ------------------------------------------- 1. a coluna da instancia
  const [colunas] = await conn.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()" +
    " AND TABLE_NAME = 'clinicas' AND COLUMN_NAME = 'evolution_instance'");
  if (!colunas.length) {
    await conn.query('ALTER TABLE clinicas ADD COLUMN evolution_instance VARCHAR(100) NULL');
    console.log('   + clinicas.evolution_instance');
  } else {
    console.log('   = clinicas.evolution_instance ja existia');
  }

  // Duas clinicas apontando para a MESMA instancia significaria a mensagem
  // recebida ter dois donos -- e o webhook teria de escolher. O banco recusa
  // antes.
  const [indices] = await conn.query(
    "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()" +
    " AND TABLE_NAME = 'clinicas' AND INDEX_NAME = 'uq_clinica_instancia'");
  if (!indices.length) {
    await conn.query(
      'ALTER TABLE clinicas ADD UNIQUE INDEX uq_clinica_instancia (evolution_instance)');
    console.log('   + unicidade da instancia (duas clinicas na mesma instancia e recusado)');
  }

  // ------------------------------------------- 2. a tabela de configuracao
  //
  // A COLACAO DE `clinica_id` E COPIADA DE `clinicas.id`, e nao escrita a mao.
  //
  // Chave estrangeira exige colacao IGUAL nas duas pontas. Escrever
  // `utf8mb4_unicode_ci` aqui funciona nesta instalacao por coincidencia -- e
  // e coincidencia mesmo: depende do padrao do banco na hora em que a tabela
  // `clinicas` foi criada. Num banco com outro padrao, o CREATE TABLE falha com
  // "Foreign key constraint is incorrectly formed", que nao diz nada sobre
  // colacao e manda procurar o defeito no lugar errado.
  //
  // Pego pelo ensaio contra MySQL de verdade, em 09/09, antes de ir ao ar.
  const [colacao] = await conn.query(
    "SELECT COLLATION_NAME AS c, CHARACTER_SET_NAME AS cs FROM information_schema.COLUMNS" +
    " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clinicas' AND COLUMN_NAME = 'id'");
  if (!colacao.length) {
    throw new Error('024 PAROU: nao encontrei a coluna clinicas.id. A migration 018 rodou?');
  }
  const COL = ' CHARACTER SET ' + colacao[0].cs + ' COLLATE ' + colacao[0].c;
  console.log('   i colacao de clinicas.id: ' + colacao[0].c + ' (copiada para a chave nova)');

  await conn.query(
    'CREATE TABLE IF NOT EXISTS clinica_settings (' +
    '  clinica_id VARCHAR(50)' + COL + ' NOT NULL,' +
    '  chave VARCHAR(100) NOT NULL,' +
    '  valor TEXT NULL,' +
    '  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,' +
    '  PRIMARY KEY (clinica_id, chave),' +
    '  FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE' +
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');

  // ------------------------------------------- 3. a mudanca de casa
  let movidas = 0;
  const [existentes] = await conn.query(
    "SELECT chave, valor FROM system_settings WHERE chave LIKE 'lembrete%'");
  const daInstalacao = {};
  for (const l of existentes) daInstalacao[l.chave] = l.valor;

  for (const chave of CHAVES_DE_CLINICA) {
    if (!(chave in daInstalacao)) continue;
    await conn.query(
      'INSERT INTO clinica_settings (clinica_id, chave, valor) VALUES (?, ?, ?)' +
      ' ON DUPLICATE KEY UPDATE valor = VALUES(valor)',
      [clinica, chave, daInstalacao[chave]]);
    movidas += 1;
  }

  // A CONFERENCIA VEM ANTES DE APAGAR. Copiar e apagar sem conferir e como esta
  // migration perderia configuracao sem dar erro nenhum.
  if (movidas) {
    const [conferencia] = await conn.query(
      'SELECT chave, valor FROM clinica_settings WHERE clinica_id = ?', [clinica]);
    const nova = {};
    for (const l of conferencia) nova[l.chave] = l.valor;
    const divergentes = CHAVES_DE_CLINICA
      .filter((c) => c in daInstalacao)
      .filter((c) => nova[c] !== daInstalacao[c]);
    if (divergentes.length) {
      throw new Error(
        '024: a copia nao bate para ' + divergentes.join(', ') + '. Nada foi apagado. ' +
        'Rode de novo -- ela e idempotente.');
    }
    const [del] = await conn.query(
      "DELETE FROM system_settings WHERE chave LIKE 'lembrete%'");
    console.log('   = ' + movidas + ' chave(s) movida(s) para ' + clinica +
                ' (' + del.affectedRows + ' apagada(s) da instalacao)');
  } else {
    console.log('   = nenhuma configuracao de lembrete na instalacao para mover');
  }

  // ------------------------------------------- 4. a instancia desta clinica
  const doEnv = (process.env.EVOLUTION_INSTANCE_NAME || '').trim();
  let instancia = null;
  const [atual] = await conn.query(
    'SELECT evolution_instance FROM clinicas WHERE id = ?', [clinica]);
  if (atual[0] && atual[0].evolution_instance) {
    instancia = atual[0].evolution_instance;
    console.log('   = a clinica ja tinha instancia: ' + instancia);
  } else if (doEnv) {
    await conn.query('UPDATE clinicas SET evolution_instance = ? WHERE id = ?', [doEnv, clinica]);
    instancia = doEnv;
    console.log('   + instancia "' + doEnv + '" (de EVOLUTION_INSTANCE_NAME) para ' + clinica);
  }

  let lembretesDesligados = false;
  if (!instancia) {
    // Sem instancia nao ha por onde mandar. Deixar ligado faria o worker tentar
    // resolver a instancia sozinho -- que e exatamente o comportamento global
    // que esta migration existe para acabar.
    const [r] = await conn.query(
      "UPDATE clinica_settings SET valor = '0'" +
      " WHERE clinica_id = ? AND chave = 'lembretes_ativos' AND valor <> '0'", [clinica]);
    lembretesDesligados = r.affectedRows > 0;
    console.log('   ! sem instancia para ' + clinica + ': lembretes ' +
                (lembretesDesligados ? 'DESLIGADOS' : 'ja estavam desligados') +
                '. Escolha a instancia na tela "Integracao WhatsApp" e religue.');
  }

  const logId = 'lg_024_' + Date.now().toString(36);
  await conn.query(
    'INSERT INTO system_logs (id, action_type, description, author, created_at, clinica_id)' +
    ' VALUES (?, ?, ?, ?, NOW(), NULL)',
    [logId, 'MIGRATION',
     'Migration 024: ' + movidas + ' chave(s) de lembrete movida(s) para ' + clinica +
     '; instancia de WhatsApp: ' + (instancia || 'NAO CONFIGURADA') +
     (lembretesDesligados ? '; lembretes desligados por falta de instancia' : ''),
     'Sistema']);

  return {
    clinica: clinica,
    chavesMovidas: movidas,
    instancia: instancia,
    lembretesDesligadosPorFaltaDeInstancia: lembretesDesligados,
    observacao: instancia
      ? 'A instancia "' + instancia + '" agora pertence a ' + clinica + '. O webhook passa a ' +
        'identificar a clinica por ela, em vez de adivinhar pelo telefone.'
      : 'NENHUMA instancia configurada. Os lembretes ficam desligados ate voce escolher a ' +
        'instancia na tela "Integracao WhatsApp" -- e isso e de proposito: lembrete pela ' +
        'instancia errada e mensagem enviada para paciente real, e envio nao tem desfazer.'
  };
};

module.exports.CHAVES_DE_CLINICA = CHAVES_DE_CLINICA;

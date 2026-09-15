'use strict';
/** O OPERADOR DA PLATAFORMA — quem administra as 50 sem ser de nenhuma (M3.1).
 *
 *  ============================================ POR QUE UMA TABELA, E NÃO UM PAPEL
 *
 *  O caminho curto seria um papel novo em `users`: `role = 'plataforma'`. Ele
 *  esbarra num fato medido, e não numa preferência:
 *
 *  **`users.clinica_id` é NOT NULL desde a migration 025 (a M1.7).** Um operador
 *  da plataforma não tem clínica — é o que o define. Colocá-lo em `users`
 *  exigiria tornar a coluna opcional **na tabela de gente**, desfazendo, na
 *  tabela mais sensível do sistema, o aperto que custou a M1.7 inteira. A
 *  alternativa pior ainda seria dar-lhe uma clínica de mentira (`cl_1`), e aí
 *  todo `WHERE clinica_id = :clinica` passaria a devolver a Musa para ele — um
 *  operador lendo dado de clínica sem nenhum erro aparecer.
 *
 *  Então a identidade dele mora **fora** do inquilino. Consequências, todas
 *  desejadas:
 *
 *   - `escopo(req)` continua estourando para ele, como deve: não há clínica de
 *     onde tirar o filtro, e a camada diz isso em voz alta;
 *   - o login dele é **outra porta** (`POST /api/plataforma/login`), então o
 *     mesmo endereço de e-mail pode existir nos dois mundos sem ambiguidade —
 *     a dona da Mulino é administradora da Musa E operadora da plataforma, e
 *     esses são dois acessos, com duas senhas;
 *   - nenhuma rota do CRM o aceita, porque o porteiro exige `clinicaId` no
 *     token e o token dele não tem.
 *
 *  ==================================================== O QUE ELE PODE, E COMO
 *
 *  A tabela não tem papel nem permissão: **a permissão é uma lista de rotas**,
 *  em `server/middleware/plataforma.js`, no mesmo desenho do token do cron. O
 *  motivo está escrito lá e é o buraco conhecido de `exigirPapel`: regra que
 *  falta libera a rota, então papel novo herda tudo que ainda não foi regrado —
 *  inclusive a ficha das pacientes. Lista que nega por padrão não tem esse
 *  buraco.
 *
 *  ======================================================= COMO NASCE O PRIMEIRO
 *
 *  Pelo comando `scripts/criar-operador.mjs`, rodado no servidor, que pede a
 *  senha sem ecoar. Não há semente com senha fixa aqui dentro **de propósito**:
 *  senha em migration é senha em repositório público, e esta é a credencial que
 *  enxerga as 50 clínicas.
 */

const MOTIVO_SEM_CLINICA =
  'operadores da plataforma nao pertencem a clinica nenhuma: e o que os define';

module.exports = async function up(conn) {
  // ------------------------------------------------- 1. a conferência de antes
  //
  // Se a tabela ja existir de uma execucao anterior, quantos operadores ha? O
  // numero entra no relatorio para ninguem achar que criou algo que nao criou.
  const [existia] = await conn.query(
    "SELECT COUNT(*) AS n FROM information_schema.TABLES" +
    " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'operadores'");
  const jaExistia = Number(existia[0].n) > 0;

  await conn.query(`
    CREATE TABLE IF NOT EXISTS operadores (
      id VARCHAR(50) PRIMARY KEY,
      nome VARCHAR(160) NOT NULL,
      -- Unico entre operadores. NAO ha unicidade cruzada com \`users\`: sao dois
      -- mundos, com duas portas de login, e exigir que os enderecos nao se
      -- repitam obrigaria a dona do sistema a ter dois e-mails.
      email VARCHAR(190) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      -- ativo | inativo. Desligar um operador e trocar isto, nunca apagar a
      -- linha: a trilha de auditoria referencia quem fez o que, e operador
      -- apagado transformaria "criada por fulano" em "criada por ninguem".
      status VARCHAR(20) NOT NULL DEFAULT 'ativo',
      criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ultimo_acesso DATETIME NULL,
      INDEX idx_operadores_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  /* A tabela NAO recebe `clinica_id`, e isto e o ponto da tarefa inteira.
   *
   * A migration 018 classificou cada tabela do banco em tres listas, e
   * `schema_migrations` e `clinicas` ficaram de fora da coluna por serem "da
   * instalacao". `operadores` e a terceira do tipo. Se um dia alguem acrescentar
   * a coluna aqui achando que padroniza, estara dizendo que o operador pertence
   * a uma clinica -- que e exatamente o que ele nao pode ser. */

  const [conf] = await conn.query('SELECT COUNT(*) AS n FROM operadores');
  const [temColuna] = await conn.query(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()" +
    " AND TABLE_NAME = 'operadores' AND COLUMN_NAME = 'clinica_id'");
  if (Number(temColuna[0].n) > 0) {
    throw new Error(
      '031 PAROU: a tabela `operadores` tem uma coluna `clinica_id`. Operador da plataforma ' +
      'nao pertence a clinica -- ' + MOTIVO_SEM_CLINICA + '. Com a coluna, ele vira usuario de ' +
      'inquilino e a separacao inteira desta tarefa deixa de existir.');
  }

  await conn.query(
    'INSERT INTO system_logs (id, action_type, description, author) VALUES (?, ?, ?, ?)',
    ['lg_031_' + Date.now().toString(36), 'MIGRATION',
     'Migration 031: tabela `operadores` ' + (jaExistia ? 'ja existia' : 'criada') +
     '. O operador da plataforma administra as clinicas SEM pertencer a nenhuma, e o que ele ' +
     'alcanca e uma lista explicita de rotas (server/middleware/plataforma.js), nao um papel. ' +
     'Operadores cadastrados: ' + conf[0].n + '.',
     'Sistema']);

  return {
    tabela: jaExistia ? 'ja existia' : 'criada',
    operadoresCadastrados: Number(conf[0].n),
    semColunaDeClinica: true,
    observacao: Number(conf[0].n) === 0
      ? 'A tabela nasceu VAZIA, de proposito: senha em migration seria senha em repositorio ' +
        'publico, e esta e a credencial que enxerga as 50 clinicas. Crie o primeiro operador com ' +
        '`node scripts/criar-operador.mjs`, no servidor -- ele pede a senha sem ecoar na tela.'
      : conf[0].n + ' operador(es) ja cadastrado(s); nada foi alterado.'
  };
};

module.exports.MOTIVO_SEM_CLINICA = MOTIVO_SEM_CLINICA;

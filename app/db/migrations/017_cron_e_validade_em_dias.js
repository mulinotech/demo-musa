'use strict';
/** 017 — Duas mudanças que o cron do servidor trouxe junto.
 *
 *  ---------------------------------------------------------------- 1. TOKEN
 *
 *  As duas varreduras automáticas (lembrete de WhatsApp e expiração de pontos)
 *  precisam ser chamadas de fora, por um agendador do sistema, porque o
 *  relógio interno morre junto com o processo quando o LiteSpeed o recicla.
 *  Chamar de fora exige credencial.
 *
 *  A credencial NÃO é um usuário administrador com senha guardada num script
 *  de cron: uma senha de admin em arquivo de texto abre o sistema inteiro se
 *  vazar. É um token de serviço que só vale para DUAS rotas — as duas
 *  varreduras, que são idempotentes e não leem dado de paciente. O pior que um
 *  token vazado consegue fazer é mandar o servidor conferir se há lembrete a
 *  enviar, que é o que ele já faz sozinho.
 *
 *  O valor é sorteado AQUI, no servidor, na hora da migration. Nunca passou
 *  por repositório, por conversa nem pela máquina de ninguém.
 *
 *  E ele NÃO vai para a linha do crontab. Num servidor compartilhado, a linha
 *  de comando de um processo em execução é legível pelos outros usuários da
 *  máquina (`ps aux`): token em `argv` é token exposto. Por isso a migration
 *  grava um arquivo de configuração do `curl` com permissão 600, e o cron
 *  chama `curl -K <arquivo>`. O segredo fica no disco, lido só pelo dono, e
 *  nunca aparece em `ps`, em histórico de shell nem em log de cron.
 *
 *  ------------------------------------------------------ 2. VALIDADE EM DIAS
 *
 *  `expiry_months` vira `expiry_days`. Não é preciosismo: as clínicas prometem
 *  "90 dias", e 90 dias não são 3 meses. De 31 de janeiro, três meses dão 89
 *  dias; de 1º de dezembro, dão 90. Guardar em meses e prometer em dias é o
 *  mesmo número calculado de duas formas — o defeito que este projeto vem
 *  perseguindo desde a primeira fase.
 *
 *  A conversão dos valores existentes usa 30 dias por mês, que é aproximação
 *  declarada, e logo em seguida a linha 'default' recebe os 90 dias que é a
 *  regra real da clínica.
 *
 *  O QUE ESTA MIGRATION NÃO FAZ: mexer no `expires_at` dos pontos já
 *  creditados. Cada acúmulo nasceu com uma validade, e essa validade é a
 *  promessa feita à paciente naquele dia. Encurtar promessa antiga por
 *  mudança de configuração é justamente o que faz alguém deixar de confiar no
 *  saldo que anotou.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** Onde o arquivo de configuração do curl é gravado: a raiz da aplicação,
 *  ao lado do `package.json`. Este arquivo sobe três níveis a partir de
 *  db/migrations/. */
const RAIZ = path.resolve(__dirname, '..', '..');
const ARQUIVO_CURL = path.join(RAIZ, '.musa-cron.conf');

/** Grava a configuração do curl com o token, legível só pelo dono.
 *
 *  Sempre reescreve a partir do que está guardado no banco — assim, rodar a
 *  migration de novo REGENERA o arquivo se ele tiver sido apagado, sem sortear
 *  outro token e sem derrubar o cron que já funciona.
 */
function gravarConfigDoCurl(token) {
  const conteudo = [
    '# Configuracao do curl para as varreduras automaticas do Musa CRM.',
    '# Gerado pela migration 017. NAO versionar, NAO copiar para outra maquina.',
    '# Se este arquivo sumir, rode a migration de novo: ela o regenera com o',
    '# MESMO token, sem quebrar o cron.',
    'header = "X-Musa-Cron: ' + token + '"',
    'request = POST',
    'silent',
    'show-error',
    'max-time = 120',
    ''
  ].join('\n');

  // Permissao no ato da criacao, nao depois: entre criar 644 e ajustar para
  // 600 existe uma janela em que o token fica legivel por todo mundo.
  const fd = fs.openSync(ARQUIVO_CURL, 'w', 0o600);
  try {
    fs.writeSync(fd, conteudo);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(ARQUIVO_CURL, 0o600);   // reforca caso o arquivo ja existisse
}

async function temColuna(conn, tabela, coluna) {
  const [r] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tabela, coluna]
  );
  return Number(r[0].n) > 0;
}

module.exports = async function up(conn) {
  // ------------------------------------------------------------- 1. token
  await conn.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      chave VARCHAR(80) PRIMARY KEY,
      valor TEXT,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // INSERT IGNORE: rodar de novo NAO sorteia outro token e nao derruba o cron
  // que ja esta configurado.
  const token = crypto.randomBytes(32).toString('hex');
  const [r] = await conn.query(
    'INSERT IGNORE INTO system_settings (chave, valor) VALUES (?, ?)',
    ['cron_token', token]
  );
  if (r.affectedRows) console.log('   + token de servico do cron sorteado (32 bytes)');
  else console.log('   = token de servico do cron ja existia, mantido');

  // O que vale e o que esta GUARDADO, nao o que acabou de ser sorteado: numa
  // segunda passada o INSERT IGNORE nao gravou nada e o token bom e o antigo.
  const [g] = await conn.query("SELECT valor FROM system_settings WHERE chave = 'cron_token'");
  const guardado = g.length ? String(g[0].valor || '') : '';

  if (!guardado) {
    console.log('   ! token vazio no banco; o cron nao vai autenticar');
  } else {
    try {
      gravarConfigDoCurl(guardado);
      console.log('   + ' + ARQUIVO_CURL + ' (modo 600) -- use com: curl -K <esse arquivo>');
    } catch (e) {
      // Nao derruba a migration: o resto dela e independente, e a alternativa
      // e a pessoa ficar sem a conversao da validade por causa do arquivo.
      console.log('   ! nao consegui gravar ' + ARQUIVO_CURL + ': ' + e.message);
      console.log('   ! sem esse arquivo o cron nao tem como se autenticar');
    }
  }

  // -------------------------------------------------- 2. validade em dias
  const [existe] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'loyalty_settings'`
  );
  if (!Number(existe[0].n)) {
    console.log('   ! loyalty_settings ainda nao existe; nada a converter');
    return;
  }

  const jaTemDias = await temColuna(conn, 'loyalty_settings', 'expiry_days');
  const aindaTemMeses = await temColuna(conn, 'loyalty_settings', 'expiry_months');

  if (!jaTemDias) {
    await conn.query('ALTER TABLE loyalty_settings ADD COLUMN expiry_days INT NOT NULL DEFAULT 90');
    console.log('   + loyalty_settings.expiry_days');
  }

  if (aindaTemMeses) {
    await conn.query('UPDATE loyalty_settings SET expiry_days = expiry_months * 30');
    await conn.query('ALTER TABLE loyalty_settings DROP COLUMN expiry_months');
    console.log('   - loyalty_settings.expiry_months (convertido a 30 dias/mes)');
  }

  await conn.query("UPDATE loyalty_settings SET expiry_days = 90 WHERE id = 'default'");
  console.log('   = validade do programa: 90 dias');

  // Quantos acumulos seguem com a validade antiga -- informacao, nao correcao.
  const [antigos] = await conn.query(`
    SELECT COUNT(*) AS n FROM loyalty_transactions
     WHERE type = 'ACUMULO' AND expires_at IS NOT NULL
       AND expires_at > DATE_ADD(DATE(created_at), INTERVAL 90 DAY)
  `);
  if (Number(antigos[0].n)) {
    console.log('   i ' + antigos[0].n + ' acumulo(s) mantem a validade com que nasceram');
  }
};

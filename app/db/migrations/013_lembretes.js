'use strict';
/**
 * 013_lembretes.js — Fase 1, T1.5
 *
 * Cria `system_settings` (chave/valor de configuração da aplicação) e as três
 * chaves do lembrete automático.
 *
 * `lembretes_ativos` NASCE EM '0', e essa é a decisão importante desta
 * migration. O banco de demonstração tem telefones de pessoas reais
 * cadastrados como pacientes. Um worker que sobe ligado dispara WhatsApp para
 * essas pessoas na primeira vez que alguém abre o sistema — e não existe
 * desfazer para mensagem enviada. Ligar é um ato deliberado, feito na tela,
 * depois de olhar a prévia.
 */

module.exports = async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      chave VARCHAR(80) PRIMARY KEY,
      valor TEXT,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const padrao = [
    ['lembretes_ativos', '0'],
    ['lembrete_antecedencia_h', '24'],
    ['lembrete_template',
     'Ola {paciente}! Passando para lembrar do seu horario na Dra. Musa: ' +
     '{procedimento}, {data} as {hora}, com {profissional}.\n\n' +
     'Responda 1 para confirmar ou 2 se precisar remarcar.']
  ];

  // INSERT IGNORE: rodar de novo nao apaga o que a clinica ja configurou.
  for (const [chave, valor] of padrao) {
    await conn.query('INSERT IGNORE INTO system_settings (chave, valor) VALUES (?, ?)', [chave, valor]);
  }
  console.log('   + system_settings com ' + padrao.length + ' chave(s) de lembrete (desligado por padrao)');
};

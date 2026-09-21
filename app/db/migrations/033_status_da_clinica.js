'use strict';
/** Suspender e encerrar clínica precisa de MOTIVO e DATA (M3.2b).
 *
 *  A coluna `status` já existe desde a 018 (ativa | suspensa | encerrada). O que
 *  faltava era o porquê e o quando: seis meses depois, "esta clínica está
 *  suspensa" sem motivo registrado é uma discussão sem árbitro.
 *
 *  ENCERRAR NÃO APAGA NADA. Prontuário tem prazo legal de guarda; a exclusão é
 *  ato separado, deliberado, e depende do prazo que a clínica definir. Por isso
 *  aqui só entram colunas — nenhum DELETE, nem hoje nem por descuido depois.
 */
module.exports = async function up(conn) {
  const [cols] = await conn.query(
    "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS" +
    " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clinicas'");
  const tem = (nome) => cols.some((x) => x.c === nome);

  if (!tem('status_em')) {
    await conn.query('ALTER TABLE clinicas ADD COLUMN status_em DATETIME NULL' +
                     " COMMENT 'quando o status mudou pela ultima vez'");
  }
  if (!tem('motivo_status')) {
    await conn.query('ALTER TABLE clinicas ADD COLUMN motivo_status VARCHAR(255) NULL');
  }
  if (!tem('status_por')) {
    await conn.query('ALTER TABLE clinicas ADD COLUMN status_por VARCHAR(190) NULL' +
                     " COMMENT 'operador da plataforma que mudou'");
  }

  const [porStatus] = await conn.query(
    'SELECT status, COUNT(*) AS n FROM clinicas GROUP BY status');

  await conn.query(
    'INSERT INTO system_logs (id, action_type, description, author) VALUES (?, ?, ?, ?)',
    ['lg_033_' + Date.now().toString(36), 'MIGRATION',
     'Migration 033: clinicas ganhou status_em, motivo_status e status_por. Suspender e encerrar ' +
     'passam a ter porque e quando. Encerrar NAO apaga dado: prontuario tem prazo legal de guarda.',
     'Sistema']);

  return {
    clinicasPorStatus: porStatus,
    apagou: 'nada -- esta migration so acrescenta colunas'
  };
};

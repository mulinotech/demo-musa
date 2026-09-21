'use strict';
async function temColuna(conn, tabela, coluna) {
  const [r] = await conn.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [tabela, coluna]);
  return r.length > 0;
}
async function addSeFaltar(conn, tabela, coluna, def) {
  if (await temColuna(conn, tabela, coluna)) return;
  await conn.query('ALTER TABLE `' + tabela + '` ADD COLUMN `' + coluna + '` ' + def);
  console.log('   + ' + tabela + '.' + coluna);
}
async function ajustarTipo(conn, tabela, coluna, def) {
  if (!(await temColuna(conn, tabela, coluna))) return;
  await conn.query('ALTER TABLE `' + tabela + '` MODIFY COLUMN `' + coluna + '` ' + def);
}
module.exports = async function up(conn) {
  await addSeFaltar(conn, 'leads', 'email', 'VARCHAR(255) DEFAULT NULL');
  await addSeFaltar(conn, 'leads', 'salesperson_id', 'VARCHAR(50) DEFAULT NULL');
  await addSeFaltar(conn, 'leads', 'source', "VARCHAR(50) DEFAULT 'site'");
  await addSeFaltar(conn, 'leads', 'sales_notes', 'TEXT DEFAULT NULL');
  await addSeFaltar(conn, 'leads', 'last_edited_by', 'VARCHAR(255) DEFAULT NULL');
  await addSeFaltar(conn, 'leads', 'qualified', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addSeFaltar(conn, 'clients', 'anamnese', 'TEXT');
  await addSeFaltar(conn, 'clients', 'image_base64', 'LONGTEXT');
  await addSeFaltar(conn, 'clients', 'laudo', 'TEXT');
  await addSeFaltar(conn, 'treatments', 'price', 'DECIMAL(10,2) DEFAULT NULL');
  await addSeFaltar(conn, 'treatments', 'total_sessions', 'INT DEFAULT 1');
  await addSeFaltar(conn, 'treatments', 'completed_sessions', 'INT DEFAULT 1');
  await addSeFaltar(conn, 'salespeople', 'avatar', 'TEXT DEFAULT NULL');
  await addSeFaltar(conn, 'salespeople', 'password', 'VARCHAR(255) DEFAULT NULL');
  await addSeFaltar(conn, 'treatment_catalog', 'package_price', 'DECIMAL(10,2) DEFAULT NULL');
  await ajustarTipo(conn, 'leads', 'whatsapp', 'VARCHAR(50) NOT NULL');
  await ajustarTipo(conn, 'leads', 'status', "VARCHAR(50) DEFAULT 'novo'");
  await ajustarTipo(conn, 'clients', 'phone', 'VARCHAR(50) NOT NULL');
  await ajustarTipo(conn, 'salespeople', 'whatsapp', 'VARCHAR(50) NOT NULL');
  await ajustarTipo(conn, 'salespeople', 'email', 'VARCHAR(255) DEFAULT NULL');
  const indices = [
    ['leads', 'idx_leads_status', '(status)'],
    ['leads', 'idx_leads_date', '(date)'],
    ['leads', 'idx_leads_salesperson', '(salesperson_id)'],
    ['clients', 'idx_clients_phone', '(phone)'],
    ['treatment_plans', 'idx_plans_client', '(client_id)'],
    ['treatment_plans', 'idx_plans_status', '(status)'],
    ['treatment_sessions', 'idx_sessions_plan', '(plan_id)'],
    ['treatment_sessions', 'idx_sessions_date', '(session_date)'],
    ['treatment_sessions', 'idx_sessions_status', '(status)'],
    ['interactions', 'idx_interactions_client', '(client_id, created_at)'],
    ['system_logs', 'idx_logs_created', '(created_at)']
  ];
  for (const linha of indices) {
    const [r] = await conn.query(
      'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
      [linha[0], linha[1]]);
    if (r.length === 0) {
      await conn.query('ALTER TABLE `' + linha[0] + '` ADD INDEX `' + linha[1] + '` ' + linha[2]);
      console.log('   + indice ' + linha[0] + '.' + linha[1]);
    }
  }
};

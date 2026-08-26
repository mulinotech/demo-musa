'use strict';
/**
 * 002_alinhar_colunas.js
 *
 * O banco de produção foi criado antes do 001_baseline e recebeu colunas ao longo
 * do tempo através dos ALTER TABLE em try/catch do initializeDatabase().
 * Esta migration garante que ele fique com exatamente as mesmas colunas e tipos
 * do baseline — e não faz nada num banco recém-criado pelo 001.
 *
 * É em .js e não em .sql porque o MySQL 8 não tem ADD COLUMN IF NOT EXISTS:
 * a checagem precisa consultar o information_schema antes de decidir.
 */

async function temColuna(conn, tabela, coluna) {
  const [r] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [tabela, coluna]
  );
  return r.length > 0;
}

async function adicionarSeFaltar(conn, tabela, coluna, definicao) {
  if (await temColuna(conn, tabela, coluna)) return false;
  await conn.query(`ALTER TABLE \`${tabela}\` ADD COLUMN \`${coluna}\` ${definicao}`);
  console.log(`   + ${tabela}.${coluna}`);
  return true;
}

async function ajustarTipo(conn, tabela, coluna, definicao) {
  if (!(await temColuna(conn, tabela, coluna))) return false;
  await conn.query(`ALTER TABLE \`${tabela}\` MODIFY COLUMN \`${coluna}\` ${definicao}`);
  return true;
}

module.exports = async function up(conn) {
  // Colunas que nasceram como ALTER no app.js
  await adicionarSeFaltar(conn, 'leads', 'email', 'VARCHAR(255) DEFAULT NULL');
  await adicionarSeFaltar(conn, 'leads', 'salesperson_id', 'VARCHAR(50) DEFAULT NULL');
  await adicionarSeFaltar(conn, 'leads', 'source', "VARCHAR(50) DEFAULT 'site'");
  await adicionarSeFaltar(conn, 'leads', 'sales_notes', 'TEXT DEFAULT NULL');
  await adicionarSeFaltar(conn, 'leads', 'last_edited_by', 'VARCHAR(255) DEFAULT NULL');
  await adicionarSeFaltar(conn, 'leads', 'qualified', 'TINYINT(1) NOT NULL DEFAULT 0');

  await adicionarSeFaltar(conn, 'clients', 'anamnese', 'TEXT');
  await adicionarSeFaltar(conn, 'clients', 'image_base64', 'LONGTEXT');
  await adicionarSeFaltar(conn, 'clients', 'laudo', 'TEXT');

  await adicionarSeFaltar(conn, 'treatments', 'price', 'DECIMAL(10,2) DEFAULT NULL');
  await adicionarSeFaltar(conn, 'treatments', 'total_sessions', 'INT DEFAULT 1');
  await adicionarSeFaltar(conn, 'treatments', 'completed_sessions', 'INT DEFAULT 1');

  await adicionarSeFaltar(conn, 'salespeople', 'avatar', 'TEXT DEFAULT NULL');
  await adicionarSeFaltar(conn, 'salespeople', 'password', 'VARCHAR(255) DEFAULT NULL');

  await adicionarSeFaltar(conn, 'treatment_catalog', 'package_price', 'DECIMAL(10,2) DEFAULT NULL');

  // Tipos que foram alargados depois da criação original
  await ajustarTipo(conn, 'leads', 'whatsapp', 'VARCHAR(50) NOT NULL');
  await ajustarTipo(conn, 'leads', 'status', "VARCHAR(50) DEFAULT 'novo'");
  await ajustarTipo(conn, 'clients', 'phone', 'VARCHAR(50) NOT NULL');
  await ajustarTipo(conn, 'salespeople', 'whatsapp', 'VARCHAR(50) NOT NULL');
  await ajustarTipo(conn, 'salespeople', 'email', 'VARCHAR(255) DEFAULT NULL');

  // Índices que faltam e que as telas já usam para filtrar
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
    ['system_logs', 'idx_logs_created', '(created_at)'],
  ];
  for (const [tabela, nome, cols] of indices) {
    const [r] = await conn.query(
      `SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
      [tabela, nome]
    );
    if (r.length === 0) {
      await conn.query(`ALTER TABLE \`${tabela}\` ADD INDEX \`${nome}\` ${cols}`);
      console.log(`   + indice ${tabela}.${nome}`);
    }
  }
};

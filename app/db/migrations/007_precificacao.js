'use strict';
/**
 * 007_precificacao.js — Fase 2, T2.1
 *
 * Tres tabelas novas e quatro colunas no catalogo.
 *
 * Em .js e nao em .sql pelo mesmo motivo da 002: o MySQL 8 nao tem
 * ADD COLUMN IF NOT EXISTS, e esta migration precisa poder rodar de novo sem
 * quebrar - o banco de producao ja passou por ALTERs feitos fora do controle
 * de versao e nao da para assumir o que existe la.
 *
 * `duration_min` merece explicacao. O catalogo ja tem `duration`, mas e
 * VARCHAR(50) com conteudo irregular: a tela de Cadastros grava "60", enquanto
 * ha texto herdado como "40 a 60 minutos". Precificar em cima disso seria
 * adivinhar. A coluna nova guarda minutos como INT e o backfill so preenche o
 * que for numero inequivoco - o resto fica NULL e a tela pergunta.
 * `duration` continua intacta: nenhum dado e apagado nem reescrito.
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

module.exports = async function up(conn) {
  // ---- custos fixos mensais da clinica ----
  await conn.query(`
    CREATE TABLE IF NOT EXISTS fixed_costs (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      monthly_amount DECIMAL(10,2) NOT NULL,
      category VARCHAR(100) DEFAULT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_fixed_costs_active (active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // ---- parametros globais: linha unica, id fixo 'default' ----
  await conn.query(`
    CREATE TABLE IF NOT EXISTS pricing_settings (
      id VARCHAR(50) PRIMARY KEY,
      monthly_working_hours DECIMAL(6,2) NOT NULL DEFAULT 160,
      target_margin_pct DECIMAL(5,2) NOT NULL DEFAULT 30,
      card_fee_pct DECIMAL(5,2) NOT NULL DEFAULT 3.5,
      tax_pct DECIMAL(5,2) NOT NULL DEFAULT 6,
      default_commission_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await conn.query(
    "INSERT INTO pricing_settings (id) VALUES ('default') ON DUPLICATE KEY UPDATE id = id"
  );

  // ---- historico de simulacoes ----
  await conn.query(`
    CREATE TABLE IF NOT EXISTS pricing_simulations (
      id VARCHAR(50) PRIMARY KEY,
      catalog_id VARCHAR(50) DEFAULT NULL,
      service_name VARCHAR(255) NOT NULL,
      duration_min INT NOT NULL,
      fixed_cost_hour DECIMAL(10,2) NOT NULL,
      fixed_cost_service DECIMAL(10,2) NOT NULL,
      variable_cost DECIMAL(10,2) NOT NULL,
      margin_pct DECIMAL(5,2) NOT NULL,
      commission_pct DECIMAL(5,2) NOT NULL,
      card_fee_pct DECIMAL(5,2) NOT NULL,
      tax_pct DECIMAL(5,2) NOT NULL,
      suggested_price DECIMAL(10,2) NOT NULL,
      hourly_value DECIMAL(10,2) NOT NULL,
      net_profit DECIMAL(10,2) NOT NULL,
      price_before DECIMAL(10,2) DEFAULT NULL,
      applied TINYINT(1) NOT NULL DEFAULT 0,
      created_by VARCHAR(50) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_sim_catalog (catalog_id),
      INDEX idx_sim_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // ---- colunas de precificacao no catalogo ----
  await adicionarSeFaltar(conn, 'treatment_catalog', 'variable_cost', 'DECIMAL(10,2) DEFAULT NULL');
  await adicionarSeFaltar(conn, 'treatment_catalog', 'commission_pct', 'DECIMAL(5,2) DEFAULT NULL');
  await adicionarSeFaltar(conn, 'treatment_catalog', 'suggested_price', 'DECIMAL(10,2) DEFAULT NULL');
  await adicionarSeFaltar(conn, 'treatment_catalog', 'price_updated_at', 'DATETIME DEFAULT NULL');
  const criouDuracao = await adicionarSeFaltar(conn, 'treatment_catalog', 'duration_min', 'INT DEFAULT NULL');

  // Backfill conservador: so o que for numero puro, opcionalmente com "min" ou
  // "minutos". "40 a 60 minutos" fica NULL de proposito.
  if (criouDuracao) {
    const [r] = await conn.query(`
      UPDATE treatment_catalog
         SET duration_min = CAST(TRIM(duration) AS UNSIGNED)
       WHERE duration_min IS NULL
         AND duration REGEXP '^[[:space:]]*[0-9]{1,4}[[:space:]]*(min|minuto|minutos)?[[:space:]]*$'
    `);
    console.log('   + duration_min preenchido em ' + r.affectedRows + ' servico(s) do catalogo');
  }
};

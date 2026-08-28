'use strict';
/**
 * 008_financeiro.js — Fase 2, T2.4
 *
 * Razão único de entradas e saídas, categorias e despesas recorrentes.
 *
 * Três decisões estão embutidas no formato das tabelas e não devem ser
 * redecididas em código:
 *
 *  1. RAZÃO ÚNICO. Receita e despesa na mesma tabela, separadas por `type`.
 *     Duas tabelas produzem, mais cedo ou mais tarde, dois "lucros" que não
 *     batem porque alguém somou com filtros levemente diferentes.
 *
 *  2. VALOR SEMPRE POSITIVO. O sinal vem do `type`. Despesa guardada como
 *     número negativo parece prática e vira erro de soma em todo relatório em
 *     que alguém esquecer o ABS.
 *
 *  3. COMPETÊNCIA E CAIXA SEPARADOS. `entry_date` é quando o fato aconteceu;
 *     `paid_at` é quando o dinheiro andou. Despesa com `paid_at` nulo é conta a
 *     pagar. Os dois relatórios usam colunas diferentes de propósito.
 *
 * A chave única (source, source_id, type) é a idempotência: uma segunda
 * tentativa de lançar a mesma receita falha no banco em vez de duplicar.
 * Os ids das categorias do seed são fixos porque o código referencia
 * 'cat_procedimentos' ao lançar receita de atendimento.
 */

const CATEGORIAS = [
  ['cat_procedimentos', 'Procedimentos', 'RECEITA'],
  ['cat_pacotes', 'Pacotes', 'RECEITA'],
  ['cat_produtos', 'Produtos', 'RECEITA'],
  ['cat_outras_receitas', 'Outras receitas', 'RECEITA'],
  ['cat_aluguel', 'Aluguel', 'DESPESA'],
  ['cat_energia', 'Energia e agua', 'DESPESA'],
  ['cat_insumos', 'Insumos', 'DESPESA'],
  ['cat_equipamentos', 'Equipamentos', 'DESPESA'],
  ['cat_pessoal', 'Pessoal', 'DESPESA'],
  ['cat_comissoes', 'Comissoes', 'DESPESA'],
  ['cat_marketing', 'Marketing', 'DESPESA'],
  ['cat_software', 'Software e sistemas', 'DESPESA'],
  ['cat_impostos', 'Impostos', 'DESPESA'],
  ['cat_taxas_cartao', 'Taxas de cartao', 'DESPESA'],
  ['cat_contabilidade', 'Contabilidade', 'DESPESA'],
  ['cat_outras_despesas', 'Outras despesas', 'DESPESA']
];

module.exports = async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS finance_categories (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      type ENUM('RECEITA','DESPESA') NOT NULL,
      parent_id VARCHAR(50) DEFAULT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_fincat_type (type, active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS cash_entries (
      id VARCHAR(50) PRIMARY KEY,
      type ENUM('RECEITA','DESPESA') NOT NULL,
      category_id VARCHAR(50) DEFAULT NULL,
      description VARCHAR(255) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      entry_date DATE NOT NULL,
      due_date DATE DEFAULT NULL,
      paid_at DATE DEFAULT NULL,
      payment_method ENUM('DINHEIRO','PIX','DEBITO','CREDITO','TRANSFERENCIA','OUTRO') DEFAULT NULL,
      source ENUM('MANUAL','APPOINTMENT','COMMISSION','REVERSAL','RECURRING') NOT NULL DEFAULT 'MANUAL',
      source_id VARCHAR(80) DEFAULT NULL,
      client_id VARCHAR(50) DEFAULT NULL,
      professional_id VARCHAR(50) DEFAULT NULL,
      supplier VARCHAR(255) DEFAULT NULL,
      notes TEXT,
      created_by VARCHAR(50) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_cash_source (source, source_id, type),
      INDEX idx_cash_date (entry_date),
      INDEX idx_cash_paid (paid_at),
      INDEX idx_cash_type_cat (type, category_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS recurring_expenses (
      id VARCHAR(50) PRIMARY KEY,
      category_id VARCHAR(50) DEFAULT NULL,
      description VARCHAR(255) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      day_of_month TINYINT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE DEFAULT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_rec_active (active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Seed idempotente: reaplicar a migration nao duplica nem sobrescreve um
  // nome que a clinica tenha renomeado.
  let novas = 0;
  for (const [id, nome, tipo] of CATEGORIAS) {
    const [r] = await conn.query(
      'INSERT INTO finance_categories (id, name, type) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE id = id',
      [id, nome, tipo]
    );
    if (r.affectedRows === 1) novas += 1;
  }
  console.log('   + ' + novas + ' categoria(s) financeira(s) criada(s)');
};

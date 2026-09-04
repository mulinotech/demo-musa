'use strict';
/**
 * 015_fidelizacao.js — Fase 5, T5.1
 *
 * MESMA REGRA DO ESTOQUE: O SALDO NÃO EXISTE COMO CAMPO.
 *
 * Saldo de pontos é `SUM(points)` das transações não expiradas. Não há
 * `clients.loyalty_points`. Duas fontes para o mesmo número divergem — e num
 * programa de pontos a divergência é pior que no estoque, porque o paciente
 * tem a própria contagem na cabeça e vai reclamar na recepção.
 *
 * UMA CORREÇÃO AO CONTRATO ORIGINAL, DELIBERADA
 *
 * O desenho dizia "points positivo em ACUMULO/ESTORNO, negativo nos demais".
 * Isso não fecha: o estorno de um ACÚMULO indevido precisa ser negativo, e o
 * estorno de um RESGATE cancelado precisa ser positivo. O mesmo tipo, dois
 * sinais.
 *
 * Aqui `points` carrega o próprio sinal, sempre, em todos os tipos, e o saldo é
 * a soma simples. É o que a própria regra de saldo já pedia. O sinal do
 * ESTORNO segue o que ele está desfazendo — nunca dependa do tipo para
 * descobrir o sinal.
 *
 * O BACKFILL EXISTE PARA A DEMONSTRAÇÃO TER SALDO
 *
 * Atendimentos já concluídos com preço recebem o acúmulo retroativo, usando a
 * chave definitiva (`APPOINTMENT` + id do compromisso). Sem isso a tela de
 * fidelidade abre com zero em todos os pacientes, o que não demonstra nada. A
 * data de expiração é contada a partir da data do atendimento, não de hoje —
 * ponto de abril não pode nascer hoje com validade de um ano.
 */

function novoId(p) {
  return p + '_' + Math.random().toString(36).slice(2, 10);
}

const PREMIOS = [
  ['Desconto de R$ 50', 'Vale R$ 50,00 em qualquer procedimento.', 500, 'DESCONTO_VALOR', 50],
  ['Desconto de R$ 120', 'Vale R$ 120,00 em qualquer procedimento.', 1100, 'DESCONTO_VALOR', 120],
  ['10% de desconto', 'Dez por cento de desconto no procedimento escolhido.', 400, 'DESCONTO_PCT', 10],
  ['20% de desconto', 'Vinte por cento de desconto no procedimento escolhido.', 900, 'DESCONTO_PCT', 20],
  ['Limpeza de pele cortesia', 'Uma limpeza de pele sem custo.', 1800, 'SERVICO', null]
];

module.exports = async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS loyalty_settings (
      id VARCHAR(50) PRIMARY KEY,
      active TINYINT(1) NOT NULL DEFAULT 1,
      points_per_real DECIMAL(6,3) NOT NULL DEFAULT 1,
      redemption_value DECIMAL(6,3) NOT NULL DEFAULT 0.10,
      expiry_months INT NOT NULL DEFAULT 12,
      min_points_to_redeem INT NOT NULL DEFAULT 100,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS loyalty_transactions (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50) NOT NULL,
      type ENUM('ACUMULO','RESGATE','EXPIRACAO','AJUSTE','ESTORNO') NOT NULL,
      points INT NOT NULL,
      description VARCHAR(255) NOT NULL,
      source ENUM('MANUAL','APPOINTMENT','WORKER') NOT NULL DEFAULT 'MANUAL',
      source_id VARCHAR(80) NULL,
      reward_id VARCHAR(50) NULL,
      -- Quantos REAIS este resgate abateu do atendimento. Guardado, e nao
      -- recalculado depois: um desconto percentual depende do preco no momento
      -- do resgate, e esse preco muda. Sem isto, desfazer um resgate de 20%
      -- devolveria o valor errado -- e o relatorio de custo do programa seria
      -- uma estimativa (pontos x valor do ponto) em vez do dinheiro real.
      amount_discounted DECIMAL(10,2) NULL,
      expires_at DATE NULL,
      expired TINYINT(1) NOT NULL DEFAULT 0,
      created_by VARCHAR(50),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      UNIQUE KEY uq_loyalty_source (source, source_id, type),
      INDEX idx_loyalty_client (client_id, created_at),
      INDEX idx_loyalty_expiry (expires_at, expired)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS loyalty_rewards (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      points_cost INT NOT NULL,
      type ENUM('DESCONTO_VALOR','DESCONTO_PCT','SERVICO','PRODUTO') NOT NULL,
      value DECIMAL(10,2) NULL,
      catalog_id VARCHAR(50) NULL,
      product_id VARCHAR(50) NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(
    "INSERT IGNORE INTO loyalty_settings (id, active) VALUES ('default', 1)"
  );

  const [temPremio] = await conn.query('SELECT COUNT(*) AS n FROM loyalty_rewards');
  if (temPremio[0].n === 0) {
    for (const [nome, desc, custo, tipo, valor] of PREMIOS) {
      await conn.query(
        'INSERT INTO loyalty_rewards (id, name, description, points_cost, type, value) VALUES (?,?,?,?,?,?)',
        [novoId('rw'), nome, desc, custo, tipo, valor]
      );
    }
    // A cortesia aponta para a limpeza de pele, quando existe no catalogo.
    await conn.query(`
      UPDATE loyalty_rewards r
        SET r.catalog_id = (SELECT id FROM treatment_catalog WHERE LOWER(name) LIKE '%limpeza%' LIMIT 1)
      WHERE r.type = 'SERVICO'
    `);
    console.log('   + ' + PREMIOS.length + ' recompensa(s) de exemplo');
  }

  // ------------------------------------------------------- backfill
  const [cfg] = await conn.query("SELECT * FROM loyalty_settings WHERE id = 'default'");
  const porReal = Number(cfg[0].points_per_real) || 1;
  const meses = Number(cfg[0].expiry_months) || 0;

  const [feitos] = await conn.query(`
    SELECT a.id, a.client_id, a.title, a.price,
           DATE_FORMAT(a.starts_at, '%Y-%m-%d') AS dia
      FROM appointments a
     WHERE a.status = 'REALIZADO' AND a.kind = 'ATENDIMENTO'
       AND a.price > 0 AND a.client_id IS NOT NULL
  `);

  let criados = 0, jaExistiam = 0;
  for (const a of feitos) {
    const pontos = Math.floor(Number(a.price) * porReal);
    if (pontos <= 0) continue;
    try {
      await conn.query(
        `INSERT INTO loyalty_transactions
          (id, client_id, type, points, description, source, source_id, expires_at)
         VALUES (?,?, 'ACUMULO', ?, ?, 'APPOINTMENT', ?, ${meses > 0 ? 'DATE_ADD(?, INTERVAL ? MONTH)' : 'NULL'})`,
        meses > 0
          ? [novoId('lt'), a.client_id, pontos, ('Atendimento: ' + (a.title || a.id)).slice(0, 255), a.id, a.dia, meses]
          : [novoId('lt'), a.client_id, pontos, ('Atendimento: ' + (a.title || a.id)).slice(0, 255), a.id]
      );
      criados += 1;
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') jaExistiam += 1;
      else throw e;
    }
  }
  console.log('   + ' + criados + ' acumulo(s) retroativo(s), ' + jaExistiam + ' ja existia(m)');
};

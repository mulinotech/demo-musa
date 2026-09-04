'use strict';
/**
 * 014_estoque.js — Fase 3, T3.1
 *
 * A DECISÃO ESTRUTURAL: O SALDO NÃO EXISTE COMO CAMPO.
 *
 * Não há `products.stock`, e a ausência é deliberada. Saldo de produto é a
 * soma dos saldos dos lotes. Guardar o total também no produto cria duas
 * fontes para o mesmo número — e as duas divergem, sempre; a pergunta é só
 * quando. Aí ninguém sabe qual está certa e o estoque inteiro perde a
 * credibilidade. Custa um `SUM` a mais por consulta e vale cada um.
 *
 * POR QUE LOTE E VALIDADE DESDE O PRIMEIRO DIA
 *
 * Clínica de estética trabalha com toxina botulínica, ácido hialurônico e
 * anestésico. Rastrear lote é requisito sanitário, não refinamento de
 * software: se um lote for recolhido, a clínica precisa saber em quem foi
 * aplicado. Um estoque que só conta unidades não serve para este negócio, e
 * "lote na fase 2" significaria migrar histórico sem lote depois.
 *
 * O TEXTO LIVRE ANTIGO NÃO É MIGRADO.
 *
 * `treatment_sessions.supplies_applied` guarda coisas como "1 seringa de AH".
 * Não tem quantidade confiável, nem unidade, nem lote. Converter por
 * adivinhação poluiria o saldo inicial com números inventados que ninguém
 * conseguiria auditar depois. O histórico fica onde está; o saldo começa do
 * zero, por inventário.
 */

const P = (n) => 'prd_' + n;

/* Insumos de uma clínica de estética de verdade. Servem de ponto de partida
 * para a demonstração e são editáveis na tela. Custos em faixa plausível de
 * mercado — não são cotação. */
const PRODUTOS = [
  // id, nome, categoria, unidade, custo, minimo, controlado
  [P('toxina'),     'Toxina Botulínica 100U',        'Injetável',   'UN',        980.00, 2,  1],
  [P('ah_volume'),  'Ácido Hialurônico Volume 1ml',  'Injetável',   'UN',        620.00, 3,  1],
  [P('ah_skin'),    'Skinbooster 2ml',               'Injetável',   'UN',        410.00, 2,  1],
  [P('anestesico'), 'Anestésico Tópico 30g',         'Injetável',   'UN',         48.00, 4,  1],
  [P('agulha30g'),  'Agulha 30G',                    'Descartável', 'UN',          1.20, 100, 0],
  [P('seringa1ml'), 'Seringa 1ml',                   'Descartável', 'UN',          1.80, 60, 0],
  [P('luva'),       'Luva de procedimento (par)',    'Descartável', 'UN',          1.10, 200, 0],
  [P('gaze'),       'Gaze estéril (pacote)',         'Descartável', 'UN',          2.40, 50, 0],
  [P('clorexidina'),'Clorexidina 100ml',             'Higiene',     'ML',          0.09, 300, 0],
  [P('acido_gli'),  'Ácido Glicólico 70% 30ml',      'Peeling',     'ML',          3.20, 60, 1],
  [P('mascara'),    'Máscara calmante pós-peeling',  'Cuidado',     'UN',         22.00, 10, 0],
  [P('gel_us'),     'Gel condutor 1L',               'Aparelho',    'ML',          0.02, 1000, 0]
];

/* Ficha técnica semeada por PALAVRA-CHAVE do nome do serviço, não por
 * posição na lista. É conservador de propósito: o que não casar fica sem
 * ficha, e a tela pede. Inventar ficha para serviço que ninguém conferiu
 * faria a baixa automática consumir o produto errado. */
const RECEITAS = [
  { palavras: ['botox', 'toxina', 'botul'], itens: [[P('toxina'), 1], [P('agulha30g'), 4], [P('seringa1ml'), 2], [P('anestesico'), 0.2], [P('luva'), 1], [P('gaze'), 2]] },
  { palavras: ['preenchimento', 'volume', 'labial', 'harmoniz'], itens: [[P('ah_volume'), 1], [P('agulha30g'), 2], [P('anestesico'), 0.3], [P('luva'), 1], [P('gaze'), 2]] },
  { palavras: ['skinbooster', 'skin booster'], itens: [[P('ah_skin'), 1], [P('agulha30g'), 6], [P('anestesico'), 0.3], [P('luva'), 1], [P('gaze'), 3]] },
  { palavras: ['peeling', 'glicol', 'acido', 'ácido'], itens: [[P('acido_gli'), 6], [P('mascara'), 1], [P('luva'), 1], [P('gaze'), 4], [P('clorexidina'), 20]] },
  { palavras: ['limpeza'], itens: [[P('clorexidina'), 30], [P('luva'), 1], [P('gaze'), 6], [P('mascara'), 1]] },
  { palavras: ['ultraformer', 'laser', 'lavien', 'radiofrequ', 'criolip'], itens: [[P('gel_us'), 60], [P('luva'), 1], [P('gaze'), 2]] }
];

function novoId(p) {
  return p + '_' + Math.random().toString(36).slice(2, 10);
}

function dia(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const z = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}

module.exports = async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS products (
      id VARCHAR(50) PRIMARY KEY,
      sku VARCHAR(60) NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(100) NULL,
      unit ENUM('UN','ML','G','APLICACAO') NOT NULL DEFAULT 'UN',
      unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
      sale_price DECIMAL(10,2) NULL,
      min_stock DECIMAL(10,3) NOT NULL DEFAULT 0,
      controlled TINYINT(1) NOT NULL DEFAULT 0,
      supplier VARCHAR(255) NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS stock_batches (
      id VARCHAR(50) PRIMARY KEY,
      product_id VARCHAR(50) NOT NULL,
      batch_number VARCHAR(100) NULL,
      expiry_date DATE NULL,
      quantity DECIMAL(10,3) NOT NULL DEFAULT 0,
      unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
      received_at DATE NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      INDEX idx_batch_product (product_id, expiry_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id VARCHAR(50) PRIMARY KEY,
      product_id VARCHAR(50) NOT NULL,
      batch_id VARCHAR(50) NULL,
      type ENUM('ENTRADA','SAIDA','AJUSTE','PERDA','ESTORNO') NOT NULL,
      quantity DECIMAL(10,3) NOT NULL,
      unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
      reason VARCHAR(255) NULL,
      source ENUM('MANUAL','APPOINTMENT','INVENTORY') NOT NULL DEFAULT 'MANUAL',
      source_id VARCHAR(80) NULL,
      created_by VARCHAR(50),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      INDEX idx_mov_product (product_id, created_at),
      INDEX idx_mov_source (source, source_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS service_supplies (
      id VARCHAR(50) PRIMARY KEY,
      catalog_id VARCHAR(50) NOT NULL,
      product_id VARCHAR(50) NOT NULL,
      quantity DECIMAL(10,3) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      UNIQUE KEY uq_service_product (catalog_id, product_id),
      INDEX idx_supplies_catalog (catalog_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // ------------------------------------------------------------- seed
  const [jaTem] = await conn.query('SELECT COUNT(*) AS n FROM products');
  if (jaTem[0].n > 0) {
    console.log('   = produtos ja cadastrados (' + jaTem[0].n + '): seed pulado');
    return;
  }

  for (const [id, nome, cat, un, custo, min, ctrl] of PRODUTOS) {
    await conn.query(
      `INSERT INTO products (id, name, category, unit, unit_cost, min_stock, controlled)
       VALUES (?,?,?,?,?,?,?)`,
      [id, nome, cat, un, custo, min, ctrl]
    );
  }
  console.log('   + ' + PRODUTOS.length + ' produto(s) de insumo');

  /* Inventário inicial. Três lotes propositalmente fora do comum, para a tela
   * de alertas ter o que mostrar desde o primeiro acesso: um vencido, um
   * vencendo em 20 dias e um abaixo do mínimo. Estoque de demonstração sem
   * nenhum problema visível não demonstra o módulo. */
  const LOTES = [
    // produto, quantidade, lote, validade (dias a partir de hoje)
    [P('toxina'),      4,   'TX-2611',  180],
    [P('toxina'),      1,   'TX-2540',  20],   // vencendo: aparece no alerta
    [P('ah_volume'),   6,   'AH-8801',  240],
    [P('ah_skin'),     2,   'SB-1190',  -15],  // VENCIDO com saldo: alerta critico
    [P('anestesico'),  6,   'AN-4420',  300],
    [P('agulha30g'),   240, null,       null],
    [P('seringa1ml'),  150, null,       null],
    [P('luva'),        120, null,       null], // abaixo do minimo (200)
    [P('gaze'),        180, null,       null],
    [P('clorexidina'), 900, 'CL-2201',  400],
    [P('acido_gli'),   90,  'GL-3320',  150],
    [P('mascara'),     24,  null,       null],
    [P('gel_us'),      2400, null,      null]
  ];

  for (const [produto, qtd, lote, validade] of LOTES) {
    const custo = (PRODUTOS.find((p) => p[0] === produto) || [])[4] || 0;
    const idLote = novoId('lot');
    await conn.query(
      `INSERT INTO stock_batches (id, product_id, batch_number, expiry_date, quantity, unit_cost, received_at)
       VALUES (?,?,?,?,?,?,?)`,
      [idLote, produto, lote, validade == null ? null : dia(validade), qtd, custo, dia(-30)]
    );
    await conn.query(
      `INSERT INTO stock_movements (id, product_id, batch_id, type, quantity, unit_cost, reason, source)
       VALUES (?,?,?,'ENTRADA',?,?,?, 'INVENTORY')`,
      [novoId('mov'), produto, idLote, qtd, custo, 'Inventario inicial']
    );
  }
  console.log('   + ' + LOTES.length + ' lote(s) de inventario inicial');

  // ------------------------------------------------- ficha tecnica
  const [servicos] = await conn.query('SELECT id, name FROM treatment_catalog');
  let fichas = 0, itens = 0;
  for (const s of servicos) {
    const nome = String(s.name || '').toLowerCase();
    const receita = RECEITAS.find((r) => r.palavras.some((p) => nome.indexOf(p) !== -1));
    if (!receita) continue;
    for (const [produto, qtd] of receita.itens) {
      await conn.query(
        'INSERT IGNORE INTO service_supplies (id, catalog_id, product_id, quantity) VALUES (?,?,?,?)',
        [novoId('ss'), s.id, produto, qtd]
      );
      itens += 1;
    }
    fichas += 1;
  }
  console.log('   + ficha tecnica em ' + fichas + ' de ' + servicos.length +
              ' servico(s), ' + itens + ' item(ns); os demais ficam sem ficha de proposito');
};

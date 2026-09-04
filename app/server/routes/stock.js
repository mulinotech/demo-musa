'use strict';
/** Estoque — Fase 3, T3.2.
 *
 *  A rota busca, chama `services/estoque.js` e grava. Nenhuma aritmética de
 *  saldo, de FEFO ou de custo médio mora aqui.
 *
 *  SALDO É SEMPRE CALCULADO A PARTIR DOS LOTES. Se algum dia aparecer um
 *  `products.stock` neste arquivo, alguém redecidiu a regra R1 sem ler o
 *  motivo — e o sistema passou a ter duas fontes para o mesmo número.
 *
 *  Permissão: leitura para `profissional` também, e isso é proposital. Quem
 *  vai aplicar o produto precisa poder conferir saldo e validade antes. Mexer
 *  no saldo continua sendo de `admin` e `gerente`, pela tabela de papéis.
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const est = require('../services/estoque');
const { logSystemEvent } = require('../services/logs');

const novoId = (p) => p + '_' + Math.random().toString(36).slice(2, 10);
const autor = (req) => (req.usuario && req.usuario.nome) || 'Sistema';
const UNIDADES = ['UN', 'ML', 'G', 'APLICACAO'];

function positivo(v) {
  const n = Number(v);
  return isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : null;
}

function dataValida(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Produtos com seus lotes, em duas consultas e uma junção em memória.
 *  Uma consulta com JOIN devolveria o produto repetido por lote e obrigaria a
 *  desduplicar do lado de cá — que é onde o saldo costuma sair dobrado. */
async function produtosComLotes(filtro) {
  const [produtos] = await pool.query(
    'SELECT * FROM products' + (filtro && filtro.somenteAtivos ? ' WHERE active = 1' : '') +
    ' ORDER BY category, name'
  );
  if (!produtos.length) return [];

  const [lotes] = await pool.query(`
    SELECT id, product_id, batch_number, quantity, unit_cost,
           DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date,
           DATE_FORMAT(received_at, '%Y-%m-%d') AS received_at
      FROM stock_batches
     WHERE quantity > 0
  `);
  const porProduto = new Map();
  for (const l of lotes) {
    if (!porProduto.has(l.product_id)) porProduto.set(l.product_id, []);
    porProduto.get(l.product_id).push(l);
  }
  return produtos.map((p) => Object.assign({}, p, { lotes: porProduto.get(p.id) || [] }));
}

function paraTela(p) {
  const lotes = p.lotes || [];
  const util = est.saldoUtilizavel(lotes);
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    unit: p.unit,
    unitCost: est.centavos(p.unit_cost),
    salePrice: p.sale_price == null ? null : est.centavos(p.sale_price),
    minStock: est.q(p.min_stock),
    controlled: !!p.controlled,
    supplier: p.supplier,
    active: !!p.active,
    // Dois saldos, sempre os dois: o total é o que existe na prateleira, o
    // utilizável é o que pode ser aplicado em alguém. Mostrar só um esconde
    // exatamente o caso que interessa.
    saldo: util,
    saldoTotal: est.saldoDosLotes(lotes),
    valorEmEstoque: est.centavos(est.saldoDosLotes(lotes) * est.num(p.unit_cost)),
    lotes: lotes.map((l) => ({
      id: l.id, lote: l.batch_number, validade: l.expiry_date,
      quantidade: est.q(l.quantity), custoUnitario: est.centavos(l.unit_cost),
      recebidoEm: l.received_at, vencido: est.vencido(l)
    }))
  };
}

/* ---------------------------------------------------------- produtos */

router.get('/api/products', async function (req, res) {
  try {
    const lista = await produtosComLotes({ somenteAtivos: req.query.active === '1' });
    let saida = lista.map(paraTela);
    if (req.query.lowStock === '1') saida = saida.filter((p) => p.minStock > 0 && p.saldo < p.minStock);
    res.json(saida);
  } catch (e) {
    res.status(500).json({ error: 'Falha ao listar os produtos.' });
  }
});

router.post('/api/products', async function (req, res) {
  const b = req.body || {};
  const nome = String(b.name || '').trim();
  if (!nome) return res.status(400).json({ error: 'O produto precisa de um nome.' });
  if (b.unit && UNIDADES.indexOf(b.unit) === -1) return res.status(400).json({ error: 'Unidade invalida.' });
  try {
    const id = novoId('prd');
    await pool.query(
      `INSERT INTO products (id, sku, name, category, unit, unit_cost, sale_price, min_stock, controlled, supplier)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, b.sku || null, nome.slice(0, 255), b.category || null, b.unit || 'UN',
       est.centavos(b.unitCost), b.salePrice == null || b.salePrice === '' ? null : est.centavos(b.salePrice),
       est.q(b.minStock), b.controlled ? 1 : 0, b.supplier || null]
    );
    await logSystemEvent('ESTOQUE', 'Produto cadastrado: ' + nome + '.', autor(req));
    res.status(201).json({ id });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ja existe produto com este SKU.' });
    res.status(500).json({ error: 'Falha ao cadastrar o produto.' });
  }
});

router.patch('/api/products/:id', async function (req, res) {
  const b = req.body || {};
  const sets = [], v = [];
  const campo = (c, x) => { sets.push(c + ' = ?'); v.push(x); };
  if (b.name !== undefined) campo('name', String(b.name).trim().slice(0, 255));
  if (b.sku !== undefined) campo('sku', b.sku || null);
  if (b.category !== undefined) campo('category', b.category || null);
  if (b.unit !== undefined) {
    if (UNIDADES.indexOf(b.unit) === -1) return res.status(400).json({ error: 'Unidade invalida.' });
    campo('unit', b.unit);
  }
  if (b.salePrice !== undefined) campo('sale_price', b.salePrice == null || b.salePrice === '' ? null : est.centavos(b.salePrice));
  if (b.minStock !== undefined) campo('min_stock', est.q(b.minStock));
  if (b.controlled !== undefined) campo('controlled', b.controlled ? 1 : 0);
  if (b.supplier !== undefined) campo('supplier', b.supplier || null);
  if (b.active !== undefined) campo('active', b.active ? 1 : 0);
  // `unit_cost` NAO entra aqui de proposito: ele e resultado do custo medio
  // das entradas (R3). Deixar editar a mao criaria um custo que nao
  // corresponde a nenhuma compra, e a precificacao passaria a mentir.
  if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar.' });
  try {
    v.push(req.params.id);
    const [r] = await pool.query('UPDATE products SET ' + sets.join(', ') + ' WHERE id = ?', v);
    if (!r.affectedRows) return res.status(404).json({ error: 'Produto nao encontrado.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao atualizar o produto.' });
  }
});

router.get('/api/products/:id/batches', async function (req, res) {
  try {
    const [r] = await pool.query(`
      SELECT id, batch_number, quantity, unit_cost,
             DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date,
             DATE_FORMAT(received_at, '%Y-%m-%d') AS received_at
        FROM stock_batches WHERE product_id = ? ORDER BY expiry_date IS NULL, expiry_date, received_at
    `, [req.params.id]);
    res.json(r.map((l) => ({
      id: l.id, lote: l.batch_number, validade: l.expiry_date, quantidade: est.q(l.quantity),
      custoUnitario: est.centavos(l.unit_cost), recebidoEm: l.received_at, vencido: est.vencido(l)
    })));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao listar os lotes.' });
  }
});

/* ------------------------------------------------------------ entrada */

router.post('/api/stock/entry', async function (req, res) {
  const b = req.body || {};
  const qtd = positivo(b.quantity);
  if (!qtd) return res.status(400).json({ error: 'Quantidade precisa ser maior que zero.' });
  const custo = est.centavos(b.unitCost);

  const conexao = await pool.getConnection();
  try {
    await conexao.beginTransaction();

    const [pr] = await conexao.query('SELECT * FROM products WHERE id = ? FOR UPDATE', [b.productId]);
    if (!pr.length) { await conexao.rollback(); return res.status(404).json({ error: 'Produto nao encontrado.' }); }
    const produto = pr[0];

    // Produto controlado exige lote e validade. E requisito sanitario: sem
    // isso, um recolhimento de lote nao tem como ser rastreado.
    const validade = dataValida(b.expiryDate);
    if (produto.controlled && (!String(b.batchNumber || '').trim() || !validade)) {
      await conexao.rollback();
      return res.status(400).json({ error: 'Produto controlado exige numero de lote e validade.' });
    }

    const [lotesAtuais] = await conexao.query(
      'SELECT quantity FROM stock_batches WHERE product_id = ?', [b.productId]
    );
    const saldoAntes = est.saldoDosLotes(lotesAtuais);
    const novoCusto = est.custoMedio(saldoAntes, produto.unit_cost, qtd, custo);

    const idLote = novoId('lot');
    await conexao.query(
      `INSERT INTO stock_batches (id, product_id, batch_number, expiry_date, quantity, unit_cost, received_at)
       VALUES (?,?,?,?,?,?,?)`,
      [idLote, b.productId, String(b.batchNumber || '').trim() || null, validade, qtd, custo,
       dataValida(b.receivedAt) || est.hojeISO()]
    );
    await conexao.query(
      `INSERT INTO stock_movements (id, product_id, batch_id, type, quantity, unit_cost, reason, source, created_by)
       VALUES (?,?,?,'ENTRADA',?,?,?, 'MANUAL', ?)`,
      [novoId('mov'), b.productId, idLote, qtd, custo,
       b.reason || (b.supplier ? 'Compra - ' + b.supplier : 'Entrada de estoque'),
       req.usuario && req.usuario.sub]
    );
    await conexao.query('UPDATE products SET unit_cost = ?' + (b.supplier ? ', supplier = ?' : '') + ' WHERE id = ?',
      b.supplier ? [novoCusto, b.supplier, b.productId] : [novoCusto, b.productId]);

    await conexao.commit();
    await logSystemEvent('ESTOQUE',
      'Entrada de ' + qtd + ' ' + produto.unit + ' de ' + produto.name + '.', autor(req));
    res.status(201).json({ batchId: idLote, saldoAntes, saldoDepois: est.q(saldoAntes + qtd),
                           custoAnterior: est.centavos(produto.unit_cost), custoMedio: novoCusto });
  } catch (e) {
    try { await conexao.rollback(); } catch (_) { /* conexao ja pode ter caido */ }
    res.status(500).json({ error: 'Falha ao dar entrada no estoque.' });
  } finally {
    conexao.release();
  }
});

/* ------------------------------------------------- ajuste e perda */

router.post('/api/stock/adjust', async function (req, res) {
  const b = req.body || {};
  const tipo = b.type === 'PERDA' ? 'PERDA' : 'AJUSTE';
  const qtd = positivo(Math.abs(Number(b.quantity)));
  if (!qtd) return res.status(400).json({ error: 'Informe a quantidade do ajuste.' });
  const motivo = String(b.reason || '').trim();
  // Ajuste sem motivo e um numero que ninguem consegue explicar depois. E o
  // ajuste e justamente onde some estoque sem rastro.
  if (!motivo) return res.status(400).json({ error: 'Informe o motivo do ajuste.' });

  const negativo = tipo === 'PERDA' || Number(b.quantity) < 0;
  const conexao = await pool.getConnection();
  try {
    await conexao.beginTransaction();
    const [lr] = await conexao.query('SELECT * FROM stock_batches WHERE id = ? FOR UPDATE', [b.batchId]);
    if (!lr.length) { await conexao.rollback(); return res.status(404).json({ error: 'Lote nao encontrado.' }); }
    const lote = lr[0];

    if (negativo && est.q(lote.quantity) < qtd) {
      await conexao.rollback();
      return res.status(409).json({ error: 'O lote tem apenas ' + est.q(lote.quantity) + ' em saldo.' });
    }

    await conexao.query('UPDATE stock_batches SET quantity = quantity ' + (negativo ? '-' : '+') + ' ? WHERE id = ?',
      [qtd, b.batchId]);
    await conexao.query(
      `INSERT INTO stock_movements (id, product_id, batch_id, type, quantity, unit_cost, reason, source, created_by)
       VALUES (?,?,?,?,?,?,?, 'MANUAL', ?)`,
      [novoId('mov'), lote.product_id, b.batchId, tipo, qtd, est.centavos(lote.unit_cost),
       (negativo ? '' : '+ ') + motivo, req.usuario && req.usuario.sub]
    );
    await conexao.commit();
    await logSystemEvent('ESTOQUE', tipo + ' de ' + qtd + ' no lote ' + (lote.batch_number || b.batchId) +
      '. Motivo: ' + motivo, autor(req));
    res.json({ ok: true, saldoDoLote: est.q(est.num(lote.quantity) + (negativo ? -qtd : qtd)) });
  } catch (e) {
    try { await conexao.rollback(); } catch (_) { /* conexao ja pode ter caido */ }
    res.status(500).json({ error: 'Falha ao ajustar o estoque.' });
  } finally {
    conexao.release();
  }
});

/* --------------------------------------------- saldo, extrato, alertas */

router.get('/api/stock/balance', async function (req, res) {
  try {
    const lista = await produtosComLotes({ somenteAtivos: true });
    const itens = lista.map(paraTela);
    res.json({
      itens: itens,
      valorTotal: est.centavos(itens.reduce((s, p) => s + p.valorEmEstoque, 0)),
      produtos: itens.length
    });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao calcular o saldo.' });
  }
});

router.get('/api/stock/alerts', async function (req, res) {
  try {
    const lista = await produtosComLotes({ somenteAtivos: true });
    res.json(est.alertas(lista));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao montar os alertas de estoque.' });
  }
});

/** Extrato. A origem sai LEGÍVEL — "Atendimento: Botox, Ana Beatriz, 12/09" —
 *  e não o id cru: extrato que obriga a pessoa a decorar identificador não é
 *  extrato, é despejo de tabela. */
router.get('/api/stock/movements', async function (req, res) {
  try {
    const cond = [], v = [];
    if (req.query.productId) { cond.push('m.product_id = ?'); v.push(req.query.productId); }
    if (req.query.from) { cond.push('DATE(m.created_at) >= ?'); v.push(String(req.query.from).slice(0, 10)); }
    if (req.query.to) { cond.push('DATE(m.created_at) <= ?'); v.push(String(req.query.to).slice(0, 10)); }

    const [r] = await pool.query(`
      SELECT m.id, m.type, m.quantity, m.unit_cost, m.reason, m.source, m.source_id,
             DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
             p.name AS produto, p.unit,
             b.batch_number AS lote,
             a.title AS compromisso,
             DATE_FORMAT(a.starts_at, '%Y-%m-%d %H:%i:%s') AS compromisso_em,
             c.name AS paciente,
             u.name AS autor
        FROM stock_movements m
        JOIN products p ON p.id = m.product_id
        LEFT JOIN stock_batches b ON b.id = m.batch_id
        LEFT JOIN appointments a ON m.source = 'APPOINTMENT' AND a.id = m.source_id
        LEFT JOIN clients c ON c.id = a.client_id
        LEFT JOIN users u ON u.id = m.created_by
       ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 300
    `, v);

    res.json(r.map(function (m) {
      let origem = m.reason || null;
      if (m.source === 'APPOINTMENT' && m.compromisso) {
        origem = m.compromisso + (m.paciente ? ' — ' + m.paciente : '') +
                 (m.compromisso_em ? ', ' + m.compromisso_em.slice(8, 10) + '/' + m.compromisso_em.slice(5, 7) +
                  ' ' + m.compromisso_em.slice(11, 16) : '');
      }
      return {
        id: m.id, tipo: m.type, produto: m.produto, unidade: m.unit, lote: m.lote,
        quantidade: est.q(m.quantity), custoUnitario: est.centavos(m.unit_cost),
        sinal: est.sinal(m.type), origem: origem, fonte: m.source,
        quando: m.created_at, autor: m.autor || null
      };
    }));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao listar as movimentacoes.' });
  }
});

/* ------------------------------------------------------ ficha técnica */

router.get('/api/services/:catalogId/supplies', async function (req, res) {
  try {
    const [itens] = await pool.query(`
      SELECT s.product_id, s.quantity, p.name, p.unit, p.unit_cost
        FROM service_supplies s
        JOIN products p ON p.id = s.product_id
       WHERE s.catalog_id = ?
       ORDER BY p.name
    `, [req.params.catalogId]);
    const [cat] = await pool.query('SELECT variable_cost FROM treatment_catalog WHERE id = ?', [req.params.catalogId]);
    const custo = est.custoVariavelDaFicha(itens, cat.length ? cat[0].variable_cost : 0);
    res.json({
      catalogId: req.params.catalogId,
      itens: itens.map((i) => ({ productId: i.product_id, produto: i.name, unidade: i.unit,
                                 quantidade: est.q(i.quantity), custoUnitario: est.centavos(i.unit_cost),
                                 parcial: est.centavos(est.num(i.quantity) * est.num(i.unit_cost)) })),
      custoVariavel: custo.valor,
      origem: custo.origem
    });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao ler a ficha tecnica.' });
  }
});

/** Substitui a ficha inteira. Trocar tudo de uma vez é mais simples de acertar
 *  do que diferença item a item, e a ficha é pequena por natureza. */
router.put('/api/services/:catalogId/supplies', async function (req, res) {
  const itens = Array.isArray(req.body && req.body.itens) ? req.body.itens : null;
  if (!itens) return res.status(400).json({ error: 'Envie a lista de itens da ficha.' });

  const conexao = await pool.getConnection();
  try {
    await conexao.beginTransaction();
    await conexao.query('DELETE FROM service_supplies WHERE catalog_id = ?', [req.params.catalogId]);
    for (const i of itens) {
      const qtd = positivo(i.quantity);
      if (!i.productId || !qtd) continue;
      await conexao.query(
        'INSERT INTO service_supplies (id, catalog_id, product_id, quantity) VALUES (?,?,?,?)',
        [novoId('ss'), req.params.catalogId, i.productId, qtd]
      );
    }
    await conexao.commit();
    await logSystemEvent('ESTOQUE', 'Ficha tecnica atualizada (' + itens.length + ' item(ns)).', autor(req));

    const [novos] = await pool.query(`
      SELECT s.quantity, p.name, p.unit_cost, s.product_id, p.unit
        FROM service_supplies s JOIN products p ON p.id = s.product_id
       WHERE s.catalog_id = ?`, [req.params.catalogId]);
    res.json(est.custoVariavelDaFicha(novos, 0));
  } catch (e) {
    try { await conexao.rollback(); } catch (_) { /* conexao ja pode ter caido */ }
    res.status(500).json({ error: 'Falha ao salvar a ficha tecnica.' });
  } finally {
    conexao.release();
  }
});

module.exports = router;

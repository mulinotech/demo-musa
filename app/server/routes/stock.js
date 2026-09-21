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
 *
 *  ============================================= O QUE MUDOU NA M1.3 (09/09)
 *
 *  Toda consulta passou a `escopo(req)`. Dois lugares mereceram mais que o
 *  filtro, e estão comentados no lugar:
 *
 *  - o **extrato** junta seis tabelas, e é a consulta com mais junções do
 *    sistema inteiro;
 *  - a **ficha técnica** passou a conferir o dono do serviço e de cada insumo,
 *    porque é ela que decide de qual produto o atendimento dá baixa.
 */
const express = require('express');
const router = express.Router();

/** A linha e desta clinica? Ver o mesmo em routes/documents.js. */
async function ehDestaClinica(db, tabela, id) {
  const [r] = await db.q(
    'SELECT 1 FROM `' + tabela + '` WHERE clinica_id = :clinica AND id = ? LIMIT 1', [id]);
  return r.length > 0;
}
const escopo = require('../db/escopo');
const est = require('../services/estoque');
const logs = require('../services/logs');

/** Recusa de regra de dentro de uma transacao. Mesmo padrao de
 *  `routes/appointments.js`: `db.transacao` desfaz tudo quando a funcao lanca,
 *  e a recusa carrega o status para nao virar 500. Ver o comentario longo la. */
class Recusa extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.recusa = { status: status, error: mensagem };
  }
}

function responderRecusa(res, e) {
  if (!e || !e.recusa) return false;
  res.status(e.recusa.status).json({ error: e.recusa.error });
  return true;
}

const novoId = (p) => p + '_' + Math.random().toString(36).slice(2, 10);
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
async function produtosComLotes(db, filtro) {
  const [produtos] = await db.q(
    'SELECT * FROM products WHERE clinica_id = :clinica' +
    (filtro && filtro.somenteAtivos ? ' AND active = 1' : '') +
    ' ORDER BY category, name'
  );
  if (!produtos.length) return [];

  // As DUAS consultas filtram. Filtrar so os produtos deixaria os lotes da
  // vizinha entrarem no mapa por `product_id` -- e, na colisao de id, o saldo
  // do produto desta clinica sairia somado com o lote de outra. Saldo errado no
  // estoque nao e vazamento de leitura: e a baixa automatica tirando do lote
  // que nao existe aqui.
  const [lotes] = await db.q(`
    SELECT id, product_id, batch_number, quantity, unit_cost,
           DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date,
           DATE_FORMAT(received_at, '%Y-%m-%d') AS received_at
      FROM stock_batches
     WHERE clinica_id = :clinica AND quantity > 0
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
  const db = escopo(req);
  try {
    const lista = await produtosComLotes(db, { somenteAtivos: req.query.active === '1' });
    let saida = lista.map(paraTela);
    if (req.query.lowStock === '1') saida = saida.filter((p) => p.minStock > 0 && p.saldo < p.minStock);
    res.json(saida);
  } catch (e) {
    res.status(500).json({ error: 'Falha ao listar os produtos.' });
  }
});

router.post('/api/products', async function (req, res) {
  const db = escopo(req);
  const b = req.body || {};
  const nome = String(b.name || '').trim();
  if (!nome) return res.status(400).json({ error: 'O produto precisa de um nome.' });
  if (b.unit && UNIDADES.indexOf(b.unit) === -1) return res.status(400).json({ error: 'Unidade invalida.' });
  try {
    const id = novoId('prd');
    // O SKU virou unico POR CLINICA na migration 019, entao a mensagem de
    // conflito abaixo continua verdadeira: se der ER_DUP_ENTRY, o codigo ja
    // existe NESTA clinica -- e nao numa vizinha, que seria uma recusa
    // inexplicavel olhando a propria lista.
    await db.q(
      `INSERT INTO products (id, sku, name, category, unit, unit_cost, sale_price, min_stock, controlled, supplier, clinica_id)
       VALUES (?,?,?,?,?,?,?,?,?,?, :clinica)`,
      [id, b.sku || null, nome.slice(0, 255), b.category || null, b.unit || 'UN',
       est.centavos(b.unitCost), b.salePrice == null || b.salePrice === '' ? null : est.centavos(b.salePrice),
       est.q(b.minStock), b.controlled ? 1 : 0, b.supplier || null]
    );
    await logs.registrar(db, 'ESTOQUE', 'Produto cadastrado: ' + nome + '.');
    res.status(201).json({ id });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ja existe produto com este SKU.' });
    res.status(500).json({ error: 'Falha ao cadastrar o produto.' });
  }
});

router.patch('/api/products/:id', async function (req, res) {
  const db = escopo(req);
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
    const [r] = await db.q('UPDATE products SET ' + sets.join(', ') +
      ' WHERE clinica_id = :clinica AND id = ?', v);
    if (!r.affectedRows) return res.status(404).json({ error: 'Produto nao encontrado.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao atualizar o produto.' });
  }
});

router.get('/api/products/:id/batches', async function (req, res) {
  const db = escopo(req);
  try {
    if (!(await ehDestaClinica(db, 'products', req.params.id))) {
      return res.status(404).json({ error: 'Produto nao encontrado.' });
    }
    const [r] = await db.q(`
      SELECT id, batch_number, quantity, unit_cost,
             DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date,
             DATE_FORMAT(received_at, '%Y-%m-%d') AS received_at
        FROM stock_batches
       WHERE clinica_id = :clinica AND product_id = ?
       ORDER BY expiry_date IS NULL, expiry_date, received_at
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
  const db = escopo(req);
  const b = req.body || {};
  const qtd = positivo(b.quantity);
  if (!qtd) return res.status(400).json({ error: 'Quantidade precisa ser maior que zero.' });
  const custo = est.centavos(b.unitCost);

  try {
    const saida = await db.transacao(async function (tx) {
      const [pr] = await tx.q(
        'SELECT * FROM products WHERE clinica_id = :clinica AND id = ? FOR UPDATE', [b.productId]);
      if (!pr.length) throw new Recusa(404, 'Produto nao encontrado.');
      const produto = pr[0];

      // Produto controlado exige lote e validade. E requisito sanitario: sem
      // isso, um recolhimento de lote nao tem como ser rastreado.
      const validade = dataValida(b.expiryDate);
      if (produto.controlled && (!String(b.batchNumber || '').trim() || !validade)) {
        throw new Recusa(400, 'Produto controlado exige numero de lote e validade.');
      }

      // O saldo anterior entra no CUSTO MEDIO. Um lote da vizinha entrando
      // nesta soma nao mostraria dado dela na tela -- faria o custo medio deste
      // produto sair errado, e a precificacao passaria a calcular preco sobre
      // um custo que nao corresponde a compra nenhuma. Erro silencioso e caro.
      const [lotesAtuais] = await tx.q(
        'SELECT quantity FROM stock_batches WHERE clinica_id = :clinica AND product_id = ?',
        [b.productId]);
      const saldoAntes = est.saldoDosLotes(lotesAtuais);
      const novoCusto = est.custoMedio(saldoAntes, produto.unit_cost, qtd, custo);

      const idLote = novoId('lot');
      await tx.q(
        `INSERT INTO stock_batches (id, product_id, batch_number, expiry_date, quantity, unit_cost, received_at, clinica_id)
         VALUES (?,?,?,?,?,?,?, :clinica)`,
        [idLote, b.productId, String(b.batchNumber || '').trim() || null, validade, qtd, custo,
         dataValida(b.receivedAt) || est.hojeISO()]
      );
      await tx.q(
        `INSERT INTO stock_movements (id, product_id, batch_id, type, quantity, unit_cost, reason, source, created_by, clinica_id)
         VALUES (?,?,?,'ENTRADA',?,?,?, 'MANUAL', ?, :clinica)`,
        [novoId('mov'), b.productId, idLote, qtd, custo,
         b.reason || (b.supplier ? 'Compra - ' + b.supplier : 'Entrada de estoque'),
         req.usuario && req.usuario.sub]
      );
      await tx.q('UPDATE products SET unit_cost = ?' + (b.supplier ? ', supplier = ?' : '') +
        ' WHERE clinica_id = :clinica AND id = ?',
        b.supplier ? [novoCusto, b.supplier, b.productId] : [novoCusto, b.productId]);

      return { idLote, produto, saldoAntes, novoCusto };
    });

    await logs.registrar(db, 'ESTOQUE',
      'Entrada de ' + qtd + ' ' + saida.produto.unit + ' de ' + saida.produto.name + '.');
    res.status(201).json({ batchId: saida.idLote, saldoAntes: saida.saldoAntes,
                           saldoDepois: est.q(saida.saldoAntes + qtd),
                           custoAnterior: est.centavos(saida.produto.unit_cost),
                           custoMedio: saida.novoCusto });
  } catch (e) {
    if (responderRecusa(res, e)) return;
    console.error('[estoque]', e && e.message);
    res.status(500).json({ error: 'Falha ao dar entrada no estoque.' });
  }
});

/* ------------------------------------------------- ajuste e perda */

router.post('/api/stock/adjust', async function (req, res) {
  const db = escopo(req);
  const b = req.body || {};
  const tipo = b.type === 'PERDA' ? 'PERDA' : 'AJUSTE';
  const qtd = positivo(Math.abs(Number(b.quantity)));
  if (!qtd) return res.status(400).json({ error: 'Informe a quantidade do ajuste.' });
  const motivo = String(b.reason || '').trim();
  // Ajuste sem motivo e um numero que ninguem consegue explicar depois. E o
  // ajuste e justamente onde some estoque sem rastro.
  if (!motivo) return res.status(400).json({ error: 'Informe o motivo do ajuste.' });

  const negativo = tipo === 'PERDA' || Number(b.quantity) < 0;
  try {
    const saida = await db.transacao(async function (tx) {
      // Sem o filtro, um id de lote adivinhado tira saldo do estoque da
      // vizinha -- e ela veria o proprio produto sumindo sem ninguem ter
      // mexido nele.
      const [lr] = await tx.q(
        'SELECT * FROM stock_batches WHERE clinica_id = :clinica AND id = ? FOR UPDATE', [b.batchId]);
      if (!lr.length) throw new Recusa(404, 'Lote nao encontrado.');
      const lote = lr[0];

      if (negativo && est.q(lote.quantity) < qtd) {
        throw new Recusa(409, 'O lote tem apenas ' + est.q(lote.quantity) + ' em saldo.');
      }

      await tx.q('UPDATE stock_batches SET quantity = quantity ' + (negativo ? '-' : '+') + ' ? ' +
        'WHERE clinica_id = :clinica AND id = ?', [qtd, b.batchId]);
      await tx.q(
        `INSERT INTO stock_movements (id, product_id, batch_id, type, quantity, unit_cost, reason, source, created_by, clinica_id)
         VALUES (?,?,?,?,?,?,?, 'MANUAL', ?, :clinica)`,
        [novoId('mov'), lote.product_id, b.batchId, tipo, qtd, est.centavos(lote.unit_cost),
         (negativo ? '' : '+ ') + motivo, req.usuario && req.usuario.sub]
      );
      return lote;
    });

    await logs.registrar(db, 'ESTOQUE', tipo + ' de ' + qtd + ' no lote ' + (saida.batch_number || b.batchId) +
      '. Motivo: ' + motivo);
    res.json({ ok: true, saldoDoLote: est.q(est.num(saida.quantity) + (negativo ? -qtd : qtd)) });
  } catch (e) {
    if (responderRecusa(res, e)) return;
    console.error('[estoque]', e && e.message);
    res.status(500).json({ error: 'Falha ao ajustar o estoque.' });
  }
});

/* --------------------------------------------- saldo, extrato, alertas */

router.get('/api/stock/balance', async function (req, res) {
  const db = escopo(req);
  try {
    const lista = await produtosComLotes(db, { somenteAtivos: true });
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
  const db = escopo(req);
  try {
    const lista = await produtosComLotes(db, { somenteAtivos: true });
    res.json(est.alertas(lista));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao montar os alertas de estoque.' });
  }
});

/** Extrato. A origem sai LEGÍVEL — "Atendimento: Botox, Ana Beatriz, 12/09" —
 *  e não o id cru: extrato que obriga a pessoa a decorar identificador não é
 *  extrato, é despejo de tabela. */
router.get('/api/stock/movements', async function (req, res) {
  const db = escopo(req);
  try {
    const cond = [], v = [];
    if (req.query.productId) { cond.push('m.product_id = ?'); v.push(req.query.productId); }
    if (req.query.from) { cond.push('DATE(m.created_at) >= ?'); v.push(String(req.query.from).slice(0, 10)); }
    if (req.query.to) { cond.push('DATE(m.created_at) <= ?'); v.push(String(req.query.to).slice(0, 10)); }

    // ================================== SEIS TABELAS, SEIS FILTROS
    //
    // E a consulta com mais juncoes do sistema. O `JOIN products` filtra no
    // WHERE porque e INNER -- movimento sem produto nao existe. Os quatro
    // `LEFT JOIN` filtram no ON, e a diferenca importa: no WHERE cada um deles
    // viraria INNER, e o extrato perderia justamente as linhas mais comuns --
    // entrada manual (sem compromisso), baixa de bloqueio (sem paciente),
    // movimento da rotina automatica (sem autor).
    //
    // A camada NAO pega juncao esquecida: ela confere que a marca esta na
    // consulta, e uma marca so ja bastaria para passar. Quem pega e a
    // ferramenta de vazamento, e e por isso que ela existe.
    const [r] = await db.q(`
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
        LEFT JOIN stock_batches b ON b.id = m.batch_id AND b.clinica_id = :clinica
        LEFT JOIN appointments a ON m.source = 'APPOINTMENT' AND a.id = m.source_id
                                AND a.clinica_id = :clinica
        LEFT JOIN clients c ON c.id = a.client_id AND c.clinica_id = :clinica
        LEFT JOIN users u ON u.id = m.created_by AND u.clinica_id = :clinica
       WHERE m.clinica_id = :clinica AND p.clinica_id = :clinica
       ${cond.length ? 'AND ' + cond.join(' AND ') : ''}
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
  const db = escopo(req);
  try {
    if (!(await ehDestaClinica(db, 'treatment_catalog', req.params.catalogId))) {
      return res.status(404).json({ error: 'Servico nao encontrado.' });
    }
    const [itens] = await db.q(`
      SELECT s.product_id, s.quantity, p.name, p.unit, p.unit_cost
        FROM service_supplies s
        JOIN products p ON p.id = s.product_id AND p.clinica_id = :clinica
       WHERE s.clinica_id = :clinica AND s.catalog_id = ?
       ORDER BY p.name
    `, [req.params.catalogId]);
    const [cat] = await db.q(
      'SELECT variable_cost FROM treatment_catalog WHERE clinica_id = :clinica AND id = ?',
      [req.params.catalogId]);
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
  const db = escopo(req);
  const itens = Array.isArray(req.body && req.body.itens) ? req.body.itens : null;
  if (!itens) return res.status(400).json({ error: 'Envie a lista de itens da ficha.' });

  try {
    await db.transacao(async function (tx) {
      // ==================== POR QUE AQUI SE CONFERE O DONO, E NAO SO SE FILTRA
      //
      // A ficha tecnica e quem decide de qual produto o atendimento da baixa.
      // Um `productId` de outra clinica gravado aqui faria a conclusao do
      // atendimento procurar esse produto no estoque DESTA clinica, nao achar
      // lote, e recusar a conclusao com "estoque insuficiente" de um produto
      // que a recepcao ve cheio na prateleira. Diagnostico impossivel.
      //
      // Filtrar a leitura nao resolveria: o dado errado ja estaria gravado.
      const [cat] = await tx.q(
        'SELECT id FROM treatment_catalog WHERE clinica_id = :clinica AND id = ?',
        [req.params.catalogId]);
      if (!cat.length) throw new Recusa(404, 'Servico nao encontrado no catalogo.');

      const validos = [];
      for (const i of itens) {
        const qtd = positivo(i.quantity);
        if (!i.productId || !qtd) continue;
        const [prod] = await tx.q(
          'SELECT id FROM products WHERE clinica_id = :clinica AND id = ?', [i.productId]);
        if (!prod.length) throw new Recusa(404, 'Produto nao encontrado: ' + i.productId);
        validos.push({ productId: i.productId, qtd: qtd });
      }

      await tx.q('DELETE FROM service_supplies WHERE clinica_id = :clinica AND catalog_id = ?',
        [req.params.catalogId]);
      for (const i of validos) {
        await tx.q(
          'INSERT INTO service_supplies (id, catalog_id, product_id, quantity, clinica_id) VALUES (?,?,?,?, :clinica)',
          [novoId('ss'), req.params.catalogId, i.productId, i.qtd]
        );
      }
    });

    await logs.registrar(db, 'ESTOQUE', 'Ficha tecnica atualizada (' + itens.length + ' item(ns)).');

    const [novos] = await db.q(`
      SELECT s.quantity, p.name, p.unit_cost, s.product_id, p.unit
        FROM service_supplies s
        JOIN products p ON p.id = s.product_id AND p.clinica_id = :clinica
       WHERE s.clinica_id = :clinica AND s.catalog_id = ?`, [req.params.catalogId]);
    res.json(est.custoVariavelDaFicha(novos, 0));
  } catch (e) {
    if (responderRecusa(res, e)) return;
    console.error('[estoque]', e && e.message);
    res.status(500).json({ error: 'Falha ao salvar a ficha tecnica.' });
  }
});

module.exports = router;

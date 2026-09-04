'use strict';
const cron = require('../middleware/cron');
/** Fidelização — Fase 5.
 *
 *  A rota busca, chama `services/fidelidade.js` e grava. A conta de saldo,
 *  validade e desconto não mora aqui.
 *
 *  Permissão: leitura para TODOS os papéis autenticados, e isso é intencional —
 *  a recepção precisa dizer o saldo à paciente no fim do atendimento, e um
 *  programa de pontos que só a gerência consulta não muda comportamento
 *  nenhum. Configuração e ajuste manual são de `admin`, porque ajuste de pontos
 *  é dinheiro em forma de crédito.
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const fid = require('../services/fidelidade');
const { logSystemEvent } = require('../services/logs');

const novoId = (p) => p + '_' + Math.random().toString(36).slice(2, 10);
const autor = (req) => (req.usuario && req.usuario.nome) || 'Sistema';

function soAdmin(req, res) {
  // Idem: a rotina automatica dispara a expiracao de pontos, e o porteiro so a
  // deixa chegar em /api/loyalty/expire. Ver server/middleware/cron.js.
  if (cron.ehServico(req)) return true;
  if (req.usuario && req.usuario.papel === 'admin') return true;
  res.status(403).json({ error: 'Esta acao e restrita a administrador.' });
  return false;
}

async function lerConfig() {
  const [r] = await pool.query("SELECT * FROM loyalty_settings WHERE id = 'default'");
  if (r.length) return fid.config(r[0]);
  await pool.query("INSERT IGNORE INTO loyalty_settings (id) VALUES ('default')");
  const [r2] = await pool.query("SELECT * FROM loyalty_settings WHERE id = 'default'");
  return fid.config(r2[0]);
}

async function extratoDoCliente(clientId) {
  const [r] = await pool.query(`
    SELECT t.id, t.type, t.points, t.description, t.source, t.source_id, t.reward_id, t.expired,
           DATE_FORMAT(t.expires_at, '%Y-%m-%d') AS expires_at,
           DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
           w.name AS reward_name
      FROM loyalty_transactions t
      LEFT JOIN loyalty_rewards w ON w.id = t.reward_id
     WHERE t.client_id = ?
     ORDER BY t.created_at DESC, t.id DESC
  `, [clientId]);
  return r;
}

/* ---------------------------------------------------------- configuração */

router.get('/api/loyalty/settings', async function (req, res) {
  try {
    const cfg = await lerConfig();
    res.json({ config: cfg, exemplo: fid.exemplo(cfg) });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao ler a configuracao do programa.' });
  }
});

router.put('/api/loyalty/settings', async function (req, res) {
  if (!soAdmin(req, res)) return;
  const b = req.body || {};
  const sets = [], v = [];
  const campo = (c, x) => { sets.push(c + ' = ?'); v.push(x); };

  if (b.active !== undefined) campo('active', b.active ? 1 : 0);
  if (b.pointsPerReal !== undefined) {
    const n = Number(b.pointsPerReal);
    if (!isFinite(n) || n <= 0 || n > 100) return res.status(400).json({ error: 'Pontos por real entre 0 e 100.' });
    campo('points_per_real', n);
  }
  if (b.redemptionValue !== undefined) {
    const n = Number(b.redemptionValue);
    if (!isFinite(n) || n < 0 || n > 10) return res.status(400).json({ error: 'Valor do ponto entre 0 e 10 reais.' });
    campo('redemption_value', n);
  }
  if (b.expiryDays !== undefined) {
    const n = Math.round(Number(b.expiryDays));
    // Teto de 5 anos e piso 0 (= nao expira). A clinica tipica usa 90.
    if (!isFinite(n) || n < 0 || n > 1825) return res.status(400).json({ error: 'Validade entre 0 e 1825 dias.' });
    campo('expiry_days', n);
  }
  if (b.minPointsToRedeem !== undefined) {
    const n = Math.round(Number(b.minPointsToRedeem));
    if (!isFinite(n) || n < 0) return res.status(400).json({ error: 'Minimo para resgate invalido.' });
    campo('min_points_to_redeem', n);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar.' });

  try {
    v.push('default');
    await pool.query('UPDATE loyalty_settings SET ' + sets.join(', ') + ' WHERE id = ?', v);
    const cfg = await lerConfig();
    if (b.active !== undefined) {
      await logSystemEvent('FIDELIDADE',
        'Programa de pontos ' + (cfg.active ? 'ativado' : 'desativado') + '.', autor(req));
    }
    // A mudanca NAO altera pontos ja creditados, de proposito: quem acumulou
    // sob a regra antiga mantem o que tem. Mexer no passado quebraria a
    // confianca da paciente no saldo que ela anotou.
    res.json({ config: cfg, exemplo: fid.exemplo(cfg) });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao salvar a configuracao.' });
  }
});

/* ----------------------------------------------------------- recompensas */

router.get('/api/loyalty/rewards', async function (req, res) {
  try {
    const [r] = await pool.query(`
      SELECT w.*, c.name AS catalog_name
        FROM loyalty_rewards w
        LEFT JOIN treatment_catalog c ON c.id = w.catalog_id
       ORDER BY w.active DESC, w.points_cost
    `);
    res.json(r.map((w) => ({
      id: w.id, name: w.name, description: w.description, pointsCost: w.points_cost,
      type: w.type, value: w.value == null ? null : Number(w.value),
      catalogId: w.catalog_id, catalogName: w.catalog_name || null, active: !!w.active
    })));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao listar as recompensas.' });
  }
});

router.post('/api/loyalty/rewards', async function (req, res) {
  if (!soAdmin(req, res)) return;
  const b = req.body || {};
  const nome = String(b.name || '').trim();
  const custo = Math.round(Number(b.pointsCost));
  const TIPOS = ['DESCONTO_VALOR', 'DESCONTO_PCT', 'SERVICO', 'PRODUTO'];
  if (!nome) return res.status(400).json({ error: 'A recompensa precisa de um nome.' });
  if (!isFinite(custo) || custo <= 0) return res.status(400).json({ error: 'Custo em pontos invalido.' });
  if (TIPOS.indexOf(b.type) === -1) return res.status(400).json({ error: 'Tipo de recompensa invalido.' });
  if (b.type === 'DESCONTO_PCT') {
    const n = Number(b.value);
    if (!isFinite(n) || n <= 0 || n > 100) return res.status(400).json({ error: 'Percentual entre 0 e 100.' });
  }
  try {
    const id = novoId('rw');
    await pool.query(
      `INSERT INTO loyalty_rewards (id, name, description, points_cost, type, value, catalog_id, product_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, nome.slice(0, 255), b.description || null, custo, b.type,
       b.value == null || b.value === '' ? null : Number(b.value),
       b.catalogId || null, b.productId || null]
    );
    await logSystemEvent('FIDELIDADE', 'Recompensa criada: ' + nome + ' (' + custo + ' pontos).', autor(req));
    res.status(201).json({ id });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao criar a recompensa.' });
  }
});

router.patch('/api/loyalty/rewards/:id', async function (req, res) {
  if (!soAdmin(req, res)) return;
  const b = req.body || {};
  const sets = [], v = [];
  const campo = (c, x) => { sets.push(c + ' = ?'); v.push(x); };
  if (b.name !== undefined) campo('name', String(b.name).trim().slice(0, 255));
  if (b.description !== undefined) campo('description', b.description || null);
  if (b.pointsCost !== undefined) campo('points_cost', Math.round(Number(b.pointsCost)));
  if (b.value !== undefined) campo('value', b.value == null || b.value === '' ? null : Number(b.value));
  if (b.catalogId !== undefined) campo('catalog_id', b.catalogId || null);
  if (b.active !== undefined) campo('active', b.active ? 1 : 0);
  if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar.' });
  try {
    v.push(req.params.id);
    const [r] = await pool.query('UPDATE loyalty_rewards SET ' + sets.join(', ') + ' WHERE id = ?', v);
    if (!r.affectedRows) return res.status(404).json({ error: 'Recompensa nao encontrada.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao atualizar a recompensa.' });
  }
});

/* -------------------------------------------------- saldo e extrato */

router.get('/api/clients/:id/loyalty', async function (req, res) {
  try {
    const cfg = await lerConfig();
    const tx = await extratoDoCliente(req.params.id);
    const saldo = fid.saldo(tx, req.query.hoje);
    res.json({
      clientId: req.params.id,
      ativo: cfg.active,
      saldo: saldo,
      vale: fid.valorEmReais(saldo, cfg),
      aExpirar30Dias: fid.aExpirar(tx, 30, req.query.hoje),
      minimoParaResgate: cfg.minPointsToRedeem,
      extrato: tx.map((t) => ({
        id: t.id, tipo: t.type, pontos: Number(t.points), descricao: t.description,
        fonte: t.source, recompensa: t.reward_name || null,
        expiraEm: t.expires_at, expirado: !!Number(t.expired), quando: t.created_at
      }))
    });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao ler o saldo de pontos.' });
  }
});

/** Ajuste manual. Só admin, motivo obrigatório — é crédito em forma de ponto,
 *  e ajuste sem motivo registrado é o buraco que a auditoria fecha. */
router.post('/api/clients/:id/loyalty/adjust', async function (req, res) {
  if (!soAdmin(req, res)) return;
  const b = req.body || {};
  const pontos = Math.round(Number(b.points));
  const motivo = String(b.description || '').trim();
  if (!isFinite(pontos) || pontos === 0) return res.status(400).json({ error: 'Informe a quantidade de pontos.' });
  if (!motivo) return res.status(400).json({ error: 'Informe o motivo do ajuste.' });

  try {
    const cfg = await lerConfig();
    const tx = await extratoDoCliente(req.params.id);
    const saldo = fid.saldo(tx);
    if (pontos < 0 && saldo < -pontos) {
      return res.status(409).json({ error: 'Saldo de ' + saldo + ' ponto(s): nao da para retirar ' + (-pontos) + '.' });
    }
    await pool.query(
      `INSERT INTO loyalty_transactions
        (id, client_id, type, points, description, source, expires_at, created_by)
       VALUES (?,?, 'AJUSTE', ?, ?, 'MANUAL', ?, ?)`,
      [novoId('lt'), req.params.id, pontos, motivo.slice(0, 255),
       pontos > 0 ? fid.validadeDoAcumulo(null, cfg) : null, req.usuario && req.usuario.sub]
    );
    await logSystemEvent('FIDELIDADE',
      'Ajuste de ' + (pontos > 0 ? '+' : '') + pontos + ' ponto(s). Motivo: ' + motivo, autor(req));
    const novo = fid.saldo(await extratoDoCliente(req.params.id));
    res.json({ ok: true, saldo: novo });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao ajustar os pontos.' });
  }
});

/* ------------------------------------------------- relatório e worker */

/** O custo do programa em reais é um RELATÓRIO, não um lançamento contábil.
 *  Desconto não é dinheiro que saiu — é dinheiro que não entrou. Criar despesa
 *  para ele contaria duas vezes: a receita já veio menor. */
router.get('/api/loyalty/report', async function (req, res) {
  // O relatorio mostra custo do programa e passivo em circulacao: e dado de
  // negocio da mesma natureza do preco e do resultado, que ja sao restritos.
  // O SALDO de um paciente continua legivel por todos -- e a recepcao que diz
  // o saldo a ele no fim do atendimento.
  const papel = req.usuario && req.usuario.papel;
  if (papel !== 'admin' && papel !== 'gerente') {
    return res.status(403).json({ error: 'O relatorio de fidelidade e restrito a admin e gerente.' });
  }
  try {
    const cfg = await lerConfig();
    const de = String(req.query.from || '').slice(0, 10) || fid.hojeISO().slice(0, 8) + '01';
    const ate = String(req.query.to || '').slice(0, 10) || fid.hojeISO();
    const [r] = await pool.query(`
      SELECT type, SUM(points) AS pontos, COUNT(*) AS n,
             SUM(COALESCE(amount_discounted, 0)) AS reais
        FROM loyalty_transactions
       WHERE DATE(created_at) BETWEEN ? AND ?
       GROUP BY type
    `, [de, ate]);

    const mapa = {};
    for (const l of r) mapa[l.type] = { pontos: Number(l.pontos), transacoes: Number(l.n), reais: Number(l.reais) };
    const em = (t) => (mapa[t] ? mapa[t].pontos : 0);

    const resgatados = Math.abs(em('RESGATE'));

    // Saldo total em circulacao: e o passivo do programa. Nao entra no
    // financeiro como divida -- nao e obrigacao em dinheiro -- mas a clinica
    // precisa saber que existe, porque um dia parte disso vira desconto.
    const [tudo] = await pool.query(`
      SELECT t.client_id, t.type, t.points, t.expired,
             DATE_FORMAT(t.expires_at, '%Y-%m-%d') AS expires_at,
             DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i:%s') AS created_at, t.id
        FROM loyalty_transactions t
    `);
    const porCliente = new Map();
    for (const t of tudo) {
      if (!porCliente.has(t.client_id)) porCliente.set(t.client_id, []);
      porCliente.get(t.client_id).push(t);
    }
    let circulacao = 0;
    for (const tx of porCliente.values()) circulacao += fid.saldo(tx);

    res.json({
      periodo: { de, ate },
      emitidos: em('ACUMULO'),
      resgatados: resgatados,
      expirados: Math.abs(em('EXPIRACAO')),
      ajustes: em('AJUSTE'),
      estornos: em('ESTORNO'),
      // O custo do programa e o DINHEIRO que o desconto tirou, gravado no
      // resgate -- nao "pontos x valor do ponto", que e estimativa. Desconto
      // percentual em atendimento caro devolve muito mais do que a tabela diz.
      custoEmReais: fid.centavos(mapa.RESGATE ? mapa.RESGATE.reais : 0),
      custoEstimadoPelaTabela: fid.valorEmReais(resgatados, cfg),
      saldoEmCirculacao: circulacao,
      passivoEmReais: fid.valorEmReais(circulacao, cfg),
      pacientesComSaldo: Array.from(porCliente.values()).filter((tx) => fid.saldo(tx) > 0).length
    });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao montar o relatorio de pontos.' });
  }
});

router.post('/api/loyalty/expire', async function (req, res) {
  if (!soAdmin(req, res)) return;
  try {
    const worker = require('../workers/expiracao-pontos');
    const r = await worker.rodarUmaVez(pool);
    if (r.expirados) {
      await logSystemEvent('FIDELIDADE',
        r.expirados + ' acumulo(s) expirado(s), ' + r.pontos + ' ponto(s).', autor(req));
    }
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: 'Falha ao processar a expiracao de pontos.' });
  }
});

module.exports = router;

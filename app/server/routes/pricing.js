'use strict';
/** Precificacao — Fase 2, T2.1.
 *
 *  Custos fixos, parametros globais, simulacao e aplicacao ao catalogo.
 *  A conta em si nao mora aqui: esta rota so busca estado, chama
 *  services/precificacao.js e devolve. Motor puro, testado a parte.
 *
 *  Restricao de papel: preco e informacao sensivel de negocio. As linhas de
 *  /api/pricing e /api/fixed-costs em REGRAS_DE_PAPEL limitam tudo isto a
 *  admin e gerente.
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { calcularPreco, compararComPraticado } = require('../services/precificacao');
const { logSystemEvent } = require('../services/logs');

const novoId = (p) => p + '_' + Math.random().toString(36).slice(2, 10);
const autor = (req) => (req.usuario && req.usuario.nome) || 'Sistema';
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Parametros globais, sempre a linha 'default'. Cria na leitura se nao existir,
 *  para a tela nunca ver 404 num banco que ainda nao rodou a migration inteira. */
async function lerParametros() {
  const [r] = await pool.query('SELECT * FROM pricing_settings WHERE id = ?', ['default']);
  if (r.length) return r[0];
  await pool.query("INSERT INTO pricing_settings (id) VALUES ('default') ON DUPLICATE KEY UPDATE id = id");
  const [r2] = await pool.query('SELECT * FROM pricing_settings WHERE id = ?', ['default']);
  return r2[0];
}

async function somaCustosFixos() {
  const [r] = await pool.query('SELECT COALESCE(SUM(monthly_amount), 0) AS total FROM fixed_costs WHERE active = 1');
  return Number(r[0].total);
}

function paraTela(p) {
  return {
    monthlyWorkingHours: Number(p.monthly_working_hours),
    targetMarginPct: Number(p.target_margin_pct),
    cardFeePct: Number(p.card_fee_pct),
    taxPct: Number(p.tax_pct),
    defaultCommissionPct: Number(p.default_commission_pct),
    updatedAt: p.updated_at
  };
}

/* ------------------------------------------------------------ parametros */

router.get('/api/pricing/settings', async function (req, res) {
  try {
    const p = await lerParametros();
    const totalFixo = await somaCustosFixos();
    const horas = Number(p.monthly_working_hours);
    res.json(Object.assign(paraTela(p), {
      totalFixedMonthly: totalFixo,
      fixedCostHour: horas > 0 ? Math.round((totalFixo / horas) * 100) / 100 : null
    }));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao carregar os parametros de precificacao.' });
  }
});

router.put('/api/pricing/settings', async function (req, res) {
  const b = req.body || {};
  const campos = [
    ['monthly_working_hours', num(b.monthlyWorkingHours), 0.1, 744],
    ['target_margin_pct', num(b.targetMarginPct), 0, 99.99],
    ['card_fee_pct', num(b.cardFeePct), 0, 99.99],
    ['tax_pct', num(b.taxPct), 0, 99.99],
    ['default_commission_pct', num(b.defaultCommissionPct), 0, 99.99]
  ];
  const sets = [], valores = [];
  for (const [coluna, valor, minimo, maximo] of campos) {
    if (valor === null) continue;
    if (!isFinite(valor) || valor < minimo || valor > maximo) {
      return res.status(400).json({ error: 'Valor invalido para ' + coluna + '.' });
    }
    sets.push(coluna + ' = ?');
    valores.push(valor);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar.' });

  try {
    await lerParametros();
    valores.push('default');
    await pool.query('UPDATE pricing_settings SET ' + sets.join(', ') + ' WHERE id = ?', valores);
    await logSystemEvent('PRECIFICACAO', 'Parametros de precificacao atualizados.', autor(req));
    const p = await lerParametros();
    res.json(paraTela(p));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao salvar os parametros.' });
  }
});

/* ----------------------------------------------------------- custos fixos */

router.get('/api/fixed-costs', async function (req, res) {
  try {
    const [linhas] = await pool.query('SELECT * FROM fixed_costs ORDER BY active DESC, monthly_amount DESC');
    const total = await somaCustosFixos();
    const p = await lerParametros();
    const horas = Number(p.monthly_working_hours);
    res.json({
      itens: linhas.map(function (l) {
        return {
          id: l.id,
          name: l.name,
          monthlyAmount: Number(l.monthly_amount),
          category: l.category,
          active: !!l.active,
          createdAt: l.created_at
        };
      }),
      totalMensal: total,
      horasProdutivas: horas,
      custoPorHora: horas > 0 ? Math.round((total / horas) * 100) / 100 : null
    });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao listar os custos fixos.' });
  }
});

router.post('/api/fixed-costs', async function (req, res) {
  const b = req.body || {};
  const nome = String(b.name || '').trim();
  const valor = num(b.monthlyAmount);
  if (!nome) return res.status(400).json({ error: 'Informe o nome do custo.' });
  if (valor === null || !isFinite(valor) || valor < 0) {
    return res.status(400).json({ error: 'Informe um valor mensal valido.' });
  }
  try {
    const id = novoId('fc');
    await pool.query(
      'INSERT INTO fixed_costs (id, name, monthly_amount, category) VALUES (?, ?, ?, ?)',
      [id, nome, valor, b.category ? String(b.category).trim() : null]
    );
    await logSystemEvent('PRECIFICACAO', 'Custo fixo cadastrado: ' + nome + '.', autor(req));
    res.status(201).json({ id: id, name: nome, monthlyAmount: valor, category: b.category || null, active: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao cadastrar o custo fixo.' });
  }
});

router.patch('/api/fixed-costs/:id', async function (req, res) {
  const b = req.body || {};
  const sets = [], valores = [];
  if (b.name !== undefined) {
    const nome = String(b.name).trim();
    if (!nome) return res.status(400).json({ error: 'O nome nao pode ficar vazio.' });
    sets.push('name = ?'); valores.push(nome);
  }
  if (b.monthlyAmount !== undefined) {
    const valor = num(b.monthlyAmount);
    if (valor === null || !isFinite(valor) || valor < 0) {
      return res.status(400).json({ error: 'Informe um valor mensal valido.' });
    }
    sets.push('monthly_amount = ?'); valores.push(valor);
  }
  if (b.category !== undefined) { sets.push('category = ?'); valores.push(b.category ? String(b.category).trim() : null); }
  if (b.active !== undefined) { sets.push('active = ?'); valores.push(b.active ? 1 : 0); }
  if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar.' });

  try {
    const [r] = await pool.query('SELECT id FROM fixed_costs WHERE id = ?', [req.params.id]);
    if (!r.length) return res.status(404).json({ error: 'Custo fixo nao encontrado.' });
    valores.push(req.params.id);
    await pool.query('UPDATE fixed_costs SET ' + sets.join(', ') + ' WHERE id = ?', valores);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao atualizar o custo fixo.' });
  }
});

router.delete('/api/fixed-costs/:id', async function (req, res) {
  try {
    const [r] = await pool.query('SELECT name FROM fixed_costs WHERE id = ?', [req.params.id]);
    if (!r.length) return res.status(404).json({ error: 'Custo fixo nao encontrado.' });
    await pool.query('DELETE FROM fixed_costs WHERE id = ?', [req.params.id]);
    await logSystemEvent('PRECIFICACAO', 'Custo fixo removido: ' + r[0].name + '.', autor(req));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao remover o custo fixo.' });
  }
});

/* -------------------------------------------------------------- simulacao */

/** Calcula e NAO grava. A tela recalcula a cada tecla; gravar aqui encheria o
 *  historico de lixo. Quem grava e o /apply. */
router.post('/api/pricing/simulate', async function (req, res) {
  const b = req.body || {};
  try {
    const p = await lerParametros();
    const totalFixo = await somaCustosFixos();

    let precoAtual = num(b.currentPrice);
    let nome = String(b.serviceName || '').trim();

    if (b.catalogId) {
      const [c] = await pool.query('SELECT * FROM treatment_catalog WHERE id = ?', [b.catalogId]);
      if (!c.length) return res.status(404).json({ error: 'Servico nao encontrado no catalogo.' });
      if (precoAtual === null) precoAtual = Number(c[0].price);
      if (!nome) nome = c[0].name;
    }

    const entrada = {
      durationMin: num(b.durationMin),
      totalFixedMonthly: totalFixo,
      monthlyWorkingHours: Number(p.monthly_working_hours),
      variableCost: b.variableCost === undefined ? 0 : num(b.variableCost),
      marginPct: b.marginPct === undefined ? Number(p.target_margin_pct) : num(b.marginPct),
      commissionPct: b.commissionPct === undefined ? Number(p.default_commission_pct) : num(b.commissionPct),
      cardFeePct: b.cardFeePct === undefined ? Number(p.card_fee_pct) : num(b.cardFeePct),
      taxPct: b.taxPct === undefined ? Number(p.tax_pct) : num(b.taxPct)
    };

    const r = calcularPreco(entrada);
    if (r.erro) return res.status(400).json({ error: r.erro });

    res.json({
      entrada: entrada,
      serviceName: nome || 'Simulacao avulsa',
      resultado: r,
      comparacao: compararComPraticado(r.precoSugerido, precoAtual)
    });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao simular o preco.' });
  }
});

/** Grava a simulacao no historico. Opcionalmente aplica ao catalogo. */
router.post('/api/pricing/apply', async function (req, res) {
  const b = req.body || {};
  const aplicarNoCatalogo = b.aplicar !== false && !!b.catalogId;
  const conexao = await pool.getConnection();
  try {
    const [ps] = await conexao.query('SELECT * FROM pricing_settings WHERE id = ?', ['default']);
    const p = ps[0] || {};
    const [fs] = await conexao.query('SELECT COALESCE(SUM(monthly_amount), 0) AS total FROM fixed_costs WHERE active = 1');
    const totalFixo = Number(fs[0].total);

    let servico = null;
    if (b.catalogId) {
      const [c] = await conexao.query('SELECT * FROM treatment_catalog WHERE id = ?', [b.catalogId]);
      if (!c.length) return res.status(404).json({ error: 'Servico nao encontrado no catalogo.' });
      servico = c[0];
    }

    const entrada = {
      durationMin: num(b.durationMin),
      totalFixedMonthly: totalFixo,
      monthlyWorkingHours: Number(p.monthly_working_hours),
      variableCost: b.variableCost === undefined ? 0 : num(b.variableCost),
      marginPct: b.marginPct === undefined ? Number(p.target_margin_pct) : num(b.marginPct),
      commissionPct: b.commissionPct === undefined ? Number(p.default_commission_pct) : num(b.commissionPct),
      cardFeePct: b.cardFeePct === undefined ? Number(p.card_fee_pct) : num(b.cardFeePct),
      taxPct: b.taxPct === undefined ? Number(p.tax_pct) : num(b.taxPct)
    };

    // Recalcula no servidor. Nunca confie no numero que a tela mandou: e o
    // mesmo motivo de nunca decidir permissao pelo cliente.
    const r = calcularPreco(entrada);
    if (r.erro) return res.status(400).json({ error: r.erro });

    const nome = String(b.serviceName || (servico && servico.name) || '').trim() || 'Simulacao avulsa';
    const precoAntes = servico ? Number(servico.price) : num(b.currentPrice);

    await conexao.beginTransaction();

    const id = novoId('sim');
    await conexao.query(
      `INSERT INTO pricing_simulations
        (id, catalog_id, service_name, duration_min, fixed_cost_hour, fixed_cost_service, variable_cost,
         margin_pct, commission_pct, card_fee_pct, tax_pct, suggested_price, hourly_value, net_profit,
         price_before, applied, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, b.catalogId || null, nome, entrada.durationMin, r.custoFixoHora, r.custoFixoServico,
       entrada.variableCost, entrada.marginPct, entrada.commissionPct, entrada.cardFeePct,
       entrada.taxPct, r.precoSugerido, r.valorHora, r.lucroLiquido,
       precoAntes, aplicarNoCatalogo ? 1 : 0, (req.usuario && req.usuario.sub) || null]
    );

    if (aplicarNoCatalogo) {
      await conexao.query(
        `UPDATE treatment_catalog
            SET price = ?, suggested_price = ?, variable_cost = ?, commission_pct = ?,
                duration_min = ?, price_updated_at = NOW()
          WHERE id = ?`,
        [r.precoSugerido, r.precoSugerido, entrada.variableCost, entrada.commissionPct,
         entrada.durationMin, b.catalogId]
      );
    }

    await conexao.commit();

    if (aplicarNoCatalogo) {
      await logSystemEvent(
        'PRECIFICACAO',
        'Preco de "' + nome + '" alterado de R$ ' + Number(precoAntes || 0).toFixed(2) +
          ' para R$ ' + r.precoSugerido.toFixed(2) + '.',
        autor(req)
      );
    }

    res.status(201).json({ id: id, aplicado: aplicarNoCatalogo, resultado: r, precoAnterior: precoAntes });
  } catch (e) {
    try { await conexao.rollback(); } catch (e2) { /* ja fechada */ }
    res.status(500).json({ error: 'Falha ao aplicar o preco.' });
  } finally {
    conexao.release();
  }
});

router.get('/api/pricing/simulations', async function (req, res) {
  try {
    const params = [];
    let sql = 'SELECT * FROM pricing_simulations';
    if (req.query.catalogId) { sql += ' WHERE catalog_id = ?'; params.push(req.query.catalogId); }
    sql += ' ORDER BY created_at DESC LIMIT 100';
    const [linhas] = await pool.query(sql, params);
    res.json(linhas.map(function (l) {
      return {
        id: l.id,
        catalogId: l.catalog_id,
        serviceName: l.service_name,
        durationMin: l.duration_min,
        variableCost: Number(l.variable_cost),
        marginPct: Number(l.margin_pct),
        commissionPct: Number(l.commission_pct),
        cardFeePct: Number(l.card_fee_pct),
        taxPct: Number(l.tax_pct),
        suggestedPrice: Number(l.suggested_price),
        hourlyValue: Number(l.hourly_value),
        netProfit: Number(l.net_profit),
        priceBefore: l.price_before === null ? null : Number(l.price_before),
        applied: !!l.applied,
        createdAt: l.created_at
      };
    }));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao listar o historico de simulacoes.' });
  }
});

module.exports = router;

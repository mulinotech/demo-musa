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
 *
 *  ============================================= O QUE MUDOU NA M1.2 (09/09)
 *
 *  Toda consulta passou a `escopo(req)`. E `lerParametros` mudou de
 *  comportamento — leia a nota em cima dela, porque ali não bastava filtrar.
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');
const { calcularPreco, compararComPraticado } = require('../services/precificacao');
const est = require('../services/estoque');
const logs = require('../services/logs');
const custos = require('../services/custos-fixos');

const novoId = (p) => p + '_' + Math.random().toString(36).slice(2, 10);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Custo variavel do servico — T3.4.
 *
 *  Sai da ficha tecnica quando ela existe: soma de (quantidade x custo medio do
 *  insumo). Sem ficha, cai no valor digitado em `treatment_catalog`.
 *
 *  A ORIGEM VOLTA JUNTO E A TELA MOSTRA. Custo variavel de R$ 120 pode ser a
 *  soma real dos insumos de hoje ou um numero que alguem digitou ha um ano; os
 *  dois aparecem igual na conta e levam a decisoes muito diferentes. Sem dizer
 *  qual dos dois e, o sistema faz um chute antigo parecer calculo. */
async function custoVariavelDoServico(db, catalogId, custoDigitado) {
  if (!catalogId) return { valor: est.centavos(custoDigitado), origem: 'MANUAL', itens: 0 };
  try {
    // Duas tabelas, dois filtros: sem o `p.clinica_id`, a ficha tecnica leria o
    // custo do insumo da vizinha, e o preco do servico sairia calculado sobre o
    // custo de outro negocio.
    const [itens] = await db.q(`
      SELECT s.product_id, s.quantity, p.name, p.unit, p.unit_cost
        FROM service_supplies s
        JOIN products p ON p.id = s.product_id AND p.clinica_id = :clinica
       WHERE s.clinica_id = :clinica AND s.catalog_id = ? AND p.active = 1
    `, [catalogId]);
    return est.custoVariavelDaFicha(itens, custoDigitado);
  } catch (e) {
    // Estoque ainda nao migrado: a precificacao continua funcionando com o
    // valor digitado. Modulo novo nao pode derrubar modulo antigo.
    if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
    return { valor: est.centavos(custoDigitado), origem: 'MANUAL', itens: 0 };
  }
}

/** Os valores do DDL da migration 007. Existem aqui para a clínica sem linha
 *  própria ver a tela funcionando com números plausíveis, em vez de 500. */
const PADRAO = {
  monthly_working_hours: 160,
  target_margin_pct: 30,
  card_fee_pct: 3.5,
  tax_pct: 6,
  default_commission_pct: 0,
  updated_at: null,
  proprio: false
};

/** Os parâmetros de precificação DESTA clínica.
 *
 *  ========================= POR QUE AQUI NÃO BASTAVA ACRESCENTAR O FILTRO
 *
 *  A versão anterior lia `WHERE id = 'default'` e, se não achasse, **criava** a
 *  linha. As duas coisas param de funcionar com mais de uma clínica:
 *
 *  - a leitura sem filtro devolveria os parâmetros da clínica 1 para todas;
 *  - a criação não é possível: a chave primária de `pricing_settings` é `id`,
 *    então um segundo `'default'` é **recusado pelo banco**.
 *
 *  Então a leitura filtra clínica e, quando não há linha, devolve `PADRAO` com
 *  `proprio: false`. A clínica vê a tela e entende que ainda não configurou —
 *  em vez de ver, sem saber, a margem e a taxa de cartão de outro negócio.
 *
 *  Dar uma linha a cada clínica exige mudar a primária para composta: é a
 *  tarefa **M1.2b**, e até ela a gravação é recusada para quem não tem linha
 *  (ver o `PUT` abaixo). Recusar é pior para a clínica nova e melhor para todas:
 *  a alternativa era ela salvar e sobrescrever os parâmetros da clínica 1. */
async function lerParametros(db) {
  const [r] = await db.q(
    "SELECT * FROM pricing_settings WHERE clinica_id = :clinica AND id = 'default'");
  if (r.length) return Object.assign({}, r[0], { proprio: true });
  return PADRAO;
}

/** A soma que vira CUSTO POR HORA -- e que por isso entra em todo preço.
 *
 *  Só `natureza = 'FIXO'` (M6.3). O que é recorrente POR ATENDIMENTO já entra
 *  no preço pela ficha técnica e pelos percentuais da calculadora; somá-lo aqui
 *  o contaria duas vezes, e o preço sairia alto sem nada na tela acusar.
 *
 *  A regra de qual natureza soma vive em `services/custos-fixos.js`, com teste.
 *  O filtro é escrito no SQL, e não em JavaScript depois de ler tudo, porque
 *  esta função é chamada por três rotas e uma delas devolve só o total. */
async function somaCustosFixos(db) {
  const [r] = await db.q('SELECT COALESCE(SUM(monthly_amount), 0) AS total FROM fixed_costs ' +
    "WHERE clinica_id = :clinica AND active = 1 AND natureza = 'FIXO'");
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
  const db = escopo(req);
  try {
    const p = await lerParametros(db);
    const totalFixo = await somaCustosFixos(db);
    const horas = Number(p.monthly_working_hours);
    res.json(Object.assign(paraTela(p), {
      totalFixedMonthly: totalFixo,
      fixedCostHour: horas > 0 ? Math.round((totalFixo / horas) * 100) / 100 : null,
      // `false` = esta clinica ainda nao tem parametros proprios, e o que ela
      // esta vendo e o padrao do sistema. Ver M1.2b.
      parametrosProprios: p.proprio !== false
    }));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao carregar os parametros de precificacao.' });
  }
});

router.put('/api/pricing/settings', async function (req, res) {
  const db = escopo(req);
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
    const atual = await lerParametros(db);
    if (atual.proprio === false) {
      // Sem linha propria, o UPDATE filtrado nao acha nada e nao grava -- e a
      // tela diria "salvo" sem ter salvado. Recusar alto e dizer por que.
      return res.status(409).json({
        error: 'Esta clinica ainda nao tem parametros proprios de precificacao. ' +
               'Fale com o administrador da plataforma.'
      });
    }
    await db.q('UPDATE pricing_settings SET ' + sets.join(', ') +
      " WHERE clinica_id = :clinica AND id = 'default'", valores);
    await logs.registrar(db, 'PRECIFICACAO', 'Parametros de precificacao atualizados.');
    const p = await lerParametros(db);
    res.json(paraTela(p));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao salvar os parametros.' });
  }
});

/* ----------------------------------------------------------- custos fixos */

router.get('/api/fixed-costs', async function (req, res) {
  const db = escopo(req);
  try {
    const [linhas] = await db.q('SELECT * FROM fixed_costs WHERE clinica_id = :clinica ' +
      'ORDER BY active DESC, monthly_amount DESC');
    const separado = custos.separar(linhas.map((l) => ({
      monthlyAmount: Number(l.monthly_amount), active: !!l.active, natureza: l.natureza })));
    const total = await somaCustosFixos(db);
    const p = await lerParametros(db);
    const horas = Number(p.monthly_working_hours);
    res.json({
      itens: linhas.map(function (l) {
        return {
          id: l.id,
          name: l.name,
          monthlyAmount: Number(l.monthly_amount),
          category: l.category,
          natureza: custos.natureza(l.natureza),
          active: !!l.active,
          createdAt: l.created_at
        };
      }),
      totalMensal: total,
      /* O OUTRO TOTAL VAI JUNTO, e não some da tela (M6.3): quem lançou aqueles
         custos precisa continuar vendo que eles existem e quanto somam -- o que
         muda é que eles não dividem mais pelas horas. Esconder o número faria
         parecer que a reclassificação apagou o custo. */
      totalRecorrente: separado.totalVariavel,
      horasProdutivas: horas,
      custoPorHora: custos.custoPorHora(total, horas),
      naturezas: custos.NATUREZAS
    });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao listar os custos fixos.' });
  }
});

router.post('/api/fixed-costs', async function (req, res) {
  const db = escopo(req);
  const b = req.body || {};
  const nome = String(b.name || '').trim();
  const valor = num(b.monthlyAmount);
  if (!nome) return res.status(400).json({ error: 'Informe o nome do custo.' });
  if (valor === null || !isFinite(valor) || valor < 0) {
    return res.status(400).json({ error: 'Informe um valor mensal valido.' });
  }
  try {
    const id = novoId('fc');
    const nat = custos.natureza(b.natureza);
    await db.q(
      'INSERT INTO fixed_costs (id, name, monthly_amount, category, natureza, clinica_id)' +
      ' VALUES (?, ?, ?, ?, ?, :clinica)',
      [id, nome, valor, b.category ? String(b.category).trim() : null, nat]
    );
    await logs.registrar(db, 'PRECIFICACAO', 'Custo cadastrado: ' + nome +
      (nat === 'FIXO' ? ' (fixo -- entra no custo por hora).'
        : ' (recorrente por atendimento -- NAO entra no custo por hora).'));
    res.status(201).json({ id: id, name: nome, monthlyAmount: valor,
      category: b.category || null, natureza: nat, active: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao cadastrar o custo fixo.' });
  }
});

router.patch('/api/fixed-costs/:id', async function (req, res) {
  const db = escopo(req);
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
  /* RECLASSIFICAR muda o custo por hora da clínica, e portanto muda todo preço
     calculado daqui para a frente. Por isso vai para a trilha (abaixo) com o
     nome do custo: seis meses depois, "por que o preço subiu?" tem resposta. */
  if (b.natureza !== undefined) { sets.push('natureza = ?'); valores.push(custos.natureza(b.natureza)); }
  if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar.' });

  try {
    const [r] = await db.q(
      'SELECT id, name, natureza FROM fixed_costs WHERE clinica_id = :clinica AND id = ?',
      [req.params.id]);
    if (!r.length) return res.status(404).json({ error: 'Custo fixo nao encontrado.' });
    valores.push(req.params.id);
    await db.q('UPDATE fixed_costs SET ' + sets.join(', ') +
      ' WHERE clinica_id = :clinica AND id = ?', valores);
    if (b.natureza !== undefined && custos.natureza(b.natureza) !== custos.natureza(r[0].natureza)) {
      await logs.registrar(db, 'PRECIFICACAO', 'Custo "' + r[0].name + '" passou a ser ' +
        (custos.natureza(b.natureza) === 'FIXO'
          ? 'FIXO: volta a entrar no custo por hora.'
          : 'RECORRENTE por atendimento: sai do custo por hora.'));
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao atualizar o custo fixo.' });
  }
});

router.delete('/api/fixed-costs/:id', async function (req, res) {
  const db = escopo(req);
  try {
    const [r] = await db.q(
      'SELECT name FROM fixed_costs WHERE clinica_id = :clinica AND id = ?', [req.params.id]);
    if (!r.length) return res.status(404).json({ error: 'Custo fixo nao encontrado.' });
    await db.q('DELETE FROM fixed_costs WHERE clinica_id = :clinica AND id = ?', [req.params.id]);
    await logs.registrar(db, 'PRECIFICACAO', 'Custo fixo removido: ' + r[0].name + '.');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao remover o custo fixo.' });
  }
});

/* -------------------------------------------------------------- simulacao */

/** Calcula e NAO grava. A tela recalcula a cada tecla; gravar aqui encheria o
 *  historico de lixo. Quem grava e o /apply. */
router.post('/api/pricing/simulate', async function (req, res) {
  const db = escopo(req);
  const b = req.body || {};
  try {
    const p = await lerParametros(db);
    const totalFixo = await somaCustosFixos(db);

    let precoAtual = num(b.currentPrice);
    let nome = String(b.serviceName || '').trim();
    let custo = { valor: 0, origem: 'MANUAL', itens: 0 };

    if (b.catalogId) {
      const [c] = await db.q(
        'SELECT * FROM treatment_catalog WHERE clinica_id = :clinica AND id = ?', [b.catalogId]);
      if (!c.length) return res.status(404).json({ error: 'Servico nao encontrado no catalogo.' });
      if (precoAtual === null) precoAtual = Number(c[0].price);
      if (!nome) nome = c[0].name;
      custo = await custoVariavelDoServico(db, b.catalogId, c[0].variable_cost);
    }

    // Se a pessoa digitou um custo na tela, o que ela digitou vale — mas a
    // resposta continua dizendo o que a ficha tecnica diria, para a diferenca
    // ficar visivel em vez de silenciosa.
    const informado = b.variableCost !== undefined;
    const entrada = {
      durationMin: num(b.durationMin),
      totalFixedMonthly: totalFixo,
      monthlyWorkingHours: Number(p.monthly_working_hours),
      variableCost: informado ? num(b.variableCost) : custo.valor,
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
      comparacao: compararComPraticado(r.precoSugerido, precoAtual),
      custoVariavel: {
        origem: informado ? 'INFORMADO_NA_TELA' : custo.origem,
        daFicha: custo.origem === 'FICHA_TECNICA' ? custo.valor : null,
        itensDaFicha: custo.itens || 0,
        detalhe: custo.detalhe || null
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao simular o preco.' });
  }
});

/** Grava a simulacao no historico. Opcionalmente aplica ao catalogo. */
router.post('/api/pricing/apply', async function (req, res) {
  const db = escopo(req);
  const b = req.body || {};
  const aplicarNoCatalogo = b.aplicar !== false && !!b.catalogId;
  try {
    const p = await lerParametros(db);
    const totalFixo = await somaCustosFixos(db);

    let servico = null;
    if (b.catalogId) {
      const [c] = await db.q(
        'SELECT * FROM treatment_catalog WHERE clinica_id = :clinica AND id = ?', [b.catalogId]);
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

    const id = novoId('sim');
    await db.transacao(async function (tx) {
      await tx.q(
        `INSERT INTO pricing_simulations
          (id, catalog_id, service_name, duration_min, fixed_cost_hour, fixed_cost_service, variable_cost,
           margin_pct, commission_pct, card_fee_pct, tax_pct, suggested_price, hourly_value, net_profit,
           price_before, applied, created_by, clinica_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, :clinica)`,
        [id, b.catalogId || null, nome, entrada.durationMin, r.custoFixoHora, r.custoFixoServico,
         entrada.variableCost, entrada.marginPct, entrada.commissionPct, entrada.cardFeePct,
         entrada.taxPct, r.precoSugerido, r.valorHora, r.lucroLiquido,
         precoAntes, aplicarNoCatalogo ? 1 : 0, (req.usuario && req.usuario.sub) || null]
      );

      if (aplicarNoCatalogo) {
        // Sem o filtro, um id de catalogo adivinhado muda o PRECO do servico da
        // vizinha. Nao e leitura de dado alheio: e alteracao de dado alheio, e
        // ela apareceria na tela dela como se a propria clinica tivesse mexido.
        await tx.q(
          `UPDATE treatment_catalog
              SET price = ?, suggested_price = ?, variable_cost = ?, commission_pct = ?,
                  duration_min = ?, price_updated_at = NOW()
            WHERE clinica_id = :clinica AND id = ?`,
          [r.precoSugerido, r.precoSugerido, entrada.variableCost, entrada.commissionPct,
           entrada.durationMin, b.catalogId]
        );
      }
    });

    if (aplicarNoCatalogo) {
      await logs.registrar(db, 
        'PRECIFICACAO',
        'Preco de "' + nome + '" alterado de R$ ' + Number(precoAntes || 0).toFixed(2) +
          ' para R$ ' + r.precoSugerido.toFixed(2) + '.');
    }

    res.status(201).json({ id: id, aplicado: aplicarNoCatalogo, resultado: r, precoAnterior: precoAntes });
  } catch (e) {
    console.error('[precificacao]', e && e.message);
    res.status(500).json({ error: 'Falha ao aplicar o preco.' });
  }
});

router.get('/api/pricing/simulations', async function (req, res) {
  const db = escopo(req);
  try {
    const params = [];
    let sql = 'SELECT * FROM pricing_simulations WHERE clinica_id = :clinica';
    if (req.query.catalogId) { sql += ' AND catalog_id = ?'; params.push(req.query.catalogId); }
    sql += ' ORDER BY created_at DESC LIMIT 100';
    const [linhas] = await db.q(sql, params);
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

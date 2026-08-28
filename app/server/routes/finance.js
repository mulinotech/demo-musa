'use strict';
/** Financeiro — Fase 2, T2.4 e T2.6.
 *
 *  A rota busca linhas e entrega; a conta vive em services/financeiro.js, que é
 *  puro e testado. Se aparecer aritmética de resultado aqui dentro, está no
 *  lugar errado.
 *
 *  Restrito a admin e gerente pela linha de /api/finance em REGRAS_DE_PAPEL.
 *  Profissional não enxerga o financeiro da clínica.
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const fin = require('../services/financeiro');
const { logSystemEvent } = require('../services/logs');

const novoId = (p) => p + '_' + Math.random().toString(36).slice(2, 10);
const autor = (req) => (req.usuario && req.usuario.nome) || 'Sistema';
const TIPOS = ['RECEITA', 'DESPESA'];
const PAGAMENTOS = ['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO', 'TRANSFERENCIA', 'OUTRO'];

function valorValido(v) {
  const n = Number(v);
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function dataValida(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Período imediatamente anterior, do mesmo tamanho. É o que dá sentido ao
 *  comparativo: 30 dias contra 30 dias, não contra "mês passado" solto. */
function periodoAnterior(de, ate) {
  const ms = 86400000;
  const dias = Math.round((new Date(ate + 'T12:00:00') - new Date(de + 'T12:00:00')) / ms) + 1;
  return { de: fin.somarDias(de, -dias), ate: fin.somarDias(de, -1) };
}

/** Um mês corrente como padrão, para a tela abrir mostrando alguma coisa. */
function periodoPadrao(query) {
  const hoje = fin.dia(new Date());
  const de = dataValida(query.from) || hoje.slice(0, 8) + '01';
  const ate = dataValida(query.to) || hoje;
  return { de, ate };
}

async function lerRazao() {
  const [linhas] = await pool.query(`
    SELECT e.*, c.name AS category_name
      FROM cash_entries e
      LEFT JOIN finance_categories c ON c.id = e.category_id
     ORDER BY e.entry_date DESC, e.created_at DESC
  `);
  return linhas;
}

function paraTela(l) {
  return {
    id: l.id,
    type: l.type,
    categoryId: l.category_id,
    categoria: l.category_name || null,
    description: l.description,
    amount: Number(l.amount),
    entryDate: fin.dia(l.entry_date),
    dueDate: fin.dia(l.due_date),
    paidAt: fin.dia(l.paid_at),
    paymentMethod: l.payment_method,
    source: l.source,
    sourceId: l.source_id,
    supplier: l.supplier,
    notes: l.notes,
    createdAt: l.created_at
  };
}

/* ------------------------------------------------------------- categorias */

router.get('/api/finance/categories', async function (req, res) {
  try {
    const [r] = await pool.query('SELECT * FROM finance_categories WHERE active = 1 ORDER BY type, name');
    res.json(r.map((c) => ({ id: c.id, name: c.name, type: c.type })));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao listar as categorias.' });
  }
});

router.post('/api/finance/categories', async function (req, res) {
  const b = req.body || {};
  const nome = String(b.name || '').trim();
  if (!nome) return res.status(400).json({ error: 'Informe o nome da categoria.' });
  if (TIPOS.indexOf(b.type) === -1) return res.status(400).json({ error: 'Tipo precisa ser RECEITA ou DESPESA.' });
  try {
    const id = novoId('cat');
    await pool.query('INSERT INTO finance_categories (id, name, type) VALUES (?, ?, ?)', [id, nome, b.type]);
    res.status(201).json({ id, name: nome, type: b.type });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao criar a categoria.' });
  }
});

router.patch('/api/finance/categories/:id', async function (req, res) {
  const b = req.body || {};
  const sets = [], valores = [];
  if (b.name !== undefined) {
    const nome = String(b.name).trim();
    if (!nome) return res.status(400).json({ error: 'O nome nao pode ficar vazio.' });
    sets.push('name = ?'); valores.push(nome);
  }
  if (b.active !== undefined) { sets.push('active = ?'); valores.push(b.active ? 1 : 0); }
  if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar.' });
  try {
    valores.push(req.params.id);
    await pool.query('UPDATE finance_categories SET ' + sets.join(', ') + ' WHERE id = ?', valores);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao atualizar a categoria.' });
  }
});

/* ------------------------------------------------------------ lancamentos */

router.get('/api/finance/entries', async function (req, res) {
  try {
    const { de, ate } = periodoPadrao(req.query);
    const base = req.query.basis === 'caixa' ? 'caixa' : 'competencia';
    let linhas = await lerRazao();

    linhas = linhas.filter(function (l) {
      const d = base === 'caixa' ? fin.dia(l.paid_at) : fin.dia(l.entry_date);
      if (!d || d < de || d > ate) return false;
      if (req.query.type && l.type !== req.query.type) return false;
      if (req.query.categoryId && l.category_id !== req.query.categoryId) return false;
      if (req.query.status === 'aberto' && fin.dia(l.paid_at)) return false;
      if (req.query.status === 'pago' && !fin.dia(l.paid_at)) return false;
      return true;
    });

    res.json({ periodo: { de, ate, base }, itens: linhas.map(paraTela) });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao listar os lancamentos.' });
  }
});

router.post('/api/finance/entries', async function (req, res) {
  const b = req.body || {};
  if (TIPOS.indexOf(b.type) === -1) return res.status(400).json({ error: 'Tipo precisa ser RECEITA ou DESPESA.' });
  const descricao = String(b.description || '').trim();
  if (!descricao) return res.status(400).json({ error: 'Informe a descricao do lancamento.' });

  const valor = valorValido(b.amount);
  if (valor === null) {
    return res.status(400).json({ error: 'O valor precisa ser maior que zero. Despesa tambem entra positiva: o sinal vem do tipo.' });
  }
  const competencia = dataValida(b.entryDate) || fin.dia(new Date());
  const vencimento = dataValida(b.dueDate);
  const pago = dataValida(b.paidAt);
  if (b.paymentMethod && PAGAMENTOS.indexOf(b.paymentMethod) === -1) {
    return res.status(400).json({ error: 'Forma de pagamento invalida.' });
  }

  try {
    const id = novoId('ce');
    await pool.query(
      `INSERT INTO cash_entries
        (id, type, category_id, description, amount, entry_date, due_date, paid_at, payment_method,
         source, source_id, supplier, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,'MANUAL',NULL,?,?,?)`,
      [id, b.type, b.categoryId || null, descricao, valor, competencia, vencimento, pago,
       b.paymentMethod || null, b.supplier || null, b.notes || null, (req.usuario && req.usuario.sub) || null]
    );
    await logSystemEvent('FINANCEIRO',
      b.type + ' lancada: ' + descricao + ' - R$ ' + valor.toFixed(2) + '.', autor(req));
    res.status(201).json({ id });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao gravar o lancamento.' });
  }
});

router.patch('/api/finance/entries/:id', async function (req, res) {
  const b = req.body || {};
  const sets = [], valores = [];
  if (b.description !== undefined) {
    const d = String(b.description).trim();
    if (!d) return res.status(400).json({ error: 'A descricao nao pode ficar vazia.' });
    sets.push('description = ?'); valores.push(d);
  }
  if (b.amount !== undefined) {
    const v = valorValido(b.amount);
    if (v === null) return res.status(400).json({ error: 'O valor precisa ser maior que zero.' });
    sets.push('amount = ?'); valores.push(v);
  }
  if (b.categoryId !== undefined) { sets.push('category_id = ?'); valores.push(b.categoryId || null); }
  if (b.entryDate !== undefined) {
    const d = dataValida(b.entryDate);
    if (!d) return res.status(400).json({ error: 'Data de competencia invalida.' });
    sets.push('entry_date = ?'); valores.push(d);
  }
  if (b.dueDate !== undefined) { sets.push('due_date = ?'); valores.push(dataValida(b.dueDate)); }
  if (b.supplier !== undefined) { sets.push('supplier = ?'); valores.push(b.supplier || null); }
  if (b.notes !== undefined) { sets.push('notes = ?'); valores.push(b.notes || null); }
  if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar.' });

  try {
    const [r] = await pool.query('SELECT source FROM cash_entries WHERE id = ?', [req.params.id]);
    if (!r.length) return res.status(404).json({ error: 'Lancamento nao encontrado.' });
    if (r[0].source !== 'MANUAL') {
      return res.status(409).json({ error: 'Este lancamento veio de um atendimento e nao pode ser editado a mao. Estorne o atendimento.' });
    }
    valores.push(req.params.id);
    await pool.query('UPDATE cash_entries SET ' + sets.join(', ') + ' WHERE id = ?', valores);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao atualizar o lancamento.' });
  }
});

/** Marcar como pago e desmarcar. É a coluna `paid_at` que separa caixa de
 *  competência — por isso tem rota própria, e não um PATCH genérico. */
router.patch('/api/finance/entries/:id/pay', async function (req, res) {
  const b = req.body || {};
  const pago = b.paidAt === null ? null : (dataValida(b.paidAt) || fin.dia(new Date()));
  if (b.paymentMethod && PAGAMENTOS.indexOf(b.paymentMethod) === -1) {
    return res.status(400).json({ error: 'Forma de pagamento invalida.' });
  }
  try {
    const [r] = await pool.query('SELECT description, amount FROM cash_entries WHERE id = ?', [req.params.id]);
    if (!r.length) return res.status(404).json({ error: 'Lancamento nao encontrado.' });
    await pool.query('UPDATE cash_entries SET paid_at = ?, payment_method = ? WHERE id = ?',
      [pago, b.paymentMethod || null, req.params.id]);
    await logSystemEvent('FINANCEIRO',
      (pago ? 'Baixa registrada' : 'Baixa desfeita') + ': ' + r[0].description + '.', autor(req));
    res.json({ ok: true, paidAt: pago });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao registrar a baixa.' });
  }
});

router.delete('/api/finance/entries/:id', async function (req, res) {
  try {
    const [r] = await pool.query('SELECT description, source FROM cash_entries WHERE id = ?', [req.params.id]);
    if (!r.length) return res.status(404).json({ error: 'Lancamento nao encontrado.' });
    if (r[0].source !== 'MANUAL') {
      return res.status(409).json({ error: 'Lancamento vindo de atendimento nao se apaga: estorne o atendimento.' });
    }
    await pool.query('DELETE FROM cash_entries WHERE id = ?', [req.params.id]);
    await logSystemEvent('FINANCEIRO', 'Lancamento removido: ' + r[0].description + '.', autor(req));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao remover o lancamento.' });
  }
});

/* ------------------------------------------------------------- relatorios */

router.get('/api/finance/summary', async function (req, res) {
  try {
    const { de, ate } = periodoPadrao(req.query);
    const base = req.query.basis === 'caixa' ? 'caixa' : 'competencia';
    const linhas = await lerRazao();

    const atual = fin.resumo(linhas, { de, ate, base });
    const anterior = periodoAnterior(de, ate);
    const passado = fin.resumo(linhas, { de: anterior.de, ate: anterior.ate, base });

    res.json(Object.assign(atual, {
      comparativoPeriodoAnterior: fin.comparativo(atual, passado),
      periodoAnterior: anterior
    }));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao montar o resultado do periodo.' });
  }
});

router.get('/api/finance/cashflow', async function (req, res) {
  try {
    const { de, ate } = periodoPadrao(req.query);
    const base = req.query.basis === 'competencia' ? 'competencia' : 'caixa';
    const agruparPor = req.query.groupBy === 'month' ? 'month' : 'day';
    const linhas = await lerRazao();
    res.json({ periodo: { de, ate, base, agruparPor }, serie: fin.fluxo(linhas, { de, ate, base, agruparPor }) });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao montar o fluxo de caixa.' });
  }
});

/* ---------------------------------------------------------- recorrencias */

router.get('/api/recurring-expenses', async function (req, res) {
  try {
    const [r] = await pool.query(`
      SELECT e.*, c.name AS category_name
        FROM recurring_expenses e
        LEFT JOIN finance_categories c ON c.id = e.category_id
       ORDER BY e.active DESC, e.day_of_month
    `);
    res.json(r.map((l) => ({
      id: l.id, description: l.description, amount: Number(l.amount),
      dayOfMonth: l.day_of_month, categoryId: l.category_id, categoria: l.category_name,
      startDate: fin.dia(l.start_date), endDate: fin.dia(l.end_date), active: !!l.active
    })));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao listar as despesas recorrentes.' });
  }
});

router.post('/api/recurring-expenses', async function (req, res) {
  const b = req.body || {};
  const descricao = String(b.description || '').trim();
  const valor = valorValido(b.amount);
  const dia = Number(b.dayOfMonth);
  if (!descricao) return res.status(400).json({ error: 'Informe a descricao.' });
  if (valor === null) return res.status(400).json({ error: 'O valor precisa ser maior que zero.' });
  if (!isFinite(dia) || dia < 1 || dia > 31) return res.status(400).json({ error: 'O dia do mes precisa ficar entre 1 e 31.' });
  try {
    const id = novoId('rec');
    await pool.query(
      'INSERT INTO recurring_expenses (id, category_id, description, amount, day_of_month, start_date, end_date) VALUES (?,?,?,?,?,?,?)',
      [id, b.categoryId || null, descricao, valor, dia, dataValida(b.startDate) || fin.dia(new Date()), dataValida(b.endDate)]
    );
    res.status(201).json({ id });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao criar a despesa recorrente.' });
  }
});

router.patch('/api/recurring-expenses/:id', async function (req, res) {
  const b = req.body || {};
  const sets = [], valores = [];
  if (b.description !== undefined) { sets.push('description = ?'); valores.push(String(b.description).trim()); }
  if (b.amount !== undefined) {
    const v = valorValido(b.amount);
    if (v === null) return res.status(400).json({ error: 'O valor precisa ser maior que zero.' });
    sets.push('amount = ?'); valores.push(v);
  }
  if (b.dayOfMonth !== undefined) {
    const d = Number(b.dayOfMonth);
    if (!isFinite(d) || d < 1 || d > 31) return res.status(400).json({ error: 'O dia do mes precisa ficar entre 1 e 31.' });
    sets.push('day_of_month = ?'); valores.push(d);
  }
  if (b.categoryId !== undefined) { sets.push('category_id = ?'); valores.push(b.categoryId || null); }
  if (b.endDate !== undefined) { sets.push('end_date = ?'); valores.push(dataValida(b.endDate)); }
  if (b.active !== undefined) { sets.push('active = ?'); valores.push(b.active ? 1 : 0); }
  if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar.' });
  try {
    valores.push(req.params.id);
    await pool.query('UPDATE recurring_expenses SET ' + sets.join(', ') + ' WHERE id = ?', valores);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao atualizar a despesa recorrente.' });
  }
});

/** Gera os lançamentos das recorrências.
 *
 *  Enquanto não existe o worker diário (entra junto com o `node-cron` da
 *  agenda, T1.5), esta rota é o gatilho manual. A idempotência é a mesma que o
 *  worker vai usar: source RECURRING + '<id>:<AAAA-MM>' na chave única, então
 *  rodar dez vezes no mesmo mês cria um lançamento só.
 *
 *  O PADRÃO É SÓ O MÊS CORRENTE, de propósito. Uma recorrência cadastrada com
 *  data de início retroativa geraria, num único clique, meses inteiros de conta
 *  em aberto e vencida — o painel abre acusando uma dívida que nunca existiu.
 *  Foi o que aconteceu na primeira vez que isto rodou. Para preencher o
 *  passado, mande `de` explicitamente e vá marcar as baixas depois. */
router.post('/api/finance/recurring/run', async function (req, res) {
  try {
    const b = req.body || {};
    const [recorrencias] = await pool.query('SELECT * FROM recurring_expenses WHERE active = 1');
    let criados = 0, jaExistiam = 0;
    let janela = null;

    for (const r of recorrencias) {
      janela = fin.janelaDeGeracao({ de: b.de, ate: b.ate, inicioRecorrencia: r.start_date });
      const datas = fin.ocorrencias(r, janela.de, janela.ate);
      for (const data of datas) {
        const chave = fin.chaveRecorrencia(r.id, data);
        try {
          await pool.query(
            `INSERT INTO cash_entries
              (id, type, category_id, description, amount, entry_date, due_date, paid_at, source, source_id)
             VALUES (?, 'DESPESA', ?, ?, ?, ?, ?, NULL, 'RECURRING', ?)`,
            [novoId('ce'), r.category_id, r.description, r.amount, data, data, chave]
          );
          criados += 1;
        } catch (e) {
          if (e.code === 'ER_DUP_ENTRY') jaExistiam += 1;
          else throw e;
        }
      }
    }

    if (criados) await logSystemEvent('FINANCEIRO', criados + ' despesa(s) recorrente(s) lancada(s).', autor(req));
    res.json({ criados, jaExistiam, periodo: janela || fin.janelaDeGeracao({ de: b.de, ate: b.ate }) });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao gerar as despesas recorrentes.' });
  }
});

/* ------------------------------------------------- receita dos atendimentos */

/** Importa como receita as sessões já realizadas.
 *
 *  O plano previa que a receita nascesse do evento "atendimento realizado" da
 *  agenda (T2.5). A agenda ainda não existe, mas as sessões realizadas existem
 *  e são o atendimento de verdade de hoje — o relatório atual já soma
 *  `treatment_sessions` com status REALIZADA.
 *
 *  A chave de idempotência é a definitiva: source APPOINTMENT + id da origem.
 *  Quando a agenda chegar, ela pendura no mesmo formato e nada aqui é jogado
 *  fora nem duplicado. */
router.post('/api/finance/sync-atendimentos', async function (req, res) {
  try {
    const [sessoes] = await pool.query(`
      SELECT s.id, s.session_type, s.session_date, s.price, p.client_id, c.name AS client_name
        FROM treatment_sessions s
        LEFT JOIN treatment_plans p ON p.id = s.plan_id
        LEFT JOIN clients c ON c.id = p.client_id
       WHERE s.status = 'REALIZADA' AND s.price > 0 AND s.session_date IS NOT NULL
    `);

    let criados = 0, jaExistiam = 0;
    for (const s of sessoes) {
      const descricao = (s.session_type || 'Atendimento') + (s.client_name ? ' - ' + s.client_name : '');
      try {
        await pool.query(
          `INSERT INTO cash_entries
            (id, type, category_id, description, amount, entry_date, paid_at, source, source_id, client_id)
           VALUES (?, 'RECEITA', 'cat_procedimentos', ?, ?, ?, ?, 'APPOINTMENT', ?, ?)`,
          [novoId('ce'), descricao.slice(0, 255), s.price, fin.dia(s.session_date), fin.dia(s.session_date), s.id, s.client_id]
        );
        criados += 1;
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') jaExistiam += 1;
        else throw e;
      }
    }

    if (criados) await logSystemEvent('FINANCEIRO', criados + ' atendimento(s) importado(s) como receita.', autor(req));
    res.json({ criados, jaExistiam, sessoesRealizadas: sessoes.length });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao importar a receita dos atendimentos.' });
  }
});

module.exports = router;

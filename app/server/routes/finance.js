'use strict';
/** Financeiro — Fase 2, T2.4 e T2.6.
 *
 *  A rota busca linhas e entrega; a conta vive em services/financeiro.js, que é
 *  puro e testado. Se aparecer aritmética de resultado aqui dentro, está no
 *  lugar errado.
 *
 *  Restrito a admin e gerente pela linha de /api/finance em REGRAS_DE_PAPEL.
 *  Profissional não enxerga o financeiro da clínica.
 *
 *  ============================================= O QUE MUDOU NA M1.2 (09/09)
 *
 *  Toda consulta passou a `escopo(req)`. O caso que mais importa aqui é
 *  `lerRazao()`: ela lê o razão inteiro e as três rotas de relatório filtram
 *  período **em memória**, na função pura. Sem o filtro de clínica na consulta,
 *  cada uma dessas rotas somaria o dinheiro das 50.
 *
 *  UM ACHADO QUE O FILTRO NÃO RESOLVE, e está registrado na fila como M1.2b:
 *  as 16 categorias financeiras nascem da migration 008 com **id fixo**
 *  (`cat_procedimentos`, `cat_aluguel`, ...), uma linha cada no banco inteiro.
 *  Filtradas por clínica, a segunda clínica abre o financeiro com **zero
 *  categorias** e não consegue classificar uma despesa. Precisa de mudança de
 *  esquema, não de filtro.
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');
const fin = require('../services/financeiro');
const logs = require('../services/logs');

const novoId = (p) => p + '_' + Math.random().toString(36).slice(2, 10);
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

/** O razão da clínica, inteiro. As rotas de relatório filtram período depois,
 *  na função pura de `services/financeiro.js`.
 *
 *  O `LEFT JOIN` das categorias filtra clínica **no ON**, não no WHERE: no
 *  WHERE ele viraria INNER JOIN e todo lançamento sem categoria sumiria do
 *  razão — inclusive as receitas de atendimento, enquanto a M1.2b não resolver
 *  a categoria de id fixo. Lançamento que desaparece do razão é pior que
 *  lançamento sem categoria. */
async function lerRazao(db) {
  const [linhas] = await db.q(`
    SELECT e.*, c.name AS category_name
      FROM cash_entries e
      LEFT JOIN finance_categories c ON c.id = e.category_id AND c.clinica_id = :clinica
     WHERE e.clinica_id = :clinica
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

/** As categorias da clínica.
 *
 *  ==================================== POR QUE EXISTE `?incluirInativas=1` (M5.8b)
 *
 *  Por padrão esta rota devolve só as ATIVAS, e é o que as listas de lançamento
 *  precisam: ninguém quer classificar uma despesa de hoje numa categoria que a
 *  clínica aposentou.
 *
 *  A tela que ADMINISTRA categorias precisa do contrário. Categoria desativada
 *  continua existindo no razão de meses passados e **continua contando no CPL se
 *  estiver marcada como captação** — porque o dinheiro foi gasto, e apagar isso
 *  reescreveria o histórico. Se a tela não mostrasse as inativas, a clínica veria
 *  "2 marcadas como captação" com uma só na lista, e não teria como desmarcar a
 *  que sumiu. Marcação invisível é a mesma família de defeito da M5.8.
 */
router.get('/api/finance/categories', async function (req, res) {
  const db = escopo(req);
  const todas = String(req.query.incluirInativas || '') === '1';
  try {
    const [r] = await db.q('SELECT * FROM finance_categories ' +
      'WHERE clinica_id = :clinica' + (todas ? '' : ' AND active = 1') +
      ' ORDER BY type, name');
    // `contaNoCpl` (M5.8): a categoria e' investimento em captacao, e por isso
    // entra no Custo por Lead da Visao Geral. So faz sentido em DESPESA.
    res.json(r.map((c) => ({
      id: c.id, name: c.name, type: c.type,
      contaNoCpl: c.conta_no_cpl === 1, ativa: c.active === 1
    })));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao listar as categorias.' });
  }
});

router.post('/api/finance/categories', async function (req, res) {
  const b = req.body || {};
  const nome = String(b.name || '').trim().slice(0, 100);
  if (!nome) return res.status(400).json({ error: 'Informe o nome da categoria.' });
  if (TIPOS.indexOf(b.type) === -1) return res.status(400).json({ error: 'Tipo precisa ser RECEITA ou DESPESA.' });
  const db = escopo(req);
  try {
    /* NOME REPETIDO E' RECUSADO (M5.8b).
     *
     * Duas "Anuncios" na mesma clinica nao dao erro nenhum: dao um relatorio com
     * a mesma linha duas vezes, e um CPL que conta uma e esquece a outra porque
     * so uma foi marcada. A conferencia inclui as INATIVAS -- reaproveitar o
     * nome de uma categoria aposentada e' o caso em que a pessoa procura no
     * relatorio e acha duas historias diferentes com o mesmo rotulo. */
    const [iguais] = await db.q(
      'SELECT id, active FROM finance_categories' +
      ' WHERE clinica_id = :clinica AND type = ? AND LOWER(name) = LOWER(?)',
      [b.type, nome]);
    if (iguais.length) {
      return res.status(409).json({
        error: iguais[0].active === 1
          ? 'Ja existe uma categoria com esse nome.'
          : 'Ja existe uma categoria com esse nome, desativada. Reative-a em vez de criar outra.'
      });
    }
    const id = novoId('cat');
    await db.q('INSERT INTO finance_categories (id, name, type, clinica_id) VALUES (?, ?, ?, :clinica)',
      [id, nome, b.type]);
    await logs.registrar(db, 'FINANCE',
      'Categoria financeira criada: "' + nome + '" (' + b.type + ').');
    res.status(201).json({ id: id, name: nome, type: b.type, contaNoCpl: false, ativa: true });
  } catch (e) {
    console.error('[finance/categories]', e && e.message);
    res.status(500).json({ error: 'Falha ao criar a categoria.' });
  }
});

router.patch('/api/finance/categories/:id', async function (req, res) {
  const db = escopo(req);
  const b = req.body || {};
  const sets = [], valores = [];
  if (b.name !== undefined) {
    const nome = String(b.name).trim().slice(0, 100);
    if (!nome) return res.status(400).json({ error: 'O nome nao pode ficar vazio.' });
    sets.push('name = ?'); valores.push(nome);
  }
  /* DESATIVAR NAO APAGA, e nao mexe na marcacao de captacao (M5.8b).
   *
   * O lancamento de marco continua apontando para a categoria, e o relatorio de
   * marco continua com o nome dela. Desativar so a tira das listas de escolha
   * daqui para a frente -- e por isso `conta_no_cpl` fica como esta: o CPL de um
   * periodo passado nao pode mudar porque hoje alguem aposentou a categoria. */
  if (b.active !== undefined) { sets.push('active = ?'); valores.push(b.active ? 1 : 0); }
  // A marcacao de captacao (M5.8) so vale para DESPESA: marcar uma categoria de
  // RECEITA faria o CPL somar faturamento como se fosse gasto com anuncio. A
  // condicao vai no proprio UPDATE para nao depender de uma leitura antes.
  if (b.contaNoCpl !== undefined) {
    sets.push("conta_no_cpl = (CASE WHEN type = 'DESPESA' THEN ? ELSE 0 END)");
    valores.push(b.contaNoCpl ? 1 : 0);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar.' });
  try {
    valores.push(req.params.id);
    const [r] = await db.q('UPDATE finance_categories SET ' + sets.join(', ') +
      ' WHERE clinica_id = :clinica AND id = ?', valores);
    if (!r || r.affectedRows === 0) {
      return res.status(404).json({ error: 'Categoria nao encontrada.' });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao atualizar a categoria.' });
  }
});

/* ------------------------------------------------------------ lancamentos */

router.get('/api/finance/entries', async function (req, res) {
  const db = escopo(req);
  try {
    const { de, ate } = periodoPadrao(req.query);
    const base = req.query.basis === 'caixa' ? 'caixa' : 'competencia';
    let linhas = await lerRazao(db);

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
  const db = escopo(req);
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
    // A categoria vem do corpo da requisicao: um id de outra clinica
    // classificaria a despesa desta na categoria daquela. Aqui isso nao vaza
    // dado, mas suja o relatorio das duas -- e o filtro de leitura nao acusa.
    if (b.categoryId) {
      const [cat] = await db.q(
        'SELECT id FROM finance_categories WHERE clinica_id = :clinica AND id = ?', [b.categoryId]);
      if (!cat.length) return res.status(404).json({ error: 'Categoria nao encontrada.' });
    }

    const id = novoId('ce');
    await db.q(
      `INSERT INTO cash_entries
        (id, type, category_id, description, amount, entry_date, due_date, paid_at, payment_method,
         source, source_id, supplier, notes, created_by, clinica_id)
       VALUES (?,?,?,?,?,?,?,?,?,'MANUAL',NULL,?,?,?, :clinica)`,
      [id, b.type, b.categoryId || null, descricao, valor, competencia, vencimento, pago,
       b.paymentMethod || null, b.supplier || null, b.notes || null, (req.usuario && req.usuario.sub) || null]
    );
    await logs.registrar(db, 'FINANCEIRO',
      b.type + ' lancada: ' + descricao + ' - R$ ' + valor.toFixed(2) + '.');
    res.status(201).json({ id });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao gravar o lancamento.' });
  }
});

router.patch('/api/finance/entries/:id', async function (req, res) {
  const db = escopo(req);
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
    const [r] = await db.q(
      'SELECT source FROM cash_entries WHERE clinica_id = :clinica AND id = ?', [req.params.id]);
    if (!r.length) return res.status(404).json({ error: 'Lancamento nao encontrado.' });
    if (r[0].source !== 'MANUAL') {
      return res.status(409).json({ error: 'Este lancamento veio de um atendimento e nao pode ser editado a mao. Estorne o atendimento.' });
    }
    valores.push(req.params.id);
    await db.q('UPDATE cash_entries SET ' + sets.join(', ') +
      ' WHERE clinica_id = :clinica AND id = ?', valores);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao atualizar o lancamento.' });
  }
});

/** Marcar como pago e desmarcar. É a coluna `paid_at` que separa caixa de
 *  competência — por isso tem rota própria, e não um PATCH genérico. */
router.patch('/api/finance/entries/:id/pay', async function (req, res) {
  const db = escopo(req);
  const b = req.body || {};
  const pago = b.paidAt === null ? null : (dataValida(b.paidAt) || fin.dia(new Date()));
  if (b.paymentMethod && PAGAMENTOS.indexOf(b.paymentMethod) === -1) {
    return res.status(400).json({ error: 'Forma de pagamento invalida.' });
  }
  try {
    const [r] = await db.q(
      'SELECT description, amount FROM cash_entries WHERE clinica_id = :clinica AND id = ?',
      [req.params.id]);
    if (!r.length) return res.status(404).json({ error: 'Lancamento nao encontrado.' });
    await db.q('UPDATE cash_entries SET paid_at = ?, payment_method = ? ' +
      'WHERE clinica_id = :clinica AND id = ?',
      [pago, b.paymentMethod || null, req.params.id]);
    await logs.registrar(db, 'FINANCEIRO',
      (pago ? 'Baixa registrada' : 'Baixa desfeita') + ': ' + r[0].description + '.');
    res.json({ ok: true, paidAt: pago });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao registrar a baixa.' });
  }
});

router.delete('/api/finance/entries/:id', async function (req, res) {
  const db = escopo(req);
  try {
    const [r] = await db.q(
      'SELECT description, source FROM cash_entries WHERE clinica_id = :clinica AND id = ?',
      [req.params.id]);
    if (!r.length) return res.status(404).json({ error: 'Lancamento nao encontrado.' });
    if (r[0].source !== 'MANUAL') {
      return res.status(409).json({ error: 'Lancamento vindo de atendimento nao se apaga: estorne o atendimento.' });
    }
    await db.q('DELETE FROM cash_entries WHERE clinica_id = :clinica AND id = ?', [req.params.id]);
    await logs.registrar(db, 'FINANCEIRO', 'Lancamento removido: ' + r[0].description + '.');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao remover o lancamento.' });
  }
});

/* ------------------------------------------------------------- relatorios */

router.get('/api/finance/summary', async function (req, res) {
  const db = escopo(req);
  try {
    const { de, ate } = periodoPadrao(req.query);
    const base = req.query.basis === 'caixa' ? 'caixa' : 'competencia';
    const linhas = await lerRazao(db);

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
  const db = escopo(req);
  try {
    const { de, ate } = periodoPadrao(req.query);
    const base = req.query.basis === 'competencia' ? 'competencia' : 'caixa';
    const agruparPor = req.query.groupBy === 'month' ? 'month' : 'day';
    const linhas = await lerRazao(db);
    res.json({ periodo: { de, ate, base, agruparPor }, serie: fin.fluxo(linhas, { de, ate, base, agruparPor }) });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao montar o fluxo de caixa.' });
  }
});

/* ---------------------------------------------------------- recorrencias */

router.get('/api/recurring-expenses', async function (req, res) {
  const db = escopo(req);
  try {
    const [r] = await db.q(`
      SELECT e.*, c.name AS category_name
        FROM recurring_expenses e
        LEFT JOIN finance_categories c ON c.id = e.category_id AND c.clinica_id = :clinica
       WHERE e.clinica_id = :clinica
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
  const db = escopo(req);
  const b = req.body || {};
  const descricao = String(b.description || '').trim();
  const valor = valorValido(b.amount);
  const dia = Number(b.dayOfMonth);
  if (!descricao) return res.status(400).json({ error: 'Informe a descricao.' });
  if (valor === null) return res.status(400).json({ error: 'O valor precisa ser maior que zero.' });
  if (!isFinite(dia) || dia < 1 || dia > 31) return res.status(400).json({ error: 'O dia do mes precisa ficar entre 1 e 31.' });
  try {
    const id = novoId('rec');
    await db.q(
      'INSERT INTO recurring_expenses (id, category_id, description, amount, day_of_month, start_date, end_date, clinica_id) VALUES (?,?,?,?,?,?,?, :clinica)',
      [id, b.categoryId || null, descricao, valor, dia, dataValida(b.startDate) || fin.dia(new Date()), dataValida(b.endDate)]
    );
    res.status(201).json({ id });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao criar a despesa recorrente.' });
  }
});

router.patch('/api/recurring-expenses/:id', async function (req, res) {
  const db = escopo(req);
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
    const [r] = await db.q('UPDATE recurring_expenses SET ' + sets.join(', ') +
      ' WHERE clinica_id = :clinica AND id = ?', valores);
    if (!r || r.affectedRows === 0) {
      return res.status(404).json({ error: 'Despesa recorrente nao encontrada.' });
    }
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
  const db = escopo(req);
  try {
    const b = req.body || {};
    const [recorrencias] = await db.q(
      'SELECT * FROM recurring_expenses WHERE clinica_id = :clinica AND active = 1');
    let criados = 0, jaExistiam = 0;
    let janela = null;

    for (const r of recorrencias) {
      janela = fin.janelaDeGeracao({ de: b.de, ate: b.ate, inicioRecorrencia: r.start_date });
      const datas = fin.ocorrencias(r, janela.de, janela.ate);
      for (const data of datas) {
        const chave = fin.chaveRecorrencia(r.id, data);
        try {
          await db.q(
            `INSERT INTO cash_entries
              (id, type, category_id, description, amount, entry_date, due_date, paid_at, source, source_id, clinica_id)
             VALUES (?, 'DESPESA', ?, ?, ?, ?, ?, NULL, 'RECURRING', ?, :clinica)`,
            [novoId('ce'), r.category_id, r.description, r.amount, data, data, chave]
          );
          criados += 1;
        } catch (e) {
          if (e.code === 'ER_DUP_ENTRY') jaExistiam += 1;
          else throw e;
        }
      }
    }

    if (criados) await logs.registrar(db, 'FINANCEIRO', criados + ' despesa(s) recorrente(s) lancada(s).');
    res.json({ criados, jaExistiam, periodo: janela || fin.janelaDeGeracao({ de: b.de, ate: b.ate }) });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao gerar as despesas recorrentes.' });
  }
});

/* ------------------------------------------------- receita dos atendimentos */

/** Importa como receita as sessões já realizadas.
 *
 *  Daqui para a frente a receita nasce sozinha, no serviço de conclusão de
 *  atendimento (contexto 02). Esta rota é o BACKFILL: importa o que já estava
 *  realizado antes de o evento existir. Rodar de novo não duplica nada — a
 *  chave é a mesma que o serviço usa, (APPOINTMENT, id do compromisso).
 *
 *  Uma diferença proposital em relação ao evento: aqui o lançamento nasce
 *  PAGO. É histórico — o atendimento aconteceu meses atrás e o dinheiro já
 *  entrou. Um atendimento concluído hoje nasce a receber, porque concluir não
 *  é receber. */
router.post('/api/finance/sync-atendimentos', async function (req, res) {
  const db = escopo(req);
  try {
    // A origem agora e o COMPROMISSO, nao a sessao clinica -- a migration 011
    // reapontou o que ja tinha sido lancado com a chave antiga. Duas chaves
    // para o mesmo fato e o comeco de uma divergencia de saldo.
    const [feitos] = await db.q(`
      SELECT a.id, a.title, a.price, a.client_id, a.professional_id,
             DATE_FORMAT(a.starts_at, '%Y-%m-%d') AS dia,
             c.name AS client_name
        FROM appointments a
        LEFT JOIN clients c ON c.id = a.client_id AND c.clinica_id = :clinica
       WHERE a.clinica_id = :clinica
         AND a.status = 'REALIZADO' AND a.kind = 'ATENDIMENTO' AND a.price > 0
    `);

    let criados = 0, jaExistiam = 0;
    for (const a of feitos) {
      const descricao = (a.title || 'Atendimento') + (a.client_name ? ' - ' + a.client_name : '');
      try {
        // `cat_procedimentos` e o id fixo da migration 008, e hoje ele pertence
        // a clinica `cl_1`. Ver a nota do cabecalho: e a M1.2b.
        await db.q(
          `INSERT INTO cash_entries
            (id, type, category_id, description, amount, entry_date, due_date, paid_at,
             source, source_id, client_id, professional_id, clinica_id)
           VALUES (?, 'RECEITA', 'cat_procedimentos', ?, ?, ?, ?, ?, 'APPOINTMENT', ?, ?, ?, :clinica)`,
          [novoId('ce'), descricao.slice(0, 255), a.price, a.dia, a.dia, a.dia,
           a.id, a.client_id, a.professional_id]
        );
        criados += 1;
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') jaExistiam += 1;
        else throw e;
      }
    }

    if (criados) await logs.registrar(db, 'FINANCEIRO', criados + ' atendimento(s) importado(s) como receita.');
    res.json({ criados, jaExistiam, atendimentosRealizados: feitos.length });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao importar a receita dos atendimentos.' });
  }
});

module.exports = router;

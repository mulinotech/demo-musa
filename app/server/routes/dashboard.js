'use strict';
/** Os números da Visão Geral (M5.8, 18/09).
 *
 *  ======================================================= POR QUE ESTA ROTA EXISTE
 *
 *  Até hoje a Visão Geral montava os próprios números **no navegador**, a partir
 *  das listas que a tela já tinha em mãos. Três consequências, todas medidas:
 *
 *  1. O faturamento da Visão Geral e o do Financeiro eram contas diferentes, e
 *     a da Visão Geral chutava `R$ 1.200` quando o procedimento não tinha preço.
 *     Duas telas do mesmo sistema podiam dizer dois faturamentos.
 *  2. A comparação com o período anterior não existia: "+12%" era texto fixo,
 *     impresso ao lado de qualquer número, inclusive de zero.
 *  3. O filtro de período não filtrava nada. A tela lia `lead.createdAt`; a API
 *     devolve a coluna `date`. Sem o campo, o código caía no `new Date()` e
 *     datava TODO lead como hoje — "7 dias" e "30 dias" mostravam a mesma coisa.
 *
 *  O conserto dos três é o mesmo: a conta sai do navegador. O servidor lê, a
 *  função pura (`services/visao-geral.js`) calcula, e a tela só desenha.
 *
 *  ================================================== POR QUE SÃO DUAS ROTAS
 *
 *  A Visão Geral é visível para **admin, gerência e profissional**, mas
 *  faturamento, ticket médio e CPL são informação sensível de negócio: em toda a
 *  plataforma `/api/finance` é de admin e gerência, e a profissional não vê
 *  preço. Uma rota só obrigaria a decidir isso DENTRO do handler — exatamente o
 *  que `REGRAS_DE_PAPEL` existe para evitar.
 *
 *  Então o painel é servido em dois pedaços, e a tabela de papéis continua sendo
 *  o único lugar que decide quem alcança o quê:
 *
 *      /api/dashboard/visao-geral   leads, conversão, série     todo papel do menu
 *      /api/dashboard/dinheiro      faturamento, ticket, CPL    admin e gerência
 *
 *  A profissional perde os três cartões de dinheiro e mantém a tela. Não é
 *  perda de função: é o mesmo recorte que ela já tem no resto do sistema.
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');
const fin = require('../services/financeiro');
const vg = require('../services/visao-geral');

function dataValida(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** O período pedido, ou os últimos 7 dias — o mesmo padrão do botão que já vem
 *  marcado na tela. "Últimos 7 dias" inclui hoje: são hoje e os 6 anteriores,
 *  como o time comercial descreveu. */
function periodo(query) {
  const hoje = fin.dia(new Date());
  const ate = dataValida(query.to) || hoje;
  const de = dataValida(query.from) || fin.somarDias(ate, -6);
  return de <= ate ? { de: de, ate: ate } : { de: ate, ate: de };
}

/** Leads da clínica. A coluna é `date` — não `created_at`, não `createdAt`.
 *  Era daqui que vinha o filtro que não filtrava. */
async function lerLeads(db) {
  const [r] = await db.q(
    'SELECT id, status, date FROM leads WHERE clinica_id = :clinica');
  return r.map((l) => ({ id: l.id, status: l.status, created_at: l.date }));
}

/** O razão, direto e sem JOIN.
 *
 *  O Financeiro junta as categorias para exibir o NOME de cada uma; aqui o CPL
 *  só precisa do `category_id` para saber se a despesa está numa categoria
 *  marcada. Sem o JOIN não há como repetir o acidente que ele evita — um
 *  lançamento sem categoria sumindo do razão. */
async function lerRazao(db) {
  const [r] = await db.q(
    'SELECT id, type, amount, entry_date, paid_at, category_id' +
    ' FROM cash_entries WHERE clinica_id = :clinica');
  return r;
}

/** Atendimentos concluídos no período: quantos foram e quantas pacientes
 *  DISTINTAS passaram. A segunda é o denominador do ticket médio — contar
 *  sessões ali faria a paciente de pacote de 10 sessões baixar o ticket da
 *  clínica inteira. */
async function atendimentos(db, de, ate) {
  const [r] = await db.q(
    "SELECT COUNT(*) AS sessoes, COUNT(DISTINCT client_id) AS pacientes" +
    ' FROM appointments' +
    " WHERE clinica_id = :clinica AND status = 'REALIZADO'" +
    ' AND DATE(starts_at) BETWEEN ? AND ?', [de, ate]);
  const l = r[0] || {};
  return { sessoes: Number(l.sessoes || 0), pacientes: Number(l.pacientes || 0) };
}

/* ------------------------------------------------- o que todo papel enxerga */

router.get('/api/dashboard/visao-geral', async function (req, res) {
  const db = escopo(req);
  try {
    const p = periodo(req.query);
    const leads = await lerLeads(db);
    const painel = vg.painel({ de: p.de, ate: p.ate, leads: leads });
    res.json({
      periodo: painel.periodo,
      periodoAnterior: painel.periodoAnterior,
      leads: painel.leads,
      conversao: painel.conversao,
      funil: vg.funil(leads, p.de, p.ate),
      serieDeLeads: painel.serieDeLeads
    });
  } catch (e) {
    console.error('[dashboard]', e && e.message);
    res.status(500).json({ error: 'Falha ao montar a visao geral.' });
  }
});

/* ------------------------------------------- o que só admin e gerência veem */

router.get('/api/dashboard/dinheiro', async function (req, res) {
  const db = escopo(req);
  try {
    const p = periodo(req.query);
    const base = req.query.basis === 'caixa' ? 'caixa' : 'competencia';
    const ant = vg.janelaAnterior(p.de, p.ate);

    const leads = await lerLeads(db);
    const razao = await lerRazao(db);
    const [marcadas] = await db.q(
      'SELECT id FROM finance_categories WHERE clinica_id = :clinica AND conta_no_cpl = 1');
    const agora = await atendimentos(db, p.de, p.ate);
    const antes = await atendimentos(db, ant.de, ant.ate);

    const painel = vg.painel({
      de: p.de, ate: p.ate, base: base,
      leads: leads,
      razao: razao,
      categoriasDeCaptacao: marcadas.map((c) => c.id),
      sessoes: agora.sessoes,
      sessoesAnterior: antes.sessoes,
      pacientesAtendidas: agora.pacientes,
      pacientesAtendidasAnterior: antes.pacientes
    });

    res.json({
      periodo: painel.periodo,
      periodoAnterior: painel.periodoAnterior,
      faturamento: painel.faturamento,
      ticketMedio: painel.ticketMedio,
      custoPorLead: painel.custoPorLead
    });
  } catch (e) {
    console.error('[dashboard/dinheiro]', e && e.message);
    res.status(500).json({ error: 'Falha ao montar os numeros de dinheiro.' });
  }
});

module.exports = router;

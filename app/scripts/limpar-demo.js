#!/usr/bin/env node
'use strict';
/**
 * Zera a base de DEMONSTRAÇÃO de uma clínica, para ela ser repovoada com
 * dados fictícios (20/10/2026).
 *
 * POR QUE ISTO EXISTE
 *   O demo foi usado por muitos colaboradores, que cadastraram nome, telefone e
 *   e-mail de verdade (relatório de QA de 15/10, BUG-09). A tela não consegue
 *   limpar: ela recusa, de propósito, excluir paciente com histórico.
 *
 * O QUE ELE FAZ (só na clínica escolhida, nunca nas outras)
 *   - guarda um BACKUP em JSON de tudo o que vai apagar, em backups/;
 *   - mantém as fichas que você mandar manter (MANTER), com os leads e as
 *     conversas delas;
 *   - apaga os outros pacientes, leads e conversas, e TODA a agenda, os planos,
 *     as sessões, os documentos, os lançamentos financeiros, os pontos, as
 *     movimentações de estoque de atendimento e a trilha de auditoria;
 *   - tira do catálogo os itens cujo nome diz "teste".
 *
 * O QUE ELE NÃO TOCA
 *   Usuários, catálogo de verdade, ficha técnica, produtos e lotes de estoque,
 *   custos fixos, recorrências, categorias, programa de fidelidade e
 *   recompensas, modelos de documento, Timbre, configurações e WhatsApp.
 *
 * COMO RODAR (no servidor, pelo SSH, na pasta da aplicação)
 *   node scripts/limpar-demo.js              # só MOSTRA o que faria
 *   APLICAR=1 node scripts/limpar-demo.js    # faz backup e apaga
 *
 *   Variáveis opcionais:
 *   CLINICA=cl_1                                     (padrão: cl_1)
 *   MANTER="Rodrigo Inpyx;Silvia Venancio;Pedro Cavalcante"
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../server/db');
const { chaveDeTelefone } = require('../server/services/conversao-de-lead');

const CLINICA = process.env.CLINICA || 'cl_1';
const MANTER = (process.env.MANTER || 'Rodrigo Inpyx;Silvia Venancio;Pedro Cavalcante')
  .split(';').map((s) => s.trim()).filter(Boolean);
const APLICAR = process.env.APLICAR === '1';

/* Tabelas que são CONFIGURAÇÃO da clínica: nunca apagadas aqui. */
const PRESERVAR = new Set([
  'clinicas', 'users', 'salespeople', 'treatment_catalog', 'service_supplies', 'products',
  'stock_batches', 'fixed_costs', 'recurring_expenses', 'finance_categories',
  'loyalty_settings', 'loyalty_rewards', 'document_templates', 'clinica_settings',
  'pricing_settings', 'pricing_simulations', 'professional_availability', 'equipments',
  'acessos_de_suporte', 'operadores', 'system_settings', 'schema_migrations'
]);

/* Tabelas com regra própria (o resto, se tiver clinica_id, é apagado inteiro). */
const ESPECIAIS = new Set(['clients', 'leads', 'interactions', 'stock_movements']);

const testeNoNome = (n) => /(^|[^a-zà-ú])testes?([^a-zà-ú]|$)/i.test(String(n || ''));

async function main() {
  const conn = await pool.getConnection();
  try {
    const [cl] = await conn.query('SELECT id, nome, status FROM clinicas WHERE id = ?', [CLINICA]);
    if (!cl[0]) throw new Error('Clinica "' + CLINICA + '" nao existe.');
    console.log('\nClinica: ' + cl[0].id + ' -- "' + cl[0].nome + '" (' + cl[0].status + ')');
    if (!/musa/i.test(cl[0].nome) && process.env.FORCAR !== '1') {
      throw new Error('O nome desta clinica nao contem "Musa". Para confirmar que e a clinica certa, rode com FORCAR=1.');
    }

    const [tabs] = await conn.query(
      "SELECT TABLE_NAME AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()" +
      " AND COLUMN_NAME = 'clinica_id' ORDER BY TABLE_NAME");
    const comClinica = tabs.map((r) => r.t);

    // ---------------------------------------------- o que fica
    const [clientes] = await conn.query('SELECT id, name, phone FROM clients WHERE clinica_id = ?', [CLINICA]);
    const ficam = clientes.filter((c) => MANTER.some((m) => m.toLowerCase() === String(c.name || '').trim().toLowerCase()));
    const naoAchados = MANTER.filter((m) => !ficam.some((c) => c.name.trim().toLowerCase() === m.toLowerCase()));
    console.log('Fichas mantidas: ' + (ficam.map((c) => c.name).join(', ') || '(nenhuma)'));
    if (naoAchados.length) console.log('  ATENCAO: nao encontrei ficha para: ' + naoAchados.join(', '));
    const idsClientes = new Set(ficam.map((c) => c.id));
    const chaves = new Set(ficam.map((c) => chaveDeTelefone(c.phone)).filter(Boolean));

    const [leads] = await conn.query('SELECT id, name, whatsapp, client_id FROM leads WHERE clinica_id = ?', [CLINICA]);
    const leadsQueFicam = leads.filter((l) => idsClientes.has(l.client_id) || chaves.has(chaveDeTelefone(l.whatsapp)));
    const idsLeads = new Set(leadsQueFicam.map((l) => l.id));
    console.log('Leads mantidos (das fichas acima): ' + (leadsQueFicam.map((l) => l.name).join(', ') || '(nenhum)'));
    const idsDeConversa = Array.from(idsClientes).concat(Array.from(idsLeads));

    const [catalogo] = await conn.query('SELECT id, name FROM treatment_catalog WHERE clinica_id = ?', [CLINICA]);
    const catTeste = catalogo.filter((c) => testeNoNome(c.name));

    // ---------------------------------------------- o plano
    const filtroIn = (ids) => (ids.length ? ' AND id NOT IN (' + ids.map(() => '?').join(',') + ')' : '');
    const plano = [];
    for (const t of comClinica) {
      if (PRESERVAR.has(t)) continue;
      if (t === 'clients') {
        plano.push({ t, where: 'clinica_id = ?' + filtroIn(Array.from(idsClientes)), params: [CLINICA].concat(Array.from(idsClientes)) });
      } else if (t === 'leads') {
        plano.push({ t, where: 'clinica_id = ?' + filtroIn(Array.from(idsLeads)), params: [CLINICA].concat(Array.from(idsLeads)) });
      } else if (t === 'interactions') {
        const w = idsDeConversa.length ? ' AND client_id NOT IN (' + idsDeConversa.map(() => '?').join(',') + ')' : '';
        plano.push({ t, where: 'clinica_id = ?' + w, params: [CLINICA].concat(idsDeConversa) });
      } else if (t === 'stock_movements') {
        plano.push({ t, where: "clinica_id = ? AND source = 'APPOINTMENT'", params: [CLINICA] });
      } else if (!ESPECIAIS.has(t)) {
        plano.push({ t, where: 'clinica_id = ?', params: [CLINICA] });
      }
    }
    if (catTeste.length) {
      plano.push({ t: 'treatment_catalog', where: 'clinica_id = ? AND id IN (' + catTeste.map(() => '?').join(',') + ')',
        params: [CLINICA].concat(catTeste.map((c) => c.id)) });
    }

    console.log('\nO que ' + (APLICAR ? 'SERA APAGADO' : 'seria apagado') + ':');
    let total = 0;
    for (const p of plano) {
      const [n] = await conn.query('SELECT COUNT(*) AS n FROM `' + p.t + '` WHERE ' + p.where, p.params);
      p.n = Number(n[0].n);
      total += p.n;
      if (p.n) console.log('  ' + p.t.padEnd(24) + String(p.n).padStart(6));
    }
    if (catTeste.length) console.log('  (catalogo: ' + catTeste.map((c) => c.name).join('; ') + ')');
    console.log('  ' + 'TOTAL'.padEnd(24) + String(total).padStart(6));

    if (!APLICAR) {
      console.log('\nNada foi apagado. Para aplicar: APLICAR=1 node scripts/limpar-demo.js\n');
      return;
    }

    // ---------------------------------------------- backup
    const pasta = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
    const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
    const arquivo = path.join(pasta, 'demo-' + CLINICA + '-antes-da-limpeza-' + carimbo + '.json');
    const copia = {};
    for (const p of plano) {
      if (!p.n) continue;
      const [linhas] = await conn.query('SELECT * FROM `' + p.t + '` WHERE ' + p.where, p.params);
      copia[p.t] = (copia[p.t] || []).concat(linhas);
    }
    fs.writeFileSync(arquivo, JSON.stringify({ clinica: CLINICA, em: new Date().toISOString(), tabelas: copia }));
    fs.chmodSync(arquivo, 0o600);
    console.log('\nBackup: ' + arquivo + ' (contem dados pessoais: guarde ou apague depois)');

    // ---------------------------------------------- apagar
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.beginTransaction();
    try {
      for (const p of plano) {
        if (!p.n) continue;
        const [r] = await conn.query('DELETE FROM `' + p.t + '` WHERE ' + p.where, p.params);
        console.log('  apagado ' + p.t.padEnd(24) + String(r.affectedRows).padStart(6));
      }
      // as fichas que ficaram perdem o vinculo com o que nao existe mais
      await conn.query(
        "UPDATE leads SET client_id = NULL WHERE clinica_id = ? AND client_id IS NOT NULL" +
        ' AND client_id NOT IN (SELECT id FROM clients WHERE clinica_id = ?)', [CLINICA, CLINICA]);
      await conn.query(
        'INSERT INTO system_logs (id, action_type, description, author, created_at, clinica_id) VALUES (?, ?, ?, ?, NOW(), ?)',
        ['lg_limpa_' + Date.now().toString(36), 'LGPD',
         'Base de demonstracao reiniciada: ' + total + ' registro(s) de teste e de pessoas reais removidos. ' +
         'Fichas mantidas: ' + (ficam.map((c) => c.name).join(', ') || 'nenhuma') + '.',
         'Sistema (limpeza do demo)', CLINICA]);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    }
    console.log('\nPronto. Base limpa.\n');
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('\nERRO: ' + (e && e.message) + '\nNada foi apagado se o erro veio antes de "apagado".\n');
  process.exit(1);
});

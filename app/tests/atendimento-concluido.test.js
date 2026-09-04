'use strict';
/** O evento "atendimento realizado" (T1.4, contexto 02).
 *
 *  ESTES TESTES NÃO ENCOSTAM NO MYSQL. A conexão é um objeto de mentira que
 *  guarda as queries recebidas. Isso não é atalho — foi uma lição: um teste
 *  que chamava a rota de verdade travou a suíte inteira no servidor, porque lá
 *  não existe banco no ambiente de teste. Serviço que recebe `conn` por
 *  parâmetro é testável; serviço que importa o pool, não.
 *
 *  O contexto 02 exige três provas, e são as três que mais custam caro quando
 *  faltam:
 *    1. concluir duas vezes aplica os efeitos uma vez só;
 *    2. efeito que falha derruba tudo — nem receita, nem status;
 *    3. reverter deixa quatro registros no histórico, não zero.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const ac = require('../server/services/atendimento-concluido');
const ef = require('../server/services/efeitos-financeiro');

/* ----------------------------------------------------- banco de mentira */

function fakeConn(estado) {
  const linhas = estado.linhas || {};
  return {
    queries: estado.queries,
    async beginTransaction() { estado.queries.push('BEGIN'); },
    async commit() { estado.committed = true; },
    async rollback() { estado.rolledback = true; },
    release() { estado.released = true; },
    async query(sql, params) {
      estado.queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params: params });
      if (estado.erroEm && estado.erroEm.test(sql)) throw new Error('falha simulada');
      for (const chave of Object.keys(linhas)) {
        if (new RegExp(chave, 'i').test(sql)) return [linhas[chave]];
      }
      return [{ affectedRows: 1 }];
    }
  };
}

function fakePool(estado) {
  const conn = fakeConn(estado);
  estado.conn = conn;
  return { getConnection: async () => conn };
}

const COMPROMISSO = {
  id: 'ap_teste', client_id: 'cl_1', professional_id: 'u_musa',
  title: 'Limpeza de pele', kind: 'ATENDIMENTO', price: '250.00',
  starts_at: '2026-09-01 14:00:00', status: 'AGENDADO',
  completed_at: null, completions: 0
};

const sqls = (estado) => estado.queries.filter((q) => typeof q !== 'string').map((q) => q.sql);
const houve = (estado, re) => sqls(estado).some((s) => re.test(s));

/* ------------------------------------------------------------ a chave */

test('a chave de origem da primeira conclusao e o proprio id', function () {
  // Compatibilidade com o que a T2.5 ja lancou antes desta task existir.
  assert.strictEqual(ac.chaveDeOrigem('ap_x', 1), 'ap_x');
});

test('reconcluir depois de estornar usa uma chave nova', function () {
  // O estorno nao apaga a receita errada, entao a chave antiga continua
  // ocupada no indice unico. Sem o sufixo, a segunda conclusao seria recusada
  // pelo banco e o atendimento refeito nunca seria faturado.
  assert.strictEqual(ac.chaveDeOrigem('ap_x', 2), 'ap_x#2');
  assert.notStrictEqual(ac.chaveDeOrigem('ap_x', 2), ac.chaveDeOrigem('ap_x', 1));
});

/* --------------------------------------------------------- a decisao */

test('compromisso ja concluido nao aplica efeito de novo', function () {
  const d = ac.decidirConclusao({ ...COMPROMISSO, completed_at: '2026-09-01 15:00:00' });
  assert.strictEqual(d.acao, 'JA_CONCLUIDO');
});

test('bloqueio de horario muda status e nao gera efeito nenhum', function () {
  const d = ac.decidirConclusao({ ...COMPROMISSO, kind: 'BLOQUEIO' });
  assert.strictEqual(d.acao, 'SO_STATUS');
});

test('reverter exige motivo', function () {
  const ap = { ...COMPROMISSO, completed_at: '2026-09-01 15:00:00', completions: 1 };
  assert.strictEqual(ac.decidirReversao(ap, '').acao, 'SEM_MOTIVO');
  assert.strictEqual(ac.decidirReversao(ap, '   ').status, 400);
  assert.strictEqual(ac.decidirReversao(ap, 'marcado por engano').acao, 'REVERTER');
});

test('nao da para reverter o que nunca foi concluido', function () {
  const r = ac.decidirReversao(COMPROMISSO, 'qualquer coisa');
  assert.strictEqual(r.status, 409);
});

test('reverter estorna a chave da conclusao atual, nao a primeira', function () {
  const ap = { ...COMPROMISSO, completed_at: '2026-09-01 15:00:00', completions: 2 };
  assert.strictEqual(ac.decidirReversao(ap, 'engano').chave, 'ap_teste#2');
});

/* ------------------------------------------------- o que vira receita */

test('atendimento com preco vira receita a receber, nao caixa', function () {
  const r = ef.receitaDe(COMPROMISSO, 'ap_teste', 'Ana');
  assert.strictEqual(r.amount, 250);
  assert.strictEqual(r.entry_date, '2026-09-01');
  // A linha que separa competencia de caixa mora aqui: concluir nao e receber.
  assert.strictEqual(r.paid_at, null, 'concluir atendimento nao carimba dinheiro recebido');
  assert.strictEqual(r.source, 'APPOINTMENT');
  assert.strictEqual(r.source_id, 'ap_teste');
  assert.match(r.description, /Limpeza de pele - Ana/);
});

test('bloqueio, cortesia e retorno nao viram receita', function () {
  assert.strictEqual(ef.receitaDe({ ...COMPROMISSO, kind: 'BLOQUEIO' }, 'k'), null, 'almoco nao fatura');
  assert.strictEqual(ef.receitaDe({ ...COMPROMISSO, price: 0 }, 'k'), null, 'cortesia');
  assert.strictEqual(ef.receitaDe({ ...COMPROMISSO, price: null }, 'k'), null, 'retorno sem preco');
});

/* --------------------------------------------- 1. concluir duas vezes */

test('concluir aplica os efeitos e fecha a transacao', async function () {
  const estado = { queries: [], linhas: { 'FROM appointments WHERE id': [COMPROMISSO], 'FROM clients': [{ name: 'Ana' }] } };
  const saida = await ac.concluirAtendimento(fakePool(estado), 'ap_teste', { usuarioId: 'u_musa' });

  assert.strictEqual(saida.acao, 'CONCLUIDO');
  assert.strictEqual(saida.efeitos.financeiro.lancado, true);
  assert.strictEqual(saida.efeitos.financeiro.valor, 250);
  assert.ok(houve(estado, /FOR UPDATE/), 'le o compromisso travando a linha');
  assert.ok(houve(estado, /INSERT INTO cash_entries/), 'lancou a receita');
  assert.ok(houve(estado, /UPDATE treatment_sessions/), 'a sessao clinica acompanha');
  assert.strictEqual(estado.committed, true);
  assert.notStrictEqual(estado.rolledback, true);
  assert.strictEqual(estado.released, true, 'devolveu a conexao ao pool');
});

test('concluir de novo nao lanca receita outra vez', async function () {
  const jaFeito = { ...COMPROMISSO, completed_at: '2026-09-01 15:00:00', completions: 1 };
  const estado = { queries: [], linhas: { 'FROM appointments WHERE id': [jaFeito] } };
  const saida = await ac.concluirAtendimento(fakePool(estado), 'ap_teste', {});

  assert.strictEqual(saida.jaConcluido, true);
  assert.ok(!houve(estado, /INSERT INTO cash_entries/), 'nenhum lancamento novo');
  assert.ok(!houve(estado, /UPDATE appointments SET status/), 'nem status mexido');
  assert.strictEqual(estado.committed, true, 'idempotencia nao e erro: encerra em paz');
});

test('clique duplo simultaneo esbarra no indice unico e nao duplica', async function () {
  // O `if` do completed_at nao segura duas requisicoes no mesmo milissegundo.
  // Quem segura e o banco. Aqui o INSERT devolve ER_DUP_ENTRY.
  const conn = {
    async query() { const e = new Error('dup'); e.code = 'ER_DUP_ENTRY'; throw e; }
  };
  const r = await ef.lancarReceitaDeAtendimento(COMPROMISSO, conn, { chave: 'ap_teste' });
  assert.strictEqual(r.lancado, false);
  assert.strictEqual(r.motivo, 'ja lancado');
});

/* ------------------------------------- 2. efeito que falha derruba tudo */

test('erro em um efeito desfaz o atendimento inteiro', async function () {
  const estado = {
    queries: [],
    linhas: { 'FROM appointments WHERE id': [COMPROMISSO], 'FROM clients': [{ name: 'Ana' }] },
    erroEm: /INSERT INTO cash_entries/
  };
  await assert.rejects(() => ac.concluirAtendimento(fakePool(estado), 'ap_teste', {}), /falha simulada/);

  // O ponto do teste: o status NAO pode ficar aplicado sozinho. Se a receita
  // falha e o compromisso fica REALIZADO, a clinica atende de graca sem saber.
  assert.strictEqual(estado.rolledback, true, 'rollback aconteceu');
  assert.notStrictEqual(estado.committed, true, 'nada foi confirmado');
  assert.strictEqual(estado.released, true, 'a conexao volta ao pool mesmo com erro');
});

/* ---------------------------------------- 3. reverter deixa histórico */

test('reverter cria estorno e nao apaga o lancamento errado', async function () {
  const jaFeito = { ...COMPROMISSO, completed_at: '2026-09-01 15:00:00', completions: 1 };
  const original = { id: 'ce_1', description: 'Limpeza de pele - Ana', amount: '250.00',
                     category_id: 'cat_procedimentos', paid_at: null, client_id: 'cl_1',
                     professional_id: 'u_musa' };
  const estado = {
    queries: [],
    linhas: { 'FROM appointments WHERE id': [jaFeito], 'FROM cash_entries': [original] }
  };
  const saida = await ac.reverterConclusao(fakePool(estado), 'ap_teste', {
    usuarioId: 'u_musa', motivo: 'marcado por engano'
  });

  assert.strictEqual(saida.acao, 'REVERTIDO');
  assert.strictEqual(saida.efeitos.financeiro.estornado, true);
  assert.strictEqual(saida.efeitos.financeiro.valor, 250);

  const inserts = sqls(estado).filter((s) => /INSERT INTO cash_entries/.test(s));
  assert.strictEqual(inserts.length, 1, 'o estorno e um lancamento novo');
  assert.match(inserts[0], /'REVERSAL'/, 'marcado como estorno');
  assert.ok(!houve(estado, /DELETE FROM cash_entries/), 'ESTORNO NUNCA APAGA: o erro fica no historico');
  assert.ok(houve(estado, /completed_at = NULL/), 'o carimbo de conclusao sai');
  assert.strictEqual(estado.committed, true);
});

test('reverter nao devolve completions, para a chave nunca se repetir', async function () {
  const jaFeito = { ...COMPROMISSO, completed_at: '2026-09-01 15:00:00', completions: 1 };
  const estado = { queries: [], linhas: { 'FROM appointments WHERE id': [jaFeito], 'FROM cash_entries': [] } };
  await ac.reverterConclusao(fakePool(estado), 'ap_teste', { motivo: 'engano' });
  assert.ok(!houve(estado, /completions/), 'o contador so cresce, e cresce na conclusao');
});

test('estorno sem receita lancada nao inventa despesa', async function () {
  const conn = { async query() { return [[]]; } };
  const r = await ef.estornarReceitaDeAtendimento(COMPROMISSO, conn, { chave: 'ap_teste' });
  assert.strictEqual(r.estornado, false);
});

/* ------------------------------------------- modulo ausente nao derruba */

test('modulo nao instalado nao impede concluir atendimento', async function () {
  // Este teste nasceu quando estoque e fidelizacao eram stubs vazios: media que
  // efeito ausente nao derrubasse a conclusao. Os dois foram implementados
  // (Fases 3 e 5) e a garantia continua valendo, agora no caso real -- o banco
  // sem as tabelas do modulo, que e o estado de qualquer ambiente antes de
  // rodar as migrations.
  const estoque = require('../server/services/efeitos-estoque');
  const fidelidade = require('../server/services/efeitos-fidelidade');
  const semTabela = {
    async query() { const e = new Error('table missing'); e.code = 'ER_NO_SUCH_TABLE'; throw e; }
  };
  assert.strictEqual((await fidelidade.creditarPontos(COMPROMISSO, semTabela, {})).creditado, false);

  // O estoque e diferente de proposito: sem catalog_id nao existe ficha para
  // consultar, e ele nem chega a tocar o banco.
  const semServico = { ...COMPROMISSO, catalog_id: null };
  assert.strictEqual((await estoque.baixarInsumosDoAtendimento(semServico, semTabela, {})).baixado, false);
});

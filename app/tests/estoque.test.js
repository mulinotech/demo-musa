'use strict';
/** Estoque (T3.2 e T3.4).
 *
 *  O Definition of Done do módulo lista seis provas. Estão todas aqui, e as
 *  duas que mais importam são as que envolvem risco, não aritmética: lote
 *  vencido nunca sai automaticamente, e saldo insuficiente derruba o
 *  atendimento inteiro em vez de deixar o estoque mentir.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const e = require('../server/services/estoque');
const efeitos = require('../server/services/efeitos-estoque');

const HOJE = '2026-09-01';

const lote = (id, qtd, validade, custo, recebido) => ({
  id: id, quantity: String(qtd), expiry_date: validade,
  unit_cost: String(custo == null ? 10 : custo), received_at: recebido || '2026-01-01'
});

/* ------------------------------------------------------------ DECIMAL */

test('DECIMAL que vem do banco como texto nao virа concatenacao', function () {
  // O mysql2 devolve DECIMAL como string. '10.000' + '5.000' = '10.0005'.
  // Este e o bug silencioso numero um do modulo: o saldo fica errado e nada
  // lanca erro.
  assert.strictEqual(e.saldoDosLotes([lote('a', '10.000'), lote('b', '5.500')]), 15.5);
});

/* --------------------------------------------------------------- FEFO */

test('sai primeiro o lote que VENCE antes, nao o que entrou antes', function () {
  const lotes = [
    lote('novo_mas_vence_logo', 5, '2026-10-01', 10, '2026-08-01'),
    lote('antigo_vence_depois', 5, '2027-01-01', 10, '2026-01-01')
  ];
  const r = e.escolherLotes(lotes, 3, { hoje: HOJE });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.consumo[0].batchId, 'novo_mas_vence_logo',
    'FIFO aqui jogaria dinheiro no lixo: o lote que vence logo venceria na prateleira');
});

test('saida que atravessa dois lotes gera dois movimentos e zera o primeiro', function () {
  const lotes = [lote('l1', 4, '2026-10-01'), lote('l2', 10, '2026-12-01')];
  const r = e.escolherLotes(lotes, 6, { hoje: HOJE });
  assert.strictEqual(r.consumo.length, 2, 'um movimento por lote: e o que sustenta a rastreabilidade');
  assert.deepStrictEqual(r.consumo[0], { batchId: 'l1', quantidade: 4, unitCost: 10 });
  assert.deepStrictEqual(r.consumo[1], { batchId: 'l2', quantidade: 2, unitCost: 10 });
});

test('lote sem validade fica para o fim da fila', function () {
  const lotes = [lote('sem_validade', 10, null), lote('com_validade', 10, '2027-06-01')];
  const r = e.escolherLotes(lotes, 5, { hoje: HOJE });
  assert.strictEqual(r.consumo[0].batchId, 'com_validade');
});

test('LOTE VENCIDO NUNCA SAI AUTOMATICAMENTE', function () {
  // A prova mais importante do arquivo. Consumir vencido "porque tinha saldo"
  // e o pior desfecho: risco sanitario registrado pelo proprio sistema.
  const lotes = [lote('vencido', 10, '2026-08-01'), lote('bom', 2, '2027-01-01')];
  const r = e.escolherLotes(lotes, 5, { hoje: HOJE });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.disponivel, 2, 'so conta o que pode ser aplicado');
  assert.strictEqual(r.vencidoDisponivel, 10, 'e diz que existe saldo vencido');
});

test('saldo insuficiente diz quanto falta, nao so que falhou', function () {
  const r = e.escolherLotes([lote('l1', 2, null)], 5, { hoje: HOJE });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.faltando, 3);
});

test('quantidade zero ou negativa e recusada', function () {
  assert.strictEqual(e.escolherLotes([lote('l1', 10, null)], 0, { hoje: HOJE }).ok, false);
  assert.strictEqual(e.escolherLotes([lote('l1', 10, null)], -2, { hoje: HOJE }).ok, false);
});

test('o custo da saida sai do lote consumido, nao do custo medio do produto', function () {
  // Dois lotes com custos diferentes: o custo do que saiu e o do lote de onde
  // saiu. Usar o custo medio aqui distorceria a margem do atendimento.
  const lotes = [lote('caro', 2, '2026-10-01', 100), lote('barato', 10, '2026-12-01', 50)];
  const r = e.escolherLotes(lotes, 4, { hoje: HOJE });
  assert.strictEqual(r.custo, 2 * 100 + 2 * 50);
});

/* -------------------------------------------------------- custo medio */

test('custo medio ponderado: 10 a 20,00 mais 10 a 30,00 da 25,00', function () {
  // Caso de referencia do modulo. Se este numero mudar, a regra mudou.
  assert.strictEqual(e.custoMedio(10, 20, 10, 30), 25);
});

test('compra pequena e cara nao reprecifica o estoque todo', function () {
  // Com "ultimo preco pago", 1 unidade a R$ 300 faria as 20 antigas valerem
  // R$ 300 cada, e a precificacao subiria em cima de um custo inexistente.
  const novo = e.custoMedio(20, 100, 1, 300);
  assert.ok(novo > 100 && novo < 120, 'sobe pouco: ' + novo);
});

test('estoque zerado assume o custo da entrada', function () {
  assert.strictEqual(e.custoMedio(0, 999, 5, 40), 40);
});

/* ------------------------------------------------------------ alertas */

const prod = (id, nome, minimo, lotes) => ({ id: id, name: nome, min_stock: String(minimo), lotes: lotes });

test('vencido com saldo e alerta critico, com quantos dias faz', function () {
  const a = e.alertas([prod('p1', 'Skinbooster', 2, [lote('l1', 2, '2026-08-17')])], HOJE);
  assert.strictEqual(a.criticos.length, 1);
  assert.strictEqual(a.criticos[0].tipo, 'VENCIDO');
  assert.strictEqual(a.criticos[0].diasVencido, 15);
});

test('vencendo em 30 dias ou menos entra no alerta de validade', function () {
  const a = e.alertas([prod('p1', 'Toxina', 0, [lote('l1', 1, '2026-09-21'), lote('l2', 1, '2027-01-01')])], HOJE);
  assert.strictEqual(a.validade.length, 1, 'so o que vence dentro da janela');
  assert.strictEqual(a.validade[0].diasRestantes, 20);
});

test('o minimo compara com o saldo UTILIZAVEL, nao com o total', function () {
  // 10 unidades no estoque, todas vencidas, minimo 5. Contar o vencido faria o
  // sistema dizer "tem estoque" para algo que nao pode ser aplicado em ninguem.
  const a = e.alertas([prod('p1', 'Anestesico', 5, [lote('l1', 10, '2026-08-01')])], HOJE);
  assert.strictEqual(a.reposicao.length, 1, 'precisa repor mesmo tendo 10 na prateleira');
  assert.strictEqual(a.reposicao[0].saldo, 0);
  assert.strictEqual(a.reposicao[0].saldoTotal, 10);
});

test('produto sem minimo definido nao gera alerta de reposicao', function () {
  const a = e.alertas([prod('p1', 'Gaze', 0, [])], HOJE);
  assert.strictEqual(a.reposicao.length, 0);
});

test('um produto pode disparar mais de um alerta ao mesmo tempo', function () {
  const a = e.alertas([prod('p1', 'Toxina', 3, [lote('l1', 1, '2026-08-01'), lote('l2', 1, '2026-09-10')])], HOJE);
  assert.strictEqual(a.criticos.length, 1, 'um lote vencido');
  assert.strictEqual(a.validade.length, 1, 'outro vencendo');
  assert.strictEqual(a.reposicao.length, 1, 'e utilizavel (1) abaixo do minimo (3)');
  assert.strictEqual(a.total, 3);
});

/* ------------------------------------------------- ficha tecnica */

test('custo variavel sai da ficha tecnica e diz que saiu dela', function () {
  const itens = [
    { product_id: 'p1', name: 'Toxina', unit: 'UN', quantity: '1.000', unit_cost: '980.00' },
    { product_id: 'p2', name: 'Agulha', unit: 'UN', quantity: '4.000', unit_cost: '1.20' }
  ];
  const r = e.custoVariavelDaFicha(itens, 500);
  assert.strictEqual(r.valor, 984.8);
  assert.strictEqual(r.origem, 'FICHA_TECNICA');
  assert.strictEqual(r.detalhe[1].parcial, 4.8);
});

test('sem ficha tecnica, usa o valor digitado e ADMITE que foi digitado', function () {
  // A tela mostra a origem por um motivo: a profissional precisa saber se esta
  // olhando para custo real ou para um chute antigo.
  const r = e.custoVariavelDaFicha([], 120);
  assert.strictEqual(r.valor, 120);
  assert.strictEqual(r.origem, 'MANUAL');
});

/* --------------------------------------- o efeito no atendimento (T3.4) */

function fakeConn(estado) {
  return {
    async query(sql, params) {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      estado.sqls = estado.sqls || [];
      estado.sqls.push(s);
      if (/FROM stock_movements/.test(s)) return [estado.jaBaixado ? [{ n: 3 }] : [{ n: 0 }]];
      if (/FROM service_supplies/.test(s)) return [estado.ficha || []];
      if (/FROM stock_batches/.test(s)) {
        return [(estado.lotes || []).filter((l) => l.product_id === params[0])];
      }
      if (/UPDATE stock_batches/.test(s)) {
        const l = (estado.lotes || []).find((x) => x.id === params[1]);
        if (l) l.quantity = String(e.q(Number(l.quantity) - Number(params[0])));
        return [{ affectedRows: 1 }];
      }
      if (/INSERT INTO stock_movements/.test(s)) {
        estado.movimentos = (estado.movimentos || 0) + 1;
        return [{ affectedRows: 1 }];
      }
      return [[]];
    }
  };
}

const AP = { id: 'ap_1', catalog_id: 'cat_1', kind: 'ATENDIMENTO', title: 'Botox' };

test('atendimento sem ficha tecnica nao baixa nada, e nao e erro', function () {
  return efeitos.baixarInsumosDoAtendimento(AP, fakeConn({ ficha: [] }), { chave: 'ap_1' })
    .then(function (r) {
      assert.strictEqual(r.baixado, false);
      assert.match(r.motivo, /sem ficha/i);
    });
});

test('compromisso sem servico do catalogo nao baixa nada', function () {
  return efeitos.baixarInsumosDoAtendimento({ id: 'ap_2', catalog_id: null }, fakeConn({}), {})
    .then((r) => assert.strictEqual(r.baixado, false));
});

test('baixa gera um movimento por lote consumido', async function () {
  const estado = {
    ficha: [{ product_id: 'p1', name: 'Toxina', quantity: '6.000' }],
    lotes: [
      { id: 'l1', product_id: 'p1', quantity: '4.000', expiry_date: '2026-10-01', unit_cost: '980.00', received_at: '2026-01-01' },
      { id: 'l2', product_id: 'p1', quantity: '10.000', expiry_date: '2026-12-01', unit_cost: '960.00', received_at: '2026-02-01' }
    ]
  };
  const r = await efeitos.baixarInsumosDoAtendimento(AP, fakeConn(estado), { chave: 'ap_1', hoje: HOJE });
  assert.strictEqual(r.baixado, true);
  assert.strictEqual(estado.movimentos, 2, 'atravessou dois lotes');
  assert.strictEqual(estado.lotes[0].quantity, '0', 'o primeiro lote zerou');
  assert.strictEqual(estado.lotes[1].quantity, '8');
});

test('SALDO INSUFICIENTE LANCA ERRO E DERRUBA O ATENDIMENTO INTEIRO', async function () {
  // Decisao de produto, nao de codigo: e preferivel travar na recepcao a
  // concluir o atendimento e deixar o estoque negativo mentindo.
  const estado = {
    ficha: [{ product_id: 'p1', name: 'Toxina Botulinica 100U', quantity: '2.000' }],
    lotes: [{ id: 'l1', product_id: 'p1', quantity: '1.000', expiry_date: '2027-01-01', unit_cost: '980.00', received_at: '2026-01-01' }]
  };
  await assert.rejects(
    () => efeitos.baixarInsumosDoAtendimento(AP, fakeConn(estado), { chave: 'ap_1', hoje: HOJE }),
    function (err) {
      assert.match(err.message, /Toxina Botulinica 100U/, 'a mensagem nomeia o produto que falta');
      assert.match(err.message, /Ajuste o estoque/, 'e diz o que fazer');
      return true;
    }
  );
  assert.strictEqual(estado.movimentos, undefined, 'nada foi gravado');
});

test('so lote vencido disponivel tambem derruba, com mensagem propria', async function () {
  const estado = {
    ficha: [{ product_id: 'p1', name: 'Skinbooster 2ml', quantity: '1.000' }],
    lotes: [{ id: 'l1', product_id: 'p1', quantity: '5.000', expiry_date: '2026-08-01', unit_cost: '410.00', received_at: '2026-01-01' }]
  };
  await assert.rejects(
    () => efeitos.baixarInsumosDoAtendimento(AP, fakeConn(estado), { chave: 'ap_1', hoje: HOJE }),
    /vencid/i
  );
});

test('CONCLUIR DUAS VEZES GERA UMA BAIXA SO', async function () {
  const estado = {
    jaBaixado: true,
    ficha: [{ product_id: 'p1', name: 'Toxina', quantity: '1.000' }],
    lotes: [{ id: 'l1', product_id: 'p1', quantity: '4.000', expiry_date: '2027-01-01', unit_cost: '980.00', received_at: '2026-01-01' }]
  };
  const r = await efeitos.baixarInsumosDoAtendimento(AP, fakeConn(estado), { chave: 'ap_1', hoje: HOJE });
  assert.strictEqual(r.baixado, false);
  assert.match(r.motivo, /ja baixado/i);
  assert.strictEqual(estado.movimentos, undefined);
});

test('estorno devolve ao MESMO lote de onde saiu', async function () {
  // Devolver "para o estoque" sem dizer para qual lote quebraria a
  // rastreabilidade: o saldo voltaria certo e a origem do produto, nao.
  const estado = {
    saidas: [{ batch_id: 'l1', product_id: 'p1', quantity: '2.000', unit_cost: '980.00' }],
    lotes: [{ id: 'l1', product_id: 'p1', quantity: '2.000', expiry_date: '2027-01-01', unit_cost: '980.00', received_at: '2026-01-01' }]
  };
  const conn = {
    async query(sql, params) {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      if (/FROM stock_movements/.test(s) && /SAIDA/.test(s)) return [estado.saidas];
      if (/UPDATE stock_batches/.test(s)) {
        estado.devolvido = { lote: params[1], qtd: Number(params[0]) };
        return [{ affectedRows: 1 }];
      }
      if (/INSERT INTO stock_movements/.test(s)) {
        estado.tipoGravado = /'ESTORNO'/.test(s) ? 'ESTORNO' : '?';
        return [{ affectedRows: 1 }];
      }
      return [[]];
    }
  };
  const r = await efeitos.devolverInsumosDoAtendimento(AP, conn, { chave: 'ap_1' });
  assert.strictEqual(r.devolvido, true);
  assert.deepStrictEqual(estado.devolvido, { lote: 'l1', qtd: 2 });
  assert.strictEqual(estado.tipoGravado, 'ESTORNO', 'estorno e movimento novo, nao apagamento');
});

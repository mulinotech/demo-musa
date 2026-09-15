'use strict';
/** Fidelização por pontos (Fase 5).
 *
 *  As cinco provas que o Definition of Done exige estão aqui, e a terceira é a
 *  que sustenta o programa inteiro: resgatar R$ 25 num atendimento de R$ 250
 *  tem de acumular 225 pontos, não 250. Acumular sobre o valor cheio faz a
 *  paciente gerar pontos com os próprios pontos, e o programa se financia até
 *  quebrar — sem nenhum erro aparecer em tela.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const f = require('../server/services/fidelidade');
const efeitos = require('../server/services/efeitos-fidelidade');
const worker = require('../server/workers/expiracao-pontos');

const HOJE = '2026-09-01';
const CFG = f.config({ active: 1, points_per_real: 1, redemption_value: 0.1, expiry_days: 90, min_points_to_redeem: 100 });

const ap = (extra) => Object.assign({
  id: 'ap_1', client_id: 'cl_1', kind: 'ATENDIMENTO', title: 'Limpeza de Pele',
  price: '250.00', starts_at: '2026-09-01 14:00:00'
}, extra || {});

const tx = (id, tipo, pontos, extra) => Object.assign({
  id: id, type: tipo, points: pontos, expires_at: null, expired: 0,
  created_at: '2026-01-01 10:00:00', description: tipo
}, extra || {});

/* ------------------------------------------------ 1. piso, nao arredondamento */

test('atendimento de R$ 250,00 credita exatamente 250 pontos', function () {
  assert.strictEqual(f.pontosDoAtendimento(ap(), CFG), 250);
});

test('R$ 249,90 credita 249 -- PISO, nunca arredondamento', function () {
  // Arredondar daria 250. Creditar ponto que nao foi conquistado e divida
  // silenciosa, e ela cresce sozinha a cada atendimento.
  assert.strictEqual(f.pontosDoAtendimento(ap({ price: '249.90' }), CFG), 249);
  assert.strictEqual(f.pontosDoAtendimento(ap({ price: '99.99' }), CFG), 99);
});

test('bloqueio, cortesia e programa desligado nao acumulam', function () {
  assert.strictEqual(f.pontosDoAtendimento(ap({ kind: 'BLOQUEIO' }), CFG), 0);
  assert.strictEqual(f.pontosDoAtendimento(ap({ price: 0 }), CFG), 0);
  assert.strictEqual(f.pontosDoAtendimento(ap({ price: null }), CFG), 0);
  const desligado = Object.assign({}, CFG, { active: false });
  assert.strictEqual(f.pontosDoAtendimento(ap(), desligado), 0);
});

test('pontos por real diferente de 1 e respeitado, ainda com piso', function () {
  const c = Object.assign({}, CFG, { pointsPerReal: 1.5 });
  assert.strictEqual(f.pontosDoAtendimento(ap({ price: '99.00' }), c), 148);  // 148,5 -> 148
});

/* ------------------------------------------------------------- 2. saldo */

test('saldo e a soma das transacoes, e o sinal vem da propria linha', function () {
  const extrato = [tx('a', 'ACUMULO', 250), tx('b', 'RESGATE', -100), tx('c', 'AJUSTE', 30)];
  assert.strictEqual(f.saldo(extrato, HOJE), 180);
});

test('estorno de acumulo e negativo; estorno de resgate e positivo', function () {
  // O contrato original dizia "ESTORNO e positivo". Nao fecha: o mesmo tipo
  // desfaz creditos e desfaz resgates. O sinal segue o fato, nunca o tipo.
  const desfazAcumulo = [tx('a', 'ACUMULO', 250), tx('b', 'ESTORNO', -250)];
  const desfazResgate = [tx('a', 'ACUMULO', 250), tx('b', 'RESGATE', -100), tx('c', 'ESTORNO', 100)];
  assert.strictEqual(f.saldo(desfazAcumulo, HOJE), 0);
  assert.strictEqual(f.saldo(desfazResgate, HOJE), 250);
});

test('ponto vencido continua no extrato e sai do saldo', function () {
  const extrato = [
    tx('velho', 'ACUMULO', 100, { expires_at: '2026-08-01' }),
    tx('novo', 'ACUMULO', 50, { expires_at: '2027-01-01' })
  ];
  assert.strictEqual(f.saldo(extrato, HOJE), 50, 'so o que ainda vale');
  assert.strictEqual(f.filaDeAcumulos(extrato).length, 2, 'mas os dois seguem no historico');
});

test('resgate consome primeiro o que vence antes', function () {
  // Mesma logica FEFO do estoque: o que vai virar po primeiro e o que precisa
  // ser gasto primeiro.
  const extrato = [
    tx('vence_depois', 'ACUMULO', 100, { expires_at: '2027-06-01' }),
    tx('vence_antes', 'ACUMULO', 100, { expires_at: '2026-10-01' }),
    tx('r', 'RESGATE', -100)
  ];
  const fila = f.filaDeAcumulos(extrato);
  assert.strictEqual(fila[0].id, 'vence_antes');
  assert.strictEqual(fila[0].restante, 0, 'o que vence antes foi consumido');
  assert.strictEqual(fila[1].restante, 100);
});

test('acumulo sem validade fica para o fim da fila', function () {
  const extrato = [
    tx('sem', 'ACUMULO', 100, { expires_at: null }),
    tx('com', 'ACUMULO', 100, { expires_at: '2027-01-01' }),
    tx('r', 'RESGATE', -50)
  ];
  const fila = f.filaDeAcumulos(extrato);
  assert.strictEqual(fila[0].id, 'com');
  assert.strictEqual(fila[0].restante, 50);
});

test('a expirar em 30 dias e o numero que chama a paciente de volta', function () {
  const extrato = [
    tx('a', 'ACUMULO', 80, { expires_at: '2026-09-20' }),   // dentro
    tx('b', 'ACUMULO', 40, { expires_at: '2026-11-01' }),   // fora
    tx('c', 'ACUMULO', 10, { expires_at: '2026-08-01' })    // ja venceu
  ];
  assert.strictEqual(f.aExpirar(extrato, 30, HOJE), 80);
});

/* ------------------------------------------------------------ 3. resgate */

test('RESGATE DE R$ 25 EM ATENDIMENTO DE R$ 250 ACUMULA 225, NAO 250', function () {
  // A prova que sustenta o programa. 250 pontos valem R$ 25,00.
  const premio = { id: 'rw1', active: 1, points_cost: 250, type: 'DESCONTO_VALOR', value: 25 };
  const d = f.podeResgatar({ config: CFG, premio: premio, compromisso: ap(), saldo: 400 });
  assert.strictEqual(d.ok, true);
  assert.strictEqual(d.desconto, 25);
  assert.strictEqual(d.precoFinal, 225);
  assert.strictEqual(d.acumuloPrevisto, 225, 'o acumulo cai sobre o que a paciente PAGOU');

  // E o efeito de verdade confirma, porque le o price ja descontado.
  assert.strictEqual(f.pontosDoAtendimento(ap({ price: 225 }), CFG), 225);
});

test('desconto percentual sai sobre o preco do momento', function () {
  const premio = { id: 'rw2', active: 1, points_cost: 400, type: 'DESCONTO_PCT', value: 20 };
  const d = f.podeResgatar({ config: CFG, premio: premio, compromisso: ap({ price: '1800.00' }), saldo: 500 });
  assert.strictEqual(d.desconto, 360);
  assert.strictEqual(d.precoFinal, 1440);
  // 20% de um procedimento de R$ 1.800 devolve R$ 360 por 400 pontos, enquanto
  // a tabela diria R$ 40. E por isso que o custo do programa e medido em reais
  // gravados, nao em pontos x valor do ponto.
});

test('premio maior que o atendimento nao gera credito a favor da paciente', function () {
  const premio = { id: 'rw3', active: 1, points_cost: 1100, type: 'DESCONTO_VALOR', value: 120 };
  const d = f.podeResgatar({ config: CFG, premio: premio, compromisso: ap({ price: '80.00' }), saldo: 2000 });
  assert.strictEqual(d.desconto, 80, 'o desconto para no preco');
  assert.strictEqual(d.precoFinal, 0, 'nunca negativo: receita negativa no financeiro');
});

test('SALDO ABAIXO DO MINIMO BLOQUEIA O RESGATE', function () {
  const premio = { id: 'rw1', active: 1, points_cost: 50, type: 'DESCONTO_VALOR', value: 5 };
  const d = f.podeResgatar({ config: CFG, premio: premio, compromisso: ap(), saldo: 80 });
  assert.strictEqual(d.ok, false);
  assert.strictEqual(d.status, 409);
  assert.match(d.error, /minimo para resgatar e 100/);
});

test('saldo insuficiente diz quantos pontos faltam', function () {
  const premio = { id: 'rw1', active: 1, points_cost: 500, type: 'DESCONTO_VALOR', value: 50 };
  const d = f.podeResgatar({ config: CFG, premio: premio, compromisso: ap(), saldo: 380 });
  assert.strictEqual(d.ok, false);
  assert.match(d.error, /Faltam 120/);
});

test('RESGATE EM ATENDIMENTO JA CONCLUIDO E RECUSADO', function () {
  // A trava mais importante da ordem do fluxo. Se passasse, o acumulo ja teria
  // sido creditado sobre o valor cheio e a conta ficaria errada em favor da
  // paciente, em silencio.
  const premio = { id: 'rw1', active: 1, points_cost: 250, type: 'DESCONTO_VALOR', value: 25 };
  const d = f.podeResgatar({
    config: CFG, premio: premio, saldo: 400,
    compromisso: ap({ completed_at: '2026-09-01 15:00:00' })
  });
  assert.strictEqual(d.ok, false);
  assert.match(d.error, /valor cheio/);
});

test('dois resgates no mesmo atendimento sao recusados', function () {
  const premio = { id: 'rw1', active: 1, points_cost: 250, type: 'DESCONTO_VALOR', value: 25 };
  const d = f.podeResgatar({ config: CFG, premio: premio, compromisso: ap(), saldo: 900, jaResgatou: true });
  assert.strictEqual(d.ok, false);
  assert.match(d.error, /ja tem um resgate/);
});

test('compromisso sem paciente nao resgata', function () {
  const premio = { id: 'rw1', active: 1, points_cost: 100, type: 'DESCONTO_VALOR', value: 10 };
  const d = f.podeResgatar({ config: CFG, premio: premio, compromisso: ap({ client_id: null }), saldo: 900 });
  assert.strictEqual(d.status, 400);
});

/* ----------------------------------------- 4. idempotencia do acumulo */

/** Escopo de mentira (M1.1c). Ver a nota igual em tests/estoque.test.js: o
 *  serviço passou a receber um escopo de clínica, e o de mentira é um escopo de
 *  verdade sobre um executor de mentira — o analisador da camada roda, e a
 *  conferência abaixo faz este teste provar que a consulta leva o filtro.
 *
 *  A clínica de ensaio NÃO se chama `cl_1` de propósito: o compromisso destes
 *  testes tem `client_id: 'cl_1'`, e um nome igual faria `semClinica` tirar o
 *  parâmetro errado. Coincidência de valor entre coisas diferentes é como um
 *  teste passa medindo outra coisa. */
const escopo = require('../server/db/escopo');
const CL = 'cl_ensaio';
const semClinica = (params) => (params || []).filter((x) => x !== CL);

const CFG_ATIVA = { points_per_real: 1, redemption_value: 0.1, expiry_days: 90,
                    min_points_to_redeem: 100 };

function fakeConn(estado) {
  return escopo.fazerEscopo(CL, {
    async query(sql, params) {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      assert.ok((params || []).indexOf(CL) !== -1,
        'consulta sem o valor da clinica nos parametros: ' + s.slice(0, 90));
      const p = semClinica(params);

      if (/FROM loyalty_settings/.test(s)) {
        // Clinica sem linha de configuracao NAO pontua (M1.1c). O estado
        // `semPrograma` finge exatamente esse caso.
        if (estado.semPrograma) return [[]];
        return [[Object.assign({ active: estado.ativo === false ? 0 : 1 }, CFG_ATIVA)]];
      }
      if (/INSERT INTO loyalty_transactions/.test(s)) {
        if (estado.duplicado) { const e = new Error('dup'); e.code = 'ER_DUP_ENTRY'; throw e; }
        estado.inseridos = (estado.inseridos || []).concat([{ pontos: p[2] }]);
        return [{ affectedRows: 1 }];
      }
      if (/FROM loyalty_transactions/.test(s)) return [estado.acumulos || []];
      return [[]];
    }
  });
}

test('CONCLUIR DUAS VEZES CREDITA UMA VEZ SO', async function () {
  const primeira = { };
  const r1 = await efeitos.creditarPontos(ap(), fakeConn(primeira), { chave: 'ap_1' });
  assert.strictEqual(r1.creditado, true);
  assert.strictEqual(r1.pontos, 250);

  // A segunda passada esbarra no indice unico do banco -- que e a trava de
  // verdade, nao o `if` do codigo.
  const segunda = { duplicado: true };
  const r2 = await efeitos.creditarPontos(ap(), fakeConn(segunda), { chave: 'ap_1' });
  assert.strictEqual(r2.creditado, false);
  assert.strictEqual(r2.motivo, 'ja creditado');
});

test('programa desligado nao credita, e nao e erro', async function () {
  const r = await efeitos.creditarPontos(ap(), fakeConn({ ativo: false }), { chave: 'ap_1' });
  assert.strictEqual(r.creditado, false);
  assert.strictEqual(r.motivo, 'programa desativado');
});

test('fidelizacao nao instalada nao impede concluir atendimento', async function () {
  const conn = escopo.fazerEscopo(CL, {
    async query() { const e = new Error('no table'); e.code = 'ER_NO_SUCH_TABLE'; throw e; } });
  const r = await efeitos.creditarPontos(ap(), conn, {});
  assert.strictEqual(r.creditado, false);
  assert.match(r.motivo, /nao configurado nesta clinica/);
});

test('a VALIDADE sai certa quando a data vem como objeto Date do driver', async function () {
  // Defeito real, achado em 08/09 pela ferramenta de vazamento. O mysql2
  // devolve DATETIME como Date; `String(Date).slice(0,10)` da "Mon Sep 08", e
  // a validade saia `NaN-NaN-NaN`. O MySQL RECUSAVA o INSERT e a conclusao do
  // atendimento morria com uma mensagem que nao dizia nada.
  const estado = {};
  const comDate = Object.assign(ap(), { starts_at: new Date('2026-09-08T09:00:00') });
  const r = await efeitos.creditarPontos(comDate, fakeConn(estado), { chave: 'ap_date' });
  assert.strictEqual(r.creditado, true);
  assert.match(String(r.expiraEm), /^\d{4}-\d{2}-\d{2}$/,
    'validade tem de ser uma data, e veio: ' + r.expiraEm);
  assert.strictEqual(r.expiraEm, '2026-12-07', '90 dias depois de 08/09/2026');
});

test('CLINICA SEM PROGRAMA CONFIGURADO NAO PONTUA, e nao herda o da vizinha', async function () {
  // A mudanca de comportamento da M1.1c, e a razao dela: herdar a configuracao
  // da clinica 1 daria a regra de pontos de OUTRO negocio valendo dinheiro na
  // recepcao desta. Falhar fechado aqui e visivel no primeiro atendimento.
  const estado = { semPrograma: true };
  const r = await efeitos.creditarPontos(ap(), fakeConn(estado), { chave: 'ap_1' });
  assert.strictEqual(r.creditado, false);
  assert.match(r.motivo, /nao configurado nesta clinica/);
  assert.strictEqual(estado.inseridos, undefined, 'nao pode ter gravado ponto nenhum');
});

test('estorno de conclusao lanca pontos negativos e nao apaga o credito', async function () {
  const estado = { acumulos: [{ id: 'lt1', client_id: 'cl_1', points: 250 }] };
  const consultas = [];
  const conn = escopo.fazerEscopo(CL, {
    async query(sql, params) {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      consultas.push(s);
      const p = semClinica(params);
      if (/FROM loyalty_settings/.test(s)) return [[Object.assign({ active: 1 }, CFG_ATIVA)]];
      if (/SELECT id, client_id, points FROM loyalty_transactions/.test(s)) return [estado.acumulos];
      if (/INSERT INTO loyalty_transactions/.test(s)) { estado.pontosGravados = p[2]; return [{ affectedRows: 1 }]; }
      return [[]];
    }
  });
  const r = await efeitos.estornarPontos(ap(), conn, { chave: 'ap_1', motivo: 'engano' });
  assert.strictEqual(r.estornado, true);
  assert.strictEqual(estado.pontosGravados, -250, 'negativo: desfaz um credito');
  assert.ok(!consultas.some((s) => /DELETE/.test(s)), 'o credito errado fica no extrato');
});

/* -------------------------------------------------- 5. expiracao */

test('WORKER RODANDO DUAS VEZES NO MESMO DIA NAO EXPIRA EM DOBRO', async function () {
  const linhas = [
    { id: 'lt1', client_id: 'cl_1', client_name: 'Ana', type: 'ACUMULO', points: 100,
      expires_at: '2026-08-01', expired: 0, created_at: '2025-08-01 10:00:00', description: 'x' }
  ];
  const estado = { chaves: new Set(), inseridos: 0 };
  // ESCOPO, e nao pool: desde a M2.3 o worker recebe o escopo de UMA clinica, e
  // o laco sobre as clinicas fica em `rodarUmaVez`. O reconhecimento abaixo
  // exige a clausula de clinica -- um worker que voltasse a consultar sem
  // filtrar deixaria de casar com os `if` e o teste quebraria, que e o que se
  // quer.
  //
  // ATENCAO A DIFERENCA, que custou um teste vermelho: o EXECUTOR de baixo
  // recebe o SQL **preparado**, ja com `:clinica` trocada por `?`. Quem ve a
  // marca literal e o `q` do escopo -- e por isso os testes de lembrete, que
  // fingem o proprio `q`, procuram `:clinica`, e este, que finge o executor,
  // procura `clinica_id = ?`.
  const db = escopo.fazerEscopo(CL, {
    async query(sql, params) {
      const t = String(sql).replace(/\s+/g, ' ').trim();
      const p = semClinica(params);
      if (/FROM loyalty_transactions t JOIN clients/.test(t)) {
        assert.match(t, /t\.clinica_id = \?/, 'a leitura do extrato tem de filtrar clinica');
        return [linhas];
      }
      if (/INSERT INTO loyalty_transactions/.test(t)) {
        assert.match(t, /clinica_id/, 'a transacao de expiracao tem de carimbar a clinica');
        const chave = 'WORKER|' + p[4] + '|EXPIRACAO';
        if (estado.chaves.has(chave)) { const e = new Error('dup'); e.code = 'ER_DUP_ENTRY'; throw e; }
        estado.chaves.add(chave);
        estado.inseridos += 1;
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE loyalty_transactions SET expired/.test(t)) {
        assert.match(t, /clinica_id = \?/, 'a marca de expirado tem de filtrar clinica');
        const l = linhas.find((x) => x.id === p[0]);
        if (l) l.expired = 1;
        return [{ affectedRows: 1 }];
      }
      return [[]];
    }
  });

  const a = await worker.umaClinica(db, { hoje: HOJE });
  const b = await worker.umaClinica(db, { hoje: HOJE });

  assert.strictEqual(a.expirados, 1);
  assert.strictEqual(a.pontos, 100);
  assert.strictEqual(b.expirados, 0, 'a segunda passada nao acha mais nada');
  assert.strictEqual(estado.inseridos, 1, 'uma transacao de expiracao, uma so');
});

test('o que o worker expira e o RESTANTE, nao o valor original do acumulo', async function () {
  // 100 acumulados, 60 ja resgatados: expiram 40. Expirar 100 deixaria o saldo
  // negativo, e o extrato da paciente ficaria impossivel de explicar.
  const extrato = [
    tx('a', 'ACUMULO', 100, { expires_at: '2026-08-01' }),
    tx('r', 'RESGATE', -60)
  ];
  const alvos = f.paraExpirar(extrato, HOJE);
  assert.strictEqual(alvos.length, 1);
  assert.strictEqual(alvos[0].pontos, 40);
});

test('acumulo ja marcado como expirado nao volta para a fila do worker', function () {
  const extrato = [tx('a', 'ACUMULO', 100, { expires_at: '2026-08-01', expired: 1 })];
  assert.deepStrictEqual(f.paraExpirar(extrato, HOJE), []);
});

/* ------------------------------------------------ configuracao e exemplo */

test('o exemplo da tela mostra quanto do faturamento volta em desconto', function () {
  // 1 ponto por real com ponto valendo R$ 0,10 devolve 10%. Com R$ 0,50
  // devolveria 50% -- e isso nao e obvio olhando dois campos numericos.
  const e = f.exemplo(CFG, 250);
  assert.strictEqual(e.pontos, 250);
  assert.strictEqual(e.vale, 25);
  assert.strictEqual(e.percentualDeVolta, 10);

  const generoso = Object.assign({}, CFG, { redemptionValue: 0.5 });
  assert.strictEqual(f.exemplo(generoso, 250).percentualDeVolta, 50);
});

test('validade zero significa nao expira', function () {
  const c = Object.assign({}, CFG, { expiryDays: 0 });
  assert.strictEqual(f.validadeDoAcumulo('2026-09-01', c), null);
  assert.strictEqual(f.validadeDoAcumulo('2026-09-01', CFG), '2026-11-30');
});

test('90 dias sao 90 dias, nunca "tres meses"', function () {
  // O motivo de a validade ter deixado de ser guardada em meses. Tres meses
  // valem 89, 90, 91 ou 92 dias conforme o mes de partida; a clinica promete
  // um numero fixo a paciente, e quem perde a diferenca e sempre ela.
  const c = Object.assign({}, CFG, { expiryDays: 90 });

  // 1o de setembro + 90 dias = 30 de novembro. Tres meses dariam 1o de
  // dezembro: um dia a mais.
  assert.strictEqual(f.validadeDoAcumulo('2026-09-01', c), '2026-11-30');

  // 31 de janeiro e o caso que expoe o erro na outra direcao: 90 dias caem em
  // 1o de maio, e tres meses de calendario cairiam em 30 de abril -- 89 dias,
  // um dia a MENOS do que foi prometido a paciente.
  assert.strictEqual(f.validadeDoAcumulo('2026-01-31', c), '2026-05-01');

  // E o ano bissexto nao muda a conta, porque a conta e em dias.
  assert.strictEqual(f.validadeDoAcumulo('2028-01-01', c), '2028-03-31');
});

test('a validade sai da configuracao, nao de um padrao escondido', function () {
  const trinta = Object.assign({}, CFG, { expiryDays: 30 });
  const anual = Object.assign({}, CFG, { expiryDays: 365 });
  assert.strictEqual(f.validadeDoAcumulo('2026-09-01', trinta), '2026-10-01');
  assert.strictEqual(f.validadeDoAcumulo('2026-09-01', anual), '2027-09-01');
});

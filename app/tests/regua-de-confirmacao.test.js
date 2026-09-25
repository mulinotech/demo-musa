'use strict';
/** A régua de confirmação: três disparos e um cancelamento automático (M6.7).
 *
 *  Este é o módulo do sistema com o pior custo de erro. Um defeito aqui não
 *  devolve número errado numa tela — ele manda mensagem para o celular de uma
 *  paciente, e na terceira etapa **desmarca o horário dela sozinho**. Não há
 *  desfazer para nenhum dos dois.
 *
 *  Por isso a maior parte dos testes deste arquivo pergunta o que a régua NÃO
 *  faz: não cobra quem respondeu, não cobra quem confirmou, não recomeça do
 *  zero para quem já recebeu o lembrete antigo, e não manda a terceira antes da
 *  segunda.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const L = require('../server/services/lembretes');

/** Um compromisso de ensaio. `stage` é o que já saiu. */
function compromisso(extra) {
  return Object.assign({
    id: 'a1', kind: 'ATENDIMENTO', status: 'AGENDADO',
    phone: '11999998888', client_name: 'Ana Paula', title: 'Limpeza de pele',
    professional_name: 'Dra Musa',
    starts_at: '2026-09-10 14:00:00',
    reminder_stage: 0, reminder_sent_at: null,
    reminder_last_at: null, reminder_reply_at: null
  }, extra || {});
}

/* =========================================================== A ANTECEDÊNCIA */

test('o primeiro disparo saiu de 24 para 26 horas', () => {
  assert.strictEqual(L.ANTECEDENCIA_H, 26);
  // 10/09 às 14:00 menos 26 h = 09/09 às 12:00, dentro da janela civilizada.
  assert.strictEqual(L.momentoDeEnvio('2026-09-10 14:00:00'), '2026-09-09 12:00:00');
});

test('as esperas sao 2 h e 4 h, contadas do envio ANTERIOR', () => {
  assert.deepStrictEqual(L.ESPERA_H, { 2: 2, 3: 4 });
  assert.strictEqual(L.momentoDaCobranca('2026-09-09 12:00:00', 2), '2026-09-09 14:00:00');
  assert.strictEqual(L.momentoDaCobranca('2026-09-09 14:00:00', 4), '2026-09-09 18:00:00');
});

test('a cobranca fora da janela espera PARA FRENTE, nunca para tras', () => {
  /* É a diferença entre esta função e `momentoDeEnvio`, e é a que evita o
     absurdo: recuar colocaria "ainda não recebemos sua confirmação" ANTES do
     pedido de confirmação. */
  assert.strictEqual(L.momentoDaCobranca('2026-09-09 19:30:00', 4), '2026-09-10 08:00:00');
  assert.strictEqual(L.momentoDaCobranca('2026-09-09 23:00:00', 2), '2026-09-10 08:00:00');

  const lembrete = L.momentoDeEnvio('2026-09-10 09:00:00');   // 26 h antes = 07:00, cedo
  assert.strictEqual(lembrete, '2026-09-08 20:00:00', 'o lembrete recua');
  assert.ok(L.momentoDaCobranca(lembrete, 2) > lembrete, 'a cobranca nunca precede o lembrete');
});

/* ================================================== A SEQUÊNCIA DAS ETAPAS */

test('etapa 1: o lembrete sai na hora marcada, e nao antes', () => {
  const c = compromisso();
  assert.deepStrictEqual(
    (({ enviar, etapa, motivo }) => ({ enviar, etapa, motivo }))(
      L.deveEnviar(c, '2026-09-09 11:59:00')),
    { enviar: false, etapa: 0, motivo: 'ainda cedo' });

  const d = L.deveEnviar(c, '2026-09-09 12:00:00');
  assert.strictEqual(d.enviar, true);
  assert.strictEqual(d.etapa, 1);
  assert.strictEqual(d.cancela, false);
});

test('etapa 2: duas horas depois da primeira, e so entao', () => {
  const c = compromisso({ reminder_stage: 1, reminder_sent_at: '2026-09-09 12:00:00',
                          reminder_last_at: '2026-09-09 12:00:00' });
  assert.strictEqual(L.deveEnviar(c, '2026-09-09 13:59:00').enviar, false);

  const d = L.deveEnviar(c, '2026-09-09 14:00:00');
  assert.strictEqual(d.enviar, true);
  assert.strictEqual(d.etapa, 2);
  assert.strictEqual(d.cancela, false, 'a segunda NAO cancela');
});

test('etapa 3: quatro horas depois da segunda, e ela cancela', () => {
  const c = compromisso({ reminder_stage: 2, reminder_sent_at: '2026-09-09 12:00:00',
                          reminder_last_at: '2026-09-09 14:00:00' });
  assert.strictEqual(L.deveEnviar(c, '2026-09-09 17:59:00').enviar, false);

  const d = L.deveEnviar(c, '2026-09-09 18:00:00');
  assert.strictEqual(d.enviar, true);
  assert.strictEqual(d.etapa, 3);
  assert.strictEqual(d.cancela, true);
});

test('depois da terceira a regua acaba, e nao recomeca', () => {
  const c = compromisso({ reminder_stage: 3, reminder_sent_at: '2026-09-09 12:00:00',
                          reminder_last_at: '2026-09-09 18:00:00' });
  const d = L.deveEnviar(c, '2026-09-09 23:00:00');
  assert.strictEqual(d.enviar, false);
  assert.strictEqual(d.motivo, 'regua concluida');
});

/* ================================================== O QUE PARA A RÉGUA */

test('qualquer resposta da paciente para a cobranca', () => {
  /* O caso que motivou a coluna: "posso chegar 10 minutos depois?" não é "1"
     nem "2". Sem isto, essa paciente receberia a cobrança e, quatro horas
     depois, o cancelamento do horário que ela acabou de tratar de manter. */
  const c = compromisso({ reminder_stage: 1, reminder_last_at: '2026-09-09 12:00:00',
                          reminder_sent_at: '2026-09-09 12:00:00',
                          reminder_reply_at: '2026-09-09 12:31:00' });
  const d = L.deveEnviar(c, '2026-09-09 15:00:00');
  assert.strictEqual(d.enviar, false);
  assert.strictEqual(d.motivo, 'paciente ja respondeu');
});

test('quem confirmou nao e cobrado, mesmo sem ter respondido por aqui', () => {
  /* Confirmação pelo balcão ou por telefone chega como `status`, não como
     resposta. Cobrar quem já confirmou é o jeito mais rápido de a clínica
     parecer desorganizada para a própria paciente. */
  const c = compromisso({ status: 'CONFIRMADO', reminder_stage: 1,
                          reminder_sent_at: '2026-09-09 12:00:00',
                          reminder_last_at: '2026-09-09 12:00:00' });
  assert.strictEqual(L.deveEnviar(c, '2026-09-09 15:00:00').motivo, 'ja confirmado');
});

test('mas o CONFIRMADO ainda recebe o primeiro lembrete', () => {
  /* Lembrete serve para quem vem; cobrança é que não faz sentido. Confundir os
     dois tiraria o lembrete de quem confirmou com uma semana de antecedência —
     justamente quem mais precisa dele. */
  const c = compromisso({ status: 'CONFIRMADO' });
  const d = L.deveEnviar(c, '2026-09-09 12:00:00');
  assert.strictEqual(d.enviar, true);
  assert.strictEqual(d.etapa, 1);
});

test('cancelado, realizado e falta ficam de fora da regua inteira', () => {
  for (const s of ['CANCELADO', 'REALIZADO', 'FALTOU']) {
    const d = L.deveEnviar(compromisso({ status: s, reminder_stage: 1 }), '2026-09-09 15:00:00');
    assert.strictEqual(d.enviar, false, s);
    assert.match(d.motivo, /status/);
  }
});

test('bloqueio de horario nao e paciente', () => {
  assert.strictEqual(L.deveEnviar(compromisso({ kind: 'BLOQUEIO' }), '2026-09-09 13:00:00').enviar, false);
});

test('depois do horario marcado nao sai mensagem nenhuma', () => {
  /* Inclusive a terceira: cancelar por falta de confirmação um horário que já
     passou seria o sistema reescrevendo o que aconteceu. Quem faltou, faltou —
     e isso é `FALTOU`, marcado por gente. */
  const c = compromisso({ reminder_stage: 2, reminder_sent_at: '2026-09-09 12:00:00',
                          reminder_last_at: '2026-09-09 14:00:00' });
  const d = L.deveEnviar(c, '2026-09-10 14:30:00');
  assert.strictEqual(d.enviar, false);
  assert.strictEqual(d.motivo, 'horario ja passou');
});

test('paciente sem telefone nao entra na regua, e portanto nao e cancelada', () => {
  const c = compromisso({ phone: '', reminder_stage: 2, reminder_last_at: '2026-09-09 14:00:00' });
  const d = L.deveEnviar(c, '2026-09-09 19:00:00');
  assert.strictEqual(d.enviar, false);
  assert.strictEqual(d.motivo, 'paciente sem telefone');
});

/* ============================================ O BANCO DE ONTEM, LIDO HOJE */

test('quem ja recebeu o lembrete antigo nao recebe o primeiro de novo', () => {
  /* Linha de antes da migration 044: `reminder_sent_at` preenchido e
     `reminder_stage` em 0. Contar como etapa 0 mandaria o lembrete repetido —
     e a paciente lê repetição como "esse consultório está com problema". */
  const c = compromisso({ reminder_stage: 0, reminder_sent_at: '2026-09-09 12:00:00' });
  assert.strictEqual(L.etapaAtual(c), 1);
  const d = L.deveEnviar(c, '2026-09-09 15:00:00');
  assert.strictEqual(d.etapa, 2, 'segue de onde parou');
});

test('sem registro do envio anterior a regua PARA', () => {
  /* Inventar uma base para a conta faria a cobrança sair na hora errada — e,
     quatro horas depois, o cancelamento também. Parar e dizer o motivo é a
     única saída honesta. */
  const c = compromisso({ reminder_stage: 1, reminder_sent_at: null, reminder_last_at: null });
  const d = L.deveEnviar(c, '2026-09-09 20:00:00');
  assert.strictEqual(d.enviar, false);
  assert.strictEqual(d.motivo, 'sem registro do envio anterior');
});

test('etapa corrompida no banco nao vira etapa quatro', () => {
  for (const v of [9, 99, 'abc', null, -1]) {
    const e = L.etapaAtual(compromisso({ reminder_stage: v }));
    assert.ok(e >= 0 && e <= 3, String(v) + ' -> ' + e);
  }
});

/* ============================================================== OS TEXTOS */

test('cada etapa tem o proprio texto, e sao tres diferentes', () => {
  const t = [1, 2, 3].map((e) => L.templateDaEtapa({}, e));
  assert.strictEqual(new Set(t).size, 3);
});

test('a segunda mensagem diz que ha uma profissional reservada', () => {
  /* Era o pedido, com estas palavras. Repetir a primeira mensagem soaria a
     sistema quebrado; dizer o que está em jogo é o que faz a pessoa responder. */
  assert.match(L.TEMPLATE_COBRANCA, /profissional reservada exclusivamente/i);
  assert.match(L.TEMPLATE_COBRANCA, /nao recebemos sua confirmacao/i);
});

test('a terceira anuncia o cancelamento e oferece outra data', () => {
  assert.match(L.TEMPLATE_CANCELAMENTO, /foi cancelado/i);
  assert.match(L.TEMPLATE_CANCELAMENTO, /outra data/i);
});

test('a clinica pode reescrever a 2a e a 3a; sem texto proprio vale o padrao', () => {
  const cfg = { template: 'meu 1', templateCobranca: 'meu 2', templateCancelamento: 'meu 3' };
  assert.strictEqual(L.templateDaEtapa(cfg, 2), 'meu 2');
  assert.strictEqual(L.templateDaEtapa(cfg, 3), 'meu 3');
  assert.strictEqual(L.templateDaEtapa({}, 2), L.TEMPLATE_COBRANCA);
});

test('as variaveis sao preenchidas nas tres mensagens', () => {
  const c = compromisso();
  for (const e of [1, 2, 3]) {
    const m = L.montarMensagem(L.templateDaEtapa({}, e), c);
    assert.match(m, /Ana/, 'etapa ' + e);
    assert.strictEqual(/\{(paciente|procedimento|data|hora|profissional)\}/.test(m), false,
      'etapa ' + e + ': sobrou variavel por preencher');
  }
});

test('a terceira mensagem nao promete remarcar sozinha', () => {
  /* "Vamos remarcar para a proxima semana" seria o sistema marcando horario que
     ninguem escolheu. Ela se coloca a disposicao, e quem remarca e gente. */
  const m = L.montarMensagem(L.TEMPLATE_CANCELAMENTO, compromisso());
  assert.strictEqual(/remarcamos|reagendamos|ja remarcamos/i.test(m), false);
});

/* ============================================ A SEQUÊNCIA INTEIRA, DE PONTA */

test('a regua inteira: tres mensagens e o cancelamento, em ordem', () => {
  let c = compromisso();
  const saiu = [];
  const relogio = ['2026-09-09 12:00:00', '2026-09-09 14:00:00', '2026-09-09 18:00:00',
                   '2026-09-09 22:00:00'];

  for (const agora of relogio) {
    const d = L.deveEnviar(c, agora);
    if (!d.enviar) continue;
    saiu.push({ etapa: d.etapa, quando: agora, cancela: d.cancela });
    // O que o worker grava depois de enviar.
    c = Object.assign({}, c, {
      reminder_stage: d.etapa, reminder_last_at: agora,
      reminder_sent_at: c.reminder_sent_at || agora,
      status: d.cancela ? 'CANCELADO' : c.status
    });
  }

  assert.deepStrictEqual(saiu.map((x) => x.etapa), [1, 2, 3]);
  assert.deepStrictEqual(saiu.map((x) => x.cancela), [false, false, true]);
  assert.strictEqual(c.status, 'CANCELADO');
});

test('uma resposta no meio interrompe a regua e o horario fica de pe', () => {
  let c = compromisso();
  const d1 = L.deveEnviar(c, '2026-09-09 12:00:00');
  c = Object.assign({}, c, { reminder_stage: d1.etapa, reminder_last_at: '2026-09-09 12:00:00',
                             reminder_sent_at: '2026-09-09 12:00:00' });

  // A paciente escreve qualquer coisa. O webhook carimba a coluna.
  c.reminder_reply_at = '2026-09-09 12:40:00';

  for (const agora of ['2026-09-09 14:00:00', '2026-09-09 18:00:00', '2026-09-09 23:00:00']) {
    assert.strictEqual(L.deveEnviar(c, agora).enviar, false, agora);
  }
  assert.strictEqual(c.status, 'AGENDADO', 'o horario continua marcado');
});

/* ================================= A LEITURA DA RESPOSTA NÃO FICOU MAIS FROUXA */

test('"1" confirma, "1 hora antes da?" continua nao confirmando nada', () => {
  assert.strictEqual(L.interpretarResposta('1'), 'CONFIRMAR');
  assert.strictEqual(L.interpretarResposta('2'), 'REMARCAR');
  assert.strictEqual(L.interpretarResposta('1 hora antes da?'), null);
  assert.strictEqual(L.interpretarResposta('sim, mas posso atrasar'), null);
});

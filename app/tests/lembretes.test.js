'use strict';
/** Lembrete automático por WhatsApp (T1.5).
 *
 *  O efeito colateral deste módulo é uma mensagem no celular de uma paciente.
 *  Não existe desfazer. Por isso a regra inteira é pura e testada aqui, e o
 *  worker recebe a função de envio por parâmetro — nestes testes ela é um
 *  espião que só conta chamadas. Nenhum WhatsApp sai daqui.
 *
 *  O contexto do módulo exige explicitamente: rodar duas vezes seguidas não
 *  envia duas mensagens. É o último teste do arquivo.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const l = require('../server/services/lembretes');
const worker = require('../server/workers/lembretes');

/* ------------------------------------------------ quando o lembrete sai */

test('lembrete sai 24 h antes quando a hora e civilizada', function () {
  assert.strictEqual(l.momentoDeEnvio('2026-09-02 14:00:00'), '2026-09-01 14:00:00');
});

test('compromisso da manha cedo nao acorda ninguem de madrugada', function () {
  // 07:00 menos 24 h = 07:00 do dia anterior, fora da janela por uma hora.
  // O envio recua para o ultimo instante valido: 20:00 de dois dias antes.
  assert.strictEqual(l.momentoDeEnvio('2026-09-02 07:00:00'), '2026-08-31 20:00:00');
});

test('compromisso do fim da noite tambem recua, nao avanca', function () {
  // 21:30 menos 24 h = 21:30, depois da janela. Recua para as 20:00 do mesmo
  // dia. Avancar para as 08:00 seguintes deixaria o aviso a 13 h do horario,
  // competindo com a paciente que ja se organizou.
  assert.strictEqual(l.momentoDeEnvio('2026-09-02 21:30:00'), '2026-09-01 20:00:00');
});

test('as 20:00 em ponto ainda esta dentro da janela', function () {
  assert.strictEqual(l.momentoDeEnvio('2026-09-02 20:00:00'), '2026-09-01 20:00:00');
});

test('antecedencia configuravel muda o momento', function () {
  assert.strictEqual(l.momentoDeEnvio('2026-09-02 14:00:00', { antecedenciaH: 48 }), '2026-08-31 14:00:00');
});

/* -------------------------------------------------------- quem recebe */

const compromisso = (extra) => Object.assign({
  id: 'ap_1', kind: 'ATENDIMENTO', status: 'AGENDADO', reminder_sent_at: null,
  phone: '5511999990000', starts_at: '2026-09-02 14:00:00',
  client_name: 'Ana Beatriz Rocha', professional_name: 'Silvia Venancio', title: 'Limpeza de Pele'
}, extra || {});

test('no momento certo, envia', function () {
  const d = l.deveEnviar(compromisso(), '2026-09-01 14:05:00');
  assert.strictEqual(d.enviar, true);
});

test('antes da hora, nao envia', function () {
  const d = l.deveEnviar(compromisso(), '2026-09-01 09:00:00');
  assert.strictEqual(d.enviar, false);
  assert.strictEqual(d.motivo, 'ainda cedo');
});

test('processo que dormiu envia atrasado em vez de nao enviar', function () {
  // Esta e a razao de o gatilho ser um instante e nao uma faixa de 23 a 25 h.
  // O LiteSpeed recicla o processo quando ninguem acessa; com faixa, tudo que
  // vencesse durante o sono nunca sairia, e ninguem ficaria sabendo.
  const d = l.deveEnviar(compromisso(), '2026-09-01 19:00:00');
  assert.strictEqual(d.enviar, true, 'cinco horas depois ainda vale a pena avisar');
  assert.ok(d.atrasadoMin > 0, 'mas fica registrado que saiu atrasado');
});

test('depois do horario marcado nao existe lembrete', function () {
  const d = l.deveEnviar(compromisso(), '2026-09-02 15:00:00');
  assert.strictEqual(d.enviar, false);
  assert.strictEqual(d.motivo, 'horario ja passou');
});

test('lembrete ja enviado nao sai de novo', function () {
  const d = l.deveEnviar(compromisso({ reminder_sent_at: '2026-09-01 14:00:00' }), '2026-09-01 18:00:00');
  assert.strictEqual(d.enviar, false);
  assert.strictEqual(d.motivo, 'lembrete ja enviado');
});

test('cancelado, faltou e bloqueio nao recebem, e o motivo aparece', function () {
  const quando = '2026-09-01 14:05:00';
  assert.strictEqual(l.deveEnviar(compromisso({ status: 'CANCELADO' }), quando).motivo, 'status cancelado');
  assert.strictEqual(l.deveEnviar(compromisso({ status: 'REALIZADO' }), quando).motivo, 'status realizado');
  assert.strictEqual(l.deveEnviar(compromisso({ kind: 'BLOQUEIO' }), quando).motivo, 'bloqueio de horario');
});

test('paciente sem telefone e dito com todas as letras', function () {
  // Silencio aqui vira "por que a fulana nao recebeu?" e uma hora de banco.
  const d = l.deveEnviar(compromisso({ phone: '' }), '2026-09-01 14:05:00');
  assert.strictEqual(d.motivo, 'paciente sem telefone');
});

test('compromisso ja CONFIRMADO ainda recebe o lembrete', function () {
  // Confirmar na semana passada nao substitui lembrar na vespera.
  assert.strictEqual(l.deveEnviar(compromisso({ status: 'CONFIRMADO' }), '2026-09-01 14:05:00').enviar, true);
});

/* ------------------------------------------------------- a mensagem */

test('a mensagem sai com primeiro nome, procedimento, data e hora', function () {
  const m = l.montarMensagem(null, compromisso());
  assert.match(m, /Ola Ana!/, 'primeiro nome, nao o nome completo');
  assert.match(m, /Limpeza de Pele/);
  assert.match(m, /02\/09/);
  assert.match(m, /14:00/);
  assert.match(m, /Silvia/);
  assert.ok(!/\{/.test(m), 'nenhuma variavel sobrou sem preencher');
});

test('template personalizado e respeitado', function () {
  const m = l.montarMensagem('{paciente}, {data} as {hora}. Ate la!', compromisso());
  assert.strictEqual(m, 'Ana, 02/09 as 14:00. Ate la!');
});

/* ------------------------------------------------------- a resposta */

test('1 confirma, 2 pede remarcacao', function () {
  assert.strictEqual(l.interpretarResposta('1'), 'CONFIRMAR');
  assert.strictEqual(l.interpretarResposta('2'), 'REMARCAR');
});

test('palavras equivalentes valem, com ou sem acento e maiuscula', function () {
  assert.strictEqual(l.interpretarResposta('Confirmo'), 'CONFIRMAR');
  assert.strictEqual(l.interpretarResposta('CONFIRMADO!'), 'CONFIRMAR');
  assert.strictEqual(l.interpretarResposta(' sim '), 'CONFIRMAR');
  assert.strictEqual(l.interpretarResposta('Remarcar'), 'REMARCAR');
});

test('FRASE QUE CONTEM O NUMERO NAO CONFIRMA NADA', function () {
  // O erro que este teste existe para impedir: procurar "1" dentro do texto.
  // "1 hora antes da?" e uma pergunta; marcar como confirmado faria a clinica
  // segurar um horario que ninguem garantiu.
  assert.strictEqual(l.interpretarResposta('1 hora antes da?'), null);
  assert.strictEqual(l.interpretarResposta('posso chegar 10 min atrasada?'), null);
  assert.strictEqual(l.interpretarResposta('sim, mas preciso mudar o horario'), null);
  assert.strictEqual(l.interpretarResposta('nao vou poder ir'), null, 'texto livre e assunto de gente');
  assert.strictEqual(l.interpretarResposta(''), null);
  assert.strictEqual(l.interpretarResposta(null), null);
});

/* ---------------------------------------------------------- o worker */

function fakePool(linhas, estado) {
  return {
    async query(sql, params) {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      if (/FROM system_settings/.test(s)) {
        return [[{ chave: 'lembretes_ativos', valor: estado.ativo ? '1' : '0' }]];
      }
      if (/^SELECT a.id, a.title/.test(s)) {
        return [linhas.filter((c) => !c.reminder_sent_at)];
      }
      if (/UPDATE appointments SET reminder_sent_at/.test(s)) {
        const c = linhas.find((x) => x.id === params[0]);
        if (c) c.reminder_sent_at = '2026-09-01 14:05:00';
        estado.marcados = (estado.marcados || 0) + 1;
        return [{ affectedRows: 1 }];
      }
      return [[]];
    }
  };
}

test('desligado, nao envia nada mesmo com compromisso vencido', async function () {
  // O banco de demonstracao tem telefone de gente real. Subir ligado seria
  // disparar WhatsApp para essas pessoas sem ninguem ter pedido.
  const estado = { ativo: false };
  const enviadas = [];
  const r = await worker.rodarUmaVez(fakePool([compromisso()], estado), {
    agora: '2026-09-01 14:05:00', enviar: async (t, m) => enviadas.push([t, m])
  });
  assert.strictEqual(r.enviados, 0);
  assert.strictEqual(enviadas.length, 0);
  assert.match(r.aviso, /desligados/);
});

test('a previa mostra o que sairia e nao envia', async function () {
  const estado = { ativo: false };
  const enviadas = [];
  const r = await worker.rodarUmaVez(fakePool([compromisso()], estado), {
    agora: '2026-09-01 14:05:00', simular: true, enviar: async (t, m) => enviadas.push([t, m])
  });
  assert.strictEqual(enviadas.length, 0, 'previa nao envia');
  assert.strictEqual(r.itens.length, 1);
  assert.strictEqual(r.itens[0].enviar, true);
  assert.match(r.itens[0].mensagem, /Ola Ana!/, 'da para ler o texto antes de ligar');
});

test('envio que falha NAO marca o compromisso como avisado', async function () {
  // Marcar antes e a versao que parece mais segura e nao e: o sistema jura que
  // enviou, a paciente nunca recebe, e ninguem descobre.
  const estado = { ativo: true };
  const linhas = [compromisso()];
  const r = await worker.rodarUmaVez(fakePool(linhas, estado), {
    agora: '2026-09-01 14:05:00',
    enviar: async () => { throw new Error('Evolution fora do ar'); }
  });
  assert.strictEqual(r.falhas, 1);
  assert.strictEqual(r.enviados, 0);
  assert.strictEqual(linhas[0].reminder_sent_at, null, 'continua na fila para a proxima passada');
});

test('RODAR DUAS VEZES SEGUIDAS NAO ENVIA DUAS MENSAGENS', async function () {
  // Exigencia explicita do contexto do modulo. Vale para o relogio interno e
  // para o disparo externo rodando juntos, que e o caso real.
  const estado = { ativo: true };
  const linhas = [compromisso()];
  const pool = fakePool(linhas, estado);
  const enviadas = [];
  const envio = async (t, m) => { enviadas.push([t, m]); };

  const a = await worker.rodarUmaVez(pool, { agora: '2026-09-01 14:05:00', enviar: envio });
  const b = await worker.rodarUmaVez(pool, { agora: '2026-09-01 14:20:00', enviar: envio });

  assert.strictEqual(a.enviados, 1);
  assert.strictEqual(b.enviados, 0, 'a segunda passada nao acha mais nada para enviar');
  assert.strictEqual(enviadas.length, 1, 'uma mensagem, uma so');
});

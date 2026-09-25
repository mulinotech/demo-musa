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

test('lembrete sai 26 h antes quando a hora e civilizada', function () {
  /* Eram 24 h ate a M6.7. Viraram 26 para o 1o disparo caber na regua de tres:
     26 - 2 - 4 = 20 h de folga entre o ultimo aviso e o horario marcado. Com
     24 h a terceira mensagem sairia a 18 h do atendimento, e o cancelamento
     automatico pegaria a paciente ja organizada para vir. */
  assert.strictEqual(l.momentoDeEnvio('2026-09-02 14:00:00'), '2026-09-01 12:00:00');
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
  //
  // A antecedencia vai EXPLICITA desde a M6.7: o padrao passou a 26 h, e com
  // ele este horario cai dentro da janela e a regra de recuo nao seria
  // exercitada. O que este teste guarda e a JANELA, nao o numero de horas.
  assert.strictEqual(l.momentoDeEnvio('2026-09-02 21:30:00', { antecedenciaH: 24 }),
                     '2026-09-01 20:00:00');
});

test('as 20:00 em ponto ainda esta dentro da janela', function () {
  assert.strictEqual(l.momentoDeEnvio('2026-09-02 20:00:00', { antecedenciaH: 24 }),
                     '2026-09-01 20:00:00');
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

test('o lembrete nao sai duas vezes -- o que vem depois e a 2a etapa', function () {
  /* A frase deste teste mudou com a M6.7, e a mudanca e o ponto: ate aqui
     `reminder_sent_at` preenchido queria dizer "acabou". Agora quer dizer
     "a etapa 1 ja saiu", e o que vem a seguir e a COBRANCA, duas horas depois.
     O que continua garantido e o que importa: a etapa 1 nao se repete. */
  const c = compromisso({ reminder_sent_at: '2026-09-01 14:00:00' });
  const d = l.deveEnviar(c, '2026-09-01 18:00:00');
  assert.strictEqual(d.etapa, 2, 'nunca 1 de novo');
  assert.strictEqual(d.enviar, true);

  // E com a regua inteira concluida, nada mais sai.
  const fim = l.deveEnviar(compromisso({ reminder_stage: 3,
    reminder_sent_at: '2026-09-01 14:00:00', reminder_last_at: '2026-09-01 20:00:00' }),
    '2026-09-01 23:00:00');
  assert.strictEqual(fim.enviar, false);
  assert.strictEqual(fim.motivo, 'regua concluida');
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

/** Escopo de mentira: `q` e `minhaClinica`, e mais nada.
 *
 *  ============================== O QUE MUDOU NA M2.1b, E POR QUE FICOU MELHOR
 *
 *  Antes isto era um `pool` falso e o worker recebia `pool`. Agora ele recebe o
 *  **escopo de uma clínica**, e o fingimento tem de incluir a coluna: as
 *  consultas do worker passaram a trazer `clinica_id = :clinica`, então o
 *  reconhecimento aqui exige a cláusula. Um worker que voltasse a consultar sem
 *  filtrar deixaria de casar com estes `if` e os testes quebrariam — o que é
 *  exatamente o que se quer. */
function fakeEscopo(linhas, estado) {
  return {
    clinicaId: 'cl_teste',
    autor: 'Sistema',
    ip: null,
    async minhaClinica() {
      return { id: 'cl_teste', nome: 'Clinica de Teste',
               evolution_instance: estado.instancia === undefined ? 'inst-teste' : estado.instancia };
    },
    async q(sql, params) {
      const t = String(sql).replace(/\s+/g, ' ').trim();
      if (/FROM clinica_settings/.test(t)) {
        assert.match(t, /clinica_id = :clinica/, 'a leitura de configuracao tem de filtrar clinica');
        return [[{ chave: 'lembretes_ativos', valor: estado.ativo ? '1' : '0' }]];
      }
      if (/^SELECT a.id, a.title/.test(t)) {
        assert.match(t, /a\.clinica_id = :clinica/, 'a busca de candidatos tem de filtrar clinica');
        // O recorte grosso mudou com a regua (M6.7): era `reminder_sent_at IS
        // NULL`, virou `reminder_stage < 3`. O fake acompanha, senao o teste
        // mede um SQL que o worker nao usa mais.
        return [linhas.filter((c) => Number(c.reminder_stage || 0) < 3)];
      }
      if (/UPDATE appointments SET reminder_stage/.test(t)) {
        assert.match(t, /clinica_id = :clinica/, 'a marca do lembrete tem de filtrar clinica');
        /* A CONDICAO TEM DE ESTAR NO SQL, e nao so nos parametros.
         * Sem `AND reminder_stage = ?` duas passadas simultaneas se atropelam:
         * a segunda regrava a etapa por cima e uma das tres mensagens nao sai.
         * O fake nao consegue simular a corrida, entao confere a clausula --
         * pela mesma razao que confere o filtro de clinica na linha acima. */
        assert.match(t, /AND reminder_stage = \?/,
          'o avanco de etapa tem de conferir de qual etapa veio');
        const [etapa, id, etapaEsperada] = params;
        const c = linhas.find((x) => x.id === id);
        if (!c || Number(c.reminder_stage || 0) !== etapaEsperada) return [{ affectedRows: 0 }];
        c.reminder_stage = etapa;
        c.reminder_last_at = estado.agora || '2026-09-01 14:05:00';
        c.reminder_sent_at = c.reminder_sent_at || c.reminder_last_at;
        estado.marcados = (estado.marcados || 0) + 1;
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE appointments SET status = 'CANCELADO'/.test(t)) {
        assert.match(t, /clinica_id = :clinica/, 'o cancelamento tem de filtrar clinica');
        /* Mesma razao: sem `reminder_reply_at IS NULL` no SQL, o cancelamento
         * pega a paciente que respondeu entre a consulta e o UPDATE. */
        assert.match(t, /reminder_reply_at IS NULL/,
          'o cancelamento nao pode pegar quem respondeu no meio da passada');
        const c = linhas.find((x) => x.id === params[1]);
        if (!c || c.status !== 'AGENDADO' || c.reminder_reply_at) return [{ affectedRows: 0 }];
        c.status = 'CANCELADO';
        estado.cancelados = (estado.cancelados || 0) + 1;
        return [{ affectedRows: 1 }];
      }
      return [[]];
    }
  };
}

/** A configuracao como `clinica-config.lerLembrete` a devolveria. */
function cfg(estado) {
  const instancia = estado.instancia === undefined ? 'inst-teste' : estado.instancia;
  return {
    proprio: true,
    instancia: instancia,
    ativo: !!estado.ativo && !!instancia,
    ligadoNaConfiguracao: !!estado.ativo,
    template: estado.template || l.TEMPLATE_PADRAO,
    antecedenciaH: 24
  };
}

test('desligado, nao envia nada mesmo com compromisso vencido', async function () {
  // O banco de demonstracao tem telefone de gente real. Subir ligado seria
  // disparar WhatsApp para essas pessoas sem ninguem ter pedido.
  const estado = { ativo: false };
  const enviadas = [];
  const r = await worker.umaClinica(fakeEscopo([compromisso()], estado), cfg(estado), {
    agora: '2026-09-01 14:05:00', enviar: async (t, m, i) => enviadas.push([t, m, i])
  });
  assert.strictEqual(r.enviados, 0);
  assert.strictEqual(enviadas.length, 0);
  assert.match(r.aviso, /desligados/);
});

test('SEM INSTANCIA nao envia, mesmo com a configuracao ligada', async function () {
  // A configuracao diz "eu quero"; a instancia diz "eu tenho por onde". Sem as
  // duas, enviar seria mandar do numero de outro consultorio -- e a paciente
  // responderia para a clinica errada.
  const estado = { ativo: true, instancia: null };
  const enviadas = [];
  const r = await worker.umaClinica(fakeEscopo([compromisso()], estado), cfg(estado), {
    agora: '2026-09-01 14:05:00', enviar: async (t, m, i) => enviadas.push([t, m, i])
  });
  assert.strictEqual(enviadas.length, 0, 'sem instancia, nada sai');
  assert.match(r.aviso, /instancia de WhatsApp/,
    'o motivo tem de dizer que falta instancia, e nao so "desligado"');
});

test('a previa mostra o que sairia e nao envia', async function () {
  const estado = { ativo: false };
  const enviadas = [];
  const r = await worker.umaClinica(fakeEscopo([compromisso()], estado), cfg(estado), {
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
  const r = await worker.umaClinica(fakeEscopo(linhas, estado), cfg(estado), {
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
  const db = fakeEscopo(linhas, estado);
  const enviadas = [];
  const envio = async (t, m, i) => { enviadas.push([t, m, i]); };

  const a = await worker.umaClinica(db, cfg(estado), { agora: '2026-09-01 14:05:00', enviar: envio });
  const b = await worker.umaClinica(db, cfg(estado), { agora: '2026-09-01 14:20:00', enviar: envio });

  assert.strictEqual(a.enviados, 1);
  assert.strictEqual(b.enviados, 0, 'a segunda passada nao acha mais nada para enviar');
  assert.strictEqual(enviadas.length, 1, 'uma mensagem, uma so');
});

test('a instancia da clinica vai junto em cada envio', async function () {
  // O terceiro argumento e o que impede a mensagem de sair pelo numero de outro
  // consultorio. Sem ele, `sendWhatsappText` resolve uma instancia globalmente.
  const estado = { ativo: true, instancia: 'instancia-desta-clinica' };
  const enviadas = [];
  await worker.umaClinica(fakeEscopo([compromisso()], estado), cfg(estado), {
    agora: '2026-09-01 14:05:00', enviar: async (t, m, i) => enviadas.push([t, m, i])
  });
  assert.strictEqual(enviadas.length, 1);
  assert.strictEqual(enviadas[0][2], 'instancia-desta-clinica',
    'a instancia tem de chegar ao envio; `undefined` aqui e a queda global de volta');
});

/* ==================================================================
 *  A RÉGUA DE TRÊS DISPAROS VISTA PELO WORKER (M6.7)
 *
 *  As regras puras têm arquivo próprio (`regua-de-confirmacao.test.js`). O que
 *  se mede aqui é o que só o worker faz: gravar a etapa, CANCELAR o horário
 *  antes de anunciar o cancelamento, e não anunciar nada quando o cancelamento
 *  não pegou.
 * ================================================================== */

test('as tres mensagens saem em ordem, e a terceira cancela o horario', async function () {
  const estado = { ativo: true };
  const linhas = [compromisso()];              // 02/09 14:00, antecedencia 24 h
  const db = fakeEscopo(linhas, estado);
  const saiu = [];
  const envio = async (t, m) => { saiu.push(m); };

  /* Os relogios sao EXATOS de proposito. Cada etapa conta do envio anterior, e
     a cobranca que cairia depois das 20:00 espera as 08:00 do dia seguinte --
     entao adiantar a 2a passada em dez minutos joga a 3a para fora da janela e
     este teste "falharia" por um comportamento correto. Ver `momentoDaCobranca`. */
  estado.agora = '2026-09-01 14:00:00';
  const a = await worker.umaClinica(db, cfg(estado), { agora: estado.agora, enviar: envio });
  estado.agora = '2026-09-01 16:00:00';
  const b = await worker.umaClinica(db, cfg(estado), { agora: estado.agora, enviar: envio });
  estado.agora = '2026-09-01 20:00:00';
  const c = await worker.umaClinica(db, cfg(estado), { agora: estado.agora, enviar: envio });

  assert.deepStrictEqual([a.enviados, b.enviados, c.enviados], [1, 1, 1]);
  assert.strictEqual(saiu.length, 3, 'tres mensagens, e tres textos diferentes');
  assert.strictEqual(new Set(saiu).size, 3);
  assert.match(saiu[1], /profissional reservada/i);
  assert.match(saiu[2], /cancelado/i);

  assert.strictEqual(linhas[0].status, 'CANCELADO');
  assert.strictEqual(linhas[0].reminder_stage, 3);
  assert.strictEqual(c.cancelados, 1);
});

test('quem responde no meio nao e cobrado nem cancelado', async function () {
  const estado = { ativo: true };
  const linhas = [compromisso()];
  const db = fakeEscopo(linhas, estado);
  const saiu = [];
  const envio = async (t, m) => { saiu.push(m); };

  estado.agora = '2026-09-01 14:00:00';
  await worker.umaClinica(db, cfg(estado), { agora: estado.agora, enviar: envio });

  // A paciente escreve qualquer coisa: o webhook carimba a coluna.
  linhas[0].reminder_reply_at = '2026-09-01 14:40:00';

  for (const agora of ['2026-09-01 16:00:00', '2026-09-01 20:00:00']) {
    estado.agora = agora;
    const r = await worker.umaClinica(db, cfg(estado), { agora: agora, enviar: envio });
    assert.strictEqual(r.enviados, 0, agora);
  }
  assert.strictEqual(saiu.length, 1, 'so o lembrete saiu');
  assert.strictEqual(linhas[0].status, 'AGENDADO', 'o horario continua de pe');
});

test('se o cancelamento nao pegar, a mensagem de cancelamento NAO sai', async function () {
  /* A corrida real: a paciente responde entre a consulta e o UPDATE. O UPDATE
     tem `reminder_reply_at IS NULL` na condicao, entao ele nao afeta linha
     nenhuma -- e o worker tem de DESISTIR do envio. Mandar assim mesmo diria a
     alguem que acabou de confirmar que o horario dela foi desmarcado. */
  const estado = { ativo: true };
  const linhas = [compromisso({ reminder_stage: 2, reminder_sent_at: '2026-09-01 14:00:00',
                                reminder_last_at: '2026-09-01 16:00:00' })];
  const db = fakeEscopo(linhas, estado);

  // A resposta chega "durante a passada": o fake recusa o UPDATE por causa dela.
  linhas[0].reminder_reply_at = null;
  const dbEspiao = Object.assign({}, db, {
    async q(sql, params) {
      if (/UPDATE appointments SET status = 'CANCELADO'/.test(String(sql).replace(/\s+/g, ' '))) {
        linhas[0].reminder_reply_at = '2026-09-01 19:59:59';
      }
      return db.q(sql, params);
    }
  });

  const saiu = [];
  const r = await worker.umaClinica(dbEspiao, cfg(estado),
    { agora: '2026-09-01 20:00:00', enviar: async (t, m) => saiu.push(m) });

  assert.strictEqual(saiu.length, 0, 'nenhuma mensagem de cancelamento saiu');
  assert.strictEqual(r.enviados, 0);
  assert.strictEqual(r.cancelados, 0);
  assert.strictEqual(linhas[0].status, 'AGENDADO');
  assert.match(r.itens[0].motivo, /respondeu durante a passada/);
});

test('a previa mostra a etapa de cada linha sem enviar nada', async function () {
  const estado = { ativo: true };
  const linhas = [compromisso({ reminder_stage: 1, reminder_sent_at: '2026-09-01 14:00:00',
                                reminder_last_at: '2026-09-01 14:00:00' })];
  const r = await worker.umaClinica(fakeEscopo(linhas, estado), cfg(estado),
    { agora: '2026-09-01 16:00:00', simular: true });

  assert.strictEqual(r.enviados, 0);
  assert.strictEqual(r.itens[0].simulado, true);
  assert.strictEqual(r.itens[0].etapa, 2);
  assert.strictEqual(r.itens[0].etapaFeita, 1);
  assert.strictEqual(r.itens[0].cancela, false);
  assert.strictEqual(linhas[0].status, 'AGENDADO', 'previa nao cancela nada');
});

'use strict';
/** A entrada de mensagens do WhatsApp está viva? (M5.9)
 *
 *  Estes testes existem por causa de 18/09: a clínica passou semanas com a
 *  entrada morta — 8 mensagens enviadas, zero recebidas — e **nenhuma tela
 *  dizia nada**. O defeito não era o webhook desconfigurado; era o silêncio.
 *
 *  Vários casos abaixo são impossíveis de reproduzir à mão numa tela (o webhook
 *  apontado para outra instalação, o evento faltando), e é exatamente por isso
 *  que a regra mora numa função pura.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const e = require('../server/services/entrada-whatsapp');

const AQUI = 'https://demo-musa.mulinotech.com/api/webhook/whatsapp';

/** O caso saudável, do qual cada teste abaixo tira uma peça. */
const BOM = {
  instancia: 'clinica_musa',
  webhookLigado: true,
  webhookUrl: AQUI,
  urlEsperada: AQUI,
  eventos: ['MESSAGES_UPSERT'],
  ultimaRecebida: '2026-09-21',
  ultimaEnviada: '2026-09-21',
  hoje: '2026-09-21'
};

const com = (mudancas) => e.diagnosticar(Object.assign({}, BOM, mudancas));

/* ----------------------------------------------------- o endereço do webhook */

test('mesma URL com barra final ou maiuscula continua sendo a mesma', function () {
  assert.strictEqual(e.apontaParaCa(AQUI + '/', AQUI), true);
  assert.strictEqual(e.apontaParaCa(AQUI.toUpperCase(), AQUI), true);
});

test('URL de OUTRA instalacao nao conta como apontando para ca', function () {
  assert.strictEqual(e.apontaParaCa('https://outro-sistema.com/api/webhook/whatsapp', AQUI), false);
  // O caso mais traicoeiro: mesmo caminho, host diferente.
  assert.strictEqual(e.apontaParaCa('https://copia.mulinotech.com/api/webhook/whatsapp', AQUI), false);
});

test('URL vazia nunca aponta para ca', function () {
  assert.strictEqual(e.apontaParaCa('', AQUI), false);
  assert.strictEqual(e.apontaParaCa(null, AQUI), false);
  assert.strictEqual(e.apontaParaCa(AQUI, ''), false);
});

/* ------------------------------------------------------- o que esta parado */

test('sem instancia: parada, e NAO oferece ligar (nao ha o que ligar)', function () {
  const d = com({ instancia: null });
  assert.strictEqual(d.nivel, 'parada');
  assert.strictEqual(d.podeLigar, false);
  assert.match(d.oQueFazer, /QR Code/);
});

test('webhook desligado: parada, e oferece ligar', function () {
  const d = com({ webhookLigado: false });
  assert.strictEqual(d.nivel, 'parada');
  assert.strictEqual(d.podeLigar, true);
  // A frase precisa nomear o sintoma que a pessoa VE: envia e nao recebe.
  assert.match(d.detalhe, /ENVIAR|enviar/);
  // Nao pode AFIRMAR que o aparelho esta conectado: isso nao foi medido aqui.
  assert.strictEqual(/est[aá] conectado/.test(d.detalhe), false);
});

test('webhook apontado para outro endereco: parada, e diz PARA ONDE esta indo', function () {
  const d = com({ webhookUrl: 'https://outro-sistema.com/api/webhook/whatsapp' });
  assert.strictEqual(d.nivel, 'parada');
  assert.strictEqual(d.podeLigar, true);
  assert.match(d.detalhe, /outro-sistema\.com/);
  assert.strictEqual(d.fatos.apontaParaCa, false);
});

test('webhook sem o evento de mensagem: parada, mesmo com tudo o mais certo', function () {
  const d = com({ eventos: ['CONNECTION_UPDATE'] });
  assert.strictEqual(d.nivel, 'parada');
  assert.strictEqual(d.fatos.temEventoDeMensagem, false);
  assert.match(d.detalhe, /MESSAGES_UPSERT/);
});

test('lista de eventos vazia tambem e parada', function () {
  assert.strictEqual(com({ eventos: [] }).nivel, 'parada');
  assert.strictEqual(com({ eventos: null }).nivel, 'parada');
});

/* --------------------------------------------- o comportamento, ja configurado */

test('O CASO DE 18/09: envia e nunca recebeu -> atencao, nao "tudo certo"', function () {
  const d = com({ ultimaRecebida: null, ultimaEnviada: '2026-09-18' });
  assert.strictEqual(d.nivel, 'atencao');
  assert.match(d.titulo, /nunca recebeu/);
  // Este era o retrato exato do defeito: configuracao certa AGORA, historico
  // que ainda nao provou nada.
  assert.notStrictEqual(d.nivel, 'ok');
});

test('clinica recem-conectada, sem conversa nenhuma: ok e silencio', function () {
  const d = com({ ultimaRecebida: null, ultimaEnviada: null });
  assert.strictEqual(d.nivel, 'ok');
  assert.strictEqual(d.oQueFazer, '');
  // Silencio de quem nao comecou NAO e alarme. Alarme que toca sozinho
  // ensina a ignorar alarme.
});

test('recebeu hoje: ok', function () {
  const d = com({});
  assert.strictEqual(d.nivel, 'ok');
  assert.strictEqual(d.fatos.diasSemReceber, 0);
  assert.match(d.detalhe, /hoje/);
});

test('recebeu ha 3 dias: ainda ok', function () {
  assert.strictEqual(com({ ultimaRecebida: '2026-09-18' }).nivel, 'ok');
});

test('mais de uma semana sem receber: atencao, com o numero de dias no titulo', function () {
  const d = com({ ultimaRecebida: '2026-09-01' });
  assert.strictEqual(d.nivel, 'atencao');
  assert.strictEqual(d.fatos.diasSemReceber, 20);
  assert.match(d.titulo, /20 dias/);
  assert.strictEqual(d.podeLigar, false);   // configuracao esta certa: religar nao resolve
});

/* ------------------------------------------------------------- a forma geral */

test('todo diagnostico tem nivel valido e, se nao esta ok, diz o que fazer', function () {
  const casos = [
    {}, { instancia: null }, { webhookLigado: false },
    { webhookUrl: 'https://outro.com/x' }, { eventos: [] },
    { ultimaRecebida: null, ultimaEnviada: '2026-09-18' },
    { ultimaRecebida: null, ultimaEnviada: null },
    { ultimaRecebida: '2026-08-01' }
  ];
  for (const c of casos) {
    const d = com(c);
    assert.ok(e.NIVEIS.indexOf(d.nivel) !== -1, 'nivel invalido: ' + d.nivel);
    assert.ok(d.titulo && d.titulo.length > 5, 'titulo vazio em ' + JSON.stringify(c));
    if (d.nivel !== 'ok') {
      assert.ok(d.oQueFazer && d.oQueFazer.length > 5,
        'diagnostico sem proximo passo em ' + JSON.stringify(c) +
        ' -- diagnostico sem o que fazer so troca uma duvida por outra');
    }
  }
});

test('o diagnostico nao inventa dado: os fatos voltam como entraram', function () {
  const d = com({ ultimaRecebida: '2026-09-19' });
  assert.strictEqual(d.fatos.instancia, 'clinica_musa');
  assert.strictEqual(d.fatos.webhookUrl, AQUI);
  assert.strictEqual(d.fatos.ultimaRecebida, '2026-09-19');
  assert.strictEqual(d.fatos.diasSemReceber, 2);
});

test('a frase de "quando entrou" nao tem costura aparente', function () {
  // A primeira versao escrevia "entrou em ha 3 dia(s)": o "em" pedia uma data e
  // recebia uma duracao. Apareceu no primeiro print de producao.
  assert.strictEqual(e.quandoEntrou(0), 'hoje');
  assert.strictEqual(e.quandoEntrou(1), 'ontem');
  assert.strictEqual(e.quandoEntrou(3), 'há 3 dias');

  const d = com({ ultimaRecebida: '2026-09-18' });
  assert.strictEqual(/entrou em h[aá]/.test(d.detalhe), false, d.detalhe);
  assert.match(d.detalhe, /entrou há 3 dias\./);

  assert.match(com({}).detalhe, /entrou hoje\./);
  assert.match(com({ ultimaRecebida: '2026-09-20' }).detalhe, /entrou ontem\./);
});

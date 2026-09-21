'use strict';
/** De onde veio a mensagem: pessoa, grupo ou transmissão (M5.9a).
 *
 *  Estes testes existem por causa de um print. O número da clínica está num
 *  grupo de trabalho; alguém escreveu sobre uma condição de parcelamento; e o
 *  CRM respondeu **"Seja muito bem-vinda! Recebemos sua mensagem"** no grupo,
 *  na frente de um cliente. Antes disso, criou um lead chamado como a pessoa que
 *  escreveu, com o id do grupo no lugar do telefone.
 *
 *  Nenhum teste pegou isso porque nenhum teste perguntava **de onde a mensagem
 *  veio** — só o que o sistema fazia com ela depois (regra 40).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const jid = require('../server/services/whatsapp-jid');

/* ---------------------------------------------------------- a classificação */

test('telefone de pessoa e reconhecido nas duas grafias', function () {
  assert.strictEqual(jid.origemDoJid('5511987654321@s.whatsapp.net'), 'pessoa');
  assert.strictEqual(jid.origemDoJid('5511987654321@c.us'), 'pessoa');
});

test('o JID do print e classificado como GRUPO', function () {
  // O caso real de 18/09.
  assert.strictEqual(jid.origemDoJid('120363111222333@g.us'), 'grupo');
});

test('transmissao e status tambem nao sao pessoa', function () {
  assert.strictEqual(jid.origemDoJid('status@broadcast'), 'transmissao');
  assert.strictEqual(jid.origemDoJid('123456@broadcast'), 'transmissao');
  assert.strictEqual(jid.origemDoJid('abc@newsletter'), 'transmissao');
});

test('o identificador anonimo de grupo (@lid) nao e telefone', function () {
  // Nao e discavel: virar ficha de paciente produz um contato para o qual a
  // clinica nunca consegue responder.
  assert.strictEqual(jid.origemDoJid('55119876543210@lid'), 'anonimo');
});

test('sufixo novo do WhatsApp entra como DESCONHECIDO, e nao como pessoa', function () {
  // Lista de permissao, nao de proibicao. Foi a regra implicita "tudo o que nao
  // reconheco e telefone" que produziu o defeito.
  assert.strictEqual(jid.origemDoJid('123@algonovo.us'), 'desconhecido');
  assert.strictEqual(jid.origemDoJid(''), 'desconhecido');
  assert.strictEqual(jid.origemDoJid(null), 'desconhecido');
  assert.strictEqual(jid.origemDoJid(undefined), 'desconhecido');
  assert.strictEqual(jid.origemDoJid('5511987654321'), 'desconhecido');   // sem @
});

test('maiuscula e espaco nao driblam a regra', function () {
  assert.strictEqual(jid.origemDoJid('  120363111222333@G.US  '), 'grupo');
  assert.strictEqual(jid.origemDoJid('5511987654321@S.WhatsApp.Net'), 'pessoa');
});

/* ------------------------------------------------------- o portão do webhook */

test('SO conversa de uma pessoa vira atendimento', function () {
  assert.strictEqual(jid.ehConversaDePessoa('5511987654321@s.whatsapp.net'), true);
  ['120363111222333@g.us', 'status@broadcast', '55119876543210@lid',
   '123@algonovo.us', '', null].forEach(function (x) {
    assert.strictEqual(jid.ehConversaDePessoa(x), false,
      String(x) + ' NAO pode passar: e assim que o CRM responde onde nao devia');
  });
});

/* ------------------------------------------------------------- o telefone */

test('o telefone sai limpo do JID de pessoa', function () {
  assert.strictEqual(jid.telefoneDoJid('5511987654321@s.whatsapp.net'), '5511987654321');
  assert.strictEqual(jid.telefoneDoJid('+5511987654321@c.us'), '5511987654321');
});

test('o numero do aparelho da multi-sessao nao entra no telefone', function () {
  // `:12` e' o aparelho, nao o numero. Antes ele ia junto e a busca por
  // paciente nunca casava -- um lead duplicado por aparelho.
  assert.strictEqual(jid.telefoneDoJid('5511987654321:12@s.whatsapp.net'), '5511987654321');
});

test('id de GRUPO nunca sai como telefone -- devolve vazio', function () {
  // Esta e a conferencia central: mesmo que alguem volte a chamar a funcao no
  // lugar errado, o id do grupo nao vira telefone de lead.
  assert.strictEqual(jid.telefoneDoJid('120363111222333@g.us'), '');
  assert.strictEqual(jid.telefoneDoJid('status@broadcast'), '');
  assert.strictEqual(jid.telefoneDoJid('55119876543210@lid'), '');
  assert.notStrictEqual(jid.telefoneDoJid('120363111222333@g.us'), '120363111222333');
});

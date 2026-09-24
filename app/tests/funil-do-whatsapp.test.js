'use strict';
/** A regra de jogar a conversa no funil (M6.2).
 *
 *  O que se prova aqui é o que ninguém reproduz clicando: o card que já existe
 *  com o telefone escrito de outro jeito, o lead fechado que NÃO impede um card
 *  novo, e o telefone que não é telefone.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const funil = require('../server/services/funil-do-whatsapp');

const lead = (o) => Object.assign(
  { id: 'l1', name: 'Ana', whatsapp: '5511911112222', status: 'novo', date: '2026-09-01' }, o);

test('conversa nova, sem ninguem no funil, vira card', () => {
  const d = funil.decidirEntrada({ nome: 'Ana', telefone: '5511911112222' }, [], []);
  assert.strictEqual(d.acao, 'criar');
  assert.strictEqual(d.clienteId, null);
});

test('card ABERTO com o mesmo telefone impede o segundo card', () => {
  const d = funil.decidirEntrada({ telefone: '5511911112222' }, [lead({})], []);
  assert.strictEqual(d.acao, 'jaNoFunil');
  assert.strictEqual(d.lead.id, 'l1');
});

test('e o telefone ESCRITO DE OUTRO JEITO e o mesmo telefone', () => {
  /* Este e o caso que cria duplicata quando a comparacao e' de texto cru: o
     WhatsApp manda `5511911112222` e a ficha tem `(11) 91111-2222`. */
  for (const escrito of ['(11) 91111-2222', '+55 11 91111 2222', '11911112222',
                         ' 55 11 91111 2222 ']) {
    const d = funil.decidirEntrada({ telefone: escrito }, [lead({})], []);
    assert.strictEqual(d.acao, 'jaNoFunil', 'falhou para ' + escrito);
  }
});

test('e o numero ANTES DO NONO DIGITO tambem, quando a regra permite', () => {
  /* `chaveDeTelefone` so tira o nono digito quando o que sobra ainda comeca com
     6 a 9 -- fixo comeca com 2 a 5, e tirar o 9 de um `93111-2222` o faria
     casar com o fixo `3111-2222` da propria clinica.
     Por isso `98888-7777` casa com a ficha antiga `8888-7777`, e `91111-2222`
     NAO casa com `1111-2222`. As duas metades sao a mesma protecao. */
  const antigo = [lead({ whatsapp: '5511988887777' })];
  assert.strictEqual(
    funil.decidirEntrada({ telefone: '11 8888-7777' }, antigo, []).acao, 'jaNoFunil');
  assert.strictEqual(
    funil.decidirEntrada({ telefone: '11 1111-2222' }, [lead({})], []).acao, 'criar');
});

test('os tres estados abertos seguram o card; os dois fechados nao', () => {
  for (const s of ['novo', 'contatado', 'agendado']) {
    assert.strictEqual(
      funil.decidirEntrada({ telefone: '5511911112222' }, [lead({ status: s })], []).acao,
      'jaNoFunil', 'status ' + s);
  }
  for (const s of ['arquivado', 'perdido']) {
    assert.strictEqual(
      funil.decidirEntrada({ telefone: '5511911112222' }, [lead({ status: s })], []).acao,
      'criar', 'status ' + s);
  }
});

test('venda fechada em marco nao impede a venda nova de setembro', () => {
  /* Se `arquivado` bloqueasse, a paciente que volta nunca apareceria no funil
     do mes -- e o faturamento do mes nao teria de onde sair. */
  const d = funil.decidirEntrada({ telefone: '5511911112222' },
    [lead({ status: 'arquivado', date: '2026-03-10' })], []);
  assert.strictEqual(d.acao, 'criar');
  assert.ok(d.historico, 'a tela precisa poder dizer que ja passou por aqui');
  assert.strictEqual(d.historico.status, 'arquivado');
});

test('dois cards abertos duplicados devolvem o MAIS RECENTE', () => {
  const d = funil.decidirEntrada({ telefone: '5511911112222' }, [
    lead({ id: 'velho', date: '2026-01-05' }),
    lead({ id: 'novo', date: '2026-09-20' })
  ], []);
  assert.strictEqual(d.lead.id, 'novo');
});

test('UMA ficha com o telefone: o card ja nasce vinculado', () => {
  const d = funil.decidirEntrada({ telefone: '5511911112222' }, [],
    [{ id: 'c1', name: 'Ana Paula', phone: '(11) 91111-2222' }]);
  assert.strictEqual(d.acao, 'criar');
  assert.strictEqual(d.clienteId, 'c1');
});

test('DUAS fichas com o telefone: o card nasce SEM vinculo', () => {
  /* A mae e a filha com um numero so. Escolher uma aqui poria a sessao de uma
     na ficha da outra quando a venda fechasse. */
  const d = funil.decidirEntrada({ telefone: '5511911112222' }, [], [
    { id: 'c1', name: 'Ana', phone: '11911112222' },
    { id: 'c2', name: 'Beatriz', phone: '+55 11 91111-2222' }
  ]);
  assert.strictEqual(d.acao, 'criar');
  assert.strictEqual(d.clienteId, null);
  assert.strictEqual(d.candidatos.length, 2);
  assert.match(d.porque, /2 pacientes/);
});

test('telefone que nao e telefone e RECUSA, e nao card', () => {
  for (const ruim of ['', '123', 'sem numero', '0', '999999999999999999']) {
    const d = funil.decidirEntrada({ telefone: ruim }, [], []);
    assert.strictEqual(d.acao, 'telefoneInvalido', 'passou: ' + JSON.stringify(ruim));
  }
});

test('o lead de OUTRO telefone nao segura este card', () => {
  const d = funil.decidirEntrada({ telefone: '5511988887777' }, [lead({})], []);
  assert.strictEqual(d.acao, 'criar');
});

test('nome vazio vira o numero legivel, e nao "Contato 1"', () => {
  assert.strictEqual(funil.nomeDoContato('', '5511911112222'), 'WhatsApp 9111-12222');
  assert.strictEqual(funil.nomeDoContato(null, '11911112222'), 'WhatsApp 9111-12222');
});

test('nome que e so o proprio numero tambem vira o numero legivel', () => {
  /* O WhatsApp manda o `pushName` como o numero quando a pessoa nao tem nome
     no perfil. Gravar "+55 11 91111-2222" no campo NOME do card poe telefone
     onde o Kanban desenha nome. */
  assert.strictEqual(funil.nomeDoContato('+55 11 91111-2222', '5511911112222'),
    'WhatsApp 9111-12222');
});

test('e o nome de verdade e preservado', () => {
  assert.strictEqual(funil.nomeDoContato('Ana Paula Souza', '5511911112222'), 'Ana Paula Souza');
});

test('lista ausente nao quebra a regra', () => {
  const d = funil.decidirEntrada({ telefone: '5511911112222' }, null, undefined);
  assert.strictEqual(d.acao, 'criar');
});

'use strict';
/** De onde o lead veio (M5.13)
 *
 *  A lista antiga tinha quatro opções escritas dentro do `<select>`: site,
 *  instagram, google, indicação. Faltavam TikTok, Meta Ads e — o mais estranho
 *  — **WhatsApp**, que a própria aplicação já gravava sozinha.
 *
 *  O teste que importa é o do pago × orgânico: "instagram" era a mesma palavra
 *  para "ela viu o anúncio" e "ela achou no perfil", e é a origem paga que
 *  responde pelo investimento que o Custo por Lead divide.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const url = require('url');

const CAMINHO = url.pathToFileURL(
  path.join(__dirname, '..', 'src', 'lib', 'origens.mjs')).href;
const carregar = () => import(CAMINHO);

test('a lista tem as origens que o time pediu', async function () {
  const { ORIGENS } = await carregar();
  const valores = ORIGENS.map((o) => o.valor);
  for (const esperada of ['meta_ads', 'google_ads', 'tiktok_ads']) {
    assert.ok(valores.includes(esperada), 'faltou ' + esperada);
  }
});

test('WHATSAPP esta na lista -- a aplicacao ja gravava essa origem sozinha', async function () {
  /* `server/services/evolution.js` escreve `source: 'whatsapp'` quando a
     paciente chega pela conversa. O card exibia "whatsapp" com icone generico
     porque a lista nao conhecia o valor que o proprio sistema escrevia. */
  const { origem, rotuloDaOrigem } = await carregar();
  assert.ok(origem('whatsapp'));
  assert.strictEqual(rotuloDaOrigem('whatsapp'), 'WhatsApp');
});

test('as quatro origens antigas continuam valendo', async function () {
  const { origem } = await carregar();
  for (const antiga of ['site', 'instagram', 'google', 'indicação']) {
    assert.ok(origem(antiga), 'a origem antiga "' + antiga + '" sumiu da lista');
  }
});

/* ------------------------------------------------------- pago x organico */

test('O QUE SEPARA O CPL: anuncio e pago, perfil nao e', async function () {
  const { ehPaga } = await carregar();
  assert.strictEqual(ehPaga('meta_ads'), true);
  assert.strictEqual(ehPaga('google_ads'), true);
  assert.strictEqual(ehPaga('tiktok_ads'), true);

  /* Somar o organico junto faz o Custo por Lead parecer melhor do que e -- e
     foi esse numero que o time comercial atacou em 19/09. */
  assert.strictEqual(ehPaga('instagram'), false);
  assert.strictEqual(ehPaga('google'), false);
  assert.strictEqual(ehPaga('tiktok'), false);
  assert.strictEqual(ehPaga('indicação'), false);
  assert.strictEqual(ehPaga('site'), false);
});

test('origem desconhecida NAO conta como paga', async function () {
  const { ehPaga } = await carregar();
  /* Contar como paga um lead cuja origem ninguem sabe inflaria o denominador
     com chute -- exatamente o defeito que a M5.8 tirou da Visao Geral. */
  for (const x of ['facebook', '', null, 'anuncio', 'ads']) {
    assert.strictEqual(ehPaga(x), false, 'contou como paga: ' + JSON.stringify(x));
  }
});

/* ------------------------------------------ o que ja esta gravado nao some */

test('origem antiga fora da lista aparece como veio, e nao vira "Outro"', async function () {
  const { rotuloDaOrigem, opcoesDeOrigem } = await carregar();
  assert.strictEqual(rotuloDaOrigem('feirao-2024'), 'feirao-2024');

  const o = opcoesDeOrigem('feirao-2024');
  const legado = o.find((x) => x.legado);
  assert.ok(legado, 'a origem gravada sumiu das opcoes');
  assert.strictEqual(legado.valor, 'feirao-2024');
  assert.match(legado.rotulo, /registrado antes/);
});

test('origem conhecida nao vira opcao repetida', async function () {
  const { opcoesDeOrigem, ORIGENS } = await carregar();
  assert.strictEqual(opcoesDeOrigem('meta_ads').length, ORIGENS.length);
  assert.strictEqual(opcoesDeOrigem('').length, ORIGENS.length);
  assert.strictEqual(opcoesDeOrigem(null).length, ORIGENS.length);
});

test('maiuscula e espaco sobrando nao criam origem nova', async function () {
  const { rotuloDaOrigem, opcoesDeOrigem, ORIGENS } = await carregar();
  assert.strictEqual(rotuloDaOrigem('  META_ADS '), 'Meta Ads (Facebook/Instagram)');
  assert.strictEqual(opcoesDeOrigem('  Site  ').length, ORIGENS.length);
});

test('sem origem, a tela diz que nao foi informada -- e nao fica em branco', async function () {
  const { rotuloDaOrigem } = await carregar();
  assert.strictEqual(rotuloDaOrigem(''), 'Não informada');
  assert.strictEqual(rotuloDaOrigem(null), 'Não informada');
  assert.strictEqual(rotuloDaOrigem('   '), 'Não informada');
});

test('o card usa o nome CURTO, e o seletor o longo', async function () {
  const { rotuloCurto, rotuloDaOrigem } = await carregar();
  /* A primeira versao usava o longo nos dois lugares: "Meta Ads
     (Facebook/Instagram)" empurrava o nome da paciente para duas linhas e
     vazava do card. Apareceu na conferencia de navegador. */
  assert.strictEqual(rotuloCurto('meta_ads'), 'Meta Ads');
  assert.strictEqual(rotuloDaOrigem('meta_ads'), 'Meta Ads (Facebook/Instagram)');
  assert.strictEqual(rotuloCurto('instagram'), 'Instagram');
  // Mesma regra do longo: origem fora da lista volta como veio.
  assert.strictEqual(rotuloCurto('feirao-2024'), 'feirao-2024');
  assert.strictEqual(rotuloCurto(''), 'Não informada');
});

test('toda origem da lista tem rotulo e resposta de pago', async function () {
  const { ORIGENS } = await carregar();
  const vistos = new Set();
  for (const o of ORIGENS) {
    assert.ok(o.valor && !vistos.has(o.valor), 'valor repetido ou vazio: ' + o.valor);
    vistos.add(o.valor);
    assert.ok(o.rotulo && o.rotulo.length > 2, 'rotulo fraco em ' + o.valor);
    // O curto tem de caber na etiqueta do card: 12 caracteres e o limite pratico.
    assert.ok(o.curto && o.curto.length <= 12, 'curto longo demais em ' + o.valor + ': ' + o.curto);
    assert.strictEqual(typeof o.paga, 'boolean');
    assert.strictEqual(o.valor, o.valor.toLowerCase().trim());
  }
  // Pelo menos uma paga e uma organica: lista so com um tipo nao separa nada.
  assert.ok(ORIGENS.some((o) => o.paga) && ORIGENS.some((o) => !o.paga));
});

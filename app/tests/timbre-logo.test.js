'use strict';
/** O logo que entra no timbre (M6.2).
 *
 *  O teste que importa mais aqui é o do SVG: é a única entrada de HTML
 *  arbitrário que este sistema teria, e ela desembocaria num documento aberto
 *  no navegador com os dados da paciente na tela.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { validarLogo, LIMITE_BYTES } = require('../server/services/timbre-logo');

/** Uma data URL de `n` bytes do tipo pedido. */
const imagem = (tipo, n) =>
  'data:' + tipo + ';base64,' + Buffer.alloc(n, 7).toString('base64');

test('PNG, JPG e WEBP passam', () => {
  for (const t of ['image/png', 'image/jpeg', 'image/webp']) {
    const r = validarLogo(imagem(t, 1024));
    assert.strictEqual(r.ok, true, t);
    assert.strictEqual(r.tipo, t);
  }
});

test('SVG e RECUSADO, e a frase diz o que fazer', () => {
  const r = validarLogo('data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64'));
  assert.strictEqual(r.ok, false);
  assert.match(r.erro, /SVG/);
  assert.match(r.erro, /PNG/, 'quem tem o logo em SVG precisa saber o que fazer com ele');
});

test('GIF e PDF tambem nao entram no timbre', () => {
  assert.strictEqual(validarLogo(imagem('image/gif', 512)).ok, false);
  assert.strictEqual(validarLogo(imagem('application/pdf', 512)).ok, false);
});

test('vazio e nulo sao recusados sem estourar', () => {
  for (const v of ['', null, undefined, '   ', 42, {}]) {
    assert.strictEqual(validarLogo(v).ok, false, JSON.stringify(v));
  }
});

test('texto que nao e data URL e recusado', () => {
  for (const v of ['https://exemplo.com/logo.png', 'data:image/png,naoebase64',
                   '<img src=x>', 'data:image/png;base64,']) {
    assert.strictEqual(validarLogo(v).ok, false, v);
  }
});

test('o tamanho e medido, e o limite e o de 250 KB', () => {
  const dentro = validarLogo(imagem('image/png', LIMITE_BYTES - 10));
  assert.strictEqual(dentro.ok, true);
  const fora = validarLogo(imagem('image/png', LIMITE_BYTES + 1024));
  assert.strictEqual(fora.ok, false);
  assert.match(fora.erro, /KB/, 'a recusa diz o tamanho, senao ninguem sabe quanto cortar');
});

test('a contagem de bytes e a real, e nao o tamanho do texto base64', () => {
  /* base64 cresce 4/3. Medir o texto faria o limite valer 187 KB de imagem,
     e a recusa mentiria sobre o tamanho do arquivo de quem enviou. */
  const r = validarLogo(imagem('image/png', 3000));
  assert.strictEqual(r.bytes, 3000);
});

test('base64 truncado e recusado ANTES de virar coluna', () => {
  /* Grava sem erro e so falha na impressao, semanas depois. */
  const inteiro = imagem('image/png', 1024);
  assert.strictEqual(validarLogo(inteiro.slice(0, inteiro.length - 3)).ok, false);
});

test('a data URL devolvida e normalizada, sem espacos', () => {
  const r = validarLogo('data:image/png;base64,' +
    Buffer.alloc(300, 1).toString('base64').replace(/(.{20})/g, '$1\n'));
  assert.strictEqual(r.ok, true);
  assert.ok(!/\s/.test(r.dataUrl), 'quebra de linha dentro do src quebraria a impressao');
});

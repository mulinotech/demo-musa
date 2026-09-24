'use strict';
/** A redução do logo antes de subir (M6.2).
 *
 *  Só a parte que é aritmética pura — `novaMedida`. O desenho no canvas depende
 *  do navegador e é o que a conferência de navegador mede; o que se prova aqui
 *  é que a proporção da marca de alguém não é esticada.
 */
const { test } = require('node:test');
const assert = require('node:assert');

let novaMedida, LARGURA_MAXIMA_LOGO;
test('carrega o modulo de tela', async () => {
  const m = await import('../src/lib/logo.mjs');
  novaMedida = m.novaMedida;
  LARGURA_MAXIMA_LOGO = m.LARGURA_MAXIMA_LOGO;
  assert.strictEqual(typeof novaMedida, 'function');
});

test('imagem menor que o limite nao e mexida', () => {
  /* Ampliar um logo pequeno so acrescentaria peso e borraria a marca. */
  assert.deepStrictEqual(novaMedida(300, 120, 600), { largura: 300, altura: 120 });
});

test('imagem grande desce pela LARGURA, e a altura acompanha', () => {
  assert.deepStrictEqual(novaMedida(2400, 1200, 600), { largura: 600, altura: 300 });
});

test('a proporcao e preservada em numero quebrado', () => {
  const m = novaMedida(1000, 333, 600);
  assert.strictEqual(m.largura, 600);
  assert.strictEqual(m.altura, 200);
});

test('logo muito alto e estreito nao vira uma tarja', () => {
  /* Fixar altura em vez de largura e' o erro classico: um logo vertical viraria
     um risco horizontal no papel, e ninguem percebe ate imprimir. */
  const m = novaMedida(300, 1800, 600);
  assert.deepStrictEqual(m, { largura: 300, altura: 1800 });
});

test('altura nunca chega a zero', () => {
  const m = novaMedida(6000, 3, 600);
  assert.ok(m.altura >= 1, 'altura 0 nao desenha nada');
});

test('medida invalida devolve nulo em vez de NaN', () => {
  for (const [l, a] of [[0, 10], [10, 0], [-5, 10], [null, null], ['x', 'y']]) {
    assert.strictEqual(novaMedida(l, a, 600), null, l + 'x' + a);
  }
});

test('o limite padrao cobre a impressao de 18mm a 300dpi', () => {
  // 18mm ≈ 213px a 300dpi. 600 é folga, não capricho.
  assert.ok(LARGURA_MAXIMA_LOGO >= 213 * 2);
});

'use strict';
/** O `+55` que já vem escrito no campo (M5.10)
 *
 *  ============================ POR QUE UM TESTE DE ARQUIVO DO FRONT, EM .js
 *
 *  A suíte inteira roda contra o servidor, em CommonJS, e `src/lib/telefone.mjs`
 *  é do navegador. Ficaria sem teste — e este arquivo é exatamente o tipo de
 *  código que merece um: ele MEXE no que a pessoa está digitando. Um defeito
 *  aqui não dá erro nenhum, só grava um telefone que não é o da paciente.
 *
 *  E já deu: a primeira versão contava os dígitos do valor inteiro do campo,
 *  prefixo incluído, e quem digitava o DDD 55 (Santa Maria) via aparecer
 *  `5555`. Quem descobriu foi esta conferência, antes de o código sair daqui.
 *
 *  É por causa deste teste que o arquivo do front é `.mjs` e não `.ts`: um
 *  `import()` basta, sem esbuild nem ferramenta de build no meio. Teste que
 *  depende de ferramenta que talvez não esteja no servidor é teste que um dia
 *  some de lá em silêncio — e a guarda `conferir-suite.js` existe justamente
 *  porque isso já aconteceu.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const url = require('url');

const CAMINHO = url.pathToFileURL(
  path.join(__dirname, '..', 'src', 'lib', 'telefone.mjs')).href;

/* Cada teste carrega o modulo por conta propria. Guardar o resultado num `let`
   preenchido pelo primeiro teste faria os demais dependerem da ORDEM em que a
   suite roda -- e um deles sozinho, com `--test-name-pattern`, explodiria com
   "comDdi is not a function" em vez de dizer o que quebrou. O import de ESM e'
   memorizado pelo Node, entao repetir nao custa nada. */
const carregar = () => import(CAMINHO);

/** Digitar caractere a caractere, como o campo faz de verdade: cada tecla passa
 *  pela funcao com o resultado da anterior. E' assim que o defeito do `5555`
 *  aparecia, e nao em uma chamada solta. */
function digitando(comDdi, texto) {
  let campo = comDdi('');
  for (const c of texto) campo = comDdi(campo + c);
  return campo;
}

test('o campo vazio ja nasce com o +55', async function () {
  const { comDdi, DDI_PADRAO } = await carregar();
  assert.strictEqual(comDdi(''), DDI_PADRAO);
  assert.strictEqual(comDdi('   '), '+55 ');
});

test('apagar tudo traz o +55 de volta', async function () {
  const { comDdi } = await carregar();
  for (const meio of ['', '+', '+5', '+55']) {
    assert.strictEqual(comDdi(meio), '+55 ', 'sumiu em ' + JSON.stringify(meio));
  }
});

test('digitando um celular de Sao Paulo, tecla a tecla', async function () {
  const { comDdi } = await carregar();
  assert.strictEqual(digitando(comDdi, '11998765432'), '+55 11998765432');
});

test('O DEFEITO DO 5555: o DDD 55 nao pode ser comido pelo prefixo', async function () {
  const { comDdi } = await carregar();
  /* Santa Maria/RS e' DDD 55, e o campo ja mostra "+55 ". A primeira versao
     somava os dois e escrevia 5555 -- outro telefone, sem aviso nenhum. */
  assert.strictEqual(digitando(comDdi, '5599887766'), '+55 5599887766');
  assert.strictEqual(digitando(comDdi, '55999887766'), '+55 55999887766');
});

test('colar o numero com DDI junto nao duplica o DDI', async function () {
  const { comDdi } = await carregar();
  for (const colado of ['5511998765432', '+5511998765432', '+55 11 99876-5432',
                        '(11) 99876-5432', '005511998765432']) {
    assert.strictEqual(comDdi(colado), '+55 11998765432',
      'colagem tratada errado: ' + colado);
  }
});

test('o valor ja normalizado passa de novo sem mudar', async function () {
  const { comDdi } = await carregar();
  /* O campo chama isto a cada tecla: funcao que nao e' estavel fica brigando
     com quem digita. */
  for (const v of ['+55 11998765432', '+55 5599887766', '+55 ']) {
    assert.strictEqual(comDdi(v), v, 'nao ficou estavel: ' + v);
  }
});

test('"tem numero?" nao se deixa enganar pelo prefixo', async function () {
  const { temNumero } = await carregar();
  assert.strictEqual(temNumero('+55 '), false);
  assert.strictEqual(temNumero(''), false);
  assert.strictEqual(temNumero('+55 119'), false);
  assert.strictEqual(temNumero('+55 11998765432'), true);
  assert.strictEqual(temNumero('+55 1133334444'), true);
});

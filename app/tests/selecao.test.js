'use strict';
/** Trocar texto livre por lista sem apagar prontuário (M5.11)
 *
 *  Metade destes testes existe por causa de UM risco, e ele não é de banco: a
 *  sessão de março foi lançada com "ultra former" digitado à mão; o cadastro
 *  novo tem "Ultraformer MPT"; a janela abre com a lista e nada selecionado; a
 *  recepção salva por outro motivo qualquer — e o equipamento da sessão de
 *  março some, sem erro e sem ninguém pedir.
 *
 *  Apagar prontuário como efeito colateral de uma melhoria de tela é pior do
 *  que a tela ruim que havia antes.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const url = require('url');

const CAMINHO = url.pathToFileURL(
  path.join(__dirname, '..', 'src', 'lib', 'selecao.mjs')).href;
const carregar = () => import(CAMINHO);

const CADASTRO = ['Ultraformer MPT', 'Lavien BB Laser', 'Criofrequência'];

/* ------------------------------------------------- o texto vira lista e volta */

test('o texto de insumos de hoje vira lista', async function () {
  const { separarItens } = await carregar();
  assert.deepStrictEqual(
    separarItens('Ácido Hialurônico, Bioestimulador Y'),
    ['Ácido Hialurônico', 'Bioestimulador Y']);
});

test('espaco sobrando, virgula sobrando e campo vazio nao viram item', async function () {
  const { separarItens } = await carregar();
  assert.deepStrictEqual(separarItens('  A ,, B  ,'), ['A', 'B']);
  assert.deepStrictEqual(separarItens(''), []);
  assert.deepStrictEqual(separarItens(null), []);
  assert.deepStrictEqual(separarItens('   '), []);
});

test('repetido some, e a PRIMEIRA grafia e a que fica', async function () {
  const { separarItens } = await carregar();
  /* Ficar com a ultima faria a lista mudar sozinha cada vez que a janela
     reabrisse -- tela que se mexe sem ninguem mexer nela. */
  assert.deepStrictEqual(separarItens('Botox, botox, BOTOX'), ['Botox']);
});

test('lista volta a ser texto do jeito que a coluna guarda', async function () {
  const { juntarItens, separarItens } = await carregar();
  assert.strictEqual(juntarItens(['A', 'B']), 'A, B');
  assert.strictEqual(juntarItens([]), '');
  const ida = 'Ácido Hialurônico, Bioestimulador Y';
  assert.strictEqual(juntarItens(separarItens(ida)), ida);   // ida e volta nao mexe no dado
});

/* -------------------------------------- O QUE ESTA GRAVADO NUNCA SOME DA TELA */

test('O RISCO PRINCIPAL: o que foi digitado antes continua na lista', async function () {
  const { opcoesDeEscolha } = await carregar();
  const o = opcoesDeEscolha('ultra former', CADASTRO);

  assert.strictEqual(o.length, 4, 'a opcao do valor gravado sumiu');
  const legado = o.find((x) => x.legado);
  assert.ok(legado, 'nenhuma opcao marcada como digitada antes');
  assert.strictEqual(legado.valor, 'ultra former');
  assert.match(legado.rotulo, /digitado antes/);
  // E ele fica no FIM: o cadastro e o caminho normal.
  assert.strictEqual(o[o.length - 1].valor, 'ultra former');
});

test('o que ja esta no cadastro NAO vira opcao repetida', async function () {
  const { opcoesDeEscolha } = await carregar();
  const o = opcoesDeEscolha('Ultraformer MPT', CADASTRO);
  assert.strictEqual(o.length, 3);
  assert.strictEqual(o.filter((x) => x.legado).length, 0);
});

test('diferenca de maiuscula e espaco nao cria opcao duplicada', async function () {
  const { opcoesDeEscolha } = await carregar();
  assert.strictEqual(opcoesDeEscolha('  ultraformer mpt  ', CADASTRO).length, 3);
});

test('a regra NAO tenta adivinhar parecidos', async function () {
  const { mesmoNome } = await carregar();
  /* "ultra former" e "Ultraformer" sao parecidos e podem ser coisas diferentes.
     Casar por aproximacao juntaria o que a clinica sabe separar -- e ninguem
     revisaria, porque a tela ficaria coerente. E' o mesmo motivo do 'ambiguo'
     na M5.10. */
  assert.strictEqual(mesmoNome('ultra former', 'Ultraformer'), false);
  assert.strictEqual(mesmoNome('Ultraformer MPT', 'ultraformer mpt '), true);
});

test('campo vazio nao inventa opcao', async function () {
  const { opcoesDeEscolha } = await carregar();
  assert.strictEqual(opcoesDeEscolha('', CADASTRO).length, 3);
  assert.strictEqual(opcoesDeEscolha('   ', CADASTRO).length, 3);
  assert.strictEqual(opcoesDeEscolha(null, CADASTRO).length, 3);
});

test('cadastro vazio: so o que foi digitado antes, e ele continua la', async function () {
  const { opcoesDeEscolha } = await carregar();
  const o = opcoesDeEscolha('ultra former', []);
  assert.strictEqual(o.length, 1);
  assert.strictEqual(o[0].valor, 'ultra former');
  assert.strictEqual(o[0].legado, true);
});

/* ------------------------------------------------------- o campo de varios */

test('insumos: cadastrado e digitado antes convivem, e os dois ficam marcados', async function () {
  const { opcoesDeMarcar } = await carregar();
  const produtos = ['Ácido Hialurônico', 'Toxina Botulínica'];
  const r = opcoesDeMarcar('Ácido Hialurônico, Bioestimulador Y', produtos);

  assert.deepStrictEqual(r.opcoes.map((o) => o.valor),
    ['Ácido Hialurônico', 'Toxina Botulínica', 'Bioestimulador Y']);
  assert.strictEqual(r.opcoes[2].legado, true);
  // Os DOIS que a sessao tinha continuam marcados.
  assert.deepStrictEqual(r.marcados, ['Ácido Hialurônico', 'Bioestimulador Y']);
});

test('insumos: nada gravado, nada marcado', async function () {
  const { opcoesDeMarcar } = await carregar();
  const r = opcoesDeMarcar('', ['A', 'B']);
  assert.deepStrictEqual(r.marcados, []);
  assert.strictEqual(r.opcoes.length, 2);
});

test('INVARIANTE: abrir e salvar sem tocar em nada nao perde item nenhum', async function () {
  const { opcoesDeMarcar, juntarItens, opcoesDeEscolha } = await carregar();

  const casos = [
    ['ultra former', []], ['ultra former', CADASTRO], ['', CADASTRO],
    ['Ultraformer MPT', CADASTRO], ['Ácido, Bioestimulador', ['Ácido']],
    ['A, a, B', ['B']], ['  ', []]
  ];

  for (const [gravado, cadastro] of casos) {
    // campo de um valor
    const o = opcoesDeEscolha(gravado, cadastro);
    const atual = String(gravado || '').trim();
    if (atual) {
      assert.ok(o.some((x) => x.valor === atual || x.valor.toLowerCase() === atual.toLowerCase()),
        'o valor gravado "' + gravado + '" sumiu das opcoes');
    }

    // campo de varios: o que entra tem de sair igual
    const r = opcoesDeMarcar(gravado, cadastro);
    const devolvido = juntarItens(r.marcados);
    const esperado = juntarItens(
      (await carregar()).separarItens(gravado));
    assert.strictEqual(devolvido, esperado,
      'abrir e salvar mudou o campo: "' + gravado + '" virou "' + devolvido + '"');
  }
});

test('entrada torta nao derruba a regra', async function () {
  const { opcoesDeEscolha, opcoesDeMarcar, juntarItens } = await carregar();
  assert.deepStrictEqual(opcoesDeEscolha(null, null), []);
  assert.deepStrictEqual(opcoesDeMarcar(null, null), { opcoes: [], marcados: [] });
  assert.strictEqual(juntarItens(null), '');
  assert.strictEqual(opcoesDeEscolha('X', [null, '', '  ', 'Y']).length, 2);
});

'use strict';
/** A marca no documento impresso (M6.2b).
 *
 *  ===================================================== POR QUE ESTE TESTE
 *
 *  A M6.1 trocou a identidade em 65 arquivos de tela e ESTE ficou para trás: o
 *  documento impresso é uma página HTML inteira montada no servidor, que não
 *  passa pelo `index.css`. O resultado foi a receita saindo com o cabeçalho
 *  novo e as cores antigas — e ninguém percebeu até imprimir.
 *
 *  O teste não é sobre gosto. É sobre a próxima vez: quando a paleta mudar de
 *  novo, este arquivo avisa que existe um segundo lugar onde ela vive.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const doc = require('../server/services/documentos');

/** O HTML de um documento qualquer -- basta para ler o CSS embutido. */
const pagina = () => doc.paginaCompleta(
  { id: 'd1', title: 'Atestado', type: 'ATESTADO', status: 'EMITIDO',
    rendered_html: '<p>corpo</p>', emitido_por_nome: 'Dra Musa' },
  { timbre: { clinica: 'Clinica', endereco: 'Rua X', telefone: '11 1111-1111' } });

test('nenhuma cor da paleta antiga sobrou na folha', () => {
  const html = pagina().toLowerCase();
  /* Marrom do corpo, marrom do texto secundario, dourado do titulo, creme de
     fundo, bege de borda e o marrom do botao. Os seis da identidade anterior. */
  for (const antiga of ['#2b1c12', '#6b5443', '#8a7361', '#faf7f2', '#e6dbc9',
                        '#4a3728', '#3a2b1f', '#f5ede1']) {
    assert.ok(html.indexOf(antiga) === -1, 'ainda ha ' + antiga + ' no documento');
  }
});

test('e as cores do manual estao la', () => {
  const html = pagina();
  assert.match(html, /#141E33/, 'Navy -- o texto');
  assert.match(html, /#5A6478/, 'Slate -- o texto secundario');
  assert.match(html, /#0E7FA6/, 'Teal Musa -- o tipo do documento');
  assert.match(html, /#F6F8FB/, 'Nevoa -- o fundo de bloco');
});

test('o roxo e o gradiente NAO entram no papel', () => {
  /* Decisao, e nao esquecimento: receita e impressa em preto e branco e em
     modo economico, e area colorida vira borrao cinza. */
  const html = pagina();
  assert.ok(html.indexOf('#7A62F2') === -1, 'roxo no papel');
  assert.ok(html.indexOf('linear-gradient') === -1, 'gradiente no papel');
});

test('o aviso clinico continua vermelho', () => {
  /* `tr.atencao` e `.tag` nao sao marca: sao sinal. Repintados de teal, eles
     sumiriam no meio do resto da folha. */
  const html = pagina();
  assert.match(html, /#fdf1ee/);
  assert.match(html, /#9e3b28/);
});

test('Poppins titula e Inter le, com Georgia de reserva', () => {
  const html = pagina();
  assert.match(html, /family=Poppins/);
  assert.match(html, /family=Inter/);
  assert.match(html, /font-family:Inter,Georgia,serif/,
    'sem a reserva, impressao sem rede cairia numa fonte de sistema qualquer');
  assert.match(html, /font-family:Poppins,Georgia,serif/);
});

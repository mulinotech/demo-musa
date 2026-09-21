'use strict';
/** Venda Fechada vira paciente, sem duplicar (M5.10)
 *
 *  O time comercial escreveu, no PDF de 19/09: *"acho que cadastrado nem é a
 *  palavra, acho que é flagrado… assim não temos duplicidade nos cadastros do
 *  banco"*. A duplicidade que eles viram tinha causa exata — a regra antiga
 *  comparava telefones como TEXTO CRU, dentro do navegador:
 *
 *      const clientExists = clients.some(c => c.phone === finalPhone);
 *
 *  Metade dos testes abaixo são as formas em que o mesmo telefone chega escrito
 *  diferente. A outra metade guarda a decisão que atravessa o arquivo: **entre
 *  criar uma ficha a mais e vincular à paciente errada, criar a ficha a mais**.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const c = require('../server/services/conversao-de-lead');

/* --------------------------------------------- o mesmo numero, escrito de N formas */

test('o mesmo celular em cinco formatos tem UMA chave só', function () {
  // Este teste E' a duplicata que o time viu, escrita como conferencia.
  const formas = [
    '5511998765432',        // como o WhatsApp manda, com DDI colado
    '+55 11 99876-5432',    // como o formulario do site entrega
    '(11) 99876-5432',      // como a recepcao digita
    '11998765432',          // colado de planilha
    '11 9876-5432'          // ficha antiga, de antes do nono digito
  ];
  const chaves = formas.map(c.chaveDeTelefone);
  assert.strictEqual(new Set(chaves).size, 1,
    'formas que deveriam ser o mesmo numero deram chaves diferentes: ' + JSON.stringify(chaves));
  assert.strictEqual(chaves[0], '1198765432');
});

test('numeros de gente diferente continuam diferentes', function () {
  assert.strictEqual(c.mesmoTelefone('(11) 99876-5432', '(11) 99876-5433'), false);
  // Mesmo numero, DDD diferente: sao duas pessoas.
  assert.strictEqual(c.mesmoTelefone('(11) 99876-5432', '(21) 99876-5432'), false);
});

test('o fixo da clinica NAO casa com o celular de ninguem', function () {
  /* O risco que a conferencia do "6789" existe para fechar: tirar o nono digito
     sem olhar transformaria um 9xxxx em um numero com cara de fixo. */
  assert.strictEqual(c.mesmoTelefone('(11) 3111-2222', '(11) 93111-2222'), false);
  assert.strictEqual(c.chaveDeTelefone('(11) 3111-2222'), '1131112222');
});

test('o que nao e telefone nao vira chave -- e nao casa nem consigo mesmo', function () {
  for (const lixo of ['', null, undefined, '0', '9999', 'sem telefone', '99', '123456']) {
    assert.strictEqual(c.chaveDeTelefone(lixo), null, 'virou chave: ' + JSON.stringify(lixo));
  }
  // O ponto inteiro: dois cadastros com telefone vazio NAO sao a mesma pessoa.
  assert.strictEqual(c.mesmoTelefone('', ''), false);
  assert.strictEqual(c.mesmoTelefone('0000', '0000'), false);
  assert.strictEqual(c.chaveDeTelefone('(01) 99876-5432'), null);   // DDD nao existe
});

/* ---------------------------------------------------------- vincular x criar */

const ANA = { id: 'c_ana', name: 'Ana Paula', phone: '(11) 99876-5432' };
const JULIA = { id: 'c_jul', name: 'Júlia', phone: '(11) 99876-5432' };
const BIA = { id: 'c_bia', name: 'Beatriz', phone: '(21) 98888-1111' };

const lead = (mud) => Object.assign(
  { id: 'l_1', name: 'Ana P.', whatsapp: '5511998765432', email: '', clientId: null }, mud);

test('O CASO DA DUPLICATA: ficha ja existe com o numero escrito de outro jeito', function () {
  const r = c.escolherFicha(lead(), [ANA, BIA]);
  assert.strictEqual(r.acao, 'vincular');
  assert.strictEqual(r.cliente.id, 'c_ana');
  // A regra antiga respondia 'criar' aqui, e era assim que nascia a segunda Ana.
  assert.notStrictEqual(r.acao, 'criar');
});

test('paciente nova mesmo: cria a ficha', function () {
  const r = c.escolherFicha(lead({ whatsapp: '(31) 97777-1234' }), [ANA, BIA]);
  assert.strictEqual(r.acao, 'criar');
  assert.strictEqual(r.cliente, null);
});

test('clinica sem nenhuma ficha ainda: cria', function () {
  assert.strictEqual(c.escolherFicha(lead(), []).acao, 'criar');
});

test('fechar o MESMO lead duas vezes nao cria ficha duas vezes', function () {
  /* Arrastar o card para fora de Venda Fechada e de volta e' gesto de todo dia.
     Sem esta porta, cada ida e volta deixaria uma ficha nova para tras. */
  const r = c.escolherFicha(lead({ clientId: 'c_ana' }), [ANA]);
  assert.strictEqual(r.acao, 'jaVinculado');
  assert.strictEqual(r.cliente, null);
});

/* ----------------------------------------------- a mae e a filha, mesmo telefone */

test('DUAS fichas com o mesmo telefone: ninguem e escolhido no chute', function () {
  const r = c.escolherFicha(lead(), [ANA, JULIA, BIA]);
  assert.strictEqual(r.acao, 'ambiguo');
  assert.strictEqual(r.cliente, null);
  assert.strictEqual(r.candidatos.length, 2);
  // A tela precisa dos DOIS nomes para a recepcao conseguir decidir.
  assert.match(r.porque, /Ana Paula/);
  assert.match(r.porque, /Júlia/);
  /* As duas saidas automaticas seriam piores do que perguntar: "a mais antiga"
     poe a sessao da filha na ficha da mae, e "criar" faz a terceira duplicata
     justo onde ja ha duas. */
  assert.notStrictEqual(r.acao, 'vincular');
  assert.notStrictEqual(r.acao, 'criar');
});

/* ----------------------------------------------------------- lead sem telefone */

test('lead sem telefone usavel CRIA ficha -- nao sai procurando parecido', function () {
  const r = c.escolherFicha(lead({ whatsapp: '' }), [ANA, JULIA, BIA]);
  assert.strictEqual(r.acao, 'criar');
  assert.strictEqual(r.candidatos.length, 0);
  assert.match(r.porque, /n[ãa]o permite procurar/);
});

/* --------------------------------------------------------------- a forma geral */

test('toda resposta tem acao conhecida e diz por que', function () {
  const casos = [
    [lead(), [ANA, BIA]], [lead(), [ANA, JULIA]], [lead(), []],
    [lead({ clientId: 'c_ana' }), [ANA]], [lead({ whatsapp: 'oi' }), [ANA]],
    [lead({ whatsapp: '(31) 97777-1234' }), [ANA]]
  ];
  const conhecidas = ['jaVinculado', 'vincular', 'criar', 'ambiguo'];
  for (const [l, fichas] of casos) {
    const r = c.escolherFicha(l, fichas);
    assert.ok(conhecidas.indexOf(r.acao) !== -1, 'acao desconhecida: ' + r.acao);
    assert.ok(r.porque && r.porque.length > 5, 'resposta sem motivo em ' + r.acao);
    assert.ok(Array.isArray(r.candidatos));
  }
});

test('entrada torta nao derruba a regra', function () {
  assert.strictEqual(c.escolherFicha(null, null).acao, 'criar');
  assert.strictEqual(c.escolherFicha(lead(), [{ id: 'x', name: 'Sem telefone' }]).acao, 'criar');
});

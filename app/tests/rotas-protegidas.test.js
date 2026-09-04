'use strict';
/** Autenticacao e autorizacao pela porta da frente, via HTTP.
 *  Nenhum destes casos chega ao banco: sao todos decididos no middleware. */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { subirServidor, tokenPara, chamar } = require('./ajuda');

let ctx;
before(async function () { ctx = await subirServidor(); });
after(async function () {
  await ctx.fechar();
  // Rede de seguranca: qualquer conexao aberta por engano segura `node --test`
  // para sempre. Fechar o pool aqui faz um teste distraido falhar rapido em
  // vez de pendurar a suite inteira.
  try { await require('../server/db').pool.end(); } catch (e) { /* nunca foi aberto */ }
});

test('sem token, rota protegida devolve 401', async function () {
  const r = await chamar(ctx, 'GET', '/api/clients');
  assert.strictEqual(r.status, 401);
});

test('o 401 nao pede autenticacao basica ao navegador', async function () {
  const r = await chamar(ctx, 'GET', '/api/clients');
  assert.strictEqual(r.headers.get('www-authenticate'), null,
    'WWW-Authenticate faz o Chrome abrir o dialogo nativo por cima da tela de login');
});

test('rota publica responde sem token', async function () {
  const r = await chamar(ctx, 'GET', '/api/config');
  assert.strictEqual(r.status, 200);
});

test('vendedor autenticado nao acessa os logs', async function () {
  const r = await chamar(ctx, 'GET', '/api/logs', tokenPara('vendedor'));
  assert.strictEqual(r.status, 403);
});

test('vendedor autenticado nao acessa a gestao de usuarios', async function () {
  const r = await chamar(ctx, 'GET', '/api/users', tokenPara('vendedor'));
  assert.strictEqual(r.status, 403);
});

test('gerente nao acessa a gestao de usuarios, so admin', async function () {
  const r = await chamar(ctx, 'GET', '/api/users', tokenPara('gerente'));
  assert.strictEqual(r.status, 403);
});

test('token invalido e tratado como ausente', async function () {
  const r = await chamar(ctx, 'GET', '/api/clients', 'nao.e.um.token');
  assert.strictEqual(r.status, 401);
});

test('toda resposta da API carrega o marcador de versao', async function () {
  // Nao fixe o numero aqui. O marcador e incrementado a cada publicacao para
  // sabermos qual codigo esta no ar (OPERACOES.md, secao 3); travar o valor
  // faz a suite quebrar em todo deploy e ensina a ignorar teste vermelho.
  // O que interessa e que o porteiro rodou e assinou a resposta.
  const r = await chamar(ctx, 'GET', '/api/config');
  const marcador = r.headers.get('x-trava-musa');
  assert.ok(marcador, 'a resposta deveria trazer x-trava-musa');
  assert.match(marcador, /^v\d+$/, 'formato esperado: v seguido de numero, veio: ' + marcador);
});

test('vendedor nao ve preco: a area de precificacao devolve 403', async function () {
  // Preco e informacao sensivel de negocio. Testado pela API, nao pela tela -
  // esconder o menu no front nao e controle de acesso.
  for (const caminho of ['/api/pricing/settings', '/api/fixed-costs', '/api/pricing/simulations']) {
    const r = await chamar(ctx, 'GET', caminho, tokenPara('vendedor'));
    assert.strictEqual(r.status, 403, caminho + ' deveria negar vendedor');
  }
});

test('profissional tambem nao ve preco', async function () {
  const r = await chamar(ctx, 'GET', '/api/fixed-costs', tokenPara('profissional'));
  assert.strictEqual(r.status, 403);
});

test('simular preco sem token e 401, nao 400', async function () {
  const r = await chamar(ctx, 'POST', '/api/pricing/simulate');
  assert.strictEqual(r.status, 401);
});

test('vendedor e profissional nao acessam o financeiro', async function () {
  for (const papel of ['vendedor', 'profissional']) {
    for (const caminho of ['/api/finance/summary', '/api/finance/entries', '/api/recurring-expenses']) {
      const r = await chamar(ctx, 'GET', caminho, tokenPara(papel));
      assert.strictEqual(r.status, 403, papel + ' nao deveria abrir ' + caminho);
    }
  }
});

test('agenda exige token como qualquer outra rota', async function () {
  const r = await chamar(ctx, 'GET', '/api/appointments');
  assert.strictEqual(r.status, 401);
});

/* ------------------------------------------- o token de servico do cron
 *
 *  ESTA SUITE NAO PODE ENCOSTAR NO BANCO. Ela sobe a aplicacao de verdade, e
 *  `identidadeDeCron` abre conexao quando o cabecalho chega numa das rotas de
 *  varredura. Na maquina de quem desenvolve nao ha banco e a conexao falha na
 *  hora; NO SERVIDOR o banco existe, a conexao fica de pe, e `node --test`
 *  nunca termina -- ficou pendurado duas vezes em 03/09 ate um Ctrl+C.
 *
 *  Por isso os casos abaixo mandam o cabecalho apenas em rotas que NAO sao do
 *  cron: `identidadeDeCron` confere a lista de rotas antes de olhar o pool, e
 *  devolve null sem abrir nada. E o que precisa ser provado aqui de qualquer
 *  forma -- que o token nao vira sessao para a ficha da paciente.
 *
 *  A conferencia do token em si, com pool de mentira, vive em
 *  tests/cron.test.js, que nao sobe servidor nenhum.
 */

test('cabecalho de cron em rota que nao e do cron continua 401', async function () {
  const r = await chamar(ctx, 'GET', '/api/clients', null, { 'X-Musa-Cron': 'f'.repeat(64) });
  assert.strictEqual(r.status, 401);
});

test('cabecalho de cron nao vira sessao para a ficha do paciente', async function () {
  const r = await chamar(ctx, 'GET', '/api/clients/c1/documents', null,
    { 'X-Musa-Cron': 'f'.repeat(64) });
  assert.strictEqual(r.status, 401);
});

test('sem nenhum cabecalho, a rota de varredura tambem e 401', async function () {
  const r = await chamar(ctx, 'POST', '/api/appointments/reminders/run');
  assert.strictEqual(r.status, 401);
});

test('vendedor autenticado nao dispara varredura', async function () {
  const r = await chamar(ctx, 'POST', '/api/loyalty/expire', tokenPara('vendedor'));
  assert.strictEqual(r.status, 403);
});

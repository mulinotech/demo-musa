'use strict';
/** Os papéis novos: secretária, financeiro, contador e a gerência em duas (M6.7).
 *
 *  O que este arquivo protege é uma armadilha específica, e ela não é óbvia:
 *  `REGRAS_DE_PAPEL` funciona por NEGAÇÃO — rota sem linha na tabela é
 *  alcançável por qualquer papel autenticado. Um papel novo acrescentado só ao
 *  ENUM do banco nasceria, portanto, com acesso a **toda rota que ninguém
 *  regrou**. O contador leria prontuário. Nada apareceria em log nenhum.
 *
 *  Por isso metade dos testes aqui pergunta o que cada papel NÃO alcança.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { alcanca, papelEfetivo, regraPara, ALCANCE_DO_PAPEL } =
  require('../server/middleware/autorizacao');

/** A decisão INTEIRA do porteiro: recorte + tabela. É o que `exigirPapel` faz,
 *  sem o Express no meio. Testar só `alcanca` deixaria passar o caso em que o
 *  recorte permite e a tabela recusa — e é assim que a maioria das áreas de
 *  gestão fica de fora dos papéis estreitos. */
function passa(papel, metodo, caminho) {
  if (!alcanca(papel, metodo, caminho)) return false;
  const regra = regraPara(metodo, caminho);
  if (!regra) return true;
  return regra.papeis.indexOf(papelEfetivo(papel)) !== -1;
}

/* ===================================================== OS QUATRO DE ANTES */

test('os papeis antigos nao mudaram de alcance', () => {
  /* Esta é a primeira coisa a conferir: a tarefa acrescentou papéis, e não
     podia mexer em quem já trabalha no sistema hoje. */
  assert.strictEqual(passa('admin', 'GET', '/api/users'), true);
  assert.strictEqual(passa('gerente', 'GET', '/api/users'), false);
  assert.strictEqual(passa('gerente', 'GET', '/api/finance/resumo'), true);
  assert.strictEqual(passa('profissional', 'GET', '/api/finance/resumo'), false);
  assert.strictEqual(passa('profissional', 'POST', '/api/appointments'), true);
  assert.strictEqual(passa('vendedor', 'POST', '/api/appointments'), false);
  assert.strictEqual(passa('vendedor', 'GET', '/api/leads'), true);
});

test('papel sem recorte nao e limitado pela tabela nova', () => {
  for (const p of ['admin', 'gerente', 'gerente_admin', 'profissional', 'vendedor']) {
    assert.strictEqual(alcanca(p, 'GET', '/api/rota/que/nao/existe/ainda'), true, p);
  }
});

/* ======================================================= GERENTE ADM E COM */

test('gerente_admin e o gerente de hoje com outro nome', () => {
  assert.strictEqual(papelEfetivo('gerente_admin'), 'gerente');
  for (const r of ['/api/finance/resumo', '/api/pricing/apply', '/api/fixed-costs',
                   '/api/dashboard/dinheiro', '/api/logs']) {
    assert.strictEqual(passa('gerente_admin', 'GET', r), true, r);
  }
  // E continua sem a gestão de acessos, que é só do admin.
  assert.strictEqual(passa('gerente_admin', 'GET', '/api/users'), false);
});

test('gerente_comercial nao alcanca a estrutura de custo', () => {
  for (const r of ['/api/finance/resumo', '/api/pricing/apply', '/api/fixed-costs',
                   '/api/recurring-expenses', '/api/dashboard/dinheiro']) {
    assert.strictEqual(passa('gerente_comercial', 'GET', r), false, r);
    assert.strictEqual(passa('gerente_comercial', 'POST', r), false, r);
  }
});

test('gerente_comercial e gerente em tudo o mais', () => {
  for (const r of ['/api/leads', '/api/clients', '/api/appointments',
                   '/api/treatment-catalog', '/api/reports/visao-geral',
                   '/api/clinica', '/api/logs', '/api/products']) {
    assert.strictEqual(passa('gerente_comercial', 'GET', r), true, r);
  }
});

test('modo exceto: rota NOVA nasce aberta para o gerente comercial', () => {
  /* É a razão de ele usar `exceto` e não `somente`. Uma lista fechada o
     deixaria de fora de cada módulo novo até alguém lembrar da linha — e o
     sintoma seria um gerente sem acesso ao que a clínica acabou de comprar. */
  assert.strictEqual(passa('gerente_comercial', 'GET', '/api/modulo-que-ainda-nao-existe'), true);
});

/* ============================================================== SECRETÁRIA */

test('a secretaria trabalha na recepcao', () => {
  for (const [m, r] of [['GET', '/api/appointments'], ['POST', '/api/appointments'],
                        ['PATCH', '/api/appointments/a1'], ['GET', '/api/clients'],
                        ['GET', '/api/clients/c1'], ['POST', '/api/clients'],
                        ['GET', '/api/leads'], ['POST', '/api/leads/do-whatsapp'],
                        ['GET', '/api/treatment-plans'], ['GET', '/api/profissionais'],
                        ['GET', '/api/loyalty/saldo/c1']]) {
    assert.strictEqual(passa('secretaria', m, r), true, m + ' ' + r);
  }
});

test('a secretaria NAO abre prontuario', () => {
  /* A linha de `/api/clients` no recorte dela é um `padrao` que casa a coleção
     e uma paciente, e para aí. Um prefixo solto levaria os filhos junto — a
     mesma armadilha de rota aninhada anotada em autorizacao.js. */
  for (const r of ['/api/clients/c1/documents', '/api/clients/c1/documents/d1',
                   '/api/clients/c1/export', '/api/documents/d1',
                   '/api/document-templates']) {
    assert.strictEqual(passa('secretaria', 'GET', r), false, r);
  }
});

test('a secretaria NAO ve dinheiro', () => {
  for (const r of ['/api/finance/resumo', '/api/pricing', '/api/fixed-costs',
                   '/api/reports/visao-geral', '/api/dashboard/dinheiro',
                   '/api/dashboard/visao-geral']) {
    assert.strictEqual(passa('secretaria', 'GET', r), false, r);
  }
});

test('a secretaria nao cria acesso nem mexe no catalogo', () => {
  assert.strictEqual(passa('secretaria', 'GET', '/api/users'), false);
  assert.strictEqual(passa('secretaria', 'POST', '/api/treatment-catalog'), false);
  assert.strictEqual(passa('secretaria', 'GET', '/api/treatment-catalog'), true);
});

/* ============================================================== FINANCEIRO */

test('o financeiro trabalha o caixa', () => {
  for (const [m, r] of [['GET', '/api/finance/resumo'], ['POST', '/api/finance/lancamentos'],
                        ['GET', '/api/fixed-costs'], ['POST', '/api/pricing/apply'],
                        ['GET', '/api/reports/visao-geral'], ['GET', '/api/dashboard/dinheiro']]) {
    assert.strictEqual(passa('financeiro', m, r), true, m + ' ' + r);
  }
});

test('o financeiro nao abre prontuario nem mexe na agenda', () => {
  assert.strictEqual(passa('financeiro', 'GET', '/api/clients/c1/documents'), false);
  assert.strictEqual(passa('financeiro', 'GET', '/api/appointments'), true, 'le, para conciliar');
  assert.strictEqual(passa('financeiro', 'POST', '/api/appointments'), false);
  assert.strictEqual(passa('financeiro', 'DELETE', '/api/appointments/a1'), false);
});

/* ================================================================ CONTADOR */

test('o contador e leitura, e so do que e contabil', () => {
  assert.strictEqual(passa('contador', 'GET', '/api/finance/resumo'), true);
  assert.strictEqual(passa('contador', 'GET', '/api/reports/visao-geral'), true);
  assert.strictEqual(passa('contador', 'POST', '/api/finance/lancamentos'), false);
  assert.strictEqual(passa('contador', 'DELETE', '/api/finance/lancamentos/1'), false);
  assert.strictEqual(passa('contador', 'POST', '/api/pricing/apply'), false);
});

test('o contador nao alcanca paciente nenhum', () => {
  /* Nome de paciente não entra em livro contábil. Dar a ficha "porque é mais
     fácil" é o caminho mais curto para dado de saúde sair numa planilha. */
  for (const r of ['/api/clients', '/api/clients/c1', '/api/clients/c1/documents',
                   '/api/appointments', '/api/leads', '/api/interactions']) {
    assert.strictEqual(passa('contador', 'GET', r), false, r);
  }
});

/* ============================== O QUE FECHA A PORTA DOS FUNDOS DE VERDADE */

test('rota SEM regra fica FECHADA para os papeis estreitos', () => {
  /* O teste que justifica a tabela existir. `/api/gemini` não tem linha em
     REGRAS_DE_PAPEL; sem o recorte, os três leriam por ele. */
  for (const p of ['secretaria', 'financeiro', 'contador']) {
    assert.strictEqual(passa(p, 'GET', '/api/gemini/qualquer-coisa'), false, p);
    assert.strictEqual(passa(p, 'POST', '/api/modulo-novo-de-amanha'), false, p);
  }
});

test('todo papel estreito consegue entrar e ler o proprio timbre', () => {
  /* Um recorte apertado demais tranca a pessoa na tela de login, e o sintoma
     ("não consigo entrar") é indistinguível de senha errada. */
  for (const p of ['secretaria', 'financeiro', 'contador']) {
    assert.strictEqual(passa(p, 'POST', '/api/auth/login'), true, p);
    assert.strictEqual(passa(p, 'GET', '/api/meu-timbre'), true, p);
    assert.strictEqual(passa(p, 'GET', '/api/clinica'), true, p);
  }
});

test('nenhum papel estreito edita a clinica', () => {
  for (const p of ['secretaria', 'financeiro', 'contador']) {
    assert.strictEqual(passa(p, 'PATCH', '/api/clinica'), false, p);
    assert.strictEqual(passa(p, 'PUT', '/api/clinica/logo'), false, p);
  }
});

test('o recorte e conferido ANTES da tabela, e nao depois', () => {
  /* `financeiro` responde como `gerente`, e a tabela deixaria o gerente abrir
     `/api/logs`. Quem recusa é o recorte. Se a ordem se invertesse um dia, este
     teste cai. */
  assert.strictEqual(regraPara('GET', '/api/logs').papeis.includes('gerente'), true);
  assert.strictEqual(alcanca('financeiro', 'GET', '/api/logs'), false);
  assert.strictEqual(passa('financeiro', 'GET', '/api/logs'), false);
});

/* ============================================ AS TRÊS LISTAS NÃO DIVERGEM */

const leia = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('o ENUM do banco, a rota e a tela falam dos mesmos papeis', async () => {
  /* Três lugares nomeiam papel: a migration 043 (o que o banco aceita),
     PAPEIS_VALIDOS em routes/users.js (o que o PATCH aceita) e papeis.mjs (o
     que a tela oferece). Divergir faz a tela oferecer um papel que o servidor
     recusa — e a pessoa lê "Nada para atualizar", que não explica nada. */
  const doBanco = (leia('db/migrations/043_papeis_da_equipe.js')
    .match(/ENUM_NOVO =([\s\S]*?);/)[1].match(/'([a-z_]+)'/g) || [])
    .map((x) => x.replace(/'/g, ''));

  const daRota = (leia('server/routes/users.js')
    .match(/const PAPEIS_VALIDOS = \[([\s\S]*?)\];/)[1].match(/'([a-z_]+)'/g) || [])
    .map((x) => x.replace(/'/g, ''));

  const daTela = (await import('../src/lib/papeis.mjs')).VALORES;

  assert.deepStrictEqual(doBanco.slice().sort(), daRota.slice().sort(), 'banco x rota');
  assert.deepStrictEqual(daRota.slice().sort(), daTela.slice().sort(), 'rota x tela');
  assert.strictEqual(daRota.includes('gerente'), true,
    'o papel antigo continua valido: a migration nao converteu ninguem');
});

test('todo papel novo declara equivalencia OU recorte', () => {
  /* Um papel que chegasse ao ENUM sem aparecer em nenhuma das duas tabelas
     herdaria toda rota sem regra. Este teste é o alarme. */
  const { RESPONDE_COMO } = require('../server/middleware/autorizacao');
  for (const p of ['gerente_admin', 'gerente_comercial', 'secretaria', 'financeiro', 'contador']) {
    assert.ok(RESPONDE_COMO[p] || ALCANCE_DO_PAPEL[p], p + ' nao foi declarado em lugar nenhum');
  }
});

test('todo recorte declara o modo, e so os dois que existem', () => {
  for (const p of Object.keys(ALCANCE_DO_PAPEL)) {
    const r = ALCANCE_DO_PAPEL[p];
    assert.ok(r.modo === 'somente' || r.modo === 'exceto', p + ': modo invalido');
    assert.ok(Array.isArray(r.rotas) && r.rotas.length, p + ': sem rotas');
    for (const linha of r.rotas) {
      assert.ok(linha.prefixo || linha.padrao, p + ': linha sem prefixo nem padrao');
    }
  }
});

test('quem nao atende nao aparece como profissional responsavel', () => {
  /* Era `role <> 'vendedor'` — lista por exclusão. Com os papéis novos ela
     ofereceria o contador no seletor de "Profissional Responsável" da agenda. */
  const fonte = leia('server/routes/users.js');
  const atendem = (fonte.match(/const PAPEIS_QUE_ATENDEM = \[([\s\S]*?)\];/)[1]
    .match(/'([a-z_]+)'/g) || []).map((x) => x.replace(/'/g, ''));
  for (const p of ['vendedor', 'secretaria', 'financeiro', 'contador', 'gerente_comercial']) {
    assert.strictEqual(atendem.includes(p), false, p + ' nao aplica procedimento');
  }
  assert.strictEqual(atendem.includes('profissional'), true);
  assert.strictEqual(fonte.includes("role <> 'vendedor'"), false,
    'a lista por exclusao saiu de vez');
});

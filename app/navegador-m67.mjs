/** A M6.7 vista do navegador: o que cada papel ENXERGA ao entrar.
 *
 *  O ensaio `repro-m67` já mediu o porteiro devolvendo 403. O que só se vê
 *  daqui é a outra metade: uma pessoa que entra e encontra um menu com telas
 *  que o servidor vai recusar não lê isso como permissão — lê como defeito. E
 *  pior, o vendedor e a secretária caíam numa Visão Geral que não carrega.
 */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { chromium } from 'playwright';
import { createRequire } from 'module';
const require = createRequire('/home/claude/musa/');

const H = '127.0.0.1', P = 3307, U = 'musa', S = 'ensaio-local', B = 'musa_m67_nav';
const raiz = await mysql.createConnection({ host: H, port: P, user: U, password: S, multipleStatements: true });
await raiz.query('DROP DATABASE IF EXISTS ' + B);
await raiz.query('CREATE DATABASE ' + B);
await raiz.end();

process.env.DB_HOST = H; process.env.DB_PORT = String(P); process.env.DB_USER = U;
process.env.DB_PASSWORD = S; process.env.DB_NAME = B; process.env.JWT_SECRET = 'nav-m67';

const conn = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B, multipleStatements: true });
await require('/home/claude/musa/db/run-migrations.js')(conn, {});

const PESSOAS = [
  ['u_adm', 'Dra Musa', 'adm@ensaio.invalido', 'admin'],
  ['u_sec', 'Rita Recepcao', 'sec@ensaio.invalido', 'secretaria'],
  ['u_fin', 'Paulo Caixa', 'fin@ensaio.invalido', 'financeiro'],
  ['u_cont', 'Celso Contabil', 'cont@ensaio.invalido', 'contador'],
  ['u_gcom', 'Gisele Comercial', 'gcom@ensaio.invalido', 'gerente_comercial'],
  ['u_gadm', 'Gilda Administrativa', 'gadm@ensaio.invalido', 'gerente_admin']
];
for (const [id, nome, email, papel] of PESSOAS) {
  await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id)' +
    ' VALUES (?,?,?,?,?,?,?)',
    [id, nome, email, bcrypt.hashSync('SenhaDeEnsaio2026', 10), papel, 'active', 'cl_1']);
}
await conn.query("INSERT INTO clients (id,name,phone,clinica_id) VALUES ('c1','Ana Paula','11911112222','cl_1')");
await conn.end();

const app = require('/home/claude/musa/server/app.js');
const servidor = app.listen(4207);
await new Promise((r) => servidor.on('listening', r));
const BASE = 'http://127.0.0.1:4207';

const conf = [];
const ok = (nome, real, esperado) => {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  conf.push(passou);
  console.log((passou ? '  OK  ' : '  XX  ') + nome +
    (passou ? '' : '   esperado ' + JSON.stringify(esperado) + ', veio ' + JSON.stringify(real)));
};

const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pag = await nav.newPage({ viewport: { width: 1500, height: 950 } });

const entrar = async (email) => {
  await pag.goto(BASE + '/login');
  await pag.fill('input[type="email"]', email);
  await pag.fill('input[type="password"]', 'SenhaDeEnsaio2026');
  await pag.click('button[type="submit"]');
  await pag.waitForURL(/crm/, { timeout: 15000 });
  await pag.waitForTimeout(2200);
};
const sair = async () => {
  await pag.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
};

/** Os itens do menu lateral, pelo texto. É o que a pessoa vê. */
const menu = async () => {
  const t = await pag.locator('nav').first().innerText();
  return t.split('\n').map((x) => x.trim()).filter(Boolean);
};

console.log('\n[1] A SECRETARIA CAI NUMA TELA QUE FUNCIONA');
{
  await entrar('sec@ensaio.invalido');
  /* Era aqui que ela encontrava "Não foi possível carregar os números do
     período" — a Visão Geral chama `/api/dashboard`, que ela não alcança, e o
     que a tela sabe dizer sobre um 403 é a frase de um defeito. */
  ok('nao para na visao geral', /\/crm\/agenda/.test(pag.url()), true);
  const tela = await pag.locator('body').innerText();
  ok('e a tela abriu de verdade', /Nao foi possivel|Não foi possível/.test(tela), false);

  const itens = await menu();
  ok('o menu tem a agenda', itens.some((i) => /Agenda/.test(i)), true);
  ok('e pacientes', itens.some((i) => /Pacientes/.test(i)), true);
  ok('NAO tem financeiro', itens.some((i) => /Financeiro/.test(i)), false);
  ok('NAO tem precificacao', itens.some((i) => /Precifica/.test(i)), false);
  ok('NAO tem documentos', itens.some((i) => /Documentos/.test(i)), false);
  ok('NAO tem usuarios', itens.some((i) => /Usuários|Usuarios/.test(i)), false);
  ok('e a barra a chama de Recepcao',
    /Recepção/.test(await pag.locator('aside, nav').first().innerText()), true);

  /* O DESVIO TAMBEM VALE PARA QUEM DIGITA O CAMINHO. Sem isto, a rota
     desconhecida devolveria a secretaria para /crm -- a tela que ela nao
     alcanca -- e o desvio viraria um pingue-pongue. */
  await pag.goto(BASE + '/crm/financeiro');
  await pag.waitForTimeout(1800);
  ok('digitar /crm/financeiro nao a deixa na tela de dinheiro',
    /financeiro/.test(pag.url()), false);

  await pag.screenshot({ path: '/tmp/claude-0/m67-secretaria.png' });
  await sair();
}

console.log('\n[2] O CONTADOR SO ENXERGA O QUE E DELE');
{
  await entrar('cont@ensaio.invalido');
  const itens = await menu();
  ok('tem visao geral', itens.some((i) => /Visão Geral|Visao Geral/.test(i)), true);
  ok('tem financeiro', itens.some((i) => /Financeiro/.test(i)), true);
  ok('NAO tem agenda', itens.some((i) => /Agenda/.test(i)), false);
  ok('NAO tem pacientes', itens.some((i) => /Pacientes/.test(i)), false);
  ok('NAO tem funil', itens.some((i) => /Funil/.test(i)), false);
  ok('NAO tem precificacao', itens.some((i) => /Precifica/.test(i)), false);
  ok('a barra o chama de Contabilidade',
    /Contabilidade/.test(await pag.locator('aside, nav').first().innerText()), true);
  await sair();
}

console.log('\n[3] A GERENCIA EM DOIS: UM VE O DINHEIRO, O OUTRO NAO');
{
  await entrar('gcom@ensaio.invalido');
  const com = await menu();
  ok('o comercial tem funil', com.some((i) => /Funil/.test(i)), true);
  ok('tem cadastros', com.some((i) => /Cadastros/.test(i)), true);
  ok('e NAO tem financeiro', com.some((i) => /Financeiro/.test(i)), false);
  ok('nem precificacao', com.some((i) => /Precifica/.test(i)), false);
  await sair();

  await entrar('gadm@ensaio.invalido');
  const adm = await menu();
  ok('o administrativo tem financeiro', adm.some((i) => /Financeiro/.test(i)), true);
  ok('e precificacao', adm.some((i) => /Precifica/.test(i)), true);
  ok('mas NAO tem usuarios', adm.some((i) => /Usuários|Usuarios/.test(i)), false);
  await sair();
}

console.log('\n[4] O ADMINISTRADOR ESCOLHE ENTRE OS PAPEIS NOVOS');
{
  await entrar('adm@ensaio.invalido');
  await pag.goto(BASE + '/crm/usuarios');
  await pag.waitForTimeout(2500);

  const opcoes = await pag.locator('table select').first().locator('option').allInnerTexts();
  for (const esperado of ['Secretária(o)', 'Financeiro', 'Contador',
                          'Gerente Comercial', 'Gerente Administrativo']) {
    ok('a lista oferece ' + esperado, opcoes.some((o) => o.trim() === esperado), true);
  }
  /* O PAPEL LEGADO NAO E OFERECIDO PARA QUEM NAO O TEM. Ele existe no banco
     porque a migration nao converteu ninguem -- mas oferece-lo como escolha
     nova seria pedir para a clinica adiar a decisao para sempre. */
  ok('e nao oferece o modelo antigo a quem nao o tem',
    opcoes.some((o) => /modelo antigo/.test(o)), false);

  await pag.screenshot({ path: '/tmp/claude-0/m67-usuarios.png' });
}

console.log('\n[5] A REGUA APARECE INTEIRA NA TELA DE LEMBRETES');
{
  await pag.goto(BASE + '/crm/agenda');
  await pag.waitForTimeout(2500);

  const botao = pag.locator('button', { hasText: /Lembrete/i }).first();
  ok('ha o botao de lembretes', await botao.count(), 1);
  await botao.click();
  await pag.waitForTimeout(2200);

  /* `innerText` devolve o texto JA TRANSFORMADO pelo CSS, e estes rotulos sao
     `uppercase`. Sem o `i` a conferencia media a folha de estilo, nao a tela. */
  const painel = await pag.locator('body').innerText();
  ok('a tela fala das tres mensagens',
    /2ª mensagem/i.test(painel) && /3ª mensagem/i.test(painel), true);
  ok('e o cabecalho anuncia a regua', /régua de 3 mensagens/i.test(painel), true);
  ok('e diz que a terceira cancela', /cancela o horário/i.test(painel), true);
  /* A FRASE QUE EVITA A SURPRESA. Quem liga isto precisa entender, ANTES de
     clicar, que o sistema vai desmarcar paciente sozinho -- e que qualquer
     resposta para a regua antes disso. */
  ok('avisando que qualquer resposta para a regua',
    /Qualquer resposta da paciente/i.test(painel), true);
  /* A antecedencia mora no VALOR de um input, que nao entra em `innerText`.
     Procura-la no texto da tela passaria verde por acaso no dia em que
     qualquer outro "26" aparecesse na pagina. */
  const antecedencia = await pag.locator('input[type="number"]').first().inputValue();
  ok('a antecedencia mostrada e 26', antecedencia, '26');

  await pag.screenshot({ path: '/tmp/claude-0/m67-regua.png', fullPage: true });
}

console.log('\n[6] O CARTAO CABE NA TELA -- MEDIDO, EM TRES ALTURAS');
{
  /* A Silvia encontrou isto em producao: com os dois campos novos da regua, o
     cartao passou da altura da janela e o rodape -- onde ficam "Fechar" e
     "Enviar agora" -- saiu da dobra. Sem botao de sair, a unica saida era
     recarregar a pagina. E o mesmo defeito do modal de programacao na M6.3b.

     Por isso a conferencia MEDE, e em tela baixa tambem: a 900px de altura o
     cartao antigo cabia por pouco, e o defeito so aparecia em notebook. */
  for (const altura of [950, 800, 700]) {
    await pag.setViewportSize({ width: 1500, height: altura });
    await pag.waitForTimeout(700);

    const caixa = await pag.locator('div.fixed.inset-0.z-\\[70\\] > div').first().boundingBox();
    ok(altura + 'px: o cartao nao ultrapassa a janela',
       caixa !== null && caixa.height <= altura, true);
    ok(altura + 'px: e o topo dele esta visivel',
       caixa !== null && caixa.y >= 0, true);

    /* O RODAPE E O QUE IMPORTA: e por ele que a pessoa sai do modal. */
    const fechar = pag.locator('button', { hasText: /^Fechar$/ }).first();
    const bf = await fechar.boundingBox();
    ok(altura + 'px: o botao Fechar esta dentro da tela',
       bf !== null && bf.y >= 0 && (bf.y + bf.height) <= altura, true);

    // E ele funciona de verdade: visivel nao basta, tem de ser clicavel.
    ok(altura + 'px: e da para clicar nele', await fechar.isEnabled(), true);
  }

  /* O MIOLO E QUE ROLA, e nao a pagina. Se a pagina rolasse, o rodape iria
     junto e o conserto nao teria consertado nada. */
  const miolo = pag.locator('div.fixed.inset-0.z-\\[70\\] div.overflow-y-auto').first();
  const rolavel = await miolo.evaluate((e) => e.scrollHeight > e.clientHeight + 4);
  ok('700px: o miolo tem rolagem propria', rolavel, true);

  await pag.evaluate(() => window.scrollTo(0, 0));
  const rolouAPagina = await pag.evaluate(() =>
    document.documentElement.scrollHeight > window.innerHeight + 4);
  ok('700px: e a pagina atras NAO rola junto', rolouAPagina, false);

  await pag.screenshot({ path: '/tmp/claude-0/m67-regua-700.png' });
  await pag.locator('button', { hasText: /^Fechar$/ }).first().click();
  await pag.waitForTimeout(900);
  ok('e o modal fecha pelo botao', await pag.locator('div.fixed.inset-0.z-\\[70\\]').count(), 0);
}

await nav.close();

const passaram = conf.filter(Boolean).length;
console.log('\n====================================================');
console.log('  ' + passaram + ' de ' + conf.length + ' conferencias passaram');
console.log('====================================================\n');
servidor.close();
process.exit(passaram === conf.length ? 0 : 1);

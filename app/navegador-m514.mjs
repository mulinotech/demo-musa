/** A M5.14 vista do navegador: a duração que a agenda usa. */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { chromium } from 'playwright';
import { createRequire } from 'module';
const require = createRequire('/home/claude/musa/');

const H = '127.0.0.1', P = 3307, U = 'musa', S = 'ensaio-local', B = 'musa_m514_nav';
const raiz = await mysql.createConnection({ host: H, port: P, user: U, password: S, multipleStatements: true });
await raiz.query('DROP DATABASE IF EXISTS ' + B);
await raiz.query('CREATE DATABASE ' + B);
await raiz.end();

process.env.DB_HOST = H; process.env.DB_PORT = String(P); process.env.DB_USER = U;
process.env.DB_PASSWORD = S; process.env.DB_NAME = B; process.env.JWT_SECRET = 'nav-m514';

const conn = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B, multipleStatements: true });
await require('/home/claude/musa/db/run-migrations.js')(conn, {});
await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id) VALUES (?,?,?,?,?,?,?)',
  ['u_adm', 'Dra Musa', 'adm@ensaio.invalido', bcrypt.hashSync('SenhaDeEnsaio2026', 10), 'admin', 'active', 'cl_1']);
// Um servico com os minutos certos, e um HERDADO com a duracao em faixa.
await conn.query("INSERT INTO treatment_catalog (id,name,price,duration,duration_min,clinica_id) VALUES" +
  " ('tc_ok','Ultraformer',1500,'90',90,'cl_1')," +
  " ('tc_velho','Peeling Herdado',300,'40 a 60 minutos',NULL,'cl_1')");
await conn.end();

const app = require('/home/claude/musa/server/app.js');
const servidor = app.listen(4192);
await new Promise((r) => servidor.on('listening', r));
const BASE = 'http://127.0.0.1:4192';

const conf = [];
const ok = (nome, real, esperado) => {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  conf.push(passou);
  console.log((passou ? '  OK  ' : '  XX  ') + nome +
    (passou ? '' : '   esperado ' + JSON.stringify(esperado) + ', veio ' + JSON.stringify(real)));
};
const bd = () => mysql.createConnection({ host: H, port: P, user: U, password: S, database: B });

const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pag = await nav.newPage({ viewport: { width: 1700, height: 1000 } });

await pag.goto(BASE + '/login');
await pag.fill('input[type="email"]', 'adm@ensaio.invalido');
await pag.fill('input[type="password"]', 'SenhaDeEnsaio2026');
await pag.click('button[type="submit"]');
await pag.waitForURL(/crm/, { timeout: 15000 });

console.log('\n[1] A LISTA MOSTRA A DURACAO QUE A AGENDA USA');
{
  await pag.goto(BASE + '/crm/cadastros');
  await pag.waitForTimeout(2000);
  const tela = await pag.locator('body').innerText();
  ok('o servico com minutos mostra a duracao', /1 h 30 min/.test(tela), true);
  /* O herdado mostrava VAZIO: `Number("40 a 60 minutos")` e NaN, e a tela
     tratava NaN como "sem duracao". Parecia que ninguem tinha preenchido. */
  ok('e o herdado mostra o texto dele', /40 a 60 minutos/.test(tela), true);
  ok('com o aviso de que a agenda nao sabe reservar',
    /duração não entendida/i.test(tela), true);
}

console.log('\n[2] EDITAR A DURACAO MUDA O QUE A AGENDA USA');
{
  await pag.locator('tr', { hasText: 'Ultraformer' }).locator('button').first().click();
  await pag.waitForTimeout(800);
  const campo = pag.locator('input[type="number"]').last();
  await campo.fill('45');
  await pag.click('button:has-text("Salvar"), button[type="submit"]');
  await pag.waitForTimeout(2000);

  const c = await bd();
  const [r] = await c.query("SELECT duration, duration_min FROM treatment_catalog WHERE id = 'tc_ok'");
  await c.end();
  /* O defeito: `duration` ia para 45 e `duration_min` ficava em 90. A tela
     mostrava 45 e a agenda marcava 90, sem nada avisar. */
  ok('o texto foi para 45', String(r[0].duration), '45');
  ok('E OS MINUTOS TAMBEM', r[0].duration_min, 45);

  await pag.reload();
  await pag.waitForTimeout(2000);
  ok('e a lista passa a mostrar 45 min',
    /45 min/.test(await pag.locator('body').innerText()), true);
}

console.log('\n[3] A PRECIFICACAO RECEBE A DURACAO DO CATALOGO');
{
  await pag.goto(BASE + '/crm/precificacao');
  await pag.waitForTimeout(2500);
  const seletor = pag.locator('select').first();
  // `label` do Playwright e string exata, nao regex.
  await seletor.selectOption({ label: 'Ultraformer' });
  await pag.waitForTimeout(1200);

  /* A calculadora ja lia `duration_min` do catalogo desde a T2.1 -- o que
     faltava era a coluna estar preenchida e atual. */
  const valores = await pag.locator('input').evaluateAll(
    (els) => els.map((e) => e.value));
  ok('o campo de duracao vem preenchido com o valor do catalogo',
    valores.includes('45'), true);
}

await pag.screenshot({ path: '/tmp/claude-0/m514.png', fullPage: false });
await nav.close();

const passaram = conf.filter(Boolean).length;
console.log('\n====================================================');
console.log('  ' + passaram + ' de ' + conf.length + ' conferencias passaram');
console.log('====================================================\n');
servidor.close();
process.exit(passaram === conf.length ? 0 : 1);

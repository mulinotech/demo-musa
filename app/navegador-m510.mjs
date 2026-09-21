/** A M5.10 vista do navegador.
 *
 *  O ensaio contra o banco prova o que fica gravado. Este prova o que a pessoa
 *  VÊ — e três dos defeitos desta semana eram só de tela: "entrou em há 3 dias",
 *  "o WhatsApp está conectado", "PACIENTE PREMIUM".
 */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { chromium } from 'playwright';
import { createRequire } from 'module';
const require = createRequire('/home/claude/musa/');

const H = '127.0.0.1', P = 3307, U = 'musa', S = 'ensaio-local', B = 'musa_m510_nav';
const raiz = await mysql.createConnection({ host: H, port: P, user: U, password: S, multipleStatements: true });
await raiz.query('DROP DATABASE IF EXISTS ' + B);
await raiz.query('CREATE DATABASE ' + B);
await raiz.end();

process.env.DB_HOST = H; process.env.DB_PORT = String(P); process.env.DB_USER = U;
process.env.DB_PASSWORD = S; process.env.DB_NAME = B;
process.env.JWT_SECRET = 'nav-m510'; process.env.GEMINI_API_KEY = 'falsa';

const conn = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B, multipleStatements: true });
await require('/home/claude/musa/db/run-migrations.js')(conn, {});
await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id) VALUES (?,?,?,?,?,?,?)',
  ['u_adm', 'Admin', 'adm@ensaio.invalido', bcrypt.hashSync('SenhaDeEnsaio2026', 10), 'admin', 'active', 'cl_1']);
// A ficha que ja existe, com o telefone MASCARADO.
await conn.query("INSERT INTO clients (id,name,phone,clinica_id) VALUES ('c_ana','Ana Paula','(11) 99876-5432','cl_1')");
// O lead, com o telefone como o WhatsApp manda. Mesma mulher, texto diferente.
await conn.query("INSERT INTO leads (id,name,whatsapp,treatment,status,clinica_id) VALUES" +
  " ('l_ana','Ana P.','5511998765432','Ultraformer','agendado','cl_1')");
await conn.end();

const app = require('/home/claude/musa/server/app.js');
const servidor = app.listen(4184);
await new Promise((r) => servidor.on('listening', r));
const BASE = 'http://127.0.0.1:4184';

const conf = [];
const ok = (nome, real, esperado) => {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  conf.push(passou);
  console.log((passou ? '  OK  ' : '  XX  ') + nome +
    (passou ? '' : '   esperado ' + JSON.stringify(esperado) + ', veio ' + JSON.stringify(real)));
};

const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pag = await nav.newPage({ viewport: { width: 1600, height: 1000 } });

await pag.goto(BASE + '/login');
await pag.fill('input[type="email"]', 'adm@ensaio.invalido');
await pag.fill('input[type="password"]', 'SenhaDeEnsaio2026');
await pag.click('button[type="submit"]');
await pag.waitForURL(/crm/, { timeout: 15000 });

await pag.goto(BASE + '/crm/funil');
await pag.waitForSelector('text=Funil de Vendas', { timeout: 15000 });

console.log('\n[1] O CAMPO DE TELEFONE JA NASCE COM +55');
{
  await pag.click('button:has-text("Novo Lead")');
  await pag.waitForSelector('input[type="tel"]');
  ok('o campo comeca preenchido', await pag.inputValue('input[type="tel"]'), '+55 ');
  await pag.fill('input[type="tel"]', '');
  ok('apagar tudo traz o +55 de volta', await pag.inputValue('input[type="tel"]'), '+55 ');
  await pag.fill('input[type="tel"]', '+55 5599887766');
  ok('e o DDD 55 nao vira 5555', await pag.inputValue('input[type="tel"]'), '+55 5599887766');
  await pag.click('button:has-text("Cancelar")');
}

console.log('\n[1b] O CAMPO DE EDITAR TAMBEM -- que foi o que a Silvia usou');
{
  /* A primeira versao da M5.10 ligou o `+55` so nos campos de CADASTRAR. Quem
     apaga o numero de um lead que JA existe e digita outro caia no campo da
     gaveta, que tinha ficado de fora. Foi o primeiro retorno de producao. */
  await pag.click('text=Ana P.');
  await pag.waitForSelector('button[title="Editar Telefone"]', { timeout: 10000 });
  await pag.click('button[title="Editar Telefone"]');
  const campo = pag.locator('input[type="tel"]').first();
  /* O lead da montagem foi gravado como "5511998765432", sem DDI separado. A
     gaveta tem de exibi-lo ja com o +55 na frente -- e' o que a Silvia esperava
     ver quando abriu o campo. */
  ok('o telefone GRAVADO aparece com +55 ao abrir a gaveta',
     await campo.inputValue(), '+55 11998765432');
  await campo.fill('');
  ok('apagar tudo na gaveta traz o +55 de volta', await campo.inputValue(), '+55 ');
  await campo.fill('11981149310');
  ok('e digitar o numero novo mantem o +55', await campo.inputValue(), '+55 11981149310');
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(500);
  const fechou = await pag.locator('button[title="Editar Telefone"]').count();
  if (fechou > 0) { await pag.click('button[aria-label="Fechar"], button:has(svg.lucide-x)').catch(() => {}); }
  await pag.goto(BASE + '/crm/funil');
  await pag.waitForSelector('text=Funil de Vendas', { timeout: 15000 });
}

console.log('\n[2] FECHAR A VENDA: a tela conta o que aconteceu com a ficha');
{
  const card = pag.locator('div').filter({ hasText: /^Ana P\./ }).first();
  await card.hover();
  await pag.click('button:has-text("Fechar Venda")');

  const aviso = pag.locator('text=/Vinculada à ficha que já existia/i');
  await aviso.waitFor({ timeout: 10000 });
  const texto = await aviso.first().innerText();
  ok('o aviso nomeia a paciente', /Ana Paula/.test(texto), true);
  ok('e diz que nenhuma ficha nova nasceu', /nenhuma ficha nova/i.test(texto), true);
}

console.log('\n[3] O CARD PARA DE PROMETER O QUE NAO E');
{
  await pag.waitForTimeout(1500);
  const tela = await pag.locator('body').innerText();
  /* "PACIENTE PREMIUM" era o que estava escrito ate hoje num lead que nao tinha
     ficha nenhuma. Comparacao case-insensitive: `innerText` devolve o texto JA
     com o `uppercase` do CSS aplicado, e isso ja causou dois falsos negativos
     nesta suite (16/09 e 21/09). */
  ok('"PACIENTE PREMIUM" saiu da tela', /paciente premium/i.test(tela), false);
  ok('e no lugar dela esta o que o banco guarda', /ficha vinculada/i.test(tela), true);
}

console.log('\n[4] A DUPLICATA NAO APARECE EM PACIENTES');
{
  await pag.goto(BASE + '/crm/pacientes');
  await pag.waitForTimeout(2500);
  const tela = await pag.locator('body').innerText();
  const quantasAnas = (tela.match(/Ana/g) || []).length;
  const c = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B });
  const [r] = await c.query("SELECT COUNT(*) n FROM clients WHERE clinica_id = 'cl_1'");
  await c.end();
  ok('o banco tem UMA ficha', r[0].n, 1);
  ok('e a tela nao mostra duas Anas', quantasAnas <= 2, true);
}

await pag.screenshot({ path: '/tmp/claude-0/m510-funil.png', fullPage: false });
await nav.close();

const passaram = conf.filter(Boolean).length;
console.log('\n====================================================');
console.log('  ' + passaram + ' de ' + conf.length + ' conferencias passaram');
console.log('====================================================\n');
servidor.close();
process.exit(passaram === conf.length ? 0 : 1);

/** A M5.13 vista do navegador: as origens e o arrastar. */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { chromium } from 'playwright';
import { createRequire } from 'module';
const require = createRequire('/home/claude/musa/');

const H = '127.0.0.1', P = 3307, U = 'musa', S = 'ensaio-local', B = 'musa_m513_nav';
const raiz = await mysql.createConnection({ host: H, port: P, user: U, password: S, multipleStatements: true });
await raiz.query('DROP DATABASE IF EXISTS ' + B);
await raiz.query('CREATE DATABASE ' + B);
await raiz.end();

process.env.DB_HOST = H; process.env.DB_PORT = String(P); process.env.DB_USER = U;
process.env.DB_PASSWORD = S; process.env.DB_NAME = B; process.env.JWT_SECRET = 'nav-m513';

const conn = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B, multipleStatements: true });
await require('/home/claude/musa/db/run-migrations.js')(conn, {});
await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id) VALUES (?,?,?,?,?,?,?)',
  ['u_adm', 'Dra Musa', 'adm@ensaio.invalido', bcrypt.hashSync('SenhaDeEnsaio2026', 10), 'admin', 'active', 'cl_1']);
// Um lead de cada tipo: origem nova, origem que a aplicacao ja gravava sozinha,
// e uma origem antiga que NAO esta na lista.
for (const [id, nome, fone, origem] of [
  ['l_1', 'Ana Meta', '5511911110001', 'meta_ads'],
  ['l_2', 'Bia Zap', '5511911110002', 'whatsapp'],
  ['l_3', 'Carla Feirao', '5511911110003', 'feirao-2024']
]) {
  await conn.query(
    "INSERT INTO leads (id,name,whatsapp,treatment,status,source,clinica_id) VALUES (?,?,?,?,?,?,'cl_1')",
    [id, nome, fone, 'Ultraformer', 'novo', origem]);
}
await conn.end();

const app = require('/home/claude/musa/server/app.js');
const servidor = app.listen(4189);
await new Promise((r) => servidor.on('listening', r));
const BASE = 'http://127.0.0.1:4189';

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
await pag.goto(BASE + '/crm/funil');
await pag.waitForSelector('text=Funil de Vendas', { timeout: 15000 });
await pag.waitForTimeout(1500);

console.log('\n[1] AS ORIGENS QUE O TIME PEDIU');
{
  await pag.click('button:has-text("Novo Lead")');
  await pag.waitForTimeout(600);
  const origens = pag.locator('select').first();
  const rotulos = await pag.locator('select').nth(1).locator('option').allInnerTexts()
    .catch(() => []);
  // O select de origem e o que tem "Meta Ads" dentro.
  let opcoes = [];
  for (let i = 0; i < await pag.locator('select').count(); i++) {
    const t = await pag.locator('select').nth(i).locator('option').allInnerTexts();
    if (t.some((x) => /Meta Ads/.test(x))) { opcoes = t; break; }
  }
  void origens; void rotulos;
  ok('Meta Ads esta na lista', opcoes.some((o) => /Meta Ads/.test(o)), true);
  ok('Google Ads tambem', opcoes.some((o) => /Google Ads/.test(o)), true);
  ok('e TikTok Ads', opcoes.some((o) => /TikTok Ads/.test(o)), true);
  /* O sistema ja gravava `source: 'whatsapp'` sozinho, e a lista nao conhecia
     o valor que ele mesmo escrevia. */
  ok('WhatsApp aparece como origem', opcoes.some((o) => /WhatsApp/.test(o)), true);
  /* Pago e organico deixam de ser a mesma palavra: e' a origem paga que
     responde pelo investimento que o Custo por Lead divide. */
  ok('e o Instagram organico e distinguido do anuncio',
    opcoes.some((o) => /Instagram \(orgânico\)/.test(o)), true);
  await pag.click('button:has-text("Cancelar")');
  await pag.waitForTimeout(500);
}

console.log('\n[2] O CARD MOSTRA A ORIGEM POR EXTENSO');
{
  const tela = await pag.locator('body').innerText();
  /* No card vai o nome CURTO -- o longo vazava do card e empurrava o nome da
     paciente para duas linhas. O completo fica no seletor e no `title`. */
  ok('a origem paga aparece com nome de gente', /Meta Ads/.test(tela), true);
  ok('e o rotulo longo NAO vaza para o card',
    /Meta Ads \(Facebook\/Instagram\)/.test(tela), false);
  ok('e a origem antiga, fora da lista, continua na tela', /feirao-2024/.test(tela), true);
}

console.log('\n[3] ARRASTAR O CARD MUDA A ETAPA');
{
  const card = pag.locator('text=Ana Meta').first();
  const colunaProposta = pag.locator('[data-coluna="agendado"]');

  await card.hover();
  await pag.mouse.down();
  await colunaProposta.hover();
  await pag.mouse.move(0, 0);   // move intermediario: alguns navegadores exigem
  await colunaProposta.hover();
  await pag.mouse.up();
  await pag.waitForTimeout(2500);

  const c = await bd();
  const [r] = await c.query("SELECT status FROM leads WHERE id = 'l_1'");
  await c.end();
  ok('o lead mudou de etapa no banco', r[0].status, 'agendado');
}

console.log('\n[4] SOLTAR NA MESMA COLUNA NAO CHAMA O SERVIDOR');
{
  const antes = [];
  pag.on('request', (q) => { if (q.method() === 'PUT' && q.url().includes('/api/leads/')) antes.push(q.url()); });

  const card = pag.locator('text=Bia Zap').first();
  const colunaNovo = pag.locator('[data-coluna="novo"]');
  await card.hover();
  await pag.mouse.down();
  await colunaNovo.hover();
  await pag.mouse.up();
  await pag.waitForTimeout(2000);

  /* Sem esta porta, cada esbarrao gravaria um PUT -- e soltar em "Venda
     Fechada" o lead que ja esta la rodaria a conversao da M5.10 de novo. */
  ok('nenhuma gravacao foi disparada', antes, []);
  const c = await bd();
  const [r] = await c.query("SELECT status FROM leads WHERE id = 'l_2'");
  await c.end();
  ok('e o lead continua onde estava', r[0].status, 'novo');
}

await pag.screenshot({ path: '/tmp/claude-0/m513.png', fullPage: false });
await nav.close();

const passaram = conf.filter(Boolean).length;
console.log('\n====================================================');
console.log('  ' + passaram + ' de ' + conf.length + ' conferencias passaram');
console.log('====================================================\n');
servidor.close();
process.exit(passaram === conf.length ? 0 : 1);

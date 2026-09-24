/** A M6.2 vista do navegador: os botões que a recepção vai clicar. */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { chromium } from 'playwright';
import { createRequire } from 'module';
const require = createRequire('/home/claude/musa/');

const H = '127.0.0.1', P = 3307, U = 'musa', S = 'ensaio-local', B = 'musa_m62_nav';
const raiz = await mysql.createConnection({ host: H, port: P, user: U, password: S, multipleStatements: true });
await raiz.query('DROP DATABASE IF EXISTS ' + B);
await raiz.query('CREATE DATABASE ' + B);
await raiz.end();

process.env.DB_HOST = H; process.env.DB_PORT = String(P); process.env.DB_USER = U;
process.env.DB_PASSWORD = S; process.env.DB_NAME = B; process.env.JWT_SECRET = 'nav-m62';

const conn = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B, multipleStatements: true });
await require('/home/claude/musa/db/run-migrations.js')(conn, {});
await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id) VALUES (?,?,?,?,?,?,?)',
  ['u_adm', 'Dra Musa', 'adm@ensaio.invalido', bcrypt.hashSync('SenhaDeEnsaio2026', 10), 'admin', 'active', 'cl_1']);
await conn.query("INSERT INTO clients (id,name,phone,email,clinica_id) VALUES" +
  " ('c1','Ana Paula','(11) 91111-2222','ana@ensaio.invalido','cl_1')");
await conn.query("INSERT INTO treatments (id,client_id,procedure_name,session_date,notes,clinica_id)" +
  " VALUES ('t1','c1','Limpeza de pele','2026-08-10','','cl_1')");
await conn.end();

const app = require('/home/claude/musa/server/app.js');
const servidor = app.listen(4195);
await new Promise((r) => servidor.on('listening', r));
const BASE = 'http://127.0.0.1:4195';

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

console.log('\n[1] OS DOIS BOTOES APARECEM NA CONVERSA DA PACIENTE');
{
  await pag.goto(BASE + '/crm/atendimento');
  await pag.waitForTimeout(2500);
  await pag.locator('button', { hasText: 'Ana Paula' }).first().click();
  await pag.waitForTimeout(800);
  ok('o botao de ficha esta la', await pag.locator('button:has-text("Ver ficha")').count(), 1);
  ok('e o de funil tambem', await pag.locator('button:has-text("Jogar no funil")').count(), 1);
}

console.log('\n[2] A FICHA RAPIDA ABRE SEM SAIR DA CONVERSA');
{
  await pag.click('button:has-text("Ver ficha")');
  await pag.waitForTimeout(1500);
  const tela = await pag.locator('body').innerText();
  ok('ela traz o nome', /Ficha rápida/i.test(tela), true);
  ok('o telefone', /91111-2222/.test(tela), true);
  ok('e o procedimento ja lancado', /Limpeza de pele/i.test(tela), true);
  /* "Nenhum horario marcado" e' uma RESPOSTA. Em branco seria lido como
     "ainda carregando", e a recepcao esperaria por nada. */
  ok('e diz que nao ha horario marcado', /Nenhum horário marcado/i.test(tela), true);

  /* O que esta janela NAO mostra e' tao importante quanto o que mostra: dado
     clinico sensivel nao fica numa tela aberta o dia inteiro no balcao. */
  ok('e nao mostra anamnese nem laudo', /anamnese|laudo/i.test(
    await pag.locator('div.fixed').first().innerText()), false);

  ok('a URL nao mudou', /atendimento/.test(pag.url()), true);
  await pag.locator('div.fixed button[title="Fechar"]').first().click();
  await pag.waitForTimeout(600);
  ok('e fecha', await pag.locator('text=Ficha rápida').count(), 0);
}

console.log('\n[3] JOGAR NO FUNIL CRIA UM CARD, E SO UM');
{
  await pag.click('button:has-text("Jogar no funil")');
  await pag.waitForTimeout(2500);
  ok('a tela confirma', /Card criado no funil/i.test(await pag.locator('body').innerText()), true);

  const c = await bd();
  const [l] = await c.query('SELECT id, name, source, status, client_id FROM leads');
  await c.end();
  ok('o card existe', l.length, 1);
  ok('com o nome da paciente', l[0].name, 'Ana Paula');
  ok('a origem whatsapp', l[0].source, 'whatsapp');
  ok('e ja apontando para a ficha', l[0].client_id, 'c1');
}

console.log('\n[4] CLICAR DE NOVO NAO CRIA O SEGUNDO');
{
  await pag.reload();
  await pag.waitForTimeout(2500);
  await pag.locator('button', { hasText: 'Ana Paula' }).first().click();
  await pag.waitForTimeout(800);
  await pag.click('button:has-text("Jogar no funil")');
  await pag.waitForTimeout(2500);
  ok('a tela diz que ja esta la', /já está no funil/i.test(await pag.locator('body').innerText()), true);

  const c = await bd();
  const [l] = await c.query('SELECT COUNT(*) n FROM leads');
  await c.end();
  ok('e continua havendo UM card', l[0].n, 1);
}

console.log('\n[5] O LOGO EM CADASTROS');
{
  await pag.goto(BASE + '/crm/cadastros');
  await pag.waitForTimeout(2500);
  const aba = pag.locator('button', { hasText: /Timbre/i }).first();
  if (await aba.count()) { await aba.click(); await pag.waitForTimeout(1200); }
  ok('o campo de logo esta na tela',
    /Logo da clínica/i.test(await pag.locator('body').innerText()), true);
  ok('e diz que SVG nao entra',
    /SVG não é aceito/i.test(await pag.locator('body').innerText()), true);

  // Um PNG de verdade, feito no proprio navegador.
  const png = await pag.evaluate(() => {
    const t = document.createElement('canvas');
    t.width = 1200; t.height = 400;
    const c = t.getContext('2d');
    c.fillStyle = '#0E7FA6'; c.fillRect(0, 0, 1200, 400);
    return t.toDataURL('image/png');
  });
  const r = await pag.evaluate(async (dataUrl) => {
    const resp = await fetch('/api/clinica/logo', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl })
    });
    return { status: resp.status, corpo: await resp.json() };
  }, png);
  ok('o envio passa', r.status, 200);
  ok('e o logo volta no timbre', String(r.corpo.logo || '').slice(0, 14), 'data:image/png');

  await pag.reload();
  await pag.waitForTimeout(2500);
  const aba2 = pag.locator('button', { hasText: /Timbre/i }).first();
  if (await aba2.count()) { await aba2.click(); await pag.waitForTimeout(1500); }
  /* Duas imagens: a do campo e a da previa "como vai sair no papel". Quem
     envia o logo precisa ver como ele fica ANTES de imprimir. */
  ok('a tela passa a mostrar o logo',
    await pag.locator('img[alt="Logo da clínica"]').count() >= 2, true);
  ok('e o botao vira "Trocar logo"',
    await pag.locator('button:has-text("Trocar logo")').count(), 1);
}

await pag.screenshot({ path: '/tmp/claude-0/m62-timbre.png', fullPage: false });
await nav.close();

const passaram = conf.filter(Boolean).length;
console.log('\n====================================================');
console.log('  ' + passaram + ' de ' + conf.length + ' conferencias passaram');
console.log('====================================================\n');
servidor.close();
process.exit(passaram === conf.length ? 0 : 1);

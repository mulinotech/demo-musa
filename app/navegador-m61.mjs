/** A M6.1 vista do navegador: identidade nova, layout intacto. */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { chromium } from 'playwright';
import { createRequire } from 'module';
const require = createRequire('/home/claude/musa/');

const H = '127.0.0.1', P = 3307, U = 'musa', S = 'ensaio-local', B = 'musa_m61_nav';
const raiz = await mysql.createConnection({ host: H, port: P, user: U, password: S, multipleStatements: true });
await raiz.query('DROP DATABASE IF EXISTS ' + B);
await raiz.query('CREATE DATABASE ' + B);
await raiz.end();

process.env.DB_HOST = H; process.env.DB_PORT = String(P); process.env.DB_USER = U;
process.env.DB_PASSWORD = S; process.env.DB_NAME = B; process.env.JWT_SECRET = 'nav-m61';

const conn = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B, multipleStatements: true });
await require('/home/claude/musa/db/run-migrations.js')(conn, {});
await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id) VALUES (?,?,?,?,?,?,?)',
  ['u_adm', 'Dra Musa', 'adm@ensaio.invalido', bcrypt.hashSync('SenhaDeEnsaio2026', 10), 'admin', 'active', 'cl_1']);
await conn.query("INSERT INTO clients (id,name,phone,clinica_id) VALUES ('c1','Ana Paula','11998765432','cl_1')");
await conn.end();

const app = require('/home/claude/musa/server/app.js');
const servidor = app.listen(4193);
await new Promise((r) => servidor.on('listening', r));
const BASE = 'http://127.0.0.1:4193';

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
await pag.waitForTimeout(2500);

console.log('\n[1] TIPOGRAFIA');
{
  const corpo = await pag.evaluate(() => getComputedStyle(document.body).fontFamily);
  ok('o corpo usa Inter', /Inter/.test(corpo), true);
  const titulo = await pag.locator('h1').first().evaluate((e) => getComputedStyle(e).fontFamily);
  ok('o titulo usa Poppins', /Poppins/.test(titulo), true);
  /* Os nomes `--font-serif` e `--font-sans` continuam os mesmos: renomear
     mexeria nas classes de 65 arquivos, e a troca e' so de tipografia. */
  ok('e nenhuma fonte antiga sobrou',
    /Playfair|Jakarta/.test(corpo + titulo), false);
}

console.log('\n[2] PALETA');
{
  const cores = await pag.evaluate(() => {
    const r = getComputedStyle(document.documentElement);
    return {
      brown: r.getPropertyValue('--color-brand-brown').trim(),
      gold: r.getPropertyValue('--color-brand-gold').trim(),
      beige: r.getPropertyValue('--color-brand-beige').trim(),
      /* `--color-gold-accent` nao e emitido quando nenhuma classe o usa (o
         Tailwind 4 so publica o que a tela pede), entao o acento e conferido
         pelo gradiente de assinatura, que e CSS proprio e sempre existe. */
      acento: ''
    };
  });
  ok('brand-brown virou o Navy', cores.brown.toUpperCase(), '#141E33');
  ok('brand-gold virou o Teal Musa', cores.gold.toUpperCase(), '#0E7FA6');
  ok('brand-beige virou a Nevoa', cores.beige.toUpperCase(), '#F6F8FB');
  const grad = await pag.evaluate(() => {
    const d = document.createElement('div');
    d.className = 'bg-gold-gradient';
    document.body.appendChild(d);
    const g = getComputedStyle(d).backgroundImage;
    d.remove();
    return g;
  });
  /* 120 graus, do teal profundo ao roxo -- o gradiente do manual. */
  ok('o gradiente de assinatura leva o Roxo Musa', /122, 98, 242/.test(grad), true);
  ok('e comeca no Teal Profundo', /1, 76, 104/.test(grad), true);

  // Nenhum marrom/dourado restante em cor computada de elemento visivel.
  const antigas = await pag.evaluate(() => {
    const alvo = ['rgb(117, 85, 59)', 'rgb(173, 136, 106)', 'rgb(168, 150, 132)',
                  'rgb(74, 60, 53)', 'rgb(244, 239, 234)'];
    let n = 0;
    for (const el of Array.from(document.querySelectorAll('*')).slice(0, 4000)) {
      const cs = getComputedStyle(el);
      if (alvo.includes(cs.color) || alvo.includes(cs.backgroundColor)) n++;
    }
    return n;
  });
  ok('nenhum elemento ficou com a cor antiga', antigas, 0);
}

console.log('\n[3] O LAYOUT NAO MUDOU');
{
  /* A promessa da tarefa: so cor e tipografia. Se uma caixa da barra lateral
     tivesse mudado de tamanho, seria mudanca de layout disfarcada de tema. */
  const barra = await pag.locator('aside, nav').first().evaluate((e) => {
    const b = e.getBoundingClientRect();
    return { l: Math.round(b.width) };
  });
  ok('a barra lateral mantem a largura', barra.l > 200 && barra.l < 320, true);
  const semQuebra = await pag.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);
  ok('e nada vazou na horizontal', semQuebra, true);
}

console.log('\n[4] O LOGO');
{
  const logo = pag.locator('img[alt="Musa CRM"]').first();
  ok('o simbolo esta na tela', await logo.count(), 1);
  ok('e aponta para o arquivo novo',
    /simbolo-musa/.test(await logo.getAttribute('src') || ''), true);
  const caixa = await logo.evaluate((e) => {
    const b = e.getBoundingClientRect();
    return Math.round(b.width) === Math.round(b.height);
  });
  ok('sem distorcer a proporcao', caixa, true);
}

await pag.screenshot({ path: '/tmp/claude-0/m61-crm.png', fullPage: false });
await pag.goto(BASE + '/crm/funil');
await pag.waitForTimeout(2500);
await pag.screenshot({ path: '/tmp/claude-0/m61-funil.png', fullPage: false });
await nav.close();

const passaram = conf.filter(Boolean).length;
console.log('\n====================================================');
console.log('  ' + passaram + ' de ' + conf.length + ' conferencias passaram');
console.log('====================================================\n');
servidor.close();
process.exit(passaram === conf.length ? 0 : 1);

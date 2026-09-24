/** A M6.5 vista do navegador: a recusa que a recepção precisa LER.
 *
 *  Antes desta tarefa o front fazia `if (response.ok)` sem `else`: clicar em
 *  excluir uma ficha com prontuário não faria nada visível, e a pessoa
 *  clicaria de novo.
 */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { chromium } from 'playwright';
import { createRequire } from 'module';
const require = createRequire('/home/claude/musa/');

const H = '127.0.0.1', P = 3307, U = 'musa', S = 'ensaio-local', B = 'musa_m65_nav';
const raiz = await mysql.createConnection({ host: H, port: P, user: U, password: S, multipleStatements: true });
await raiz.query('DROP DATABASE IF EXISTS ' + B);
await raiz.query('CREATE DATABASE ' + B);
await raiz.end();

process.env.DB_HOST = H; process.env.DB_PORT = String(P); process.env.DB_USER = U;
process.env.DB_PASSWORD = S; process.env.DB_NAME = B; process.env.JWT_SECRET = 'nav-m65';

const conn = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B, multipleStatements: true });
await require('/home/claude/musa/db/run-migrations.js')(conn, {});
await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id) VALUES (?,?,?,?,?,?,?)',
  ['u_adm', 'Dra Musa', 'adm@ensaio.invalido', bcrypt.hashSync('SenhaDeEnsaio2026', 10), 'admin', 'active', 'cl_1']);
/* A ordem alfabética importa: a lista escolhe a primeira, e o ensaio precisa
   saber em qual ficha vai clicar. "Ana" vem antes de "Zelia". */
await conn.query("INSERT INTO clients (id,name,phone,clinica_id) VALUES" +
  " ('c_cheia','Ana Com Historico','11911112222','cl_1')," +
  " ('c_vazia','Zelia Duplicada','11933334444','cl_1')");
await conn.query("INSERT INTO client_documents (id, client_id, type, title, answers_json, status, clinica_id)" +
  " VALUES ('d1','c_cheia','TERMO_CONSENTIMENTO','Termo de consentimento','{}','ASSINADO','cl_1')");
await conn.query("INSERT INTO treatment_plans (id, client_id, title, total_sessions, status, clinica_id)" +
  " VALUES ('pl1','c_cheia','Protocolo',3,'ATIVO','cl_1')");
await conn.end();

const app = require('/home/claude/musa/server/app.js');
const servidor = app.listen(4202);
await new Promise((r) => servidor.on('listening', r));
const BASE = 'http://127.0.0.1:4202';

const conf = [];
const ok = (nome, real, esperado) => {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  conf.push(passou);
  console.log((passou ? '  OK  ' : '  XX  ') + nome +
    (passou ? '' : '   esperado ' + JSON.stringify(esperado) + ', veio ' + JSON.stringify(real)));
};
const bd = () => mysql.createConnection({ host: H, port: P, user: U, password: S, database: B });

const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pag = await nav.newPage({ viewport: { width: 1500, height: 950 } });
// A confirmação é um `confirm` do navegador: sem isto o ensaio trava nela.
pag.on('dialog', (d) => d.accept());

await pag.goto(BASE + '/login');
await pag.fill('input[type="email"]', 'adm@ensaio.invalido');
await pag.fill('input[type="password"]', 'SenhaDeEnsaio2026');
await pag.click('button[type="submit"]');
await pag.waitForURL(/crm/, { timeout: 15000 });

console.log('\n[1] A RECUSA CHEGA NA TELA');
{
  await pag.goto(BASE + '/crm/pacientes');
  await pag.waitForTimeout(3000);

  /* PELA POSICAO, e nao por `filter({hasText})`: um `div` que contem o nome
     tambem contem a lista inteira, e o `.last()` acabava clicando no lixo da
     OUTRA paciente -- o ensaio apagava a ficha errada e passava verde na
     metade das conferencias. A lista vem ordenada por nome (ORDER BY name ASC),
     entao "Ana" e a primeira e "Zelia" a segunda. */
  const lixos = pag.locator('button[title="Excluir Paciente"]');
  ok('ha um lixo por paciente', await lixos.count(), 2);
  await lixos.nth(0).click();
  await pag.waitForTimeout(2500);

  const tela = await pag.locator('body').innerText();
  /* Era aqui que nao acontecia NADA: `if (response.ok)` sem `else`. */
  ok('a faixa de recusa aparece', /não é apagada|não é apagado/i.test(tela), true);
  ok('dizendo o que existe', /1 documento emitido/.test(tela), true);
  ok('e o plano', /1 plano de tratamento/.test(tela), true);
  ok('com o caminho a seguir', /Exportar dados/.test(tela), true);

  const c = await bd();
  const [viva] = await c.query("SELECT id FROM clients WHERE id = 'c_cheia'");
  const [doc] = await c.query("SELECT id FROM client_documents WHERE id = 'd1'");
  await c.end();
  ok('a paciente continua na base', viva.length, 1);
  ok('e o termo assinado tambem', doc.length, 1);

  await pag.screenshot({ path: '/tmp/claude-0/m65-recusa.png', fullPage: false });
}

console.log('\n[2] A FICHA VAZIA AINDA SE APAGA');
{
  await pag.locator('button[title="Excluir Paciente"]').nth(1).click();
  await pag.waitForTimeout(2800);

  const c = await bd();
  const [q] = await c.query("SELECT id FROM clients WHERE id = 'c_vazia'");
  await c.end();
  ok('a duplicata sumiu', q.length, 0);
  ok('e a lista nao mostra mais o nome',
    /Zelia Duplicada/.test(await pag.locator('body').innerText()), false);
}

console.log('\n[3] A PERGUNTA DE CONFIRMACAO NAO PROMETE MAIS O QUE NAO FAZ');
{
  /* A frase antiga dizia "Todos os prontuários e históricos de sessões serão
     excluídos" -- e era verdade, porque as chaves cascateavam. Prometer isso
     agora seria a outra metade do mesmo defeito. */
  const perguntas = [];
  pag.on('dialog', (d) => { perguntas.push(d.message()); });
  await pag.locator('button[title="Excluir Paciente"]').nth(0).click();
  await pag.waitForTimeout(1800);
  const texto = perguntas.join(' ');
  ok('a pergunta nao promete apagar prontuario',
    /Todos os prontuários/.test(texto), false);
  ok('e avisa que so ficha SEM historico e apagada',
    /SEM histórico/.test(texto), true);
}

await nav.close();

const passaram = conf.filter(Boolean).length;
console.log('\n====================================================');
console.log('  ' + passaram + ' de ' + conf.length + ' conferencias passaram');
console.log('====================================================\n');
servidor.close();
process.exit(passaram === conf.length ? 0 : 1);

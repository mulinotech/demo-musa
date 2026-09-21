/** A M5.12 vista do navegador: as datas do plano e a falha do laudo. */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { chromium } from 'playwright';
import { createRequire } from 'module';
const require = createRequire('/home/claude/musa/');

const H = '127.0.0.1', P = 3307, U = 'musa', S = 'ensaio-local', B = 'musa_m512_nav';
const raiz = await mysql.createConnection({ host: H, port: P, user: U, password: S, multipleStatements: true });
await raiz.query('DROP DATABASE IF EXISTS ' + B);
await raiz.query('CREATE DATABASE ' + B);
await raiz.end();

process.env.DB_HOST = H; process.env.DB_PORT = String(P); process.env.DB_USER = U;
process.env.DB_PASSWORD = S; process.env.DB_NAME = B;
process.env.JWT_SECRET = 'nav-m512';
/* SEM chave: e' o caminho de falha de qualquer clinica que ainda nao configurou
   a IA -- e era exatamente onde o servidor INVENTAVA um laudo assinado por
   "Dra. Musa", com 200, para qualquer uma das 50. */
delete process.env.GEMINI_API_KEY;

const conn = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B, multipleStatements: true });
await require('/home/claude/musa/db/run-migrations.js')(conn, {});
await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id) VALUES (?,?,?,?,?,?,?)',
  ['u_adm', 'Dra Musa', 'adm@ensaio.invalido', bcrypt.hashSync('SenhaDeEnsaio2026', 10), 'admin', 'active', 'cl_1']);
await conn.query("INSERT INTO clients (id,name,phone,clinica_id) VALUES ('c1','Ana Paula','11998765432','cl_1')");
await conn.end();

const app = require('/home/claude/musa/server/app.js');
const servidor = app.listen(4188);
await new Promise((r) => servidor.on('listening', r));
const BASE = 'http://127.0.0.1:4188';

const conf = [];
const ok = (nome, real, esperado) => {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  conf.push(passou);
  console.log((passou ? '  OK  ' : '  XX  ') + nome +
    (passou ? '' : '   esperado ' + JSON.stringify(esperado) + ', veio ' + JSON.stringify(real)));
};
const bd = () => mysql.createConnection({ host: H, port: P, user: U, password: S, database: B });

const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pag = await nav.newPage({ viewport: { width: 1600, height: 1100 } });

/* Se sobrar algum `alert()`, ele TRAVA a aba e o ensaio morre esperando. O
   ouvinte abaixo fecha e anota -- e a ausencia de dialogo vira conferencia. */
const dialogos = [];
const respostas = [];
pag.on('response', (r) => { if (r.url().includes('gemini')) respostas.push([r.status(), r.url()]); });
pag.on('dialog', async (d) => { dialogos.push(d.message()); await d.dismiss(); });

await pag.goto(BASE + '/login');
await pag.fill('input[type="email"]', 'adm@ensaio.invalido');
await pag.fill('input[type="password"]', 'SenhaDeEnsaio2026');
await pag.click('button[type="submit"]');
await pag.waitForURL(/crm/, { timeout: 15000 });

await pag.goto(BASE + '/crm/pacientes');
await pag.waitForTimeout(2000);
await pag.click('text=Ana Paula');
await pag.waitForTimeout(1500);

console.log('\n[1] O PLANO DE 10 SESSOES JA NASCE COM AS DEZ DATAS');
{
  await pag.click('button:has-text("NOVO PLANO"), button:has-text("Novo Plano")');
  await pag.waitForTimeout(800);
  await pag.fill('input[placeholder*="Protocolo"], input[type="text"]', 'Protocolo Facial');
  await pag.fill('input[type="number"]', '10');
  await pag.selectOption('select >> nth=-1', { label: 'Quinzenal' }).catch(() => {});
  await pag.fill('input[type="date"]', '2026-09-21');
  await pag.click('button:has-text("Criar Plano"), button[type="submit"]');
  await pag.waitForTimeout(2500);

  const c = await bd();
  const [r] = await c.query(
    'SELECT COUNT(*) total, COUNT(session_date) comData FROM treatment_sessions');
  await c.end();
  ok('as dez sessoes foram criadas', Number(r[0].total), 10);
  /* Ate hoje estas dez nasciam com session_date NULL, e a recepcao abria dez
     janelas para digitar dez datas -- com a data de inicio e a periodicidade ja
     gravadas no plano, sem uso. */
  ok('e TODAS ja com data', Number(r[0].comData), 10);

  const tela = await pag.locator('body').innerText();
  ok('a lista de sessoes mostra as datas', /21\/09\/2026/.test(tela), true);
  ok('e a segunda, quinze dias depois', /05\/10\/2026/.test(tela), true);
}

console.log('\n[2] REPROGRAMAR NAO MEXE NO QUE JA ACONTECEU');
{
  const c = await bd();
  await c.query("UPDATE treatment_sessions SET status = 'REALIZADA' WHERE session_number = 1");
  await c.end();
  await pag.reload();
  await pag.waitForTimeout(2500);
  await pag.click('text=Ana Paula');
  await pag.waitForTimeout(1500);

  await pag.click('button:has-text("Programar datas")');
  await pag.waitForSelector('text=Programar as datas', { timeout: 10000 });
  const aviso = await pag.locator('body').innerText();
  ok('o modal avisa que o passado nao e tocado, ANTES de programar',
    /não são tocadas/i.test(aviso), true);

  /* Tudo escopado no modal: "Programar" tambem casa com o botao "Programar
     datas" que ficou atras da cortina. */
  const modal = pag.locator('div.fixed.inset-0').filter({ hasText: 'Programar as datas' }).last();
  await modal.locator('input[type="date"]').fill('2027-03-01');
  await modal.locator('select').selectOption('Mensal');
  await modal.getByRole('button', { name: 'Programar', exact: true }).click();
  await pag.waitForTimeout(2500);

  ok('o modal continua aberto para contar o resultado', await modal.count(), 1);
  const resposta = await modal.innerText();
  ok('a tela conta quantas foram programadas', /9 sessoes programadas|9 sessões programadas/i.test(resposta), true);
  ok('e quantas foram preservadas', /1 ja realizada nao foi tocada|1 já realizada não foi tocada/i.test(resposta), true);

  const c2 = await bd();
  const [r] = await c2.query(
    'SELECT session_number n, DATE_FORMAT(session_date,"%Y-%m-%d") d FROM treatment_sessions ORDER BY session_number');
  await c2.end();
  ok('a sessao realizada continua na data dela', r[0].d, '2026-09-21');
  /* A 2a recebe a SEGUNDA data do ritmo novo, e nao a primeira: recomecar a
     contagem na primeira pendente encavalaria o plano por cima do passado. */
  ok('e a segunda recebe a SEGUNDA data do ritmo novo', r[1].d, '2027-04-01');

  await modal.getByRole('button', { name: 'Fechar' }).click();
  await pag.waitForTimeout(1500);
}

console.log('\n[3] A FALHA DO LAUDO DE IA FICA NA TELA');
{
  await pag.fill('textarea', 'Paciente relata flacidez mandibular.');
  await pag.click('button:has-text("Gerar Laudo Clínico IA")');
  await pag.waitForTimeout(6000);

  /* A leitura e feita NO PAINEL DE ERRO, e nao no corpo inteiro: no corpo, o
     proprio rotulo do botao "Escrever Laudo Manualmente" faria a conferencia de
     "diz o que fazer" passar sem que erro nenhum estivesse na tela. Foi o que
     aconteceu na primeira rodada deste ensaio. */
  const painel = pag.locator('div.bg-red-50').first();
  const tela = (await painel.count()) ? await painel.innerText() : '';
  /* O `alert()` travava a aba, sumia ao ser fechado e nao dizia o proximo
     passo. Diagnostico sem proximo passo so troca uma duvida por outra. */
  ok('nenhum alert travou a aba', dialogos, []);
  ok('existe um painel de erro na tela', await painel.count(), 1);
  ok('ele nomeia a falha', /não está configurada|não foi possível gerar/i.test(tela), true);
  ok('e diz o que fazer', /manualmente/i.test(tela), true);

  const c = await bd();
  const [r] = await c.query("SELECT laudo, anamnese FROM clients WHERE id = 'c1'");
  await c.end();
  /* O ACHADO DE 21/09: sem chave, o servidor NAO recusava -- devolvia 200 com
     um laudo montado no codigo, com o nome da paciente preenchido e assinado
     por "Dra. Musa", e a tela gravava na ficha na hora. */
  ok('nenhum laudo entrou na ficha', r[0].laudo, null);
  // A anamnese que a pessoa digitou NAO se perde na falha.
  ok('mas a anamnese digitada foi salva', /flacidez mandibular/.test(r[0].anamnese || ''), true);
}

console.log('\n[4] LAUDO ESCRITO A MAO SO ENTRA NA FICHA QUANDO ALGUEM SALVA');
{
  await pag.click('button:has-text("Escrever Laudo Manualmente")');
  await pag.waitForTimeout(1000);
  const tela = await pag.locator('body').innerText();
  ok('o painel avisa que o texto nao substitui avaliacao clinica',
    /não substitui avaliação clínica/i.test(tela), true);
  ok('e que quem revisa e a profissional responsavel',
    /profissional responsável/i.test(tela), true);
  /* A tela dizia "Emitido em {hoje}" -- sempre hoje, inclusive num laudo salvo
     em marco. A ficha nao guarda data de emissao, entao a tela inventava uma. */
  ok('a data de emissao inventada saiu da tela', /Emitido em/i.test(tela), false);
}

await pag.screenshot({ path: '/tmp/claude-0/m512.png', fullPage: false });
await nav.close();

const passaram = conf.filter(Boolean).length;
console.log('\n====================================================');
console.log('  ' + passaram + ' de ' + conf.length + ' conferencias passaram');
console.log('====================================================\n');
servidor.close();
process.exit(passaram === conf.length ? 0 : 1);

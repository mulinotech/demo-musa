/** A M6.6 vista do navegador: os cinco achados da apresentação, na tela. */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { chromium } from 'playwright';
import { createRequire } from 'module';
const require = createRequire('/home/claude/musa/');

const H = '127.0.0.1', P = 3307, U = 'musa', S = 'ensaio-local', B = 'musa_m66_nav';
const raiz = await mysql.createConnection({ host: H, port: P, user: U, password: S, multipleStatements: true });
await raiz.query('DROP DATABASE IF EXISTS ' + B);
await raiz.query('CREATE DATABASE ' + B);
await raiz.end();

process.env.DB_HOST = H; process.env.DB_PORT = String(P); process.env.DB_USER = U;
process.env.DB_PASSWORD = S; process.env.DB_NAME = B; process.env.JWT_SECRET = 'nav-m66';

const emDias = (d) => {
  const x = new Date(Date.now() + d * 86400000);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' +
    String(x.getDate()).padStart(2, '0');
};

const conn = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B, multipleStatements: true });
await require('/home/claude/musa/db/run-migrations.js')(conn, {});
await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id) VALUES (?,?,?,?,?,?,?)',
  ['u_adm', 'Dra Musa', 'adm@ensaio.invalido', bcrypt.hashSync('SenhaDeEnsaio2026', 10), 'admin', 'active', 'cl_1']);
/* Nomes escolhidos para a busca: "Zulmira" e a ultima em ordem alfabetica, e
   e nela que se clica -- e a que a recarga jogava fora. */
await conn.query("INSERT INTO clients (id,name,phone,clinica_id) VALUES" +
  " ('c1','Ana Paula','11911112222','cl_1')," +
  " ('c2','Beatriz Lima','11922223333','cl_1')," +
  " ('c9','Zulmira Teste','11999998888','cl_1')");
await conn.query("INSERT INTO treatment_catalog (id,name,price,package_price,duration,duration_min,clinica_id)" +
  " VALUES ('tc1','Ultraformer',400,3600,'60',60,'cl_1')");
await conn.query("INSERT INTO products (id,name,unit,unit_cost,min_stock,clinica_id)" +
  " VALUES ('p1','Agulha 30G','UN',3.50,0,'cl_1')");
await conn.query("INSERT INTO service_supplies (id,catalog_id,product_id,quantity,clinica_id)" +
  " VALUES ('ss1','tc1','p1',2,'cl_1')");
await conn.query("INSERT INTO finance_categories (id,name,type,conta_no_cpl,clinica_id)" +
  " VALUES ('cat_ads','Meta Ads','DESPESA',1,'cl_1')");
await conn.query("INSERT INTO fixed_costs (id,name,monthly_amount,natureza,clinica_id)" +
  " VALUES ('fc1','Aluguel',12000,'FIXO','cl_1')");
await conn.query("UPDATE pricing_settings SET monthly_working_hours = 120 WHERE clinica_id = 'cl_1'");
await conn.query("INSERT INTO leads (id,name,whatsapp,treatment,status,source,date,clinica_id) VALUES" +
  " ('l1','A','11900000001','X','novo','meta_ads',?,'cl_1')", [emDias(-2)]);
// A despesa de captacao esta FORA do filtro de 7 dias -- e o caso da apresentacao.
await conn.query("INSERT INTO cash_entries (id,type,amount,description,entry_date,category_id,clinica_id)" +
  " VALUES ('ce_ads','DESPESA',1000,'Anuncio do mes passado',?,'cat_ads','cl_1')", [emDias(-40)]);
await conn.end();

const app = require('/home/claude/musa/server/app.js');
const servidor = app.listen(4204);
await new Promise((r) => servidor.on('listening', r));
const BASE = 'http://127.0.0.1:4204';

const conf = [];
const ok = (nome, real, esperado) => {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  conf.push(passou);
  console.log((passou ? '  OK  ' : '  XX  ') + nome +
    (passou ? '' : '   esperado ' + JSON.stringify(esperado) + ', veio ' + JSON.stringify(real)));
};
const bd = () => mysql.createConnection({ host: H, port: P, user: U, password: S, database: B });

const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pag = await nav.newPage({ viewport: { width: 1500, height: 900 } });
pag.on('dialog', (d) => d.accept());

await pag.goto(BASE + '/login');
await pag.fill('input[type="email"]', 'adm@ensaio.invalido');
await pag.fill('input[type="password"]', 'SenhaDeEnsaio2026');
await pag.click('button[type="submit"]');
await pag.waitForURL(/crm/, { timeout: 15000 });
await pag.waitForTimeout(3000);

console.log('\n[1] O CPL DIZ O QUE FALTA');
{
  const tela = await pag.locator('body').innerText();
  /* Antes: "R$ 0,00" e nada mais. Agora o cartao aponta para o filtro, que e'
     onde esta a causa. */
  ok('o cartao nao mostra zero', /Custo por Lead[\s\S]{0,80}R\$ 0,00/.test(tela), false);
  ok('ele diz que nao houve despesa no periodo', /nenhuma despesa no período/i.test(tela), true);
  ok('e manda ampliar o periodo ou lancar', /Amplie o período|lance a despesa/i.test(tela), true);
}

console.log('\n[2] A PACIENTE ESCOLHIDA NAO SE PERDE AO CRIAR O PLANO');
{
  await pag.goto(BASE + '/crm/pacientes');
  await pag.waitForTimeout(3000);

  ok('a busca existe', await pag.locator('input[placeholder*="Buscar"]').count(), 1);
  await pag.fill('input[placeholder*="Buscar"]', '9999');
  await pag.waitForTimeout(800);
  const naLista = await pag.locator('body').innerText();
  ok('buscar por telefone filtra', /Zulmira Teste/.test(naLista), true);
  ok('e esconde as outras', /Beatriz Lima/.test(naLista), false);

  await pag.locator('button', { hasText: 'Zulmira Teste' }).first().click();
  await pag.waitForTimeout(1500);
  ok('a ficha dela abre', /Zulmira Teste/.test(await pag.locator('h2, h3, h4').allInnerTexts().then((t) => t.join(' '))), true);

  await pag.locator('button', { hasText: /NOVO PLANO/i }).first().click();
  await pag.waitForTimeout(1200);
  const modal = pag.locator('div.fixed.inset-0').last();
  await modal.locator('input').first().fill('Protocolo da Zulmira');
  const sessoes = modal.locator('input[type="number"]').first();
  if (await sessoes.count()) await sessoes.fill('2');
  await modal.locator('button', { hasText: /Gerar Plano/i }).click();
  await pag.waitForTimeout(3500);

  /* ERA AQUI QUE A TELA SE PERDIA: `fetchCrmData()` ligava o spinner, a arvore
     inteira desmontava e a paciente selecionada voltava para a primeira da
     lista -- que nao e' a que a pessoa estava cadastrando. */
  const depois = await pag.locator('body').innerText();
  ok('a paciente continua a mesma', /Zulmira Teste/.test(depois), true);
  ok('e o plano aparece na ficha dela', /Protocolo da Zulmira/.test(depois), true);

  const c = await bd();
  const [pl] = await c.query("SELECT client_id FROM treatment_plans WHERE title = 'Protocolo da Zulmira'");
  await c.end();
  ok('o plano nasceu na ficha certa', pl[0].client_id, 'c9');
}

console.log('\n[3] A FICHA TECNICA TEM LAPIS');
{
  await pag.goto(BASE + '/crm/estoque');
  await pag.waitForTimeout(2500);
  const aba = pag.locator('button', { hasText: /Ficha/i }).first();
  if (await aba.count()) { await aba.click(); await pag.waitForTimeout(1200); }
  await pag.locator('select').first().selectOption('tc1');
  await pag.waitForTimeout(1800);

  const lapis = pag.locator('button[title*="Editar a quantidade"]');
  ok('o lapis esta na linha do insumo', await lapis.count(), 1);
  await lapis.first().click();
  await pag.waitForTimeout(800);

  const tela = await pag.locator('body').innerText();
  /* O custo unitario NAO e editavel (decisao R3: ele e o custo medio das
     entradas). A tela passa a DIZER isso em vez de so nao oferecer o campo. */
  ok('a tela explica de onde vem o custo', /custo médio das entradas/i.test(tela), true);
  ok('e para onde ir para corrigi-lo', /Estoque → Entrada/.test(tela), true);

  /* O campo de quantidade e o unico habilitado da linha de edicao (o custo fica
     desabilitado de proposito). O botao tem o rotulo "Salvar" com o icone ao
     lado, entao a busca e por texto contido, nao exato. */
  await pag.locator('div')
    .filter({ has: pag.locator('label', { hasText: 'Quantidade (' }) })
    .locator('input').first().fill('3');
  await pag.locator('button:has-text("Salvar")').first().click();
  await pag.waitForTimeout(2500);

  const c = await bd();
  const [ss] = await c.query("SELECT quantity FROM service_supplies WHERE catalog_id = 'tc1'");
  await c.end();
  ok('a quantidade foi gravada', Number(ss[0].quantity), 3);
  ok('e o insumo continua UM so', ss.length, 1);
}

console.log('\n[4] O PACOTE ACOMPANHA O PRECO DA SESSAO');
{
  await pag.goto(BASE + '/crm/precificacao');
  await pag.waitForTimeout(2500);
  await pag.locator('select').first().selectOption('tc1');
  await pag.waitForTimeout(2500);
  await pag.locator('button', { hasText: /Aplicar ao catálogo/i }).click();
  await pag.waitForTimeout(3000);

  const tela = await pag.locator('body').innerText();
  ok('a tela conta que o pacote acompanhou', /pacote acompanhou/i.test(tela), true);

  const c = await bd();
  const [cat] = await c.query("SELECT price, package_price FROM treatment_catalog WHERE id = 'tc1'");
  await c.end();
  const razao = Number(cat[0].package_price) / Number(cat[0].price);
  ok('e a proporcao do pacote foi preservada', Math.round(razao * 100) / 100, 9);
}

console.log('\n[5] A JANELA DA AGENDA CABE NA TELA');
{
  const c = await bd();
  await c.query("INSERT INTO appointments (id,client_id,professional_id,catalog_id,title,starts_at,ends_at,status,kind,clinica_id)" +
    " VALUES ('ap1','c1','u_adm','tc1','Ultraformer',?,?,'AGENDADO','ATENDIMENTO','cl_1')",
    /* HOJE: a Agenda abre na visao "Dia", e um compromisso de amanha nao
       aparece sem trocar de visao. */
    [emDias(0) + ' 15:00:00', emDias(0) + ' 16:00:00']);
  await c.end();

  await pag.goto(BASE + '/crm/agenda');
  await pag.waitForTimeout(3000);
  /* O card da agenda mostra HORA + NOME DA PACIENTE, nao o titulo. */
  await pag.locator('text=Ana Paula').first().click();
  await pag.waitForTimeout(1800);

  const caixa = pag.locator('div.fixed.inset-0 > div').last();
  const m = await caixa.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { topo: Math.round(r.top), altura: Math.round(r.height), janela: window.innerHeight };
  });
  /* ERA AQUI QUE O TOPO SUMIA: `sm:items-center` centraliza, e centralizar uma
     caixa maior que a tela poe as duas pontas para fora dela. */
  ok('a caixa nao comeca acima da tela', m.topo >= -2, true);
  ok('e nao passa da altura da janela', m.altura <= m.janela, true);
  ok('o nome da paciente aparece no topo',
    /Ana Paula/.test(await caixa.innerText()), true);

  await pag.screenshot({ path: '/tmp/claude-0/m66-agenda.png', fullPage: false });
}

await nav.close();

const passaram = conf.filter(Boolean).length;
console.log('\n====================================================');
console.log('  ' + passaram + ' de ' + conf.length + ' conferencias passaram');
console.log('====================================================\n');
servidor.close();
process.exit(passaram === conf.length ? 0 : 1);

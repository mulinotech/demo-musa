/** A M6.3 vista do navegador: o aviso do custo, o atalho da ficha e o botão da agenda. */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { chromium } from 'playwright';
import { createRequire } from 'module';
const require = createRequire('/home/claude/musa/');

const H = '127.0.0.1', P = 3307, U = 'musa', S = 'ensaio-local', B = 'musa_m63_nav';
const raiz = await mysql.createConnection({ host: H, port: P, user: U, password: S, multipleStatements: true });
await raiz.query('DROP DATABASE IF EXISTS ' + B);
await raiz.query('CREATE DATABASE ' + B);
await raiz.end();

process.env.DB_HOST = H; process.env.DB_PORT = String(P); process.env.DB_USER = U;
process.env.DB_PASSWORD = S; process.env.DB_NAME = B; process.env.JWT_SECRET = 'nav-m63';

const conn = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B, multipleStatements: true });
await require('/home/claude/musa/db/run-migrations.js')(conn, {});
const senha = bcrypt.hashSync('SenhaDeEnsaio2026', 10);
await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id) VALUES (?,?,?,?,?,?,?)',
  ['u_adm', 'Dra Musa', 'adm@ensaio.invalido', senha, 'admin', 'active', 'cl_1']);
await conn.query("INSERT INTO clients (id,name,phone,clinica_id) VALUES ('c1','Ana Paula','11911112222','cl_1')");
await conn.query("INSERT INTO treatment_catalog (id,name,price,duration,duration_min,clinica_id)" +
  " VALUES ('tc1','Ultraformer',1500,'90',90,'cl_1')");
await conn.query("INSERT INTO products (id,name,unit,unit_cost,min_stock,clinica_id)" +
  " VALUES ('p1','Agulha 30G','UN',3.50,0,'cl_1'),('p2','Anestesico','ML',1.20,0,'cl_1')");
await conn.query("UPDATE pricing_settings SET monthly_working_hours = 120 WHERE clinica_id = 'cl_1'");
await conn.end();

const app = require('/home/claude/musa/server/app.js');
const servidor = app.listen(4197);
await new Promise((r) => servidor.on('listening', r));
const BASE = 'http://127.0.0.1:4197';

const conf = [];
const ok = (nome, real, esperado) => {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  conf.push(passou);
  console.log((passou ? '  OK  ' : '  XX  ') + nome +
    (passou ? '' : '   esperado ' + JSON.stringify(esperado) + ', veio ' + JSON.stringify(real)));
};
const bd = () => mysql.createConnection({ host: H, port: P, user: U, password: S, database: B });

const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
/* 900px de altura: e' a altura util de um notebook comum, e e' nela que a
   janela de programar estourou em producao. */
const pag = await nav.newPage({ viewport: { width: 1500, height: 900 } });

await pag.goto(BASE + '/login');
await pag.fill('input[type="email"]', 'adm@ensaio.invalido');
await pag.fill('input[type="password"]', 'SenhaDeEnsaio2026');
await pag.click('button[type="submit"]');
await pag.waitForURL(/crm/, { timeout: 15000 });

console.log('\n[1] CADASTRAR CUSTO FIXO E CUSTO RECORRENTE');
{
  await pag.goto(BASE + '/crm/precificacao');
  await pag.waitForTimeout(2000);
  await pag.locator('button', { hasText: 'Custos fixos' }).first().click();
  await pag.waitForTimeout(1500);

  // O seletor de natureza existe, com as duas opcoes vindas do servidor.
  const opcoes = await pag.locator('select').nth(0).locator('option').allTextContents();
  ok('a natureza aparece no cadastro',
    opcoes.some((o) => /recorrente por atendimento/i.test(o)), true);

  const campos = pag.locator('input');
  await campos.nth(0).fill('Aluguel');
  await campos.nth(1).fill('6000');
  await pag.click('button:has-text("Adicionar")');
  await pag.waitForTimeout(1800);
  ok('o custo por hora sai do fixo',
    /R\$\s*50,00/.test(await pag.locator('body').innerText()), true);

  await campos.nth(0).fill('Acido hialuronico');
  await campos.nth(1).fill('4800');
  await pag.locator('select').nth(0).selectOption('VARIAVEL');
  await pag.click('button:has-text("Adicionar")');
  await pag.waitForTimeout(1800);

  const tela = await pag.locator('body').innerText();
  /* O numero que o time comercial nao conseguia ver: com os dois somados, o
     custo por hora seria 90 -- 80% a mais em cima de todo preco. */
  ok('o custo por hora NAO muda', /R\$\s*50,00/.test(tela), true);
  ok('e o aviso da soma dupla aparece', /contaria duas vezes/i.test(tela), true);
  ok('dizendo quanto e o recorrente', /4\.800,00/.test(tela), true);
  ok('a linha mostra que nao entra no custo por hora',
    /não entra no custo por hora/i.test(tela), true);
}

console.log('\n[2] RECLASSIFICAR NA PROPRIA LINHA');
{
  await pag.locator('button:has-text("não entra no custo por hora")').first().click();
  await pag.waitForTimeout(1800);
  // 10800 / 120 = 90.
  ok('o custo por hora sobe na hora',
    /R\$\s*90,00/.test(await pag.locator('body').innerText()), true);
  await pag.locator('tr', { hasText: 'Acido hialuronico' })
    .locator('button:has-text("entra no custo por hora")').first().click();
  await pag.waitForTimeout(1800);
  ok('e volta ao clicar de novo',
    /R\$\s*50,00/.test(await pag.locator('body').innerText()), true);
}

console.log('\n[3] EDITAR A FICHA TECNICA SEM SAIR DA PRECIFICACAO');
{
  await pag.locator('button', { hasText: 'Calculadora' }).first().click();
  await pag.waitForTimeout(1500);
  await pag.locator('select').first().selectOption({ label: 'Ultraformer' });
  await pag.waitForTimeout(1500);

  ok('o atalho aparece com servico escolhido',
    await pag.locator('button:has-text("ficha técnica")').count() >= 1, true);
  await pag.locator('button:has-text("ficha técnica")').first().click();
  await pag.waitForTimeout(1800);

  /* `div.fixed` sozinho pega tambem o cabecalho fixo da pagina, e o modal fica
     DENTRO dele -- o innerText casava e os seletores eram os da tela de tras. */
  const modal = pag.locator('div.fixed.inset-0.z-50').last();
  ok('a janela abre com o nome do servico',
    /Ficha técnica · Ultraformer/.test(await modal.innerText()), true);
  /* O seletor de servico SOME aqui: trocar de servico dentro de um modal que
     fala de outro seria mudar o assunto sem avisar. */
  ok('e sem o seletor de servico',
    /Serviço do catálogo/.test(await modal.innerText()), false);

  // Acrescenta um insumo pela janela.
  /* Pelo VALUE, e nao pelo rotulo: a opcao traz nome, custo e unidade
     ("Agulha 30G (R$ 3,50/UN)"), e `label` do Playwright e string exata. */
  await modal.locator('select').first().selectOption('p1');
  await modal.locator('input').last().fill('2');
  await modal.locator('button:has-text("Adicionar")').first().click();
  await pag.waitForTimeout(2000);

  const c = await bd();
  const [f] = await c.query("SELECT quantity FROM service_supplies WHERE catalog_id = 'tc1'");
  await c.end();
  ok('o insumo entrou na ficha do servico', f.length, 1);

  await modal.locator('button[title="Fechar"]').first().click();
  await pag.waitForTimeout(2500);
  /* 2 agulhas x R$ 3,50 = R$ 7,00. A calculadora tem de reler: sem isso ela
     continuaria calculando preco em cima da soma de antes da edicao. */
  ok('e a calculadora passa a conhecer a soma nova',
    /7,00/.test(await pag.locator('body').innerText()), true);
  ok('sem ter saido da Precificacao', /precificacao/.test(pag.url()), true);
}

console.log('\n[4] LEVAR AS SESSOES DO PLANO PARA A AGENDA');
{
  const daquiA = (d) => {
    const x = new Date(Date.now() + d * 86400000);
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' +
      String(x.getDate()).padStart(2, '0');
  };
  // O plano nasce pela API: montar quatro sessoes clicando levaria o dobro do
  // tempo e nao e o que esta tarefa mudou.
  const plano = await pag.evaluate(async (inicio) => {
    const r = await fetch('/api/treatment-plans', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'c1', title: 'Protocolo Ultraformer',
        totalSessions: 3, periodicity: 'Semanal', startDate: inicio })
    });
    const d = await r.json();
    await fetch('/api/treatment-plans/' + d.id + '/programar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inicio: inicio, periodicidade: 'Semanal' })
    });
    return d.id;
  }, daquiA(7));
  ok('o plano foi criado e programado', !!plano, true);

  await pag.goto(BASE + '/crm/pacientes');
  await pag.waitForTimeout(3000);
  const abrir = pag.locator('button[title*="rogramar"], button:has-text("Programar")').first();
  ok('o botao de programar esta na ficha', await abrir.count(), 1);
  await abrir.click();
  await pag.waitForTimeout(1800);

  const modal = pag.locator('div.fixed.inset-0').last();
  ok('a janela tem o bloco da agenda',
    /Levar para a agenda/i.test(await modal.innerText()), true);
  ok('com hora, duracao e profissional',
    (await modal.locator('input[type="time"]').count()) === 1 &&
    (await modal.locator('select').count()) >= 1, true);

  await modal.locator('input[type="time"]').fill('09:00');
  await modal.locator('select').last().selectOption({ label: 'Dra Musa' });
  await modal.locator('button:has-text("Levar para a agenda")').click();
  await pag.waitForTimeout(3000);
  ok('a tela confirma quantas entraram',
    /sessoes entraram na agenda|sessao entrou na agenda/i.test(await modal.innerText()), true);

  const c = await bd();
  const [ap] = await c.query(
    "SELECT title, DATE_FORMAT(starts_at,'%H:%i') h, DATE_FORMAT(ends_at,'%H:%i') f FROM appointments ORDER BY starts_at");
  const [s] = await c.query(
    'SELECT COUNT(*) n FROM treatment_sessions WHERE appointment_id IS NOT NULL');
  await c.end();
  ok('os tres compromissos existem', ap.length, 3);
  ok('das 9h as 10h', [ap[0].h, ap[0].f], ['09:00', '10:00']);
  ok('com o nome do plano e o numero da sessao', /Protocolo Ultraformer — sessao 1/.test(ap[0].title), true);
  ok('e as sessoes ficaram amarradas', s[0].n, 3);

  // Clicar de novo nao duplica.
  await modal.locator('button:has-text("Levar para a agenda")').click();
  await pag.waitForTimeout(2500);
  ok('clicar de novo diz que ja estao la',
    /já está na agenda/i.test(await modal.innerText()), true);
  const c2 = await bd();
  const [ap2] = await c2.query('SELECT COUNT(*) n FROM appointments');
  await c2.end();
  ok('e a agenda continua com tres', ap2[0].n, 3);
}

console.log('\n[5] A JANELA CABE NA TELA, E DA PARA SAIR DELA');
{
  /* O defeito visto em producao (M6.3b): com o bloco da agenda a janela passou
     de sete para treze campos, ficou mais alta que a tela, e o botao de fechar
     caiu para fora -- sem nada para rolar, porque quem rolava era o fundo. */
  const caixa = pag.locator('div.fixed.inset-0 > div').last();
  const m = await caixa.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { topo: Math.round(r.top), base: Math.round(r.bottom),
             altura: Math.round(r.height), janela: window.innerHeight,
             rola: el.scrollHeight > el.clientHeight };
  });
  ok('a caixa nao comeca acima da tela', m.topo >= -2, true);
  ok('e nao passa da altura da janela', m.altura <= m.janela, true);

  // O botao de fechar tem de estar alcancavel -- rolando por DENTRO da caixa.
  const fechar = caixa.locator('button:has-text("Fechar"), button:has-text("Cancelar")').first();
  await fechar.scrollIntoViewIfNeeded();
  const v = await fechar.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight + 1;
  });
  ok('o botao de sair fica visivel', v, true);
  await fechar.click();
  await pag.waitForTimeout(1500);
  ok('e a janela fecha', await pag.locator('text=Programar as datas').count(), 0);
}

await pag.screenshot({ path: '/tmp/claude-0/m63.png', fullPage: false });
await pag.goto(BASE + '/crm/precificacao');
await pag.waitForTimeout(2000);
await pag.locator('button', { hasText: 'Custos fixos' }).first().click();
await pag.waitForTimeout(1500);
await pag.screenshot({ path: '/tmp/claude-0/m63-custos.png', fullPage: false });
await nav.close();

const passaram = conf.filter(Boolean).length;
console.log('\n====================================================');
console.log('  ' + passaram + ' de ' + conf.length + ' conferencias passaram');
console.log('====================================================\n');
servidor.close();
process.exit(passaram === conf.length ? 0 : 1);

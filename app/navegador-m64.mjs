/** A M6.4 vista do navegador: o papel que a clínica leva para a reunião.
 *
 *  A conferência que importa aqui é a do BLOCO [2]: o número impresso e o
 *  número da tela, lidos os dois na mesma sessão, no mesmo período.
 */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { chromium } from 'playwright';
import { createRequire } from 'module';
const require = createRequire('/home/claude/musa/');

const H = '127.0.0.1', P = 3307, U = 'musa', S = 'ensaio-local', B = 'musa_m64_nav';
const raiz = await mysql.createConnection({ host: H, port: P, user: U, password: S, multipleStatements: true });
await raiz.query('DROP DATABASE IF EXISTS ' + B);
await raiz.query('CREATE DATABASE ' + B);
await raiz.end();

process.env.DB_HOST = H; process.env.DB_PORT = String(P); process.env.DB_USER = U;
process.env.DB_PASSWORD = S; process.env.DB_NAME = B; process.env.JWT_SECRET = 'nav-m64';

/** Datas SEMPRE relativas a hoje: a Visão Geral filtra "últimos 7 dias", e um
 *  ensaio com data fixa passa hoje e quebra sozinho no mês que vem. */
const emDias = (d) => {
  const x = new Date(Date.now() + d * 86400000);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' +
    String(x.getDate()).padStart(2, '0');
};

const conn = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B, multipleStatements: true });
await require('/home/claude/musa/db/run-migrations.js')(conn, {});
await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id) VALUES (?,?,?,?,?,?,?)',
  ['u_adm', 'Dra Musa', 'adm@ensaio.invalido', bcrypt.hashSync('SenhaDeEnsaio2026', 10), 'admin', 'active', 'cl_1']);
await conn.query("INSERT INTO clients (id,name,phone,clinica_id) VALUES" +
  " ('c1','Ana Paula','11911112222','cl_1'),('c2','Beatriz Lima','11922223333','cl_1')");
/* A clínica de ensaio tem OUTRO nome de propósito: com o nome padrão, a
   conferência do nome no papel passaria mesmo se ele continuasse escrito no
   código -- que é justamente o defeito que se quer medir. */
await conn.query("UPDATE clinicas SET nome = 'Clinica de Ensaio M64' WHERE id = 'cl_1'");

// Dentro dos últimos 7 dias: 12.000 no razão, 9.000 em sessões.
await conn.query(
  "INSERT INTO cash_entries (id, type, amount, description, entry_date, paid_at, clinica_id) VALUES" +
  " ('ce1','RECEITA',7000,'Pacote Ana',?,?,'cl_1')," +
  " ('ce2','RECEITA',5000,'Pacote Beatriz',?,?,'cl_1')," +
  " ('ce9','RECEITA',30000,'Mes passado',?,?,'cl_1')",
  [emDias(-2), emDias(-2), emDias(-1), emDias(-1), emDias(-40), emDias(-40)]);
await conn.query("INSERT INTO treatment_plans (id, client_id, title, total_sessions, status, clinica_id) VALUES" +
  " ('pl1','c1','Protocolo Ana',2,'ATIVO','cl_1'),('pl2','c1','Segundo da Ana',1,'ATIVO','cl_1')," +
  " ('pl3','c2','Protocolo Beatriz',1,'ATIVO','cl_1')");
await conn.query("INSERT INTO treatment_sessions (id, plan_id, session_number, session_type, status, session_date, price, clinica_id) VALUES" +
  " ('s1','pl1',1,'SESSAO_TRATAMENTO','REALIZADA',?,3000,'cl_1')," +
  " ('s2','pl1',2,'SESSAO_TRATAMENTO','REALIZADA',?,3000,'cl_1')," +
  " ('s3','pl3',1,'AVALIACAO_INICIAL','REALIZADA',?,3000,'cl_1')",
  [emDias(-2), emDias(-2), emDias(-1)]);
await conn.query("INSERT INTO appointments (id, client_id, professional_id, title, starts_at, ends_at, status, kind, clinica_id) VALUES" +
  " ('ap1','c1','u_adm','Sessao 1',?,?,'REALIZADO','ATENDIMENTO','cl_1')," +
  " ('ap2','c2','u_adm','Avaliacao',?,?,'REALIZADO','ATENDIMENTO','cl_1')",
  [emDias(-2) + ' 09:00:00', emDias(-2) + ' 10:00:00', emDias(-1) + ' 09:00:00', emDias(-1) + ' 10:00:00']);
await conn.query("INSERT INTO leads (id, name, whatsapp, treatment, status, source, date, converted_at, clinica_id) VALUES" +
  " ('l1','Lead Novo','11900000001','X','novo','meta_ads',?,NULL,'cl_1')," +
  " ('l2','Lead Proposta','11900000002','X','agendado','meta_ads',?,NULL,'cl_1')," +
  " ('l3','Lead Fechado','11900000003','X','arquivado','meta_ads',?,?,'cl_1')," +
  " ('l4','Lead Perdido','11900000004','X','perdido','site',?,NULL,'cl_1')",
  [emDias(-5), emDias(-5), emDias(-5), emDias(-1), emDias(-4)]);
await conn.end();

const app = require('/home/claude/musa/server/app.js');
const servidor = app.listen(4200);
await new Promise((r) => servidor.on('listening', r));
const BASE = 'http://127.0.0.1:4200';

const conf = [];
const ok = (nome, real, esperado) => {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  conf.push(passou);
  console.log((passou ? '  OK  ' : '  XX  ') + nome +
    (passou ? '' : '   esperado ' + JSON.stringify(esperado) + ', veio ' + JSON.stringify(real)));
};

const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await nav.newContext({ viewport: { width: 1500, height: 950 } });
const pag = await ctx.newPage();

await pag.goto(BASE + '/login');
await pag.fill('input[type="email"]', 'adm@ensaio.invalido');
await pag.fill('input[type="password"]', 'SenhaDeEnsaio2026');
await pag.click('button[type="submit"]');
await pag.waitForURL(/crm/, { timeout: 15000 });
await pag.waitForTimeout(3000);

console.log('\n[1] O FILTRO DA TELA VAI PARA A URL');
{
  /* É por aqui que o botão do PDF, que vive no componente pai, descobre o
     período escolhido embaixo. Sem isso o papel voltaria a consolidar o mês. */
  const url = new URL(pag.url());
  ok('a URL passa a carregar o periodo', !!(url.searchParams.get('de') && url.searchParams.get('ate')), true);
  ok('e a faixa diz que o PDF segue o filtro',
    /segue o .?filtro de período/i.test(await pag.locator('body').innerText()), true);
}

console.log('\n[2] O NUMERO DO PAPEL E O NUMERO DA TELA');
{
  const naTela = await pag.locator('body').innerText();
  ok('a tela mostra o faturamento do razao', /12\.000,00/.test(naTela), true);

  const [papel] = await Promise.all([
    ctx.waitForEvent('page'),
    pag.locator('button', { hasText: /Relat[oó]rio/i }).first().click()
  ]);
  await papel.waitForLoadState('domcontentloaded');
  await papel.waitForTimeout(1500);
  const impresso = await papel.locator('body').innerText();

  /* ERA AQUI QUE OS DOIS DIVERGIAM: as sessoes somam 9.000 e o razao 12.000.
     O papel dizia 9.000, a tela dizia 12.000, e o papel ia para a reuniao. */
  ok('o papel traz o MESMO faturamento', /12\.000,00/.test(impresso), true);
  ok('e nao o das sessoes', /9\.000,00/.test(impresso), false);
  ok('dizendo de onde o numero veio', /razão do Financeiro/i.test(impresso), true);

  // 12.000 / 2 pacientes distintas.
  ok('o ticket e por paciente', /6\.000,00/.test(impresso), true);
  ok('e o rotulo diz isso', /Ticket Médio por Paciente/i.test(impresso), true);

  // 1 fechado de 4 leads.
  ok('a conversao conta a venda fechada', /25,0%/.test(impresso), true);
  ok('e o percentual sai em portugues', /25\.0%/.test(impresso), false);
  ok('e o rotulo explica a conta', /venda fechada ÷ leads/i.test(impresso), true);

  ok('o mes passado nao entra', /30\.000,00/.test(impresso), false);

  /* O NOME DA CLINICA: seis ocorrencias estavam escritas no HTML. Na clinica
     de ensaio o nome e outro, entao o papel tem de trazer o outro. */
  const nome = await pag.evaluate(async () => (await (await fetch('/api/clinica')).json()).nome);
  ok('o papel traz o nome DESTA clinica', impresso.indexOf(nome) !== -1, true);
  ok('e nao o nome escrito no codigo',
    /Dra\. Musa Estética de Elite/.test(impresso), false);
  await papel.close();
}

console.log('\n[3] O RELATORIO DE PACIENTES NAO TEM MAIS ANIVERSARIO');
{
  await pag.goto(BASE + '/crm/pacientes');
  await pag.waitForTimeout(2500);
  const [papel] = await Promise.all([
    ctx.waitForEvent('page'),
    pag.locator('button', { hasText: /Relat[oó]rio/i }).first().click()
  ]);
  await papel.waitForLoadState('domcontentloaded');
  await papel.waitForTimeout(1500);
  const impresso = await papel.locator('body').innerText();

  /* `clients` nao tem data de nascimento. A lista saia com nome e telefone
     REAIS ao lado de datas calculadas pela posicao na lista. */
  ok('a secao de aniversariantes sumiu', /Aniversariantes/i.test(impresso), false);
  ok('nenhuma paciente aparece com data de aniversario',
    /Data do Aniversário/i.test(impresso), false);
  ok('a taxa de retorno diz sobre quantas pacientes',
    /de 2 pacientes/i.test(impresso), true);
  await papel.close();
}

console.log('\n[4] O RELATORIO DE ATENDIMENTO NAO TEM MAIS SATISFACAO INVENTADA');
{
  await pag.goto(BASE + '/crm/atendimento');
  await pag.waitForTimeout(2500);
  const [papel] = await Promise.all([
    ctx.waitForEvent('page'),
    pag.locator('button', { hasText: /Relat[oó]rio/i }).first().click()
  ]);
  await papel.waitForLoadState('domcontentloaded');
  await papel.waitForTimeout(1500);
  const impresso = await papel.locator('body').innerText();

  ok('o CSAT inventado saiu', /Satisfação Média|CSAT/i.test(impresso), false);
  ok('e o 4,9 tambem', /4,9|4\.9/.test(impresso), false);
  /* Sem mensagem nenhuma nesta clinica de ensaio, o papel tem de DIZER isso --
     e nao imprimir "12 minutos", que era a constante antiga. */
  ok('sem mensagem, o papel diz que nao mediu',
    /nenhuma mensagem/i.test(impresso), true);
  ok('e nao imprime os 12 minutos de antes', /12 min/.test(impresso), false);
  ok('as conversas sem resposta viraram um numero proprio',
    /Conversas sem Resposta/i.test(impresso), true);

  await papel.screenshot({ path: '/tmp/claude-0/m64-atendimento.png', fullPage: true });
  await papel.close();
}

console.log('\n[5] O PAPEL ESTA NA MARCA');
{
  await pag.goto(BASE + '/crm');
  await pag.waitForTimeout(3000);
  const [papel] = await Promise.all([
    ctx.waitForEvent('page'),
    pag.locator('button', { hasText: /Relat[oó]rio/i }).first().click()
  ]);
  await papel.waitForLoadState('domcontentloaded');
  await papel.waitForTimeout(1500);

  const corpo = await papel.evaluate(() => getComputedStyle(document.body).color);
  ok('o texto e o Navy da marca', corpo, 'rgb(20, 30, 51)');
  const antigas = await papel.evaluate(() => {
    const alvo = ['rgb(74, 60, 49)', 'rgb(122, 105, 94)'];
    let n = 0;
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const cs = getComputedStyle(el);
      if (alvo.includes(cs.color) || alvo.includes(cs.backgroundColor)) n++;
    }
    return n;
  });
  ok('nenhuma cor antiga sobrou no papel', antigas, 0);
  /* `grid-template-cols` nao existe em CSS: a grade dos cartoes nunca foi
     grade, e os quatro numeros saiam empilhados numa coluna so. */
  const colunas = await papel.evaluate(() => {
    const g = document.querySelector('.metrics-grid');
    return g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 0;
  });
  ok('e a grade dos cartoes virou grade mesmo', colunas > 1, true);

  await papel.screenshot({ path: '/tmp/claude-0/m64-visaogeral.png', fullPage: true });
  await papel.close();
}

await nav.close();

const passaram = conf.filter(Boolean).length;
console.log('\n====================================================');
console.log('  ' + passaram + ' de ' + conf.length + ' conferencias passaram');
console.log('====================================================\n');
servidor.close();
process.exit(passaram === conf.length ? 0 : 1);

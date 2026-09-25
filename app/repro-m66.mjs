/** Ensaio da M6.6: os cinco achados da apresentação.
 *
 *  O bloco [A] é o que amarra o item 1: a clínica marca a categoria, lança a
 *  despesa fora do período do filtro, e o cartão precisa DIZER isso em vez de
 *  mostrar "R$ 0,00".
 */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { createRequire } from 'module';
const require = createRequire('/home/claude/musa/');

const H = '127.0.0.1', P = 3307, U = 'musa', S = 'ensaio-local', B = 'musa_m66';
const raiz = await mysql.createConnection({ host: H, port: P, user: U, password: S, multipleStatements: true });
await raiz.query('DROP DATABASE IF EXISTS ' + B);
await raiz.query('CREATE DATABASE ' + B);
await raiz.end();

process.env.DB_HOST = H; process.env.DB_PORT = String(P); process.env.DB_USER = U;
process.env.DB_PASSWORD = S; process.env.DB_NAME = B; process.env.JWT_SECRET = 'repro-m66';

const conn = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B, multipleStatements: true });
await require('/home/claude/musa/db/run-migrations.js')(conn, {});
await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id) VALUES (?,?,?,?,?,?,?)',
  ['u_adm', 'Dra Musa', 'adm@ensaio.invalido', bcrypt.hashSync('SenhaDeEnsaio2026', 10), 'admin', 'active', 'cl_1']);
await conn.query("INSERT INTO clients (id,name,phone,clinica_id) VALUES ('c1','Ana Paula','11911112222','cl_1')");
await conn.query("INSERT INTO treatment_catalog (id,name,price,package_price,duration,duration_min,clinica_id)" +
  " VALUES ('tc1','Ultraformer',400,3600,'60',60,'cl_1')");
await conn.query("INSERT INTO products (id,name,unit,unit_cost,min_stock,clinica_id)" +
  " VALUES ('p1','Agulha 30G','UN',3.50,0,'cl_1')");
await conn.query("INSERT INTO finance_categories (id,name,type,conta_no_cpl,clinica_id)" +
  " VALUES ('cat_ads','Meta Ads','DESPESA',1,'cl_1')");
/* Sem custo fixo nenhum o preco sugerido sai ZERO, e um preco zero nao mexe no
   pacote -- de proposito. O ensaio precisa de uma clinica com estrutura. */
await conn.query("INSERT INTO fixed_costs (id,name,monthly_amount,natureza,clinica_id)" +
  " VALUES ('fc1','Aluguel',12000,'FIXO','cl_1')");
await conn.query("UPDATE pricing_settings SET monthly_working_hours = 120 WHERE clinica_id = 'cl_1'");

const emDias = (d) => {
  const x = new Date(Date.now() + d * 86400000);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' +
    String(x.getDate()).padStart(2, '0');
};
// Leads dentro dos ultimos 7 dias, e a DESPESA de captacao 40 dias atras.
await conn.query("INSERT INTO leads (id,name,whatsapp,treatment,status,source,date,clinica_id) VALUES" +
  " ('l1','A','11900000001','X','novo','meta_ads',?,'cl_1')," +
  " ('l2','B','11900000002','X','novo','meta_ads',?,'cl_1')", [emDias(-2), emDias(-3)]);
await conn.query("INSERT INTO cash_entries (id,type,amount,description,entry_date,category_id,clinica_id)" +
  " VALUES ('ce_ads',  'DESPESA',1000,'Anuncio do mes passado',?, 'cat_ads','cl_1')", [emDias(-40)]);
await conn.end();

const app = require('/home/claude/musa/server/app.js');
const servidor = app.listen(4203);
await new Promise((r) => servidor.on('listening', r));
const BASE = 'http://127.0.0.1:4203';

const entrar = async (email) => {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'SenhaDeEnsaio2026' }) });
  return (await r.json()).token;
};
const chamar = async (t, metodo, caminho, corpo) => {
  const r = await fetch(BASE + caminho, {
    method: metodo,
    headers: Object.assign({ Authorization: 'Bearer ' + t },
      corpo ? { 'Content-Type': 'application/json' } : {}),
    body: corpo ? JSON.stringify(corpo) : undefined });
  return { status: r.status, corpo: await r.json().catch(() => ({})) };
};
const bd = () => mysql.createConnection({ host: H, port: P, user: U, password: S, database: B });

const conf = [];
const ok = (nome, real, esperado) => {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  conf.push(passou);
  console.log((passou ? '  OK  ' : '  XX  ') + nome +
    (passou ? '' : '   esperado ' + JSON.stringify(esperado) + ', veio ' + JSON.stringify(real)));
};

const adm = await entrar('adm@ensaio.invalido');

console.log('\n[A] O CPL DIZ O QUE FALTA, EM VEZ DE MOSTRAR R$ 0,00');
{
  const curto = await chamar(adm, 'GET',
    '/api/dashboard/dinheiro?from=' + emDias(-6) + '&to=' + emDias(0));
  const c = curto.corpo.custoPorLead;
  ok('ha categoria marcada', c.categoriasMarcadas, 1);
  ok('ha lead no periodo', c.leads, 2);
  /* A despesa existe, mas e de 40 dias atras. Antes disso a conta dava 0/2 = 0
     e o cartao mostrava "R$ 0,00" -- que se le como "captamos de graca". */
  ok('nenhum lancamento caiu no periodo', c.lancamentos, 0);
  ok('e o CPL e NULO, nao zero', c.valor, null);

  const longo = await chamar(adm, 'GET',
    '/api/dashboard/dinheiro?from=' + emDias(-60) + '&to=' + emDias(0));
  const l = longo.corpo.custoPorLead;
  ok('ampliando o periodo, o lancamento entra', l.lancamentos, 1);
  ok('e o CPL passa a existir', l.valor, 500);      // 1000 / 2 leads
}

console.log('\n[B] O PRECO DO PACOTE ACOMPANHA O DA SESSAO');
{
  const r = await chamar(adm, 'POST', '/api/pricing/apply', {
    catalogId: 'tc1', durationMin: 60, variableCost: 0,
    marginPct: 30, commissionPct: 0, cardFeePct: 0, taxPct: 0, aplicar: true
  });
  ok('a aplicacao passa', r.status, 201);
  const novo = r.corpo.resultado.precoSugerido;

  const c = await bd();
  const [cat] = await c.query("SELECT price, package_price FROM treatment_catalog WHERE id = 'tc1'");
  await c.end();
  ok('a sessao mudou', Number(cat[0].price), novo);
  /* ERA AQUI QUE A MARGEM SUMIA: a sessao subia e o pacote ficava em 3.600,
     calculado sobre os 400 de antes. */
  ok('e o pacote acompanhou', Number(cat[0].package_price), Math.round((3600 * (novo / 400)) * 100) / 100);
  ok('a resposta conta o que aconteceu', r.corpo.pacote.mexeu, true);
  ok('dizendo quantas sessoes ele vale', /9 sessões/.test(r.corpo.pacote.porque), true);

  const c2 = await bd();
  const [g] = await c2.query(
    "SELECT description FROM system_logs WHERE action_type = 'PRECIFICACAO'" +
    " AND description LIKE '%pacote acompanhou%'");
  await c2.end();
  ok('e a trilha registra os dois precos', g.length, 1);
}

console.log('\n[C] SERVICO SEM PACOTE NAO GANHA UM');
{
  const c = await bd();
  await c.query("INSERT INTO treatment_catalog (id,name,price,package_price,duration,duration_min,clinica_id)" +
    " VALUES ('tc2','Avulso',300,NULL,'30',30,'cl_1')");
  await c.end();
  const r = await chamar(adm, 'POST', '/api/pricing/apply', {
    catalogId: 'tc2', durationMin: 30, variableCost: 0,
    marginPct: 30, commissionPct: 0, cardFeePct: 0, taxPct: 0, aplicar: true });
  ok('a aplicacao passa', r.status, 201);
  ok('e o pacote continua inexistente', r.corpo.pacote.novo, null);
  const c2 = await bd();
  const [cat] = await c2.query("SELECT package_price FROM treatment_catalog WHERE id = 'tc2'");
  await c2.end();
  ok('nada foi inventado no banco', cat[0].package_price, null);
}

console.log('\n[D] O CONFLITO DE AGENDA CONTINUA SENDO CONFLITO');
{
  // Uma sessao ocupada na mesma hora, para a resposta trazer o conflito.
  const p = await chamar(adm, 'POST', '/api/treatment-plans', {
    clientId: 'c1', title: 'Protocolo', totalSessions: 1, startDate: emDias(7) });
  await chamar(adm, 'POST', '/api/treatment-plans/' + p.corpo.id + '/programar',
    { inicio: emDias(7), periodicidade: 'Semanal' });
  await chamar(adm, 'POST', '/api/appointments', {
    clientId: 'c1', professionalId: 'u_adm', title: 'Ja ocupado',
    startsAt: emDias(7) + ' 09:00:00', endsAt: emDias(7) + ' 10:00:00', kind: 'ATENDIMENTO' });

  const r = await chamar(adm, 'POST', '/api/treatment-plans/' + p.corpo.id + '/agendar',
    { hora: '09:00', professionalId: 'u_adm', duracaoMin: 60 });
  ok('nada entra', r.corpo.criados, 0);
  ok('e o conflito volta com a data ISO', /^\d{4}-\d{2}-\d{2}$/.test(r.corpo.conflitos[0].dia), true);
  /* A data vira dia/mes/ano NA TELA, e nao aqui: o servidor fala uma lingua so,
     e formatar no servidor espalharia a mesma decisao por dez rotas. */
}

console.log('\n[E] EDITAR A QUANTIDADE DA FICHA TECNICA');
{
  await chamar(adm, 'PUT', '/api/services/tc1/supplies', { itens: [{ productId: 'p1', quantity: 2 }] });
  const antes = await chamar(adm, 'GET', '/api/services/tc1/supplies');
  ok('a ficha soma 2 x 3,50', antes.corpo.custoVariavel, 7);

  // E o que o lapis da tela faz: regrava a ficha com a quantidade nova.
  await chamar(adm, 'PUT', '/api/services/tc1/supplies', { itens: [{ productId: 'p1', quantity: 3 }] });
  const depois = await chamar(adm, 'GET', '/api/services/tc1/supplies');
  ok('editar a quantidade muda o custo variavel', depois.corpo.custoVariavel, 10.5);
  ok('e o insumo continua UM so na ficha', depois.corpo.itens.length, 1);

  /* O CUSTO UNITARIO NAO E EDITAVEL, e isso e' decisao antiga (R3): ele e' o
     custo MEDIO das entradas de estoque. Digita-lo criaria um custo que nao
     corresponde a nenhuma compra, e a precificacao passaria a mentir com cara
     de calculada. A tela passa a DIZER isso em vez de so nao oferecer o campo. */
  const r = await chamar(adm, 'PATCH', '/api/products/p1', { unitCost: 5 });
  ok('o servidor recusa editar o custo a mao', r.status, 400);
}

const passaram = conf.filter(Boolean).length;
console.log('\n====================================================');
console.log('  ' + passaram + ' de ' + conf.length + ' conferencias passaram');
console.log('====================================================\n');
servidor.close();
process.exit(passaram === conf.length ? 0 : 1);

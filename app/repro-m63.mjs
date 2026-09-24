/** Ensaio da M6.3: o custo que não conta duas vezes, e a sessão que vira horário.
 *
 *  O bloco [B] é o que amarra a primeira metade: prova que reclassificar um
 *  custo MUDA o custo por hora, e que o preço calculado muda junto — que é o
 *  efeito que o time comercial descreveu sem conseguir medir.
 *
 *  O bloco [E] amarra a segunda: a sessão da ficha e o horário da agenda passam
 *  a ser a mesma coisa vista de dois lugares, e concluir o atendimento marca a
 *  sessão como realizada sem ninguém digitar nada.
 */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { createRequire } from 'module';
const require = createRequire('/home/claude/musa/');

const H = '127.0.0.1', P = 3307, U = 'musa', S = 'ensaio-local', B = 'musa_m63';
const raiz = await mysql.createConnection({ host: H, port: P, user: U, password: S, multipleStatements: true });
await raiz.query('DROP DATABASE IF EXISTS ' + B);
await raiz.query('CREATE DATABASE ' + B);
await raiz.end();

process.env.DB_HOST = H; process.env.DB_PORT = String(P); process.env.DB_USER = U;
process.env.DB_PASSWORD = S; process.env.DB_NAME = B; process.env.JWT_SECRET = 'repro-m63';

const conn = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B, multipleStatements: true });
await require('/home/claude/musa/db/run-migrations.js')(conn, {});
await conn.query("INSERT IGNORE INTO clinicas (id, nome) VALUES ('cl_2', 'Clinica Vizinha')");
const senha = bcrypt.hashSync('SenhaDeEnsaio2026', 10);
for (const [id, nome, email, papel, cl] of [
  ['u_adm', 'Dra Musa', 'adm@ensaio.invalido', 'admin', 'cl_1'],
  ['u_pro', 'Dra Carla', 'pro@ensaio.invalido', 'profissional', 'cl_1'],
  ['u_ven', 'Vendedora', 'ven@ensaio.invalido', 'vendedor', 'cl_1'],
  ['u_viz', 'Vizinha', 'viz@ensaio.invalido', 'admin', 'cl_2']
]) {
  await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id) VALUES (?,?,?,?,?,?,?)',
    [id, nome, email, senha, papel, 'active', cl]);
}
await conn.query("INSERT INTO clients (id,name,phone,clinica_id) VALUES ('c1','Ana Paula','11911112222','cl_1')");
await conn.query("INSERT INTO treatment_catalog (id,name,price,duration,duration_min,clinica_id)" +
  " VALUES ('tc1','Ultraformer',1500,'90',90,'cl_1')");
// 120 horas produtivas para a conta sair redonda.
await conn.query("UPDATE pricing_settings SET monthly_working_hours = 120 WHERE clinica_id = 'cl_1'");
await conn.end();

const app = require('/home/claude/musa/server/app.js');
const servidor = app.listen(4196);
await new Promise((r) => servidor.on('listening', r));
const BASE = 'http://127.0.0.1:4196';

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
const pro = await entrar('pro@ensaio.invalido');
const ven = await entrar('ven@ensaio.invalido');
const viz = await entrar('viz@ensaio.invalido');

/** A data da sessao, sempre no futuro -- o ensaio nao pode quebrar amanha. */
const daquiA = (dias) => {
  const d = new Date(Date.now() + dias * 86400000);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
};

let insumoId = null, planoId = null;

console.log('\n[A] O CUSTO NASCE FIXO, COMO ANTES');
{
  const r = await chamar(adm, 'POST', '/api/fixed-costs', { name: 'Aluguel', monthlyAmount: 6000 });
  ok('o custo e criado', r.status, 201);
  /* Toda linha existente na migration 041 nasceu FIXO -- e o padrao de quem nao
     informa e o mesmo. Se fosse VARIAVEL, o custo por hora das 50 clinicas
     cairia a zero no dia do deploy. */
  ok('e nasce FIXO sem ninguem pedir', r.corpo.natureza, 'FIXO');

  const l = await chamar(adm, 'GET', '/api/fixed-costs');
  ok('o total mensal soma', l.corpo.totalMensal, 6000);
  ok('e o custo por hora sai', l.corpo.custoPorHora, 50);   // 6000 / 120
}

console.log('\n[B] O RECORRENTE NAO DIVIDE PELAS HORAS');
{
  const r = await chamar(adm, 'POST', '/api/fixed-costs',
    { name: 'Acido hialuronico', monthlyAmount: 4800, natureza: 'VARIAVEL' });
  insumoId = r.corpo.id;
  ok('ele e aceito e marcado', r.corpo.natureza, 'VARIAVEL');

  const l = await chamar(adm, 'GET', '/api/fixed-costs');
  /* ERA AQUI QUE O PRECO INFLAVA: com os dois somados, o custo por hora seria
     90 -- 80% a mais, por um insumo que a ficha tecnica ja cobra item a item. */
  ok('o custo por hora NAO muda', l.corpo.custoPorHora, 50);
  ok('mas o valor continua visivel', l.corpo.totalRecorrente, 4800);
  ok('e a lista mostra os dois', l.corpo.itens.length, 2);

  const p = await chamar(adm, 'GET', '/api/pricing/settings');
  ok('a precificacao usa a mesma conta', p.corpo.fixedCostHour, 50);
}

console.log('\n[C] RECLASSIFICAR MUDA O PRECO, E FICA NA TRILHA');
{
  await chamar(adm, 'PATCH', '/api/fixed-costs/' + insumoId, { natureza: 'FIXO' });
  const l = await chamar(adm, 'GET', '/api/fixed-costs');
  ok('o custo por hora sobe', l.corpo.custoPorHora, 90);    // 10800 / 120
  await chamar(adm, 'PATCH', '/api/fixed-costs/' + insumoId, { natureza: 'VARIAVEL' });
  ok('e volta', (await chamar(adm, 'GET', '/api/fixed-costs')).corpo.custoPorHora, 50);

  const c = await bd();
  const [g] = await c.query(
    "SELECT description FROM system_logs WHERE action_type = 'PRECIFICACAO'" +
    " AND description LIKE '%passou a ser%' ORDER BY created_at");
  await c.end();
  /* Seis meses depois, "por que o preco subiu?" tem resposta. */
  ok('as duas trocas ficaram registradas', g.length, 2);
}

console.log('\n[D] CUSTO INATIVO NAO ENTRA EM PRECO NENHUM');
{
  const l0 = await chamar(adm, 'GET', '/api/fixed-costs');
  const aluguel = l0.corpo.itens.filter((i) => i.name === 'Aluguel')[0];
  await chamar(adm, 'PATCH', '/api/fixed-costs/' + aluguel.id, { active: false });
  const l = await chamar(adm, 'GET', '/api/fixed-costs');
  ok('o custo por hora vai a zero', l.corpo.custoPorHora, 0);
  ok('mas a linha continua na lista', l.corpo.itens.length, 2);
  await chamar(adm, 'PATCH', '/api/fixed-costs/' + aluguel.id, { active: true });
  ok('e reativar devolve o numero', (await chamar(adm, 'GET', '/api/fixed-costs')).corpo.custoPorHora, 50);
}

console.log('\n[E] AS SESSOES PROGRAMADAS VIRAM HORARIO');
{
  const p = await chamar(adm, 'POST', '/api/treatment-plans', {
    clientId: 'c1', title: 'Protocolo Ultraformer', totalSessions: 4,
    periodicity: 'Semanal', startDate: daquiA(7)
  });
  ok('o plano e criado', p.status, 201);
  planoId = p.corpo.id;

  await chamar(adm, 'POST', '/api/treatment-plans/' + planoId + '/programar',
    { inicio: daquiA(7), periodicidade: 'Semanal' });

  const c0 = await bd();
  const [s0] = await c0.query(
    'SELECT session_number n, session_date FROM treatment_sessions WHERE plan_id = ? ORDER BY session_number',
    [planoId]);
  await c0.end();
  ok('as quatro sessoes ganharam data', s0.filter((x) => x.session_date).length, 4);
  /* PROGRAMAR NAO E AGENDAR: ate aqui a data vivia so na ficha. */
  ok('e a agenda continua vazia', (await chamar(adm, 'GET', '/api/appointments')).corpo.length, 0);

  const r = await chamar(adm, 'POST', '/api/treatment-plans/' + planoId + '/agendar',
    { hora: '09:00', professionalId: 'u_pro', catalogId: 'tc1' });
  ok('levar para a agenda passa', r.status, 200);
  ok('e as quatro entraram', r.corpo.criados, 4);
  ok('com a duracao do catalogo', r.corpo.duracaoMin, 90);

  const ag = await chamar(adm, 'GET', '/api/appointments');
  ok('a agenda passa a ter quatro compromissos', ag.corpo.length, 4);
  ok('o primeiro comeca as 9h', String(ag.corpo[0].startsAt).slice(11, 16), '09:00');
  ok('e termina as 10h30', String(ag.corpo[0].endsAt).slice(11, 16), '10:30');
  ok('com o nome do plano e o numero da sessao', /sessao 1/.test(ag.corpo[0].title), true);

  const c = await bd();
  const [s] = await c.query(
    "SELECT COUNT(*) n FROM treatment_sessions WHERE plan_id = ? AND appointment_id IS NOT NULL", [planoId]);
  const [st] = await c.query(
    "SELECT COUNT(*) n FROM treatment_sessions WHERE plan_id = ? AND status = 'AGENDADA'", [planoId]);
  await c.end();
  ok('as sessoes ficaram AMARRADAS aos compromissos', s[0].n, 4);
  ok('e passaram a AGENDADA', st[0].n, 4);
}

console.log('\n[F] CLICAR DE NOVO NAO DUPLICA A AGENDA');
{
  const r = await chamar(adm, 'POST', '/api/treatment-plans/' + planoId + '/agendar',
    { hora: '09:00', professionalId: 'u_pro', catalogId: 'tc1' });
  ok('nada novo e criado', r.corpo.criados, 0);
  ok('e as quatro sao puladas', r.corpo.pulados.length, 4);
  ok('dizendo por que', r.corpo.pulados[0].porque, 'já está na agenda');
  ok('a agenda continua com quatro', (await chamar(adm, 'GET', '/api/appointments')).corpo.length, 4);
}

console.log('\n[G] HORARIO OCUPADO E DITO, NAO EMPURRADO');
{
  const p = await chamar(adm, 'POST', '/api/treatment-plans', {
    clientId: 'c1', title: 'Segundo protocolo', totalSessions: 2,
    periodicity: 'Semanal', startDate: daquiA(7)
  });
  await chamar(adm, 'POST', '/api/treatment-plans/' + p.corpo.id + '/programar',
    { inicio: daquiA(7), periodicidade: 'Semanal' });

  const r = await chamar(adm, 'POST', '/api/treatment-plans/' + p.corpo.id + '/agendar',
    { hora: '09:00', professionalId: 'u_pro', duracaoMin: 60 });
  /* As duas datas batem com as do primeiro plano, na mesma hora e com a mesma
     profissional. Nenhuma entra -- e a resposta diz o dia de cada uma. */
  ok('nenhuma entra', r.corpo.criados, 0);
  ok('e as duas sao relatadas como conflito', r.corpo.conflitos.length, 2);
  ok('com a data', /^\d{4}-\d{2}-\d{2}$/.test(r.corpo.conflitos[0].dia), true);
  ok('e o nome do que ja estava la', /sessao/.test(r.corpo.conflitos[0].porque), true);

  // Em outro horario, elas entram.
  const r2 = await chamar(adm, 'POST', '/api/treatment-plans/' + p.corpo.id + '/agendar',
    { hora: '15:00', professionalId: 'u_pro', duracaoMin: 60 });
  ok('e em horario livre elas entram', r2.corpo.criados, 2);
}

console.log('\n[H] O CICLO FECHA: CONCLUIR O ATENDIMENTO MARCA A SESSAO');
{
  const ag = await chamar(adm, 'GET', '/api/appointments');
  const primeiro = ag.corpo.filter((a) => /Protocolo Ultraformer/.test(a.title))[0];
  const r = await chamar(adm, 'PATCH', '/api/appointments/' + primeiro.id + '/status',
    { status: 'REALIZADO' });
  ok('o atendimento e concluido', r.status, 200);

  const c = await bd();
  const [s] = await c.query(
    'SELECT status FROM treatment_sessions WHERE appointment_id = ?', [primeiro.id]);
  await c.end();
  /* Este vinculo ja era LIDO desde antes; o que faltava era alguem escreve-lo.
     Agora a sessao da ficha e o horario da agenda sao a mesma coisa. */
  ok('e a sessao da ficha vira REALIZADA sozinha', s[0].status, 'REALIZADA');
}

console.log('\n[I] QUEM PODE LEVAR PARA A AGENDA');
{
  /* Criar compromisso saiu do vendedor na M5.2. Sem regra de papel, esta rota
     seria a porta dos fundos daquela decisao -- e marcaria DEZ de uma vez. */
  const p = await chamar(adm, 'POST', '/api/treatment-plans', {
    clientId: 'c1', title: 'Terceiro', totalSessions: 1, startDate: daquiA(30) });
  await chamar(adm, 'POST', '/api/treatment-plans/' + p.corpo.id + '/programar',
    { inicio: daquiA(30), periodicidade: 'Semanal' });

  ok('o vendedor nao leva para a agenda',
    (await chamar(ven, 'POST', '/api/treatment-plans/' + p.corpo.id + '/agendar',
      { hora: '11:00', professionalId: 'u_pro', duracaoMin: 60 })).status, 403);
  ok('mas continua criando plano',
    (await chamar(ven, 'POST', '/api/treatment-plans',
      { clientId: 'c1', title: 'Vendido', totalSessions: 1 })).status, 201);
  ok('e a profissional leva',
    (await chamar(pro, 'POST', '/api/treatment-plans/' + p.corpo.id + '/agendar',
      { hora: '11:00', professionalId: 'u_pro', duracaoMin: 60 })).corpo.criados, 1);
}

console.log('\n[J] A CLINICA VIZINHA');
{
  ok('nao agenda o nosso plano',
    (await chamar(viz, 'POST', '/api/treatment-plans/' + planoId + '/agendar',
      { hora: '08:00', professionalId: 'u_pro', duracaoMin: 60 })).status, 404);
  ok('e nao ve os nossos custos',
    (await chamar(viz, 'GET', '/api/fixed-costs')).corpo.itens.length, 0);
  ok('nem o profissional daqui serve para o plano dela',
    (await chamar(viz, 'POST', '/api/treatment-plans/' + planoId + '/agendar',
      { hora: '08:00', professionalId: 'u_viz', duracaoMin: 60 })).status, 404);
}

console.log('\n[K] SERVICO SEM DURACAO ENTENDIDA E RECUSA, E NAO CHUTE');
{
  const c = await bd();
  await c.query("INSERT INTO treatment_catalog (id,name,price,duration,duration_min,clinica_id)" +
    " VALUES ('tc_velho','Peeling Herdado',300,'40 a 60 minutos',NULL,'cl_1')");
  await c.end();
  const p = await chamar(adm, 'POST', '/api/treatment-plans', {
    clientId: 'c1', title: 'Herdado', totalSessions: 1, startDate: daquiA(45) });
  await chamar(adm, 'POST', '/api/treatment-plans/' + p.corpo.id + '/programar',
    { inicio: daquiA(45), periodicidade: 'Semanal' });
  const r = await chamar(adm, 'POST', '/api/treatment-plans/' + p.corpo.id + '/agendar',
    { hora: '16:00', professionalId: 'u_pro', catalogId: 'tc_velho' });
  /* Chutar 60 minutos marcaria a agenda errada para um procedimento que pode
     durar o dobro -- e ninguem saberia por que a tarde atrasou. */
  ok('recusa com 400', r.status, 400);
  ok('dizendo onde corrigir', /Cadastros/.test(r.corpo.error || ''), true);
}

const passaram = conf.filter(Boolean).length;
console.log('\n====================================================');
console.log('  ' + passaram + ' de ' + conf.length + ' conferencias passaram');
console.log('====================================================\n');
servidor.close();
process.exit(passaram === conf.length ? 0 : 1);

/** Ensaio da M5.12: as datas do plano, contra banco e servidor reais. */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { createRequire } from 'module';
const require = createRequire('/home/claude/musa/');

const H = '127.0.0.1', P = 3307, U = 'musa', S = 'ensaio-local', B = 'musa_m512';
const raiz = await mysql.createConnection({ host: H, port: P, user: U, password: S, multipleStatements: true });
await raiz.query('DROP DATABASE IF EXISTS ' + B);
await raiz.query('CREATE DATABASE ' + B);
await raiz.end();

process.env.DB_HOST = H; process.env.DB_PORT = String(P); process.env.DB_USER = U;
process.env.DB_PASSWORD = S; process.env.DB_NAME = B;
process.env.JWT_SECRET = 'repro-m512'; process.env.GEMINI_API_KEY = 'falsa';

const conn = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B, multipleStatements: true });
await require('/home/claude/musa/db/run-migrations.js')(conn, {});
await conn.query("INSERT IGNORE INTO clinicas (id, nome) VALUES ('cl_2', 'Clinica Vizinha')");
const senha = bcrypt.hashSync('SenhaDeEnsaio2026', 10);
for (const [id, nome, email, papel, cl] of [
  ['u_adm', 'Admin', 'adm@ensaio.invalido', 'admin', 'cl_1'],
  ['u_viz', 'Vizinha', 'viz@ensaio.invalido', 'admin', 'cl_2']
]) {
  await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id) VALUES (?,?,?,?,?,?,?)',
    [id, nome, email, senha, papel, 'active', cl]);
}
await conn.query("INSERT INTO clients (id,name,phone,clinica_id) VALUES ('c1','Ana','11998765432','cl_1')");
await conn.end();

const app = require('/home/claude/musa/server/app.js');
const servidor = app.listen(4187);
await new Promise((r) => servidor.on('listening', r));
const BASE = 'http://127.0.0.1:4187';

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
const datasDoPlano = async (id) => {
  const c = await bd();
  const [r] = await c.query(
    'SELECT session_number n, status, DATE_FORMAT(session_date, "%Y-%m-%d") d' +
    ' FROM treatment_sessions WHERE plan_id = ? ORDER BY session_number', [id]);
  await c.end();
  return r;
};

const conf = [];
const ok = (nome, real, esperado) => {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  conf.push(passou);
  console.log((passou ? '  OK  ' : '  XX  ') + nome +
    (passou ? '' : '   esperado ' + JSON.stringify(esperado) + ', veio ' + JSON.stringify(real)));
};

const adm = await entrar('adm@ensaio.invalido');
const viz = await entrar('viz@ensaio.invalido');

let plano10 = null;

console.log('\n[A] PLANO DE 10 SESSOES JA NASCE COM AS DEZ DATAS');
{
  const r = await chamar(adm, 'POST', '/api/treatment-plans', {
    clientId: 'c1', title: 'Protocolo Facial', totalSessions: 10,
    periodicity: 'Quinzenal', startDate: '2026-09-21', sessionPrice: 500
  });
  ok('o plano e criado', r.status, 201);
  plano10 = r.corpo.id;
  ok('e a resposta diz que as dez foram programadas', r.corpo.programacao.programadas, 10);
  ok('sem erro', r.corpo.programacao.erro, null);

  const s = await datasDoPlano(plano10);
  /* Ate a M5.12 estas dez linhas nasciam com session_date NULL -- e o
     formulario JA tinha perguntado a data de inicio e a periodicidade. */
  ok('nenhuma sessao ficou sem data', s.filter((x) => !x.d).length, 0);
  ok('a primeira e a data informada', s[0].d, '2026-09-21');
  ok('a segunda, 14 dias depois', s[1].d, '2026-10-05');
  ok('e a decima fecha o ciclo', s[9].d, '2027-01-25');
}

console.log('\n[B] MENSAL COMECANDO EM 31');
{
  const r = await chamar(adm, 'POST', '/api/treatment-plans', {
    clientId: 'c1', title: 'Mensal', totalSessions: 4,
    periodicity: 'Mensal', startDate: '2026-01-31'
  });
  const s = await datasDoPlano(r.corpo.id);
  /* Encadear a partir de 28/02 daria 28/03: o plano escorrega para tras e cada
     data, sozinha, continua parecendo certa. */
  ok('ancora no dia do mes, e nao na data encurtada',
    s.map((x) => x.d), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
}

console.log('\n[C] QUANDO NAO DA PARA PROGRAMAR, O PLANO AINDA NASCE');
{
  // Sem data de inicio: o motivo tem de falar da DATA, e nao do intervalo.
  const semData = await chamar(adm, 'POST', '/api/treatment-plans', {
    clientId: 'c1', title: 'Sem data', totalSessions: 3, periodicity: 'Quinzenal'
  });
  ok('plano sem data de inicio ainda e criado', semData.status, 201);
  ok('e o motivo fala da data que falta',
    /data da primeira sess/i.test(semData.corpo.programacao.erro || ''), true);

  // Com data, mas periodicidade que precisa de intervalo: o motivo muda.
  const r = await chamar(adm, 'POST', '/api/treatment-plans', {
    clientId: 'c1', title: 'Sem intervalo', totalSessions: 3,
    periodicity: 'Customizado', startDate: '2026-09-21'
  });
  ok('o plano e criado assim mesmo', r.status, 201);
  ok('e agora o motivo fala do intervalo',
    /de quantos em quantos dias/.test(r.corpo.programacao.erro || ''), true);
  const s = await datasDoPlano(r.corpo.id);
  ok('e as sessoes nascem sem data, como antes', s.filter((x) => x.d).length, 0);
  /* O plano TEM de ser criado: recusar por causa da data deixaria a recepcao
     sem plano nenhum por um detalhe de calendario. */
  ok('com as tres sessoes no lugar', s.length, 3);
}

console.log('\n[D] PROGRAMAR UM PLANO QUE JA EXISTIA');
{
  const r = await chamar(adm, 'POST', '/api/treatment-plans', {
    clientId: 'c1', title: 'Antigo', totalSessions: 5, periodicity: 'Customizado'
  });
  const id = r.corpo.id;

  const p = await chamar(adm, 'POST', '/api/treatment-plans/' + id + '/programar',
    { inicio: '2026-10-01', periodicidade: 'Semanal' });
  ok('a programacao passa', p.status, 200);
  ok('as cinco entram', p.corpo.programadas, 5);
  ok('nenhuma preservada, porque nenhuma aconteceu', p.corpo.preservadas, 0);

  const s = await datasDoPlano(id);
  ok('e as datas ficam de 7 em 7',
    s.map((x) => x.d),
    ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29']);

  const c = await bd();
  const [pl] = await c.query('SELECT periodicity, DATE_FORMAT(start_date,"%Y-%m-%d") d FROM treatment_plans WHERE id = ?', [id]);
  await c.end();
  ok('o plano passa a contar a verdade sobre o proprio ritmo',
    [pl[0].periodicity, pl[0].d], ['Semanal', '2026-10-01']);
}

console.log('\n[E] O QUE JA ACONTECEU NAO E REPROGRAMADO');
{
  const r = await chamar(adm, 'POST', '/api/treatment-plans', {
    clientId: 'c1', title: 'Em andamento', totalSessions: 5,
    periodicity: 'Semanal', startDate: '2026-03-02'
  });
  const id = r.corpo.id;

  const c = await bd();
  await c.query("UPDATE treatment_sessions SET status = 'REALIZADA' WHERE plan_id = ? AND session_number = 1", [id]);
  await c.query("UPDATE treatment_sessions SET status = 'FALTOU' WHERE plan_id = ? AND session_number = 2", [id]);
  await c.end();

  const p = await chamar(adm, 'POST', '/api/treatment-plans/' + id + '/programar',
    { inicio: '2026-06-01', periodicidade: 'Mensal' });

  ok('so as tres pendentes sao movidas', p.corpo.programadas, 3);
  ok('e as duas do passado sao contadas como preservadas', p.corpo.preservadas, 2);

  const s = await datasDoPlano(id);
  /* A data de uma sessao REALIZADA e' o dia em que a paciente esteve aqui.
     Reescreve-la ao mudar o ritmo do que ainda vem e' falsificar prontuario. */
  ok('a sessao realizada continua em marco', s[0].d, '2026-03-02');
  ok('a que a paciente faltou tambem', s[1].d, '2026-03-09');
  /* A 3a sessao pega a 3a data do ritmo novo -- e nao a 1a. Recomecar a contagem
     na primeira pendente encavalaria o plano por cima do que ja foi feito. */
  ok('e a 3a recebe a TERCEIRA data do ritmo novo', s[2].d, '2026-08-01');
  ok('seguida da quarta e da quinta', [s[3].d, s[4].d], ['2026-09-01', '2026-10-01']);
}

console.log('\n[F] O DOMINGO E AVISADO, NUNCA MOVIDO');
{
  const r = await chamar(adm, 'POST', '/api/treatment-plans', {
    clientId: 'c1', title: 'Domingo', totalSessions: 3,
    periodicity: 'Semanal', startDate: '2026-09-20'
  });
  ok('as datas ficam no domingo mesmo',
    (await datasDoPlano(r.corpo.id)).map((x) => x.d),
    ['2026-09-20', '2026-09-27', '2026-10-04']);
  ok('e a tela recebe o aviso', /caem em domingo/.test((r.corpo.programacao.avisos || []).join(' ')), true);
  /* O sistema nao sabe em que dias esta clinica abre -- isso nao esta cadastrado
     em lugar nenhum. Empurrar sozinho seria inventar. */
}

console.log('\n[G] A CLINICA VIZINHA');
{
  ok('nao programa plano daqui',
    (await chamar(viz, 'POST', '/api/treatment-plans/' + plano10 + '/programar',
      { inicio: '2030-01-07', periodicidade: 'Semanal' })).status, 404);
  const s = await datasDoPlano(plano10);
  ok('e as datas continuam as nossas', s[0].d, '2026-09-21');
  ok('sem sessao, nada',
    (await fetch(BASE + '/api/treatment-plans/' + plano10 + '/programar', { method: 'POST' })).status, 401);
}

console.log('\n[H] RECUSA COM MOTIVO');
{
  ok('data invalida e recusada',
    (await chamar(adm, 'POST', '/api/treatment-plans/' + plano10 + '/programar',
      { inicio: '2026-02-31', periodicidade: 'Semanal' })).status, 400);
  const r = await chamar(adm, 'POST', '/api/treatment-plans/' + plano10 + '/programar',
    { inicio: '2026-10-01', periodicidade: 'Customizado' });
  ok('e customizado sem intervalo diz o que falta',
    /de quantos em quantos dias/.test(r.corpo.error || ''), true);
  const s = await datasDoPlano(plano10);
  ok('nada foi gravado no meio do caminho', s[0].d, '2026-09-21');
}

const passaram = conf.filter(Boolean).length;
console.log('\n====================================================');
console.log('  ' + passaram + ' de ' + conf.length + ' conferencias passaram');
console.log('====================================================\n');
servidor.close();
process.exit(passaram === conf.length ? 0 : 1);

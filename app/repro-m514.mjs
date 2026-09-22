/** Ensaio da M5.14: a duração do serviço, do cadastro até a agenda.
 *
 *  O bloco [D] é o que amarra a tarefa inteira: prova que a duração corrigida
 *  em Cadastros chega ao tamanho do compromisso na Agenda. Era exatamente essa
 *  ponte que estava rompida.
 */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { createRequire } from 'module';
const require = createRequire('/home/claude/musa/');

const H = '127.0.0.1', P = 3307, U = 'musa', S = 'ensaio-local', B = 'musa_m514';
const raiz = await mysql.createConnection({ host: H, port: P, user: U, password: S, multipleStatements: true });
await raiz.query('DROP DATABASE IF EXISTS ' + B);
await raiz.query('CREATE DATABASE ' + B);
await raiz.end();

process.env.DB_HOST = H; process.env.DB_PORT = String(P); process.env.DB_USER = U;
process.env.DB_PASSWORD = S; process.env.DB_NAME = B; process.env.JWT_SECRET = 'repro-m514';

const conn = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B, multipleStatements: true });
await require('/home/claude/musa/db/run-migrations.js')(conn, {});
await conn.query("INSERT IGNORE INTO clinicas (id, nome) VALUES ('cl_2', 'Clinica Vizinha')");
const senha = bcrypt.hashSync('SenhaDeEnsaio2026', 10);
for (const [id, nome, email, papel, cl] of [
  ['u_adm', 'Admin', 'adm@ensaio.invalido', 'admin', 'cl_1'],
  ['u_pro', 'Dra Carla', 'pro@ensaio.invalido', 'profissional', 'cl_1'],
  ['u_viz', 'Vizinha', 'viz@ensaio.invalido', 'admin', 'cl_2']
]) {
  await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id) VALUES (?,?,?,?,?,?,?)',
    [id, nome, email, senha, papel, 'active', cl]);
}
await conn.query("INSERT INTO clients (id,name,phone,clinica_id) VALUES ('c1','Ana','11998765432','cl_1')");
// O servico HERDADO, com a duracao em texto de faixa -- o caso que a migration
// 007 cita e deixou sem `duration_min`.
await conn.query(
  "INSERT INTO treatment_catalog (id,name,price,duration,duration_min,clinica_id)" +
  " VALUES ('tc_velho','Peeling Herdado',300,'40 a 60 minutos',NULL,'cl_1')");
await conn.end();

const app = require('/home/claude/musa/server/app.js');
const servidor = app.listen(4191);
await new Promise((r) => servidor.on('listening', r));
const BASE = 'http://127.0.0.1:4191';

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
const servico = async (id) => {
  const c = await bd();
  const [r] = await c.query('SELECT duration, duration_min FROM treatment_catalog WHERE id = ?', [id]);
  await c.end();
  return r[0];
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
let novo = null;

console.log('\n[A] SERVICO NOVO JA NASCE COM OS MINUTOS');
{
  const r = await chamar(adm, 'POST', '/api/treatment-catalog',
    { name: 'Ultraformer', price: 1500, duration: '90' });
  ok('o servico e criado', r.status, 201);
  novo = r.corpo.id;
  ok('e a resposta diz os minutos entendidos', r.corpo.durationMin, 90);
  ok('e que entendeu', r.corpo.duracaoEntendida, true);
  /* Ate 22/09 esta coluna nascia NULL e SO era preenchida se alguem salvasse
     uma simulacao de preco. Sem ela, a Agenda nao sabe quanto tempo reservar. */
  ok('o banco guardou os dois campos', await servico(novo), { duration: '90', duration_min: 90 });
}

console.log('\n[B] O DEFEITO: editar a duracao deixava a agenda com o valor velho');
{
  await chamar(adm, 'PATCH', '/api/treatment-catalog/' + novo, { duration: '45' });
  const s = await servico(novo);
  ok('o texto mudou', s.duration, '45');
  /* Antes, `duration_min` continuava 90: a tela de Cadastros mostrava 45 e a
     Agenda marcava 90. Duas telas, dois numeros, nenhum aviso. */
  ok('E OS MINUTOS TAMBEM', s.duration_min, 45);
  ok('nao ficou com o valor antigo', s.duration_min !== 90, true);
}

console.log('\n[C] O QUE NAO DA PARA ENTENDER E DITO, NAO CHUTADO');
{
  const r = await chamar(adm, 'PATCH', '/api/treatment-catalog/tc_velho',
    { duration: '40 a 60 minutos' });
  ok('a gravacao passa', r.status, 200);
  ok('mas a tela recebe que nao foi entendida', r.corpo.duracaoEntendida, false);
  const s = await servico('tc_velho');
  ok('o texto e preservado como veio', s.duration, '40 a 60 minutos');
  /* Escolher 40 ou 60 seria marcar o horario de alguem por adivinhacao. */
  ok('e os minutos ficam vazios, em vez de chutados', s.duration_min, null);

  const h = await chamar(adm, 'POST', '/api/treatment-catalog',
    { name: 'Com hora', price: 100, duration: '1h30' });
  ok('mas "1h30" ele entende', h.corpo.durationMin, 90);
}

console.log('\n[D] A DURACAO CHEGA NA AGENDA');
{
  const r = await chamar(adm, 'POST', '/api/appointments', {
    clientId: 'c1', catalogId: novo, professionalId: 'u_pro',
    startsAt: '2026-10-05 09:00:00', kind: 'ATENDIMENTO'
  });
  ok('o compromisso e criado sem informar o fim', r.status, 201);

  const c = await bd();
  const [a] = await c.query(
    'SELECT DATE_FORMAT(starts_at,"%H:%i") i, DATE_FORMAT(ends_at,"%H:%i") f FROM appointments');
  await c.end();
  /* 45 minutos: a duracao que a recepcao acabou de corrigir em Cadastros. Antes
     desta tarefa, a agenda usaria 90 -- o valor que ninguem mais via na tela. */
  ok('e o fim sai da duracao ATUAL do servico', [a[0].i, a[0].f], ['09:00', '09:45']);
}

console.log('\n[E] PATCH SEM DURACAO NAO MEXE NA DURACAO');
{
  await chamar(adm, 'PATCH', '/api/treatment-catalog/' + novo, { price: 1800 });
  const s = await servico(novo);
  ok('os minutos continuam os mesmos', s.duration_min, 45);
  ok('e o texto tambem', s.duration, '45');
}

console.log('\n[F] A CLINICA VIZINHA');
{
  ok('nao edita o servico daqui',
    (await chamar(viz, 'PATCH', '/api/treatment-catalog/' + novo, { duration: '600' })).status, 404);
  ok('e a duracao continua a nossa', (await servico(novo)).duration_min, 45);
}

const passaram = conf.filter(Boolean).length;
console.log('\n====================================================');
console.log('  ' + passaram + ' de ' + conf.length + ' conferencias passaram');
console.log('====================================================\n');
servidor.close();
process.exit(passaram === conf.length ? 0 : 1);

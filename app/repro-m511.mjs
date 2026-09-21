/** Ensaio da M5.11: o cadastro de equipamentos, contra banco e servidor reais. */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { createRequire } from 'module';
const require = createRequire('/home/claude/musa/');

const H = '127.0.0.1', P = 3307, U = 'musa', S = 'ensaio-local', B = 'musa_m511';
const raiz = await mysql.createConnection({ host: H, port: P, user: U, password: S, multipleStatements: true });
await raiz.query('DROP DATABASE IF EXISTS ' + B);
await raiz.query('CREATE DATABASE ' + B);
await raiz.end();

process.env.DB_HOST = H; process.env.DB_PORT = String(P); process.env.DB_USER = U;
process.env.DB_PASSWORD = S; process.env.DB_NAME = B;
process.env.JWT_SECRET = 'repro-m511'; process.env.GEMINI_API_KEY = 'falsa';

const conn = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B, multipleStatements: true });
await require('/home/claude/musa/db/run-migrations.js')(conn, {});
await conn.query("INSERT IGNORE INTO clinicas (id, nome) VALUES ('cl_2', 'Clinica Vizinha')");
const senha = bcrypt.hashSync('SenhaDeEnsaio2026', 10);
for (const [id, nome, email, papel, cl, situacao] of [
  ['u_adm', 'Admin', 'adm@ensaio.invalido', 'admin', 'cl_1', 'active'],
  ['u_ger', 'Gerente', 'ger@ensaio.invalido', 'gerente', 'cl_1', 'active'],
  ['u_pro', 'Dra Carla', 'pro@ensaio.invalido', 'profissional', 'cl_1', 'active'],
  ['u_ven', 'Vendedor', 'ven@ensaio.invalido', 'vendedor', 'cl_1', 'active'],
  ['u_old', 'Dra Antiga', 'old@ensaio.invalido', 'profissional', 'cl_1', 'inactive'],
  ['u_viz', 'Vizinha', 'viz@ensaio.invalido', 'admin', 'cl_2', 'active']
]) {
  await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id) VALUES (?,?,?,?,?,?,?)',
    [id, nome, email, senha, papel, situacao, cl]);
}
await conn.query("INSERT INTO clients (id,name,phone,clinica_id) VALUES ('c1','Ana','11998765432','cl_1')");
await conn.query("INSERT INTO treatment_plans (id,client_id,title,total_sessions,clinica_id)" +
  " VALUES ('p1','c1','Plano',3,'cl_1')");
await conn.end();

const app = require('/home/claude/musa/server/app.js');
const servidor = app.listen(4185);
await new Promise((r) => servidor.on('listening', r));
const BASE = 'http://127.0.0.1:4185';

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
const ger = await entrar('ger@ensaio.invalido');
const pro = await entrar('pro@ensaio.invalido');
const ven = await entrar('ven@ensaio.invalido');
const viz = await entrar('viz@ensaio.invalido');

let idUltra = null;

console.log('\n[A] A CLINICA COMECA SEM EQUIPAMENTO NENHUM');
{
  const r = await chamar(pro, 'GET', '/api/equipments');
  ok('a lista responde', r.status, 200);
  /* Vazia de proposito: semear "Ultraformer" nas 50 clinicas poria na tela de
     cada uma um aparelho que ela talvez nao tenha. */
  ok('e vem vazia', r.corpo, []);
}

console.log('\n[B] CADASTRAR');
{
  const r = await chamar(ger, 'POST', '/api/equipments', { name: 'Ultraformer MPT' });
  ok('a gerente cadastra', r.status, 201);
  idUltra = r.corpo.id;
  ok('e ele ja nasce ativo', r.corpo.active, 1);

  ok('o mesmo nome de novo e recusado',
    (await chamar(ger, 'POST', '/api/equipments', { name: 'Ultraformer MPT' })).status, 409);
  ok('e com outra caixa de letra tambem seria o mesmo cadastro',
    (await chamar(ger, 'POST', '/api/equipments', { name: 'ultraformer mpt' })).status, 409);
  ok('nome vazio e recusado',
    (await chamar(ger, 'POST', '/api/equipments', { name: '   ' })).status, 400);

  await chamar(ger, 'POST', '/api/equipments', { name: 'Lavien BB Laser' });
  const lista = await chamar(pro, 'GET', '/api/equipments');
  ok('a profissional ve os dois, em ordem',
    lista.corpo.map((e) => e.name), ['Lavien BB Laser', 'Ultraformer MPT']);
}

console.log('\n[C] QUEM CADASTRA E QUEM SO ESCOLHE');
{
  ok('a profissional NAO cadastra',
    (await chamar(pro, 'POST', '/api/equipments', { name: 'Proibido' })).status, 403);
  ok('nem renomeia',
    (await chamar(pro, 'PATCH', '/api/equipments/' + idUltra, { name: 'X' })).status, 403);
  ok('nem inativa',
    (await chamar(pro, 'DELETE', '/api/equipments/' + idUltra)).status, 403);
  /* Mas LE -- e isso e' deliberado: sem a lista o campo da sessao voltaria a
     ser texto digitado, que e' o que esta tarefa veio desfazer. */
  ok('mas LE a lista', (await chamar(pro, 'GET', '/api/equipments')).status, 200);
  ok('o vendedor tambem le', (await chamar(ven, 'GET', '/api/equipments')).status, 200);
  ok('sem sessao, nada', (await fetch(BASE + '/api/equipments')).status, 401);
}

console.log('\n[D] INATIVAR NAO APAGA O PASSADO');
{
  const c = await bd();
  await c.query("INSERT INTO treatment_sessions (id,plan_id,session_number,session_type,status," +
    "equipments_used,clinica_id) VALUES ('s1','p1',1,'SESSAO_TRATAMENTO','REALIZADA'," +
    "'Ultraformer MPT','cl_1')");
  await c.end();

  ok('inativar passa', (await chamar(ger, 'DELETE', '/api/equipments/' + idUltra)).status, 200);

  const lista = await chamar(pro, 'GET', '/api/equipments');
  ok('e ele some da lista de escolha', lista.corpo.map((e) => e.name), ['Lavien BB Laser']);

  const todos = await chamar(ger, 'GET', '/api/equipments?todos=1');
  ok('mas continua existindo, para poder ser reativado', todos.corpo.length, 2);

  const c2 = await bd();
  const [sess] = await c2.query("SELECT equipments_used FROM treatment_sessions WHERE id = 's1'");
  const [linha] = await c2.query('SELECT COUNT(*) n FROM equipments');
  await c2.end();
  /* O ponto do bloco: prontuario que perde o "com o que" perde justamente a
     parte que interessa se alguem precisar responder por aquele atendimento. */
  ok('a sessao de marco continua dizendo com o que foi feita',
    sess[0].equipments_used, 'Ultraformer MPT');
  ok('e nenhuma linha foi apagada do cadastro', linha[0].n, 2);

  ok('reativar volta para a lista',
    (await chamar(ger, 'PATCH', '/api/equipments/' + idUltra, { active: true })).status, 200);
  ok('e ele reaparece', (await chamar(pro, 'GET', '/api/equipments')).corpo.length, 2);
}

console.log('\n[E] A CLINICA VIZINHA');
{
  ok('nao ve os equipamentos daqui', (await chamar(viz, 'GET', '/api/equipments')).corpo, []);
  ok('nao renomeia o daqui',
    (await chamar(viz, 'PATCH', '/api/equipments/' + idUltra, { name: 'Invadido' })).status, 404);
  ok('nem inativa',
    (await chamar(viz, 'DELETE', '/api/equipments/' + idUltra)).status, 404);
  /* Duas clinicas PODEM ter o mesmo Ultraformer: a unicidade e' (clinica, nome),
     e nao (nome). Sem isso, a segunda clinica a cadastrar veria "ja existe"
     olhando uma lista onde nao existe. */
  ok('e cadastra o Ultraformer dela, com o mesmo nome',
    (await chamar(viz, 'POST', '/api/equipments', { name: 'Ultraformer MPT' })).status, 201);

  const c = await bd();
  const [r] = await c.query("SELECT clinica_id FROM equipments WHERE name = 'Ultraformer MPT' ORDER BY clinica_id");
  await c.end();
  ok('sao duas linhas, uma por clinica', r.map((x) => x.clinica_id), ['cl_1', 'cl_2']);
}

console.log('\n[F] A LISTA DE QUEM ATENDE');
{
  const r = await chamar(pro, 'GET', '/api/profissionais');
  ok('a profissional le a lista', r.status, 200);
  ok('sem o vendedor e sem quem esta inativo',
    r.corpo.map((u) => u.name).sort(), ['Admin', 'Dra Carla', 'Gerente']);
  /* Ela existe para NAO abrir /api/users, que e' de admin e devolve e-mail,
     papel, ultimo acesso e registro de conselho. */
  ok('e ela nao devolve e-mail nem papel',
    Object.keys(r.corpo[0]).sort(), ['funcao', 'id', 'name']);
  ok('o cadastro completo segue so para o admin',
    (await chamar(pro, 'GET', '/api/users')).status, 403);
  ok('e o admin continua lendo o completo',
    (await chamar(adm, 'GET', '/api/users')).status, 200);
  ok('a vizinha nao ve gente daqui',
    (await chamar(viz, 'GET', '/api/profissionais')).corpo.map((u) => u.name), ['Vizinha']);
}

const passaram = conf.filter(Boolean).length;
console.log('\n====================================================');
console.log('  ' + passaram + ' de ' + conf.length + ' conferencias passaram');
console.log('====================================================\n');
servidor.close();
process.exit(passaram === conf.length ? 0 : 1);

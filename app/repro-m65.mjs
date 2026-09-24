/** Ensaio da M6.5: a ficha da paciente deixa de sumir sozinha.
 *
 *  O bloco [B] é o que amarra a tarefa: com o comportamento antigo, apagar a
 *  paciente levava junto o TERMO ASSINADO dela e deixava a conversa e o
 *  dinheiro apontando para o vazio. Aqui isso é medido nas duas pontas.
 */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { createRequire } from 'module';
const require = createRequire('/home/claude/musa/');

const H = '127.0.0.1', P = 3307, U = 'musa', S = 'ensaio-local', B = 'musa_m65';
const raiz = await mysql.createConnection({ host: H, port: P, user: U, password: S, multipleStatements: true });
await raiz.query('DROP DATABASE IF EXISTS ' + B);
await raiz.query('CREATE DATABASE ' + B);
await raiz.end();

process.env.DB_HOST = H; process.env.DB_PORT = String(P); process.env.DB_USER = U;
process.env.DB_PASSWORD = S; process.env.DB_NAME = B; process.env.JWT_SECRET = 'repro-m65';

const conn = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B, multipleStatements: true });
const relatorio = await require('/home/claude/musa/db/run-migrations.js')(conn, {});
await conn.query("INSERT IGNORE INTO clinicas (id, nome) VALUES ('cl_2', 'Clinica Vizinha')");
const senha = bcrypt.hashSync('SenhaDeEnsaio2026', 10);
for (const [id, nome, email, cl] of [
  ['u_adm', 'Dra Musa', 'adm@ensaio.invalido', 'cl_1'],
  ['u_viz', 'Vizinha', 'viz@ensaio.invalido', 'cl_2']
]) {
  await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id) VALUES (?,?,?,?,?,?,?)',
    [id, nome, email, senha, 'admin', 'active', cl]);
}
/* DUAS pacientes: uma com prontuário inteiro, outra recém-criada e vazia --
   a duplicata que a recepção precisa conseguir apagar. */
await conn.query("INSERT INTO clients (id,name,phone,clinica_id) VALUES" +
  " ('c_cheia','Ana Paula','11911112222','cl_1')," +
  " ('c_vazia','Ana Paula (duplicada)','11911112222','cl_1')," +
  " ('cv','Vizinha Paciente','11933334444','cl_2')");
await conn.end();

const app = require('/home/claude/musa/server/app.js');
const servidor = app.listen(4201);
await new Promise((r) => servidor.on('listening', r));
const BASE = 'http://127.0.0.1:4201';

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
const viz = await entrar('viz@ensaio.invalido');

console.log('\n[A] A MIGRATION TROCOU A REGRA, E NAO APAGOU NADA');
{
  const r = relatorio && relatorio.relatorios && relatorio.relatorios['042_a_ficha_nao_some_sozinha.js'];
  ok('a 042 rodou', !!r, true);
  ok('quatro chaves deixaram de cascatear', r.trocadas.length, 4);
  ok('e a agenda ganhou a dela', r.criadas.length, 1);
  ok('nada foi apagado', /nao apaga linha nenhuma/.test(r.apagou), true);

  const c = await bd();
  const [regras] = await c.query(
    "SELECT CONSTRAINT_NAME n, DELETE_RULE d FROM information_schema.REFERENTIAL_CONSTRAINTS" +
    " WHERE CONSTRAINT_SCHEMA = ? AND REFERENCED_TABLE_NAME = 'clients'", [B]);
  await c.end();
  const cascata = regras.filter((x) => x.d === 'CASCADE');
  /* ERA AQUI QUE O TERMO ASSINADO SUMIA: quatro chaves com ON DELETE CASCADE
     saindo de `clients`. */
  ok('nenhuma chave de clients cascateia mais', cascata.length, 0);
  ok('e a agenda tambem recusa',
    regras.filter((x) => x.n === 'fk_appointments_client_id_clinica' && x.d === 'RESTRICT').length, 1);
}

console.log('\n[B] A FICHA COM PRONTUARIO NAO E APAGADA');
{
  // Um termo assinado, um plano com sessao, uma conversa e uma receita.
  const c = await bd();
  await c.query("INSERT INTO client_documents (id, client_id, type, title, answers_json, status, clinica_id)" +
    " VALUES ('d1','c_cheia','TERMO_CONSENTIMENTO','Termo de consentimento','{}','ASSINADO','cl_1')");
  await c.query("INSERT INTO treatment_plans (id, client_id, title, total_sessions, status, clinica_id)" +
    " VALUES ('pl1','c_cheia','Protocolo',3,'ATIVO','cl_1')");
  await c.query("INSERT INTO treatment_sessions (id, plan_id, session_number, session_type, status, clinica_id)" +
    " VALUES ('s1','pl1',1,'SESSAO_TRATAMENTO','REALIZADA','cl_1')");
  await c.query("INSERT INTO interactions (id, client_id, type, content, direction, clinica_id)" +
    " VALUES ('i1','c_cheia','whatsapp','oi doutora','in','cl_1')");
  await c.query("INSERT INTO cash_entries (id, type, amount, description, entry_date, client_id, clinica_id)" +
    " VALUES ('ce1','RECEITA',3000,'Pacote','2026-09-10','c_cheia','cl_1')");
  await c.end();

  const r = await chamar(adm, 'DELETE', '/api/clients/c_cheia');
  ok('a exclusao e RECUSADA', r.status, 409);
  ok('a frase cita o documento', /1 documento emitido/.test(r.corpo.error || ''), true);
  ok('o plano', /1 plano de tratamento/.test(r.corpo.error || ''), true);
  ok('a sessao', /1 sessão lançada/.test(r.corpo.error || ''), true);
  ok('a conversa', /1 mensagem de WhatsApp/.test(r.corpo.error || ''), true);
  ok('e o lancamento financeiro', /1 lançamento no financeiro/.test(r.corpo.error || ''), true);
  ok('e ela diz o caminho', /Exportar dados/.test(r.corpo.error || ''), true);

  const c2 = await bd();
  const [viva] = await c2.query("SELECT id FROM clients WHERE id = 'c_cheia'");
  const [doc] = await c2.query("SELECT id FROM client_documents WHERE id = 'd1'");
  const [ses] = await c2.query("SELECT id FROM treatment_sessions WHERE id = 's1'");
  await c2.end();
  ok('a paciente continua la', viva.length, 1);
  /* Antes desta tarefa, o DELETE teria levado os dois junto. */
  ok('o termo assinado continua la', doc.length, 1);
  ok('e a sessao tambem', ses.length, 1);
}

console.log('\n[C] A FICHA VAZIA CONTINUA SENDO APAGADA NUM CLIQUE');
{
  /* A duplicata criada por engano e' caso real e frequente. Tornar TODA
     exclusao impossivel trocaria um problema por outro. */
  const r = await chamar(adm, 'DELETE', '/api/clients/c_vazia');
  ok('a exclusao passa', r.status, 200);
  const c = await bd();
  const [q] = await c.query("SELECT id FROM clients WHERE id = 'c_vazia'");
  await c.end();
  ok('e a ficha sumiu', q.length, 0);
}

console.log('\n[D] O BANCO SEGURA MESMO POR FORA DA ROTA');
{
  /* A frase legivel vive na rota; esta e a barreira de baixo, para quem apagar
     por SQL -- um script, um suporte, uma limpeza feita a mao. */
  const c = await bd();
  let recusou = false;
  try {
    await c.query("DELETE FROM clients WHERE id = 'c_cheia'");
  } catch (e) {
    recusou = /foreign key|constraint/i.test(e.message);
  }
  const [viva] = await c.query("SELECT id FROM clients WHERE id = 'c_cheia'");
  await c.end();
  ok('o banco recusa o DELETE cru', recusou, true);
  ok('e a paciente continua la', viva.length, 1);
}

console.log('\n[E] A TRILHA REGISTRA A RECUSA');
{
  const c = await bd();
  const [g] = await c.query(
    "SELECT description FROM system_logs WHERE action_type = 'CLIENT_DELETE'" +
    " AND description LIKE '%RECUSADA%'");
  await c.end();
  /* Sem isto, "tentei excluir e nao consegui" nao deixaria rastro nenhum -- e
     e' exatamente o tipo de coisa que alguem pergunta semanas depois. */
  ok('a tentativa recusada ficou registrada', g.length >= 1, true);
}

console.log('\n[F] A CLINICA VIZINHA');
{
  ok('ela nao apaga a nossa paciente',
    (await chamar(viz, 'DELETE', '/api/clients/c_cheia')).status, 404);
  const c = await bd();
  const [q] = await c.query("SELECT id FROM clients WHERE id = 'c_cheia'");
  await c.end();
  ok('e a paciente continua la', q.length, 1);
}

console.log('\n[G] A AGENDA NAO ACEITA MAIS PACIENTE INEXISTENTE');
{
  const c = await bd();
  let recusou = false;
  try {
    await c.query("INSERT INTO appointments (id, client_id, professional_id, title, starts_at, ends_at, clinica_id)" +
      " VALUES ('ap_x','c_fantasma','u_adm','Invadido','2026-10-01 09:00:00','2026-10-01 10:00:00','cl_1')");
  } catch (e) {
    recusou = /foreign key|constraint/i.test(e.message);
  }
  await c.end();
  ok('compromisso orfao e recusado pelo banco', recusou, true);
}

const passaram = conf.filter(Boolean).length;
console.log('\n====================================================');
console.log('  ' + passaram + ' de ' + conf.length + ' conferencias passaram');
console.log('====================================================\n');
servidor.close();
process.exit(passaram === conf.length ? 0 : 1);

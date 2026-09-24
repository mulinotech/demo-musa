/** Ensaio da M6.2: a conversa vira card, e o logo vira timbre.
 *
 *  O bloco [E] é o que amarra a tarefa: prova que o logo salvo em Cadastros sai
 *  DENTRO do HTML do documento impresso, e que trocá-lo depois **não** reescreve
 *  o papel de ontem.
 */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { createRequire } from 'module';
const require = createRequire('/home/claude/musa/');

const H = '127.0.0.1', P = 3307, U = 'musa', S = 'ensaio-local', B = 'musa_m62';
const raiz = await mysql.createConnection({ host: H, port: P, user: U, password: S, multipleStatements: true });
await raiz.query('DROP DATABASE IF EXISTS ' + B);
await raiz.query('CREATE DATABASE ' + B);
await raiz.end();

process.env.DB_HOST = H; process.env.DB_PORT = String(P); process.env.DB_USER = U;
process.env.DB_PASSWORD = S; process.env.DB_NAME = B; process.env.JWT_SECRET = 'repro-m62';

const conn = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B, multipleStatements: true });
await require('/home/claude/musa/db/run-migrations.js')(conn, {});
await conn.query("INSERT IGNORE INTO clinicas (id, nome) VALUES ('cl_2', 'Clinica Vizinha')");
const senha = bcrypt.hashSync('SenhaDeEnsaio2026', 10);
for (const [id, nome, email, papel, cl] of [
  ['u_adm', 'Dra Musa', 'adm@ensaio.invalido', 'admin', 'cl_1'],
  ['u_rec', 'Recepcao', 'rec@ensaio.invalido', 'vendedor', 'cl_1'],
  ['u_viz', 'Vizinha', 'viz@ensaio.invalido', 'admin', 'cl_2']
]) {
  await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id) VALUES (?,?,?,?,?,?,?)',
    [id, nome, email, senha, papel, 'active', cl]);
}
await conn.query("UPDATE users SET conselho='CRM', conselho_numero='12345', conselho_uf='SP'," +
  " funcao='Medica' WHERE id='u_adm'");
// A paciente com o telefone escrito do jeito da recepcao; a conversa chega do
// jeito do WhatsApp. Sao a mesma mulher e dois textos diferentes.
await conn.query("INSERT INTO clients (id,name,phone,clinica_id) VALUES" +
  " ('c1','Ana Paula','(11) 91111-2222','cl_1')," +
  " ('c2','Daniel Lins','(11) 98888-7777','cl_1')");
await conn.end();

const app = require('/home/claude/musa/server/app.js');
const servidor = app.listen(4194);
await new Promise((r) => servidor.on('listening', r));
const BASE = 'http://127.0.0.1:4194';

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
  const texto = await r.text();
  let corpoResp = {};
  try { corpoResp = JSON.parse(texto); } catch { corpoResp = { texto: texto }; }
  return { status: r.status, corpo: corpoResp, texto: texto };
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
const rec = await entrar('rec@ensaio.invalido');
const viz = await entrar('viz@ensaio.invalido');

const PNG = 'data:image/png;base64,' + Buffer.alloc(900, 3).toString('base64');
const PNG2 = 'data:image/png;base64,' + Buffer.alloc(1200, 9).toString('base64');

let leadId = null;

console.log('\n[A] A CONVERSA VIRA CARD');
{
  const r = await chamar(rec, 'POST', '/api/leads/do-whatsapp',
    { nome: 'Ana Paula', telefone: '5511911112222' });
  ok('o card e criado', r.status, 201);
  ok('e a acao e dita', r.corpo.acao, 'criado');
  leadId = r.corpo.lead.id;
  /* O card ja nasce apontando para a ficha: quando ele for arrastado para
     "Venda Fechada", `escolherFicha` vera `clientId` e nao criara a segunda. */
  ok('ja nasce apontando para a ficha da Ana', r.corpo.clienteId, 'c1');

  const c = await bd();
  const [l] = await c.query('SELECT source, status, client_id, whatsapp FROM leads WHERE id = ?', [leadId]);
  await c.end();
  ok('a origem gravada e whatsapp', l[0].source, 'whatsapp');
  ok('e ele entra em Lead Novo', l[0].status, 'novo');
  ok('com o client_id da ficha', l[0].client_id, 'c1');
}

console.log('\n[B] CLICAR DE NOVO NAO CRIA O SEGUNDO CARD');
{
  /* O defeito que o time comercial descreveu em 19/09 e o mesmo daqui: dois
     cards da mesma mulher, e quem atende o segundo nao sabe do primeiro. */
  const r = await chamar(rec, 'POST', '/api/leads/do-whatsapp',
    { nome: 'Ana Paula', telefone: '(11) 91111-2222' });
  ok('a resposta e 200, e nao 409', r.status, 200);
  ok('ela diz que ja esta no funil', r.corpo.acao, 'jaNoFunil');
  ok('e devolve o card que ja existe', r.corpo.lead.id, leadId);

  const c = await bd();
  const [q] = await c.query('SELECT COUNT(*) n FROM leads WHERE clinica_id = ?', ['cl_1']);
  await c.end();
  ok('continua havendo UM card', q[0].n, 1);
}

console.log('\n[C] O TELEFONE QUE NAO E TELEFONE E RECUSADO');
{
  const r = await chamar(rec, 'POST', '/api/leads/do-whatsapp', { nome: 'X', telefone: '123' });
  ok('recusa com 400', r.status, 400);
  ok('dizendo o porque', /DDD/.test(r.corpo.error || ''), true);
  const c = await bd();
  const [q] = await c.query('SELECT COUNT(*) n FROM leads WHERE clinica_id = ?', ['cl_1']);
  await c.end();
  ok('e nada foi gravado', q[0].n, 1);
}

console.log('\n[D] O LOGO DO TIMBRE');
{
  ok('SVG e recusado', (await chamar(adm, 'PUT', '/api/clinica/logo',
    { dataUrl: 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64') })).status, 400);
  ok('imagem grande demais e recusada', (await chamar(adm, 'PUT', '/api/clinica/logo',
    { dataUrl: 'data:image/png;base64,' + Buffer.alloc(400 * 1024, 1).toString('base64') })).status, 400);

  const r = await chamar(adm, 'PUT', '/api/clinica/logo', { dataUrl: PNG });
  ok('o PNG passa', r.status, 200);
  ok('e volta na leitura do timbre', (await chamar(adm, 'GET', '/api/clinica')).corpo.logo, PNG);

  /* Quem EDITA o timbre e a gestao; quem LE e todo papel autenticado -- a
     profissional precisa ver o cabecalho antes de escrever a receita. */
  ok('a recepcao NAO troca o logo', (await chamar(rec, 'PUT', '/api/clinica/logo', { dataUrl: PNG2 })).status, 403);
  ok('mas LE o timbre', (await chamar(rec, 'GET', '/api/clinica')).status, 200);

  ok('a clinica vizinha nao ve o nosso logo',
    (await chamar(viz, 'GET', '/api/clinica')).corpo.logo, null);
}

console.log('\n[E] O LOGO SAI NO PAPEL, E O PAPEL DE ONTEM NAO MUDA');
{
  const mod = await chamar(adm, 'GET', '/api/document-templates');
  const atestado = (mod.corpo || []).filter((m) => m.type === 'ATESTADO')[0];
  ok('ha modelo de atestado semeado', !!atestado, true);

  const novo = await chamar(adm, 'POST', '/api/clients/c1/documents', {
    templateId: atestado.id, title: 'Atestado',
    answers: { atendimento_data: '20/08/2026', atendimento_hora: '09:00' }
  });
  ok('o rascunho nasce', novo.status, 201);
  const docId = novo.corpo.id;

  const ger = await chamar(adm, 'POST', '/api/documents/' + docId + '/finalize', {});
  ok('e e emitido', ger.status, 200);

  const c = await bd();
  const [d] = await c.query('SELECT timbre_logo FROM client_documents WHERE id = ?', [docId]);
  await c.end();
  ok('o logo foi CARIMBADO no documento', d[0].timbre_logo, PNG);

  const pag = await chamar(adm, 'GET', '/api/documents/' + docId + '/view');
  ok('e sai dentro do HTML impresso', pag.texto.indexOf('class="timbre-logo"') !== -1, true);
  ok('com a imagem que valia na emissao', pag.texto.indexOf(PNG) !== -1, true);

  // A clinica troca de marca DEPOIS.
  await chamar(adm, 'PUT', '/api/clinica/logo', { dataUrl: PNG2 });
  const depois = await chamar(adm, 'GET', '/api/documents/' + docId + '/view');
  ok('o atestado de ontem continua com o logo de ontem',
    depois.texto.indexOf(PNG) !== -1, true);
  ok('e NAO ganha a marca nova', depois.texto.indexOf(PNG2) !== -1, false);
}

console.log('\n[F] REMOVER O LOGO');
{
  ok('a remocao passa', (await chamar(adm, 'DELETE', '/api/clinica/logo')).status, 200);
  ok('e o timbre volta sem logo', (await chamar(adm, 'GET', '/api/clinica')).corpo.logo, null);
  ok('a recepcao nao remove', (await chamar(rec, 'DELETE', '/api/clinica/logo')).status, 403);
}

console.log('\n[G] A AGENDA POR PACIENTE');
{
  await chamar(adm, 'POST', '/api/appointments', {
    clientId: 'c1', professionalId: 'u_adm', title: 'Limpeza',
    startsAt: '2026-10-05 09:00:00', endsAt: '2026-10-05 10:00:00', kind: 'ATENDIMENTO' });
  await chamar(adm, 'POST', '/api/appointments', {
    clientId: 'c2', professionalId: 'u_adm', title: 'Retorno',
    startsAt: '2026-10-06 09:00:00', endsAt: '2026-10-06 10:00:00', kind: 'ATENDIMENTO' });

  const so = await chamar(adm, 'GET', '/api/appointments?clientId=c1');
  ok('o filtro devolve so os da paciente', so.corpo.length, 1);
  ok('e e o dela', so.corpo[0].title, 'Limpeza');
  ok('a vizinha nao alcanca a agenda daqui',
    (await chamar(viz, 'GET', '/api/appointments?clientId=c1')).corpo.length, 0);
}

console.log('\n[H] A VIZINHA NAO ENTRA NO NOSSO FUNIL');
{
  const r = await chamar(viz, 'POST', '/api/leads/do-whatsapp',
    { nome: 'Ana Paula', telefone: '5511911112222' });
  /* O mesmo telefone, da clinica de la: ela NAO ve o nosso card, entao cria o
     dela -- e o dela nasce na clinica dela. */
  ok('ela cria o card dela', r.status, 201);
  const c = await bd();
  const [q] = await c.query('SELECT clinica_id, client_id FROM leads WHERE id = ?', [r.corpo.lead.id]);
  const [n] = await c.query('SELECT COUNT(*) n FROM leads WHERE clinica_id = ?', ['cl_1']);
  await c.end();
  ok('na clinica dela', q[0].clinica_id, 'cl_2');
  ok('sem alcancar a nossa ficha', q[0].client_id, null);
  ok('e o nosso funil continua com um card', n[0].n, 1);
}

const passaram = conf.filter(Boolean).length;
console.log('\n====================================================');
console.log('  ' + passaram + ' de ' + conf.length + ' conferencias passaram');
console.log('====================================================\n');
servidor.close();
process.exit(passaram === conf.length ? 0 : 1);

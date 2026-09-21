/** Ensaio da M5.10: Venda Fechada vira paciente, contra banco e servidor reais.
 *
 *  Os testes de unidade provam a REGRA (qual ficha é a pessoa). Este prova o
 *  CAMINHO: o que sobra no banco depois que alguém fecha a venda, e o que
 *  acontece quando a conversão dá errado no meio.
 */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { createRequire } from 'module';
const require = createRequire('/home/claude/musa/');

const H = '127.0.0.1', P = 3307, U = 'musa', S = 'ensaio-local', B = 'musa_m510';
const raiz = await mysql.createConnection({ host: H, port: P, user: U, password: S, multipleStatements: true });
await raiz.query('DROP DATABASE IF EXISTS ' + B);
await raiz.query('CREATE DATABASE ' + B);
await raiz.end();

process.env.DB_HOST = H; process.env.DB_PORT = String(P); process.env.DB_USER = U;
process.env.DB_PASSWORD = S; process.env.DB_NAME = B;
process.env.JWT_SECRET = 'repro-m510'; process.env.GEMINI_API_KEY = 'falsa';
delete process.env.EVOLUTION_API_URL; delete process.env.EVOLUTION_API_KEY;

const conn = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B, multipleStatements: true });
await require('/home/claude/musa/db/run-migrations.js')(conn, {});

// Duas clinicas: a nossa e a vizinha. O isolamento e' conferido no bloco [F].
await conn.query("INSERT IGNORE INTO clinicas (id, nome) VALUES ('cl_2', 'Clinica Vizinha')");
const senha = bcrypt.hashSync('SenhaDeEnsaio2026', 10);
for (const [id, nome, email, papel, cl] of [
  ['u_adm', 'Admin', 'adm@ensaio.invalido', 'admin', 'cl_1'],
  ['u_ven', 'Vendedor', 'ven@ensaio.invalido', 'vendedor', 'cl_1'],
  ['u_viz', 'Vizinha', 'viz@ensaio.invalido', 'admin', 'cl_2']
]) {
  await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id) VALUES (?,?,?,?,?,?,?)',
    [id, nome, email, senha, papel, 'active', cl]);
}

/* A FICHA QUE JA EXISTE, com o telefone digitado pela recepcao -- com mascara.
   O lead correspondente vem do WhatsApp, com DDI colado. Textos diferentes,
   mesma mulher: e' esta a duplicata que o time relatou. */
await conn.query(
  "INSERT INTO clients (id,name,phone,clinica_id) VALUES ('c_ana','Ana Paula','(11) 99876-5432','cl_1')");
// Na clinica vizinha, uma ficha com o MESMO telefone. Nao pode ser alcancada daqui.
await conn.query(
  "INSERT INTO clients (id,name,phone,clinica_id) VALUES ('c_viz','Ana da Vizinha','(11) 99876-5432','cl_2')");
await conn.end();

const app = require('/home/claude/musa/server/app.js');
const servidor = app.listen(4183);
await new Promise((r) => servidor.on('listening', r));
const BASE = 'http://127.0.0.1:4183';

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
const contarFichas = async () => {
  const c = await bd();
  const [r] = await c.query("SELECT COUNT(*) n FROM clients WHERE clinica_id = 'cl_1'");
  await c.end();
  return r[0].n;
};
const lerLeadCru = async (id) => {
  const c = await bd();
  const [r] = await c.query('SELECT status, client_id, converted_at FROM leads WHERE id = ?', [id]);
  await c.end();
  return r[0];
};
const criarLead = async (t, nome, whatsapp) => {
  const r = await chamar(t, 'POST', '/api/leads/manual', { name: nome, whatsapp, treatment: 'Ultraformer' });
  return r.corpo.id;
};

const conf = [];
const ok = (nome, real, esperado) => {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  conf.push(passou);
  console.log((passou ? '  OK  ' : '  XX  ') + nome +
    (passou ? '' : '   esperado ' + JSON.stringify(esperado) + ', veio ' + JSON.stringify(real)));
};

const adm = await entrar('adm@ensaio.invalido');
const ven = await entrar('ven@ensaio.invalido');
const viz = await entrar('viz@ensaio.invalido');

console.log('\n[A] A DUPLICATA QUE O TIME RELATOU: mesmo numero, escrito de outro jeito');
{
  const antes = await contarFichas();
  const id = await criarLead(ven, 'Ana P.', '5511998765432');
  const r = await chamar(ven, 'PUT', '/api/leads/' + id, { status: 'arquivado' });

  ok('o fechamento passa', r.status, 200);
  ok('e VINCULA, em vez de criar', r.corpo.conversao.acao, 'vincular');
  ok('na ficha da Ana Paula que ja existia', r.corpo.conversao.cliente.id, 'c_ana');
  ok('NENHUMA ficha nova nasceu', await contarFichas(), antes);

  const cru = await lerLeadCru(id);
  ok('e o banco guarda o vinculo', cru.client_id, 'c_ana');
  ok('com a data da conversao', cru.converted_at !== null, true);
  // A regra antiga, no navegador, respondia 'criar' aqui -- e era assim que a
  // segunda Ana Paula nascia.
}

console.log('\n[B] PACIENTE NOVA DE VERDADE');
{
  const antes = await contarFichas();
  const id = await criarLead(ven, 'Beatriz Lima', '5531977771234');
  const r = await chamar(ven, 'PUT', '/api/leads/' + id, { status: 'arquivado' });

  ok('a acao e criar', r.corpo.conversao.acao, 'criar');
  ok('com o nome do lead', r.corpo.conversao.cliente.nome, 'Beatriz Lima');
  ok('uma ficha a mais', await contarFichas(), antes + 1);
  ok('e o lead aponta para ela', (await lerLeadCru(id)).client_id, r.corpo.conversao.cliente.id);
}

console.log('\n[C] FECHAR DUAS VEZES, E REABRIR E FECHAR DE NOVO');
{
  const id = await criarLead(ven, 'Carla Dias', '5511955554444');
  await chamar(ven, 'PUT', '/api/leads/' + id, { status: 'arquivado' });
  const antes = await contarFichas();
  const primeira = (await lerLeadCru(id)).client_id;

  const r2 = await chamar(ven, 'PUT', '/api/leads/' + id, { status: 'arquivado' });
  ok('fechar de novo nao cria nada', await contarFichas(), antes);
  ok('e diz que ja estava vinculado', r2.corpo.conversao.acao, 'jaVinculado');

  /* Arrastar para fora e de volta e' gesto de todo dia. Sem a porta do
     `jaVinculado`, cada ida e volta deixava uma ficha nova para tras. */
  await chamar(ven, 'PUT', '/api/leads/' + id, { status: 'agendado' });
  await chamar(ven, 'PUT', '/api/leads/' + id, { status: 'arquivado' });
  ok('ida e volta no funil tambem nao', await contarFichas(), antes);
  ok('e continua na MESMA ficha', (await lerLeadCru(id)).client_id, primeira);
}

console.log('\n[D] A MAE E A FILHA: duas fichas, um telefone');
{
  const c = await bd();
  await c.query("INSERT INTO clients (id,name,phone,clinica_id) VALUES ('c_jul','Julia','11998765432','cl_1')");
  await c.end();

  const antes = await contarFichas();
  const id = await criarLead(ven, 'Julia (filha da Ana)', '5511998765432');
  const r = await chamar(ven, 'PUT', '/api/leads/' + id, { status: 'arquivado' });

  ok('o lead FECHA mesmo assim', (await lerLeadCru(id)).status, 'arquivado');
  ok('mas ninguem e vinculado no chute', r.corpo.conversao.acao, 'ambiguo');
  ok('e nenhuma ficha nova nasce', await contarFichas(), antes);
  ok('a tela recebe as DUAS para escolher', r.corpo.conversao.candidatos.length, 2);
  ok('com os nomes', r.corpo.conversao.candidatos.map((x) => x.nome).sort(), ['Ana Paula', 'Julia']);
  ok('o lead fica sem ficha, e isso e visivel', (await lerLeadCru(id)).client_id, null);

  const cand = await chamar(ven, 'GET', '/api/leads/' + id + '/fichas-candidatas');
  ok('a tela consulta as candidatas de novo quando quiser', cand.corpo.candidatos.length, 2);

  const v = await chamar(ven, 'POST', '/api/leads/' + id + '/vincular', { clientId: 'c_jul' });
  ok('e a recepcao escolhe a Julia', v.status, 200);
  ok('sem criar ficha nenhuma', await contarFichas(), antes);
  ok('ficando vinculado a ela', (await lerLeadCru(id)).client_id, 'c_jul');
}

console.log('\n[E] "NENHUMA DESSAS": a filha que nunca veio a clinica');
{
  const antes = await contarFichas();
  const id = await criarLead(ven, 'Sofia (neta)', '5511998765432');
  const r = await chamar(ven, 'PUT', '/api/leads/' + id, { status: 'arquivado' });
  ok('cai no empate', r.corpo.conversao.acao, 'ambiguo');

  const v = await chamar(ven, 'POST', '/api/leads/' + id + '/vincular', { criarNova: true });
  ok('criar nova e' + ' aceito', v.status, 200);
  ok('com o nome do lead', v.corpo.conversao.cliente.nome, 'Sofia (neta)');
  ok('uma ficha a mais, agora de propósito', await contarFichas(), antes + 1);
}

console.log('\n[F] A CLINICA VIZINHA');
{
  const idAqui = await criarLead(ven, 'Daniela', '5511944443333');
  ok('a vizinha nao fecha lead daqui',
    (await chamar(viz, 'PUT', '/api/leads/' + idAqui, { status: 'arquivado' })).status, 404);
  ok('nem vincula ficha nele',
    (await chamar(viz, 'POST', '/api/leads/' + idAqui + '/vincular', { clientId: 'c_viz' })).status, 404);
  ok('nem enxerga as candidatas',
    (await chamar(viz, 'GET', '/api/leads/' + idAqui + '/fichas-candidatas')).status, 404);

  /* O CASO PERIGOSO: a ficha da vizinha tem o MESMO telefone da Ana Paula. Se a
     busca esquecesse o filtro de clinica, o lead daqui acharia DUAS fichas e
     cairia em 'ambiguo' -- ou pior, se vincularia na ficha de la. */
  const idAna2 = await criarLead(ven, 'Ana de novo', '5511998765432');
  const c = await chamar(ven, 'GET', '/api/leads/' + idAna2 + '/fichas-candidatas');
  ok('e a ficha dela NAO entra na busca daqui',
    c.corpo.candidatos.every((x) => x.id !== 'c_viz'), true);

  // E o contrario: o id de uma ficha da vizinha, informado a mao, e recusado.
  const idNovo = await criarLead(ven, 'Elisa', '5511922221111');
  ok('id de ficha da vizinha e recusado como inexistente',
    (await chamar(ven, 'POST', '/api/leads/' + idNovo + '/vincular', { clientId: 'c_viz' })).status, 404);
  ok('e o lead continua sem ficha', (await lerLeadCru(idNovo)).client_id, null);
}

console.log('\n[G] QUANDO A CRIACAO DA FICHA FALHA NO MEIO');
{
  /* A promessa da M5.10 e' que fechar o lead e criar a ficha sao a MESMA
     transacao -- e nao duas viagens do navegador, como era ate 21/09. A unica
     forma de conferir isso e' fazer a SEGUNDA METADE falhar e olhar o que
     sobrou da primeira.

     O gatilho abaixo recusa uma ficha com um nome combinado. E' artificial de
     proposito: em producao a falha viria do banco fora do ar no meio da
     gravacao, e o que interessa e' o que o sistema deixa para tras. */
  const c0 = await bd();
  await c0.query(
    "CREATE TRIGGER ensaio_recusa_ficha BEFORE INSERT ON clients FOR EACH ROW " +
    "BEGIN IF NEW.name = 'FICHA QUE NAO ENTRA' THEN " +
    "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'falha proposital do ensaio'; END IF; END");
  await c0.end();

  const antes = await contarFichas();
  const id = await criarLead(ven, 'FICHA QUE NAO ENTRA', '5521933332222');
  const r = await chamar(ven, 'PUT', '/api/leads/' + id, { status: 'arquivado' });

  ok('a chamada falha alto, em vez de gravar meio caminho', r.status, 500);
  ok('nenhuma ficha nasceu', await contarFichas(), antes);
  /* O ponto do bloco: o lead NAO ficou fechado. Antes da M5.10 este era o
     estado silencioso -- funil dizendo "Venda Fechada", paciente inexistente. */
  ok('e o lead NAO ficou fechado sem ficha', (await lerLeadCru(id)).status, 'novo');

  const c1 = await bd();
  await c1.query('DROP TRIGGER ensaio_recusa_ficha');
  await c1.end();

  // E com o gatilho fora, o mesmo lead fecha normalmente.
  const r2 = await chamar(ven, 'PUT', '/api/leads/' + id, { status: 'arquivado' });
  ok('e conserta sozinho quando a falha passa', r2.corpo.conversao.acao, 'criar');
}

console.log('\n[H] O TELEFONE CORRIGIDO NO MESMO CLIQUE');
{
  /* "Agora que fechei, o numero certo e' este" e' edicao comum na gaveta do
     lead, e vem no MESMO PUT que fecha. Converter com o telefone velho
     procuraria a ficha errada. */
  const antes = await contarFichas();
  const id = await criarLead(ven, 'Ana P. (numero errado)', '5511900000000');
  const r = await chamar(ven, 'PUT', '/api/leads/' + id,
    { status: 'arquivado', whatsapp: '(11) 99876-5432' });

  ok('usa o telefone corrigido, nao o antigo', r.corpo.conversao.acao, 'ambiguo');
  ok('nenhuma ficha nova', await contarFichas(), antes);
}

const passaram = conf.filter(Boolean).length;
console.log('\n====================================================');
console.log('  ' + passaram + ' de ' + conf.length + ' conferencias passaram');
console.log('====================================================\n');
servidor.close();
process.exit(passaram === conf.length ? 0 : 1);

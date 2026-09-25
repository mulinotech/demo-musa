/** Ensaio da M6.7: os papéis novos e a régua de confirmação, contra banco real.
 *
 *  A suíte pura já mede as regras. O que só aparece aqui é o resto do caminho:
 *  o ENUM aceitando (ou não) o papel novo, o token carregando esse papel, o
 *  porteiro recusando de verdade com 403, e a régua gravando etapa e
 *  cancelamento em linhas que existem.
 */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { createRequire } from 'module';
const require = createRequire('/home/claude/musa/');

const H = '127.0.0.1', P = 3307, U = 'musa', S = 'ensaio-local', B = 'musa_m67';
const raiz = await mysql.createConnection({ host: H, port: P, user: U, password: S, multipleStatements: true });
await raiz.query('DROP DATABASE IF EXISTS ' + B);
await raiz.query('CREATE DATABASE ' + B);
await raiz.end();

process.env.DB_HOST = H; process.env.DB_PORT = String(P); process.env.DB_USER = U;
process.env.DB_PASSWORD = S; process.env.DB_NAME = B; process.env.JWT_SECRET = 'repro-m67';

const conn = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B, multipleStatements: true });

/* ================= O BANCO NASCE COMO O DA PRODUÇÃO ESTAVA: SEM AS COLUNAS
 *
 * As migrations rodam ATÉ a 042, a linha de lembrete antigo é gravada, e só
 * então a 043 e a 044 entram. É a única forma de medir o backfill — num banco
 * criado do zero com tudo aplicado, não existe linha velha para converter, e o
 * risco inteiro da 044 passaria despercebido. */
const runner = require('/home/claude/musa/db/run-migrations.js');
const fs = require('fs');
const DIR = '/home/claude/musa/db/migrations';
const guardadas = ['043_papeis_da_equipe.js', '044_regua_de_confirmacao.js'];
for (const a of guardadas) fs.renameSync(DIR + '/' + a, '/tmp/claude-0/' + a);
await runner(conn, {});
for (const a of guardadas) fs.renameSync('/tmp/claude-0/' + a, DIR + '/' + a);

await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id) VALUES (?,?,?,?,?,?,?)',
  ['u_adm', 'Dra Musa', 'adm@ensaio.invalido', bcrypt.hashSync('SenhaDeEnsaio2026', 10), 'admin', 'active', 'cl_1']);
await conn.query("INSERT INTO clients (id,name,phone,clinica_id) VALUES" +
  " ('c1','Ana Paula','11911112222','cl_1'), ('c2','Bruna Lima','11933334444','cl_1')");

const emHoras = (h) => {
  const d = new Date(Date.now() + h * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':00';
};

/* Um compromisso QUE JÁ RECEBEU o lembrete do modelo antigo, confirmado, e
 * outro que recebeu e não respondeu. São as duas linhas que a 044 converte. */
await conn.query(
  "INSERT INTO appointments (id,client_id,professional_id,title,starts_at,ends_at," +
  "status,kind,reminder_sent_at,confirmed_at,clinica_id) VALUES" +
  " ('a_velho_conf','c1','u_adm','Ja confirmado',?,?,'CONFIRMADO','ATENDIMENTO',?,?,'cl_1')," +
  " ('a_velho_sem','c2','u_adm','Sem resposta',?,?,'AGENDADO','ATENDIMENTO',?,NULL,'cl_1')",
  [emHoras(30), emHoras(31), emHoras(-2), emHoras(-1),
   emHoras(30), emHoras(31), emHoras(-2)]);
await conn.query(
  "INSERT INTO clinica_settings (clinica_id, chave, valor) VALUES" +
  " ('cl_1','lembretes_ativos','1'),('cl_1','lembrete_antecedencia_h','24')" +
  ' ON DUPLICATE KEY UPDATE valor = VALUES(valor)');
await conn.query("UPDATE clinicas SET evolution_instance = 'inst-ensaio' WHERE id = 'cl_1'");

const conf = [];
const ok = (nome, real, esperado) => {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  conf.push(passou);
  console.log((passou ? '  OK  ' : '  XX  ') + nome +
    (passou ? '' : '   esperado ' + JSON.stringify(esperado) + ', veio ' + JSON.stringify(real)));
};

console.log('\n[A] O PAPEL NOVO NAO CABE NO BANCO DE ONTEM');
{
  let recusou = false;
  try {
    await conn.query("INSERT INTO users (id,name,email,password_hash,role,clinica_id)" +
      " VALUES ('u_x','X','x@ensaio.invalido','h','contador','cl_1')");
  } catch (e) { recusou = /Data truncated|Incorrect|Data too long/i.test(e.message); }
  ok('o ENUM antigo recusa "contador"', recusou, true);
}

console.log('\n[B] A MIGRACAO ABRE O ENUM E CONVERTE O QUE PRECISA');
{
  const r = await runner(conn, {});
  ok('as duas entraram', r.aplicadasAgora, ['043_papeis_da_equipe.js', '044_regua_de_confirmacao.js']);

  const r43 = r.relatorios['043_papeis_da_equipe.js'];
  ok('o relatorio diz o que acrescentou', r43.acrescentados.length, 5);
  ok('e diz que NAO converteu ninguem', /nenhuma linha mudou de papel/.test(r43.naoConvertido), true);

  const r44 = r.relatorios['044_regua_de_confirmacao.js'];
  /* AQUI ESTA O RISCO INTEIRO DA 044. Sem este backfill, os dois compromissos
     acima nasceriam na etapa 0: receberiam o lembrete DE NOVO, depois a
     cobranca, e quatro horas depois seriam CANCELADOS -- inclusive o que a
     paciente ja tinha confirmado. */
  ok('os dois ja lembrados entram na etapa 1', r44.jaLembrados, 2);
  ok('e o confirmado ja consta como quem respondeu', r44.jaConfirmados, 1);
  ok('a antecedencia padrao 24 virou 26', r44.antecedenciaAtualizada, 1);

  const [et] = await conn.query('SELECT id, reminder_stage, reminder_reply_at FROM appointments ORDER BY id');
  ok('nenhum compromisso ficou na etapa zero', et.filter((x) => x.reminder_stage === 0).length, 0);
  ok('so o confirmado tem resposta carimbada',
    et.filter((x) => x.reminder_reply_at).map((x) => x.id), ['a_velho_conf']);
}

console.log('\n[C] AGORA OS PAPEIS NOVOS CABEM');
const PESSOAS = [
  ['u_sec', 'Secretaria', 'sec@ensaio.invalido', 'secretaria'],
  ['u_fin', 'Financeiro', 'fin@ensaio.invalido', 'financeiro'],
  ['u_cont', 'Contador', 'cont@ensaio.invalido', 'contador'],
  ['u_gcom', 'Gerente Com', 'gcom@ensaio.invalido', 'gerente_comercial'],
  ['u_gadm', 'Gerente Adm', 'gadm@ensaio.invalido', 'gerente_admin']
];
for (const [id, nome, email, papel] of PESSOAS) {
  await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id)' +
    ' VALUES (?,?,?,?,?,?,?)',
    [id, nome, email, bcrypt.hashSync('SenhaDeEnsaio2026', 10), papel, 'active', 'cl_1']);
}
{
  const [r] = await conn.query('SELECT role FROM users WHERE clinica_id = "cl_1" ORDER BY role');
  ok('os cinco papeis novos gravaram', r.length, 6);
}
await conn.end();

const app = require('/home/claude/musa/server/app.js');
const servidor = app.listen(4206);
await new Promise((r) => servidor.on('listening', r));
const BASE = 'http://127.0.0.1:4206';

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

const adm = await entrar('adm@ensaio.invalido');

console.log('\n[D] O PORTEIRO RECUSA DE VERDADE, COM 403');
{
  const sec = await entrar('sec@ensaio.invalido');
  const fin = await entrar('fin@ensaio.invalido');
  const cont = await entrar('cont@ensaio.invalido');
  const gcom = await entrar('gcom@ensaio.invalido');
  const gadm = await entrar('gadm@ensaio.invalido');
  ok('todo papel novo consegue entrar', [sec, fin, cont, gcom, gadm].every(Boolean), true);

  // A secretária trabalha.
  ok('secretaria le a agenda', (await chamar(sec, 'GET', '/api/appointments')).status, 200);
  ok('secretaria le pacientes', (await chamar(sec, 'GET', '/api/clients')).status, 200);
  ok('secretaria le o funil', (await chamar(sec, 'GET', '/api/leads')).status, 200);
  // E não abre o que não é dela.
  ok('secretaria NAO abre prontuario',
    (await chamar(sec, 'GET', '/api/clients/c1/documents')).status, 403);
  ok('secretaria NAO abre o caixa', (await chamar(sec, 'GET', '/api/finance/resumo')).status, 403);
  ok('secretaria NAO abre usuarios', (await chamar(sec, 'GET', '/api/users')).status, 403);

  ok('financeiro abre o caixa', (await chamar(fin, 'GET', '/api/finance/resumo')).status, 200);
  ok('financeiro NAO abre prontuario',
    (await chamar(fin, 'GET', '/api/clients/c1/documents')).status, 403);
  ok('financeiro NAO marca horario',
    (await chamar(fin, 'POST', '/api/appointments', { clientId: 'c1' })).status, 403);

  ok('contador le o caixa', (await chamar(cont, 'GET', '/api/finance/resumo')).status, 200);
  ok('contador NAO lanca nada',
    (await chamar(cont, 'POST', '/api/finance/lancamentos', { valor: 1 })).status, 403);
  ok('contador NAO ve paciente nenhuma', (await chamar(cont, 'GET', '/api/clients')).status, 403);

  ok('gerente comercial trabalha o funil', (await chamar(gcom, 'GET', '/api/leads')).status, 200);
  ok('gerente comercial NAO abre o caixa',
    (await chamar(gcom, 'GET', '/api/finance/resumo')).status, 403);
  ok('gerente administrativo abre o caixa',
    (await chamar(gadm, 'GET', '/api/finance/resumo')).status, 200);
  ok('e continua sem a gestao de acessos',
    (await chamar(gadm, 'GET', '/api/users')).status, 403);

  /* A ROTA SEM REGRA. `/api/gemini` nao tem linha em REGRAS_DE_PAPEL: antes do
     recorte, os tres papeis estreitos a alcancariam. */
  ok('rota sem regra fica fechada para o contador',
    (await chamar(cont, 'GET', '/api/gemini/status')).status, 403);
}

console.log('\n[E] QUEM ATENDE NAO INCLUI QUEM NAO ATENDE');
{
  const r = await chamar(adm, 'GET', '/api/profissionais');
  const nomes = r.corpo.map((x) => x.name).sort();
  ok('so admin, gerencia plena e profissional', nomes, ['Dra Musa', 'Gerente Adm']);
}

console.log('\n[F] A TELA DE USUARIOS ACEITA E RECUSA O QUE DEVE');
{
  const r = await chamar(adm, 'POST', '/api/users',
    { name: 'Nova Recepcao', email: 'rec@ensaio.invalido', password: 'SenhaDeEnsaio2026',
      role: 'secretaria' });
  ok('criar com papel novo funciona', r.status, 201);
  ok('e o papel gravado e o pedido', r.corpo.role, 'secretaria');

  const p = await chamar(adm, 'PATCH', '/api/users/u_sec', { role: 'financeiro' });
  ok('trocar para outro papel novo funciona', p.status, 200);

  /* Papel inventado nao vira 400: `PAPEIS_VALIDOS` simplesmente nao o inclui no
     UPDATE. Com `role` sendo o unico campo, sobra "nada para atualizar" -- que
     e a recusa, e e' honesta. */
  const x = await chamar(adm, 'PATCH', '/api/users/u_sec', { role: 'dono_do_mundo' });
  ok('papel inventado nao passa', x.status, 400);
  const c = await bd();
  const [q] = await c.query("SELECT role FROM users WHERE id = 'u_sec'");
  await c.end();
  ok('e o papel no banco continua o de antes', q[0].role, 'financeiro');
}

console.log('\n[G] A REGUA DE TRES DISPAROS, DE PONTA A PONTA');
{
  const worker = require('/home/claude/musa/server/workers/lembretes.js');
  const escopo = require('/home/claude/musa/server/db/escopo.js');
  const cfgSvc = require('/home/claude/musa/server/services/clinica-config.js');

  const c0 = await bd();
  // Uma paciente nova, sem nada carimbado, com horario daqui a 25 h.
  await c0.query(
    "INSERT INTO appointments (id,client_id,professional_id,title,starts_at,ends_at," +
    "status,kind,clinica_id) VALUES" +
    " ('a_novo','c1','u_adm','Limpeza de pele',?,?,'AGENDADO','ATENDIMENTO','cl_1')",
    [emHoras(25), emHoras(26)]);
  await c0.end();

  const db = escopo.paraClinica('cl_1', { autor: 'Sistema' });
  const cfg = await cfgSvc.lerLembrete(db);
  ok('a clinica esta ligada', cfg.ativo, true);
  ok('e com 26 h de antecedencia depois da migracao', cfg.antecedenciaH, 26);
  ok('a 2a mensagem tem texto proprio', cfg.templateCobranca.length > 40, true);

  const saiu = [];
  const envio = async (tel, msg) => { saiu.push({ tel, msg }); };

  // Três passadas, com o relógio avançando como o do mundo.
  const r1 = await worker.umaClinica(db, cfg, { agora: new Date(), enviar: envio });
  const linha = r1.itens.find((x) => x.id === 'a_novo');
  ok('a 1a mensagem saiu para a paciente nova', linha && linha.enviado, true);
  ok('e foi a etapa 1', linha.etapa, 1);

  /* O compromisso JA CONFIRMADO nao recebe cobranca -- e a conversao da 044 que
     garante isso: sem ela ele estaria na etapa 0 e receberia tudo de novo. */
  const conf1 = r1.itens.find((x) => x.id === 'a_velho_conf');
  ok('o ja confirmado nao recebe nada', conf1.enviar, false);
  ok('e o motivo e que ele ja respondeu', /respondeu|confirmado/.test(conf1.motivo), true);

  /* ============ O LOTE QUE SERIA COBRADO E CANCELADO DE UMA VEZ SO
   *
   * `a_velho_sem` foi lembrado DUAS HORAS ATRAS e nunca respondeu. Se a 044
   * tivesse copiado `reminder_sent_at` para `reminder_last_at`, a espera de 2 h
   * ja estaria vencida e a cobranca sairia nesta PRIMEIRA passada -- para ele e
   * para todos os iguais a ele em producao, de uma vez. Quatro horas depois, o
   * lote inteiro cancelado.
   *
   * Foi este ensaio que mostrou isso: a conferencia abaixo pedia 1 cancelamento
   * e vieram 2. O conserto foi na migration, e esta linha e o que impede a
   * regressao. */
  const velho1 = r1.itens.find((x) => x.id === 'a_velho_sem');
  ok('o lembrado de duas horas atras NAO e cobrado na primeira passada',
     velho1.enviar, false);
  ok('porque o relogio da escalada comeca no deploy', velho1.motivo, 'ainda cedo');

  const c1 = await bd();
  const [e1] = await c1.query("SELECT reminder_stage, reminder_sent_at, reminder_last_at" +
    " FROM appointments WHERE id = 'a_novo'");
  await c1.end();
  ok('a etapa foi gravada', e1[0].reminder_stage, 1);
  ok('e o primeiro envio ficou registrado', !!e1[0].reminder_sent_at, true);

  // Duas horas depois: a cobrança.
  const r2 = await worker.umaClinica(db, cfg,
    { agora: new Date(Date.now() + 2 * 3600000 + 60000), enviar: envio });
  const l2 = r2.itens.find((x) => x.id === 'a_novo');
  ok('a 2a saiu', l2 && l2.enviado, true);
  ok('e e a etapa 2', l2.etapa, 2);
  ok('com o texto da profissional reservada', /profissional reservada/i.test(l2.mensagem), true);

  // Mais quatro: o cancelamento.
  const r3 = await worker.umaClinica(db, cfg,
    { agora: new Date(Date.now() + 6 * 3600000 + 120000), enviar: envio });
  const l3 = r3.itens.find((x) => x.id === 'a_novo');
  ok('a 3a saiu', l3 && l3.enviado, true);
  ok('e ela CANCELA', l3.cancela, true);
  /* DOIS, e nao um: `a_velho_sem` tambem percorreu a regua inteira ao longo
     destas tres passadas -- so que a partir do deploy, e nao retroativamente. */
  ok('a passada conta os cancelamentos', r3.cancelados, 2);

  const c3 = await bd();
  const [fim] = await c3.query("SELECT status, cancelled_reason, reminder_stage, notes" +
    " FROM appointments WHERE id = 'a_novo'");
  const [trilha] = await c3.query(
    "SELECT description FROM system_logs WHERE clinica_id = 'cl_1'" +
    " AND description LIKE '%cancelado automaticamente%'");
  await c3.end();
  ok('o horario esta CANCELADO no banco', fim[0].status, 'CANCELADO');
  ok('com o motivo escrito', /3 mensagens/.test(fim[0].cancelled_reason), true);
  ok('a etapa terminou em 3', fim[0].reminder_stage, 3);
  ok('e a trilha registra cada uma pelo nome', trilha.length, 2);
  ok('tres mensagens, nao mais', saiu.filter((x) => x.tel === '11911112222').length, 3);

  // Uma quarta passada não faz nada.
  const r4 = await worker.umaClinica(db, cfg,
    { agora: new Date(Date.now() + 10 * 3600000), enviar: envio });
  const l4 = r4.itens.find((x) => x.id === 'a_novo');
  ok('depois de cancelado ele some da varredura', l4, undefined);
}

console.log('\n[H] QUALQUER RESPOSTA PARA A REGUA, INCLUSIVE A QUE O SISTEMA NAO ENTENDE');
{
  const webhook = require('/home/claude/musa/server/routes/webhook-whatsapp.js');
  const c = await bd();
  await c.query(
    "INSERT INTO appointments (id,client_id,professional_id,title,starts_at,ends_at," +
    "status,kind,reminder_stage,reminder_sent_at,reminder_last_at,clinica_id) VALUES" +
    " ('a_resp','c2','u_adm','Peeling',?,?,'AGENDADO','ATENDIMENTO',1,NOW(),NOW(),'cl_1')",
    [emHoras(20), emHoras(21)]);
  await c.end();

  const r = await fetch(BASE + '/api/webhook/whatsapp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instance: 'inst-ensaio',
      data: { key: { remoteJid: '5511933334444@s.whatsapp.net', fromMe: false },
              pushName: 'Bruna', messageType: 'conversation',
              message: { conversation: 'posso chegar 10 minutos depois?' } }
    })
  });
  const corpo = await r.json();
  ok('o webhook aceitou', r.status, 200);
  /* ERA AQUI QUE A REGUA MATAVA O HORARIO. "posso chegar 10 minutos depois?"
     nao e "1" nem "2": antes da M6.7 a funcao saia no comeco e a paciente
     seguia como quem nao respondeu. */
  ok('e reconheceu como resposta livre', corpo.agenda && corpo.agenda.acao, 'RESPOSTA_LIVRE');

  const c2 = await bd();
  const [q] = await c2.query("SELECT status, reminder_reply_at FROM appointments WHERE id = 'a_resp'");
  await c2.end();
  ok('a resposta foi carimbada', !!q[0].reminder_reply_at, true);
  ok('e o horario continua de pe', q[0].status, 'AGENDADO');

  // E a régua para: nem cobrança, nem cancelamento.
  const worker = require('/home/claude/musa/server/workers/lembretes.js');
  const escopo = require('/home/claude/musa/server/db/escopo.js');
  const cfgSvc = require('/home/claude/musa/server/services/clinica-config.js');
  const db = escopo.paraClinica('cl_1', { autor: 'Sistema' });
  const cfg = await cfgSvc.lerLembrete(db);
  const rr = await worker.umaClinica(db, cfg,
    { agora: new Date(Date.now() + 8 * 3600000), enviar: async () => {} });
  const l = rr.itens.find((x) => x.id === 'a_resp');
  ok('a regua parou nela', l.enviar, false);
  ok('dizendo por que', l.motivo, 'paciente ja respondeu');

  const c3 = await bd();
  const [f] = await c3.query("SELECT status FROM appointments WHERE id = 'a_resp'");
  await c3.end();
  ok('e o horario nunca foi cancelado', f[0].status, 'AGENDADO');
}

console.log('\n[I] O "1" CONTINUA CONFIRMANDO');
{
  const c = await bd();
  await c.query("UPDATE clients SET phone = '11955556666' WHERE id = 'c1'");
  await c.query(
    "INSERT INTO appointments (id,client_id,professional_id,title,starts_at,ends_at," +
    "status,kind,reminder_stage,reminder_sent_at,reminder_last_at,clinica_id) VALUES" +
    " ('a_conf','c1','u_adm','Botox',?,?,'AGENDADO','ATENDIMENTO',1,NOW(),NOW(),'cl_1')",
    [emHoras(20), emHoras(21)]);
  await c.end();

  const r = await fetch(BASE + '/api/webhook/whatsapp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instance: 'inst-ensaio',
      data: { key: { remoteJid: '5511955556666@s.whatsapp.net', fromMe: false },
              pushName: 'Ana', messageType: 'conversation',
              message: { conversation: '1' } }
    })
  });
  const corpo = await r.json();
  ok('a acao e CONFIRMADO', corpo.agenda && corpo.agenda.acao, 'CONFIRMADO');
  const c2 = await bd();
  const [q] = await c2.query("SELECT status, reminder_reply_at FROM appointments WHERE id = 'a_conf'");
  await c2.end();
  ok('o compromisso foi confirmado', q[0].status, 'CONFIRMADO');
  ok('e a resposta tambem foi carimbada', !!q[0].reminder_reply_at, true);
}

const passaram = conf.filter(Boolean).length;
console.log('\n====================================================');
console.log('  ' + passaram + ' de ' + conf.length + ' conferencias passaram');
console.log('====================================================\n');
servidor.close();
process.exit(passaram === conf.length ? 0 : 1);

/** Ensaio da M6.4: o relatório impresso e a tela passam a dizer o mesmo número.
 *
 *  O bloco [B] é o que amarra a tarefa: o faturamento do PDF e o faturamento da
 *  Visão Geral saem do MESMO razão, no MESMO período. Até aqui um somava
 *  `treatment_sessions` e o outro o razão — e o papel é o que ia para a reunião.
 */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { createRequire } from 'module';
const require = createRequire('/home/claude/musa/');

const H = '127.0.0.1', P = 3307, U = 'musa', S = 'ensaio-local', B = 'musa_m64';
const raiz = await mysql.createConnection({ host: H, port: P, user: U, password: S, multipleStatements: true });
await raiz.query('DROP DATABASE IF EXISTS ' + B);
await raiz.query('CREATE DATABASE ' + B);
await raiz.end();

process.env.DB_HOST = H; process.env.DB_PORT = String(P); process.env.DB_USER = U;
process.env.DB_PASSWORD = S; process.env.DB_NAME = B; process.env.JWT_SECRET = 'repro-m64';

const conn = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B, multipleStatements: true });
await require('/home/claude/musa/db/run-migrations.js')(conn, {});
await conn.query("INSERT IGNORE INTO clinicas (id, nome) VALUES ('cl_2', 'Clinica Vizinha')");
const senha = bcrypt.hashSync('SenhaDeEnsaio2026', 10);
for (const [id, nome, email, papel, cl] of [
  ['u_adm', 'Dra Musa', 'adm@ensaio.invalido', 'admin', 'cl_1'],
  ['u_viz', 'Vizinha', 'viz@ensaio.invalido', 'admin', 'cl_2']
]) {
  await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id) VALUES (?,?,?,?,?,?,?)',
    [id, nome, email, senha, papel, 'active', cl]);
}
await conn.query("INSERT INTO clients (id,name,phone,clinica_id) VALUES" +
  " ('c1','Ana Paula','11911112222','cl_1')," +
  " ('c2','Beatriz Lima','11922223333','cl_1')," +
  " ('cv','Vizinha Paciente','11933334444','cl_2')");

const DE = '2026-09-01', ATE = '2026-09-30';

/* O RAZÃO: 12.000 de receita em setembro, e mais 5.000 em agosto -- que NÃO
   pode aparecer no relatório de setembro. */
await conn.query(
  "INSERT INTO cash_entries (id, type, amount, description, entry_date, paid_at, clinica_id) VALUES" +
  " ('ce1','RECEITA',7000,'Pacote Ana','2026-09-10','2026-09-10','cl_1')," +
  " ('ce2','RECEITA',5000,'Pacote Beatriz','2026-09-20','2026-09-20','cl_1')," +
  " ('ce3','RECEITA',5000,'Agosto','2026-08-15','2026-08-15','cl_1')," +
  " ('ce4','DESPESA',2000,'Aluguel','2026-09-05',NULL,'cl_1')," +
  " ('cev','RECEITA',99000,'Da vizinha','2026-09-12','2026-09-12','cl_2')");

/* AS SESSÕES somam OUTRO valor de propósito (9.000): é a divergência que o
   relatório escondia ao ler daqui em vez do razão. */
await conn.query("INSERT INTO treatment_plans (id, client_id, title, total_sessions, status, clinica_id) VALUES" +
  " ('pl1','c1','Protocolo Ana',3,'ATIVO','cl_1')," +
  " ('pl2','c1','Segundo da Ana',2,'ATIVO','cl_1')," +
  " ('pl3','c2','Protocolo Beatriz',2,'ATIVO','cl_1')");
await conn.query("INSERT INTO treatment_sessions (id, plan_id, session_number, session_type, status, session_date, price, clinica_id) VALUES" +
  " ('s1','pl1',1,'SESSAO_TRATAMENTO','REALIZADA','2026-09-10',3000,'cl_1')," +
  " ('s2','pl1',2,'SESSAO_TRATAMENTO','REALIZADA','2026-09-17',3000,'cl_1')," +
  " ('s3','pl3',1,'AVALIACAO_INICIAL','REALIZADA','2026-09-20',3000,'cl_1')");

/* ATENDIMENTOS concluídos: duas pacientes distintas, três sessões. */
await conn.query("INSERT INTO appointments (id, client_id, professional_id, title, starts_at, ends_at, status, kind, clinica_id) VALUES" +
  " ('ap1','c1','u_adm','Sessao 1','2026-09-10 09:00:00','2026-09-10 10:00:00','REALIZADO','ATENDIMENTO','cl_1')," +
  " ('ap2','c1','u_adm','Sessao 2','2026-09-17 09:00:00','2026-09-17 10:00:00','REALIZADO','ATENDIMENTO','cl_1')," +
  " ('ap3','c2','u_adm','Avaliacao','2026-09-20 09:00:00','2026-09-20 10:00:00','REALIZADO','ATENDIMENTO','cl_1')");

/* LEADS: 5 no período. Um fechou (arquivado), um está em "Proposta Enviada"
   (agendado) -- que a conta antiga contava como convertido. */
await conn.query("INSERT INTO leads (id, name, whatsapp, treatment, status, source, date, converted_at, clinica_id) VALUES" +
  " ('l1','Lead Novo','11900000001','X','novo','meta_ads','2026-09-02',NULL,'cl_1')," +
  " ('l2','Lead Contatado','11900000002','X','contatado','meta_ads','2026-09-03',NULL,'cl_1')," +
  " ('l3','Lead Proposta','11900000003','X','agendado','google_ads','2026-09-04',NULL,'cl_1')," +
  " ('l4','Lead Fechado','11900000004','X','arquivado','meta_ads','2026-09-05','2026-09-09','cl_1')," +
  " ('l5','Lead Perdido','11900000005','X','perdido','site','2026-09-06',NULL,'cl_1')");

/* CONVERSAS: a Ana espera 15 min; a Beatriz manda três seguidas e espera 45;
   uma terceira fica sem resposta. */
await conn.query("INSERT INTO interactions (id, client_id, type, content, direction, created_at, clinica_id) VALUES" +
  " ('i1','c1','whatsapp','oi','in','2026-09-10 14:00:00','cl_1')," +
  " ('i2','c1','whatsapp','oi!','out','2026-09-10 14:15:00','cl_1')," +
  " ('i3','c2','whatsapp','ola','in','2026-09-11 14:10:00','cl_1')," +
  " ('i4','c2','whatsapp','tem horario?','in','2026-09-11 14:20:00','cl_1')," +
  " ('i5','c2','whatsapp','?','in','2026-09-11 14:30:00','cl_1')," +
  " ('i6','c2','whatsapp','temos sim','out','2026-09-11 14:55:00','cl_1')," +
  " ('i7','c1','whatsapp','e amanha?','in','2026-09-25 09:00:00','cl_1')");
await conn.end();

const app = require('/home/claude/musa/server/app.js');
const servidor = app.listen(4199);
await new Promise((r) => servidor.on('listening', r));
const BASE = 'http://127.0.0.1:4199';

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

const conf = [];
const ok = (nome, real, esperado) => {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  conf.push(passou);
  console.log((passou ? '  OK  ' : '  XX  ') + nome +
    (passou ? '' : '   esperado ' + JSON.stringify(esperado) + ', veio ' + JSON.stringify(real)));
};

const adm = await entrar('adm@ensaio.invalido');
const viz = await entrar('viz@ensaio.invalido');
const periodo = { inicio: DE, fim: ATE + 'T23:59:59' };
const gerar = (aba, p) => chamar(adm, 'POST', '/api/reports/generate',
  { aba: aba, periodo: p === undefined ? periodo : p });

console.log('\n[A] O PDF SEGUE O FILTRO DA TELA');
{
  const r = await gerar('VISÃO GERAL');
  ok('o relatorio sai', r.status, 200);
  ok('e diz que seguiu o filtro', r.corpo.periodo.seguiuOFiltro, true);
  ok('com o periodo pedido', String(r.corpo.periodo.inicio).slice(0, 10), DE);

  const semFiltro = await gerar('VISÃO GERAL', null);
  ok('sem filtro, ele avisa que consolidou o mes', semFiltro.corpo.periodo.seguiuOFiltro, false);
}

console.log('\n[B] O FATURAMENTO DO PDF E O DA TELA');
{
  const pdf = await gerar('VISÃO GERAL');
  const tela = await chamar(adm, 'GET', '/api/dashboard/dinheiro?from=' + DE + '&to=' + ATE);

  /* ERA AQUI QUE OS DOIS DIVERGIAM: as sessoes somam 9.000 e o razao 12.000.
     O papel impresso dizia 9.000 e a tela dizia 12.000, sem nada avisar. */
  ok('o PDF traz o razao', pdf.corpo.data.faturamentoTotal, 12000);
  ok('e a tela traz o mesmo numero', tela.corpo.faturamento.valor, 12000);
  ok('o PDF diz de onde o numero veio',
    /razão/.test(pdf.corpo.data.faturamentoFonte || ''), true);
  ok('agosto nao entra em setembro', pdf.corpo.data.faturamentoTotal !== 17000, true);
  ok('e o dinheiro da vizinha tambem nao', pdf.corpo.data.faturamentoTotal !== 111000, true);
}

console.log('\n[C] O TICKET MEDIO DIVIDE POR PACIENTE, NAO POR SESSAO');
{
  const r = await gerar('VISÃO GERAL');
  // 12.000 / 2 pacientes distintas = 6.000. Por sessao seriam 4.000.
  ok('duas pacientes atendidas', r.corpo.data.pacientesAtendidas, 2);
  ok('e o ticket e por paciente', r.corpo.data.ticketMedio, 6000);
}

console.log('\n[D] CONVERTIDO E VENDA FECHADA');
{
  const r = await gerar('VISÃO GERAL');
  /* A conta antiga contava `agendado` (Proposta Enviada): daria 20% tambem,
     mas apontando para o lead ERRADO -- e uma clinica que fechasse tudo
     imprimiria 0%. O detalhe diz quem foi contado. */
  ok('um de cinco fechou', r.corpo.data.conversaoDetalhe.fechados, 1);
  ok('a taxa e 20%', r.corpo.data.taxaConversao, 20);
}

console.log('\n[E] O TEMPO DE CONVERSAO E MEDIDO, E NAO 3,5 FIXO');
{
  const r = await gerar('FUNIL');
  ok('o funil sai', r.status, 200);
  // l4 entrou em 05/09 e converteu em 09/09 -> 4 dias.
  ok('o tempo vem de converted_at', r.corpo.data.tempoMedioConversaoEmDias, 4);
  ok('e a amostra vai junto', r.corpo.data.tempoConversaoAmostra, 1);
  ok('nao e mais 3.5', r.corpo.data.tempoMedioConversaoEmDias !== 3.5, true);

  const canais = r.corpo.data.performancePorCanal;
  const meta = canais.filter((c) => c.nome === 'meta_ads')[0];
  ok('o canal conta as vendas fechadas', [meta.leads, meta.convertidos], [3, 1]);
}

console.log('\n[F] OS ANIVERSARIOS SAIRAM DA FOLHA');
{
  const r = await gerar('PACIENTES');
  ok('o relatorio de pacientes sai', r.status, 200);
  /* `clients` NAO TEM data de nascimento. A lista era calculada pela posicao
     da paciente no resultado, com nome e telefone REAIS ao lado. */
  ok('nao ha mais lista de aniversariantes',
    r.corpo.data.alertasAniversario === undefined, true);
  ok('a taxa de retorno e medida', r.corpo.data.taxaRetorno, 50);   // 1 de 2
  ok('e diz sobre quantas pacientes', r.corpo.data.retornoDetalhe, { pct: 50, comMaisDeUm: 1, total: 2 });
}

console.log('\n[G] O ATENDIMENTO DEIXA DE TER NUMERO INVENTADO');
{
  const r = await gerar('ATENDIMENTO');
  ok('o relatorio sai', r.status, 200);
  /* Ana esperou 15 min; Beatriz mandou tres seguidas e esperou 45 desde a
     PRIMEIRA. Mediana de [15, 45] = 30. */
  ok('o tempo de resposta e medido', r.corpo.data.tempoMedioResposta, 30);
  ok('sobre duas respostas', r.corpo.data.respostaAmostra, 2);
  ok('e a conversa sem resposta aparece', r.corpo.data.conversasSemResposta, 1);
  ok('a satisfacao inventada saiu', r.corpo.data.satisfacaoMedia === undefined, true);
  ok('as mensagens sao contadas dos dois lados',
    [r.corpo.data.recebidas, r.corpo.data.enviadas], [5, 2]);
  ok('e o horario de pico e real', r.corpo.data.horarioPico, '14:00 - 15:00');
}

console.log('\n[H] SEM DADO, O RELATORIO DIZ NULO -- E NAO UM NUMERO PLAUSIVEL');
{
  const vazio = { inicio: '2026-01-01', fim: '2026-01-31T23:59:59' };
  const g = await gerar('VISÃO GERAL', vazio);
  ok('faturamento zero e zero mesmo', g.corpo.data.faturamentoTotal, 0);
  ok('mas o ticket sem paciente e NULO', g.corpo.data.ticketMedio, null);
  ok('e a conversao sem lead tambem', g.corpo.data.taxaConversao, null);

  const f = await gerar('FUNIL', vazio);
  ok('o tempo de conversao sem venda e NULO', f.corpo.data.tempoMedioConversaoEmDias, null);

  const a = await gerar('ATENDIMENTO', vazio);
  ok('o tempo de resposta sem mensagem e NULO', a.corpo.data.tempoMedioResposta, null);
  ok('e o horario de pico tambem', a.corpo.data.horarioPico, null);
}

console.log('\n[I] A CLINICA VIZINHA');
{
  const r = await chamar(viz, 'POST', '/api/reports/generate',
    { aba: 'VISÃO GERAL', periodo: periodo });
  ok('ela le o relatorio dela', r.status, 200);
  ok('com o dinheiro dela', r.corpo.data.faturamentoTotal, 99000);
  ok('e nenhum lead nosso', r.corpo.data.conversaoDetalhe.total, 0);
}

const passaram = conf.filter(Boolean).length;
console.log('\n====================================================');
console.log('  ' + passaram + ' de ' + conf.length + ' conferencias passaram');
console.log('====================================================\n');
servidor.close();
process.exit(passaram === conf.length ? 0 : 1);

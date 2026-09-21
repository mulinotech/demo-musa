/** A M5.11 vista do navegador.
 *
 *  O bloco que importa é o [3]: abrir a janela de uma sessão antiga e salvar
 *  SEM tocar em nada não pode apagar o equipamento que estava lá.
 */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { chromium } from 'playwright';
import { createRequire } from 'module';
const require = createRequire('/home/claude/musa/');

const H = '127.0.0.1', P = 3307, U = 'musa', S = 'ensaio-local', B = 'musa_m511_nav';
const raiz = await mysql.createConnection({ host: H, port: P, user: U, password: S, multipleStatements: true });
await raiz.query('DROP DATABASE IF EXISTS ' + B);
await raiz.query('CREATE DATABASE ' + B);
await raiz.end();

process.env.DB_HOST = H; process.env.DB_PORT = String(P); process.env.DB_USER = U;
process.env.DB_PASSWORD = S; process.env.DB_NAME = B;
process.env.JWT_SECRET = 'nav-m511'; process.env.GEMINI_API_KEY = 'falsa';

const conn = await mysql.createConnection({ host: H, port: P, user: U, password: S, database: B, multipleStatements: true });
await require('/home/claude/musa/db/run-migrations.js')(conn, {});
await conn.query('INSERT INTO users (id,name,email,password_hash,role,status,clinica_id) VALUES (?,?,?,?,?,?,?)',
  ['u_adm', 'Dra Musa', 'adm@ensaio.invalido', bcrypt.hashSync('SenhaDeEnsaio2026', 10), 'admin', 'active', 'cl_1']);
await conn.query("INSERT INTO clients (id,name,phone,clinica_id) VALUES ('c1','Ana Paula','11998765432','cl_1')");
await conn.query("INSERT INTO treatment_plans (id,client_id,title,total_sessions,status,clinica_id)" +
  " VALUES ('p1','c1','Protocolo Facial',3,'ATIVO','cl_1')");
/* A sessao de marco, lancada com o equipamento DIGITADO A MAO -- antes de o
   cadastro existir. E' ela que nao pode perder o dado. */
await conn.query("INSERT INTO treatment_sessions (id,plan_id,session_number,session_type,status," +
  "equipments_used,supplies_applied,professional_in_charge,clinica_id) VALUES" +
  " ('s1','p1',1,'SESSAO_TRATAMENTO','REALIZADA','ultra former','Ácido Hialurônico, Bioestimulador Y','Dra Musa','cl_1')");
await conn.query("INSERT INTO treatment_sessions (id,plan_id,session_number,session_type,status,clinica_id)" +
  " VALUES ('s2','p1',2,'SESSAO_TRATAMENTO','PENDENTE','cl_1')");
await conn.end();

const app = require('/home/claude/musa/server/app.js');
const servidor = app.listen(4186);
await new Promise((r) => servidor.on('listening', r));
const BASE = 'http://127.0.0.1:4186';

const conf = [];
const ok = (nome, real, esperado) => {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  conf.push(passou);
  console.log((passou ? '  OK  ' : '  XX  ') + nome +
    (passou ? '' : '   esperado ' + JSON.stringify(esperado) + ', veio ' + JSON.stringify(real)));
};
const bd = () => mysql.createConnection({ host: H, port: P, user: U, password: S, database: B });

const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pag = await nav.newPage({ viewport: { width: 1600, height: 1000 } });

await pag.goto(BASE + '/login');
await pag.fill('input[type="email"]', 'adm@ensaio.invalido');
await pag.fill('input[type="password"]', 'SenhaDeEnsaio2026');
await pag.click('button[type="submit"]');
await pag.waitForURL(/crm/, { timeout: 15000 });

console.log('\n[1] CADASTROS -> EQUIPAMENTOS');
{
  await pag.goto(BASE + '/crm/cadastros');
  await pag.click('button:has-text("Equipamentos")');
  await pag.waitForTimeout(1200);
  const vazio = await pag.locator('body').innerText();
  ok('a lista vazia diz o que fazer, em vez de so ficar vazia',
    /nenhum equipamento cadastrado/i.test(vazio), true);
  ok('e avisa que o campo da sessao segue aceitando texto ate la',
    /continua aceitando texto digitado/i.test(vazio), true);

  await pag.fill('input[placeholder="Ex: Ultraformer MPT"]', 'Ultraformer MPT');
  await pag.click('button:has-text("Cadastrar")');
  await pag.waitForTimeout(1200);
  ok('o equipamento aparece na lista',
    /Ultraformer MPT/.test(await pag.locator('body').innerText()), true);
}

console.log('\n[2] A JANELA DA SESSAO PASSA A TER LISTA');
{
  await pag.goto(BASE + '/crm/pacientes');
  await pag.waitForTimeout(2000);
  await pag.click('text=Ana Paula');
  await pag.waitForTimeout(1500);

  // A sessao 2, ainda pendente: nada gravado nela. O botao e o "Evolucao / Status"
  // da linha dela.
  await pag.locator('button:has-text("Evolução / Status")').nth(1).click();
  await pag.waitForSelector('text=Lançar Evolução Estética', { timeout: 10000 });

  const opcoes = await pag.locator('select').last().locator('option').allInnerTexts();
  ok('o equipamento cadastrado esta na lista', opcoes.includes('Ultraformer MPT'), true);
  ok('e ainda da para digitar um que nao esta cadastrado',
    opcoes.some((o) => /Outro \(digitar\)/.test(o)), true);
  await pag.click('button:has-text("Cancelar")');
  await pag.waitForTimeout(600);
}

console.log('\n[3] O QUE IMPORTA: a sessao antiga nao perde o que ja tinha');
{
  // A sessao 1 e a PRIMEIRA linha da lista; o botao dela e o primeiro da pagina.
  await pag.locator('button:has-text("Evolução / Status")').first().click();
  await pag.waitForSelector('text=Lançar Evolução Estética', { timeout: 10000 });

  const tela = await pag.locator('body').innerText();
  /* "ultra former" foi digitado antes de o cadastro existir, e nao casa com
     "Ultraformer MPT" -- de proposito: casar por aproximacao juntaria o que a
     clinica sabe separar. Entao ele aparece como opcao propria, MARCADA. */
  ok('o equipamento digitado antes aparece', /ultra former/i.test(tela), true);
  ok('e a tela diz que ele veio de digitacao', /digitado antes/i.test(tela), true);
  ok('os dois insumos antigos continuam marcados',
    /Ácido Hialurônico/.test(tela) && /Bioestimulador Y/.test(tela), true);

  // Salvar SEM tocar em nada.
  await pag.click('button:has-text("Salvar Evolução")');
  await pag.waitForTimeout(2000);

  const c = await bd();
  const [r] = await c.query(
    "SELECT equipments_used, supplies_applied, professional_in_charge FROM treatment_sessions WHERE id = 's1'");
  await c.end();
  ok('o equipamento continua gravado', r[0].equipments_used, 'ultra former');
  /* Ordem preservada: a primeira versao da regra devolvia os insumos na ordem
     da tela, e ordem de insumo pode ser ordem de aplicacao. */
  ok('os insumos continuam, e NA MESMA ORDEM',
    r[0].supplies_applied, 'Ácido Hialurônico, Bioestimulador Y');
  ok('e a profissional continua a mesma', r[0].professional_in_charge, 'Dra Musa');
}

console.log('\n[4] INATIVAR PRECISA ESTAR ESCRITO NA TELA');
{
  /* A primeira versao punha so uma LIXEIRA aqui. A Silvia leu como "excluir",
     nao achou onde inativar, e por isso nao conseguiu testar o passo seguinte.
     Icone que promete apagar numa acao que NAO apaga e' o defeito da semana em
     forma de desenho. */
  await pag.goto(BASE + '/crm/cadastros');
  await pag.click('button:has-text("Equipamentos")');
  await pag.waitForTimeout(1200);

  const tela = await pag.locator('body').innerText();
  ok('a palavra "Inativar" esta num botao', /inativar/i.test(tela), true);
  ok('e a tela explica o que inativar faz, antes de alguem clicar',
    /sess[õo]es j[áa] lan[çc]adas com ele continuam/i.test(tela), true);

  await pag.click('button:has-text("Inativar")');
  await pag.waitForTimeout(1500);
  const depois = await pag.locator('body').innerText();
  ok('ele vai para a faixa de inativos', /não aparecem na hora de lançar/i.test(depois), true);
  ok('e da para reativar', /reativar/i.test(depois), true);

  /* O ITEM QUE A SILVIA NAO CONSEGUIU TESTAR: sem nenhum ativo, o campo da
     sessao NAO pode travar -- ele volta a aceitar texto digitado. */
  ok('sem nenhum ativo, a lista avisa que o campo volta a aceitar texto',
    /continua aceitando texto digitado/i.test(depois), true);

  await pag.goto(BASE + '/crm/pacientes');
  await pag.waitForTimeout(2000);
  await pag.click('text=Ana Paula');
  await pag.waitForTimeout(1500);
  await pag.locator('button:has-text("Evolução / Status")').nth(1).click();
  await pag.waitForSelector('text=Lançar Evolução Estética', { timeout: 10000 });

  const rotulos = await pag.locator('label').allInnerTexts();
  const iEquip = rotulos.findIndex((t) => /EQUIPAMENTO/i.test(t));
  ok('o campo de equipamento continua existindo', iEquip >= 0, true);
  const campos = await pag.locator('input[type="text"]').count();
  ok('e virou campo de digitar, em vez de trancar o lancamento', campos > 0, true);
}

await pag.screenshot({ path: '/tmp/claude-0/m511-sessao.png', fullPage: false });
await nav.close();

const passaram = conf.filter(Boolean).length;
console.log('\n====================================================');
console.log('  ' + passaram + ' de ' + conf.length + ' conferencias passaram');
console.log('====================================================\n');
servidor.close();
process.exit(passaram === conf.length ? 0 : 1);

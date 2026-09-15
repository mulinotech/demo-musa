'use strict';
/** CRIAR UM OPERADOR DA PLATAFORMA — o único jeito de nascer o primeiro (M3.1).
 *
 *  ================================================= POR QUE É UM COMANDO, E NÃO UMA TELA
 *
 *  Porque a primeira credencial não tem por onde nascer: a tela da plataforma
 *  exige estar dentro da plataforma. É o mesmo problema do primeiro usuário de
 *  qualquer sistema, e a saída de sempre é o console de quem tem o servidor.
 *
 *  ======================================================== A SENHA NÃO PASSA POR NINGUÉM
 *
 *  Ela é digitada aqui, **sem eco na tela**, e vira `password_hash` antes de
 *  qualquer outra coisa acontecer. Ela não vai em argumento de linha de comando
 *  (ficaria no histórico do shell e na lista de processos), não vai em variável
 *  de ambiente, não é registrada em log e não aparece na saída. Quem roda este
 *  comando é a única pessoa que a conhece.
 *
 *  ============================================================ COMO SE USA
 *
 *      cd /srv/.../www
 *      source /srv/.../activate
 *      node scripts/criar-operador.js
 *
 *  Ele pergunta nome, e-mail e senha (duas vezes), e diz o que criou — sem a
 *  senha.
 *
 *  ==================================================== POR QUE 12 E NÃO 10
 *
 *  A senha de administrador de clínica exige 10 caracteres. Esta exige 12: ela
 *  não abre uma clínica, abre **a lista de todas elas**. A diferença de duas
 *  letras é barata para quem digita uma vez e cara para quem tenta adivinhar.
 */
const path = require('path');
const readline = require('readline');
const bcrypt = require('bcryptjs');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (e) {
  // dotenv e opcional, como no app
}

const { pool } = require('../server/db');

const SENHA_MINIMA = 12;

function perguntar(rl, texto) {
  return new Promise(function (ok) { rl.question(texto, ok); });
}

/** Pergunta sem ecoar. O truque é substituir a escrita da saída enquanto a
 *  resposta está sendo digitada — sem isso, a senha fica na tela, e a tela de um
 *  terminal SSH costuma ficar aberta e visível. */
function perguntarSenha(rl, texto) {
  return new Promise(function (ok) {
    const escrever = rl.output.write.bind(rl.output);
    let mudo = false;
    rl.output.write = function (s) { if (!mudo) escrever(s); };
    rl.question(texto, function (r) {
      rl.output.write = escrever;
      escrever('\n');
      ok(r);
    });
    mudo = true;
  });
}

function novoId() {
  return 'op_' + Math.random().toString(36).slice(2, 10);
}

(async function () {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let codigo = 0;
  try {
    console.log('\n=== Novo operador da PLATAFORMA ===');
    console.log('Este acesso administra as clinicas e NAO le dado de paciente nenhum.\n');

    const nome = (await perguntar(rl, 'Nome: ')).trim();
    const email = (await perguntar(rl, 'E-mail: ')).trim().toLowerCase();
    const senha = await perguntarSenha(rl, 'Senha (nao aparece): ');
    const outraVez = await perguntarSenha(rl, 'Repita a senha: ');

    if (!nome) throw new Error('O operador precisa de um nome.');
    if (!email || email.indexOf('@') === -1) throw new Error('Informe um e-mail valido.');
    if (senha !== outraVez) throw new Error('As duas senhas nao sao iguais. Nada foi criado.');
    if (senha.length < SENHA_MINIMA) {
      throw new Error('A senha precisa ter ao menos ' + SENHA_MINIMA + ' caracteres.');
    }

    const [jaExiste] = await pool.query('SELECT id FROM operadores WHERE email = ?', [email]);
    if (jaExiste.length) throw new Error('Ja existe um operador com este e-mail.');

    /* Aviso, e nao recusa: o mesmo endereco pode existir nos dois mundos de
     * proposito -- a dona da Mulino e administradora da Musa E operadora da
     * plataforma. Sao duas portas de login e duas senhas, e e bom que quem
     * cadastra saiba disso no momento em que cria, e nao no dia em que a senha
     * "nao funcionar" na porta errada. */
    const [noCrm] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);

    const id = novoId();
    await pool.query(
      'INSERT INTO operadores (id, nome, email, password_hash) VALUES (?, ?, ?, ?)',
      [id, nome, email, bcrypt.hashSync(senha, 10)]);

    await pool.query(
      'INSERT INTO system_logs (id, action_type, description, author, clinica_id)' +
      ' VALUES (?, ?, ?, ?, NULL)',
      ['lg_' + Date.now().toString(36), 'PLATAFORMA_OPERADOR_CRIADO',
       'Operador da plataforma "' + nome + '" (' + email + ') criado pelo console do servidor.',
       'Console do servidor']);

    console.log('\nOK. Operador ' + id + ' criado.');
    console.log('Entre em  /plataforma  com ' + email + ' e a senha que voce digitou.');
    if (noCrm.length) {
      console.log('\nAviso: este e-mail TAMBEM existe como acesso de clinica no CRM.');
      console.log('Sao duas portas diferentes, com senhas diferentes:');
      console.log('  /        -> o CRM da clinica');
      console.log('  /plataforma -> a administracao das clinicas');
    }
  } catch (e) {
    console.error('\nPAROU, e nada foi criado: ' + (e && e.message));
    codigo = 1;
  } finally {
    rl.close();
    await pool.end().catch(function () {});
    process.exit(codigo);
  }
})();

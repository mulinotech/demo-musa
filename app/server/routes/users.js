'use strict';
/** A gestão de acessos — quem entra no sistema, com que papel.
 *
 *  ================================================= O QUE A M1.6b MUDOU AQUI
 *
 *  A criação já carimbava a clínica desde a M0.3 — foi o primeiro lugar do
 *  sistema a gravar a coluna. O que faltava era todo o resto:
 *
 *  - a **listagem** trazia os usuários de todas as clínicas, com nome, e-mail,
 *    papel e último acesso;
 *  - o **PATCH** aceitava id de qualquer clínica: a proprietária da Clínica A
 *    podia inativar, rebaixar ou **trocar a senha** de um usuário da Clínica B.
 *    Não é vazamento de dado — é uma porta: com a senha trocada, ela entra na
 *    conta da vizinha;
 *  - e a trava do **"último administrador ativo"** contava admins do sistema
 *    inteiro.
 *
 *  ================= A TRAVA DO ULTIMO ADMINISTRADOR ERRAVA PARA OS DOIS LADOS
 *
 *  Este é o detalhe que só aparece contando: uma contagem global não é "mais
 *  segura", é errada nas duas direções — e a primeira é a que tranca gente do
 *  lado de fora.
 *
 *  - **Permitia demais.** Com 50 clínicas há dezenas de admins ativos, então a
 *    contagem nunca chegaria a 1. A Clínica A poderia inativar a **própria
 *    única** administradora e ficar sem ninguém que abra a tela de usuários —
 *    que é exatamente o acidente que esta trava existe para impedir, e que ela
 *    deixaria de impedir.
 *  - **Impedia de menos, e no lugar errado.** Se a soma global chegasse a 1, a
 *    recusa cairia sobre uma clínica que tem três admins, por causa do estado
 *    de outra. E a mensagem diria "este é o único administrador ativo" sobre
 *    uma conta que não é única em clínica nenhuma que aquela pessoa possa ver.
 *
 *  A contagem agora é **por clínica**, e `verificarAlteracao` não mudou uma
 *  linha: ela sempre recebeu o número já contado, e continua pura e testável
 *  sem banco. O defeito estava na consulta, não na regra.
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');
const logs = require('../services/logs');
const { verificarAlteracao } = require('../services/usuarios');

const PAPEIS_VALIDOS = ['admin', 'gerente', 'profissional', 'vendedor'];

router.get('/api/users', async function (req, res) {
  const db = escopo(req);
  try {
    const [r] = await db.q(
      'SELECT id, name, email, role, status, last_login_at, created_at' +
      ' FROM users WHERE clinica_id = :clinica ORDER BY name'
    );
    res.json(r);
  } catch (e) {
    console.error('[usuarios]', e && e.message);
    res.status(500).json({ error: 'Falha ao listar usuarios.' });
  }
});


router.post('/api/users', express.json({ limit: '1mb' }), async function (req, res) {
  const bcrypt = require('bcryptjs');
  const db = escopo(req);
  const b = req.body || {};
  const nome = (b.name || '').trim();
  const email = (b.email || '').trim().toLowerCase();
  const senha = b.password || '';
  const papel = PAPEIS_VALIDOS.indexOf(b.role) !== -1 ? b.role : 'vendedor';
  if (!nome || !email || !senha) return res.status(400).json({ error: 'Nome, e-mail e senha sao obrigatorios.' });
  if (String(senha).length < 10) return res.status(400).json({ error: 'A senha precisa ter ao menos 10 caracteres.' });
  try {
    const id = 'u_' + Math.random().toString(36).slice(2, 10);

    // A CLINICA DO NOVO USUARIO E A DE QUEM O ESTA CRIANDO (M0.3).
    //
    // Vem da sessao, nunca do corpo da requisicao: aceitar `clinica_id` do
    // cliente deixaria a proprietaria da clinica A criar um acesso dentro da
    // clinica B -- que e o pior tipo de furo, porque nao vaza dado, cria uma
    // porta.
    //
    // Desde a M1.6b isto passa pela camada, como todo o resto: e ela que troca
    // `:clinica` pelo valor da sessao, e que recusa consulta de rota sem filtro.
    await db.q(
      'INSERT INTO users (id, name, email, password_hash, role, clinica_id)' +
      ' VALUES (?, ?, ?, ?, ?, :clinica)',
      [id, nome, email, bcrypt.hashSync(String(senha), 10), papel]);

    await logs.registrar(db, 'USUARIO',
      'Acesso criado para "' + nome + '" com o papel ' + papel + '.');

    res.status(201).json({ id: id, name: nome, email: email, role: papel });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      // NAO diga "ja existe usuario com esse e-mail".
      //
      // `users.email` e unico entre TODAS as clinicas (decisao de produto de
      // 04/09), entao a recusa pode estar vindo de um cadastro que existe em
      // OUTRA clinica. Dizer "ja existe" conta a esta clinica que aquele
      // endereco esta em uso em algum lugar da plataforma -- e informacao de um
      // cliente escapando para outro. Pouca, mas de graca para quem quiser
      // sondar: basta tentar cadastrar e-mails e ler a resposta.
      //
      // A recusa continua existindo; o que muda e nao explicar o motivo.
      // Ha teste em tests/multi-inquilino.test.js fixando esta frase, porque
      // e o tipo de mensagem que alguem "melhora" para ser mais util.
      return res.status(409).json({ error: 'Este e-mail nao esta disponivel. Use outro endereco.' });
    }
    console.error('[usuarios]', e && e.message);
    res.status(500).json({ error: 'Falha ao criar usuario.' });
  }
});


router.patch('/api/users/:id', express.json({ limit: '1mb' }), async function (req, res) {
  const bcrypt = require('bcryptjs');
  const db = escopo(req);
  const b = req.body || {};
  const campos = [], valores = [];
  if (b.name) { campos.push('name = ?'); valores.push(String(b.name).trim()); }
  if (b.role && PAPEIS_VALIDOS.indexOf(b.role) !== -1) { campos.push('role = ?'); valores.push(b.role); }
  if (b.status === 'active' || b.status === 'inactive') { campos.push('status = ?'); valores.push(b.status); }
  if (b.password) {
    if (String(b.password).length < 10) return res.status(400).json({ error: 'A senha precisa ter ao menos 10 caracteres.' });
    campos.push('password_hash = ?'); valores.push(bcrypt.hashSync(String(b.password), 10));
  }
  if (!campos.length) return res.status(400).json({ error: 'Nada para atualizar.' });
  try {
    // Guarda contra os dois cliques que trancam todo mundo do lado de fora --
    // agora conferindo primeiro que o usuario e DESTA clinica.
    const [alvos] = await db.q(
      'SELECT id, name, role, status FROM users WHERE clinica_id = :clinica AND id = ?',
      [req.params.id]);
    if (!alvos.length) return res.status(404).json({ error: 'Usuario nao encontrado.' });

    const [contagem] = await db.q(
      "SELECT COUNT(*) AS n FROM users" +
      " WHERE clinica_id = :clinica AND role = 'admin' AND status = 'active'"
    );
    const impedimento = verificarAlteracao({
      solicitanteId: req.usuario && req.usuario.sub,
      alvo: alvos[0],
      mudanca: b,
      adminsAtivos: Number(contagem[0].n)
    });
    if (impedimento) return res.status(impedimento.status).json({ error: impedimento.error });

    valores.push(req.params.id);
    await db.q(
      'UPDATE users SET ' + campos.join(', ') + ' WHERE clinica_id = :clinica AND id = ?',
      valores);

    // O QUE mudou entra na trilha; a senha nova, nunca -- nem o tamanho dela.
    const oQueMudou = [];
    if (b.name) oQueMudou.push('nome');
    if (b.role) oQueMudou.push('papel para ' + b.role);
    if (b.status) oQueMudou.push(b.status === 'inactive' ? 'acesso INATIVADO' : 'acesso reativado');
    if (b.password) oQueMudou.push('senha redefinida');
    await logs.registrar(db, 'USUARIO',
      'Acesso de "' + alvos[0].name + '" alterado: ' + oQueMudou.join(', ') + '.');

    res.json({ ok: true });
  } catch (e) {
    console.error('[usuarios]', e && e.message);
    res.status(500).json({ error: 'Falha ao atualizar usuario.' });
  }
});

module.exports = router;

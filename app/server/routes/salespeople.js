'use strict';
/** A equipe comercial — vendedores e gerentes do funil.
 *
 *  ================================================= O QUE A M1.6 MUDOU AQUI
 *
 *  As cinco consultas não filtravam. A listagem entregava nome, e-mail e
 *  WhatsApp da equipe da vizinha; e como `salespeople.id` é único no banco
 *  inteiro, com o id na mão uma clínica **alterava o cargo** ou **excluía** um
 *  vendedor da outra — e o vendedor excluído é quem responde pelos leads dele.
 *
 *  ============================ E UM ACHADO QUE NAO E DE MULTI-INQUILINO
 *
 *  `salespeople.password` guarda a senha **em texto puro**. A coluna nasceu
 *  antes do login por `users` e hoje não autentica mais nada — a migration 004
 *  já transformou essas senhas em hash dentro de `users.password_hash`. Mas
 *  duas coisas continuavam acontecendo:
 *
 *  - `GET /api/salespeople` fazia `SELECT *`, ou seja **devolvia a senha em
 *    texto ao navegador**. E esta rota não tem regra de papel: qualquer sessão
 *    autenticada a alcança, inclusive um `vendedor` — que passava a ler a senha
 *    dos colegas e a da própria gerente;
 *  - `POST` e `PATCH` continuavam **gravando** senha em texto puro na coluna, a
 *    partir do corpo da requisição.
 *
 *  As duas foram fechadas aqui: a listagem passou a nomear as colunas que
 *  devolve, e as duas gravações ignoram o campo `password` de propósito, com o
 *  motivo escrito. Senha de acesso se define em `/api/users`, que usa bcrypt.
 *
 *  **Falta uma limpeza que é migration, não rota:** as senhas que já estão
 *  gravadas nessas linhas continuam lá. Elas precisam ser apagadas
 *  (`UPDATE salespeople SET password = NULL`), e isso está anotado na fila.
 *  Enquanto não acontecer, existe senha em texto puro no banco — inalcançável
 *  pela API, mas presente em qualquer backup.
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');
const logs = require('../services/logs');

/** As colunas que a tela usa. `SELECT *` saiu daqui de propósito: era ele que
 *  entregava a coluna `password` ao navegador, e voltaria a entregar qualquer
 *  coluna sensível que alguém acrescentasse à tabela no futuro. */
const COLUNAS = 'id, name, email, whatsapp, avatar, role, status, created_at';

async function lerVendedor(db, id) {
  const [r] = await db.q(
    'SELECT id, name, role FROM salespeople WHERE clinica_id = :clinica AND id = ?', [id]);
  return r[0] || null;
}

router.get('/api/salespeople', async function (req, res) {
  const db = escopo(req);
  try {
    const [rows] = await db.q(
      'SELECT ' + COLUNAS + ' FROM salespeople WHERE clinica_id = :clinica ORDER BY name ASC');
    res.json(rows);
  } catch (error) {
    console.error('[vendedores]', error && error.message);
    res.status(500).json({ error: 'Erro ao buscar vendedores' });
  }
});


router.post('/api/salespeople', async function (req, res) {
  const db = escopo(req);
  const { name, email, whatsapp, avatar, role, status } = req.body;
  if (!name || !whatsapp) {
    return res.status(400).json({ error: 'Nome e WhatsApp sao obrigatorios.' });
  }

  try {
    const id = Math.random().toString(36).substring(2, 9);
    // `password` NAO entra. Ver o cabecalho: a coluna guardava texto puro e nao
    // autentica mais nada. Quem cria acesso e /api/users, com bcrypt.
    await db.q(
      'INSERT INTO salespeople (id, name, email, whatsapp, avatar, role, status, clinica_id)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, :clinica)',
      [id, name, email || null, whatsapp, avatar || null, role || 'vendedor', status || 'active']
    );

    await logs.registrar(db, 'SALESPERSON_CREATE',
      'Novo membro da equipe comercial cadastrado: "' + name + '" - Cargo: ' + (role || 'vendedor'));

    res.status(201).json({ message: 'Vendedor cadastrado com sucesso!', id });
  } catch (error) {
    console.error('[vendedores]', error && error.message);
    res.status(500).json({ error: 'Erro ao salvar vendedor' });
  }
});


router.patch('/api/salespeople/:id', async function (req, res) {
  const db = escopo(req);
  const { id } = req.params;
  const { name, email, whatsapp, role, status } = req.body;
  try {
    const alvo = await lerVendedor(db, id);
    if (!alvo) return res.status(404).json({ error: 'Vendedor nao encontrado.' });

    // Idem: nada de `password` aqui.
    await db.q(
      'UPDATE salespeople SET name = COALESCE(?, name), email = COALESCE(?, email),' +
      ' whatsapp = COALESCE(?, whatsapp), role = COALESCE(?, role), status = COALESCE(?, status)' +
      ' WHERE clinica_id = :clinica AND id = ?',
      [name || null, email || null, whatsapp || null, role || null, status || null, id]
    );
    await logs.registrar(db, 'SALESPERSON_UPDATE',
      'Dados de "' + (name || alvo.name) + '" foram alterados' +
      (role ? ' (Cargo: ' + role + ')' : ''));

    res.json({ message: 'Vendedor atualizado com sucesso!' });
  } catch (error) {
    console.error('[vendedores]', error && error.message);
    res.status(500).json({ error: 'Erro ao atualizar vendedor' });
  }
});


router.delete('/api/salespeople/:id', async function (req, res) {
  const db = escopo(req);
  try {
    // Lido antes de excluir: "vendedor ID xyz excluido" nao serve a quem for
    // auditar depois, e depois do DELETE nao ha de onde tirar o nome.
    const alvo = await lerVendedor(db, req.params.id);
    if (!alvo) return res.status(404).json({ error: 'Vendedor nao encontrado.' });

    await db.q('DELETE FROM salespeople WHERE clinica_id = :clinica AND id = ?', [req.params.id]);
    await logs.registrar(db, 'SALESPERSON_DELETE',
      'Membro da equipe comercial "' + alvo.name + '" (' + alvo.role + ') foi excluido');
    res.json({ message: 'Vendedor excluido' });
  } catch (error) {
    console.error('[vendedores]', error && error.message);
    res.status(500).json({ error: 'Erro ao excluir' });
  }
});

module.exports = router;

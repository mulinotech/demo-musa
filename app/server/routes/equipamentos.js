'use strict';
/** Os equipamentos da clínica (M5.11, 21/09).
 *
 *  Cadastro pequeno de propósito: nome e ativo/inativo. Ele existe para que o
 *  campo "Equipamentos Utilizados" da sessão deixe de ser texto livre — e a
 *  razão está no cabeçalho da migration 039: texto livre nunca soma num
 *  relatório.
 *
 *  ========================================= POR QUE NÃO SE APAGA, SÓ INATIVA
 *
 *  Equipamento aparece em sessão já lançada. Apagar a linha faria a sessão de
 *  março apontar para nada — e prontuário que perde o "com o quê" perde a parte
 *  que interessa se alguém precisar responder por aquele atendimento.
 *
 *  Então o `DELETE` desta rota **inativa**: some da lista de escolha, continua
 *  existindo para quem já foi lançado. É o mesmo desenho do catálogo de
 *  tratamentos, e pela mesma razão.
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');
const logs = require('../services/logs');

const COLUNAS = 'id, name, active, created_at AS createdAt';

/** A lista. `?todos=1` traz os inativos junto — a tela de Cadastros precisa
 *  deles para poder reativar; a janela da sessão, não. */
router.get('/api/equipments', async function (req, res) {
  const db = escopo(req);
  try {
    const so = req.query.todos === '1' ? '' : ' AND active = 1';
    const [r] = await db.q(
      'SELECT ' + COLUNAS + ' FROM equipments WHERE clinica_id = :clinica' + so +
      ' ORDER BY name');
    res.json(r);
  } catch (e) {
    console.error('[equipamentos]', e && e.message);
    res.status(500).json({ error: 'Falha ao listar os equipamentos.' });
  }
});

router.post('/api/equipments', async function (req, res) {
  const db = escopo(req);
  const nome = String((req.body && req.body.name) || '').trim();
  if (!nome) return res.status(400).json({ error: 'Informe o nome do equipamento.' });
  if (nome.length > 160) return res.status(400).json({ error: 'Nome muito longo (máximo 160).' });

  const id = 'eq_' + Math.random().toString(36).substring(2, 9);
  try {
    await db.q(
      'INSERT INTO equipments (clinica_id, id, name) VALUES (:clinica, ?, ?)', [id, nome]);
    await logs.registrar(db, 'EQUIPAMENTO', 'Equipamento cadastrado: "' + nome + '".');
    res.status(201).json({ id: id, name: nome, active: 1 });
  } catch (e) {
    /* A unicidade e' (clinica_id, name): duas clinicas podem ter o mesmo
       Ultraformer, a mesma nao pode ter dois. A recusa fala do cadastro DELA,
       e nao conta que a vizinha tem um igual. */
    if (e && e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Esta clínica já tem um equipamento com esse nome.' });
    }
    console.error('[equipamentos]', e && e.message);
    res.status(500).json({ error: 'Falha ao cadastrar o equipamento.' });
  }
});

router.patch('/api/equipments/:id', async function (req, res) {
  const db = escopo(req);
  const { id } = req.params;
  const campos = [], valores = [];
  if (req.body && req.body.name !== undefined) {
    const nome = String(req.body.name || '').trim();
    if (!nome) return res.status(400).json({ error: 'Informe o nome do equipamento.' });
    campos.push('name = ?'); valores.push(nome);
  }
  if (req.body && req.body.active !== undefined) {
    campos.push('active = ?'); valores.push(req.body.active ? 1 : 0);
  }
  if (!campos.length) return res.status(400).json({ error: 'Nada para atualizar.' });

  try {
    const [alvo] = await db.q(
      'SELECT name FROM equipments WHERE clinica_id = :clinica AND id = ?', [id]);
    if (!alvo[0]) return res.status(404).json({ error: 'Equipamento nao encontrado.' });

    valores.push(id);
    await db.q(
      'UPDATE equipments SET ' + campos.join(', ') + ' WHERE clinica_id = :clinica AND id = ?',
      valores);
    await logs.registrar(db, 'EQUIPAMENTO', 'Equipamento "' + alvo[0].name + '" atualizado.');
    res.json({ message: 'Equipamento atualizado.' });
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Esta clínica já tem um equipamento com esse nome.' });
    }
    console.error('[equipamentos]', e && e.message);
    res.status(500).json({ error: 'Falha ao atualizar o equipamento.' });
  }
});

/** INATIVAR, e não apagar. Ver o cabeçalho. */
router.delete('/api/equipments/:id', async function (req, res) {
  const db = escopo(req);
  const { id } = req.params;
  try {
    const [alvo] = await db.q(
      'SELECT name FROM equipments WHERE clinica_id = :clinica AND id = ?', [id]);
    if (!alvo[0]) return res.status(404).json({ error: 'Equipamento nao encontrado.' });

    await db.q(
      'UPDATE equipments SET active = 0 WHERE clinica_id = :clinica AND id = ?', [id]);
    await logs.registrar(db, 'EQUIPAMENTO',
      'Equipamento "' + alvo[0].name + '" inativado. As sessoes ja lancadas com ele ' +
      'continuam intactas.');
    res.json({
      message: 'Equipamento inativado. Ele some da lista de escolha, e as sessões ' +
        'já lançadas com ele continuam como estão.'
    });
  } catch (e) {
    console.error('[equipamentos]', e && e.message);
    res.status(500).json({ error: 'Falha ao inativar o equipamento.' });
  }
});

module.exports = router;

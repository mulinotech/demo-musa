'use strict';
/** O lado da CLÍNICA: conceder, ver e revogar o acesso de suporte (M3.1b).
 *
 *  Quem concede é `admin` da própria clínica (regra na tabela de papéis). O
 *  escopo é o de sempre, então uma clínica jamais mexe na concessão da outra.
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');
const logs = require('../services/logs');

const HORAS_MAXIMAS = 72;

/** A concessão viva desta clínica, ou null. Uma consulta só, usada pela tela e
 *  pelo porteiro — para não existirem duas definições de "válido". */
async function concessaoViva(db) {
  const [r] = await db.q(
    'SELECT id, concedido_por, motivo, concedido_em, expira_em FROM acessos_de_suporte' +
    ' WHERE clinica_id = :clinica AND revogado_em IS NULL AND expira_em > NOW()' +
    ' ORDER BY expira_em DESC LIMIT 1');
  return r[0] || null;
}

router.get('/api/suporte', async function (req, res) {
  try {
    const viva = await concessaoViva(escopo(req));
    res.json({ liberado: !!viva, concessao: viva, horasMaximas: HORAS_MAXIMAS });
  } catch (e) {
    console.error('[suporte]', e && e.message);
    res.status(500).json({ error: 'Falha ao ler o acesso de suporte.' });
  }
});

router.post('/api/suporte', express.json(), async function (req, res) {
  const db = escopo(req);
  const horas = Number((req.body && req.body.horas) || 0);
  const motivo = String((req.body && req.body.motivo) || '').trim().slice(0, 255);

  if (!(horas > 0) || horas > HORAS_MAXIMAS) {
    return res.status(400).json({
      error: 'Informe de 1 a ' + HORAS_MAXIMAS + ' horas. Acesso sem prazo nao e acesso concedido.'
    });
  }

  try {
    const id = 'sup_' + Math.random().toString(36).slice(2, 10);
    await db.q(
      'INSERT INTO acessos_de_suporte (id, clinica_id, concedido_por, motivo, expira_em)' +
      ' VALUES (?, :clinica, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))',
      [id, db.autor, motivo || null, horas]);

    await logs.registrar(db, 'SUPORTE_CONCEDIDO',
      'Acesso de suporte da Mulino liberado por ' + horas + 'h' +
      (motivo ? ' — motivo: ' + motivo : '') + '. Leitura, sem prontuario.');

    res.status(201).json({ liberado: true, concessao: await concessaoViva(db) });
  } catch (e) {
    console.error('[suporte]', e && e.message);
    res.status(500).json({ error: 'Falha ao liberar o acesso de suporte.' });
  }
});

router.delete('/api/suporte', async function (req, res) {
  const db = escopo(req);
  try {
    const [r] = await db.q(
      'UPDATE acessos_de_suporte SET revogado_em = NOW()' +
      ' WHERE clinica_id = :clinica AND revogado_em IS NULL AND expira_em > NOW()');

    await logs.registrar(db, 'SUPORTE_REVOGADO',
      'Acesso de suporte da Mulino revogado (' + r.affectedRows + ' concessao(oes)). ' +
      'Vale a partir da proxima requisicao: a permissao e conferida no banco, nao no token.');

    res.json({ liberado: false, revogadas: r.affectedRows });
  } catch (e) {
    console.error('[suporte]', e && e.message);
    res.status(500).json({ error: 'Falha ao revogar o acesso de suporte.' });
  }
});

module.exports = router;
module.exports.concessaoViva = concessaoViva;
module.exports.HORAS_MAXIMAS = HORAS_MAXIMAS;

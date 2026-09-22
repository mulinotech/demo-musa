'use strict';
/** O catálogo de tratamentos — o cardápio da clínica.
 *
 *  ================================================= O QUE A M1.6 MUDOU AQUI
 *
 *  Nenhuma das quatro consultas filtrava. A listagem já seria ruim (o cardápio
 *  e os PREÇOS da vizinha na tela), mas as outras três são piores, porque
 *  `treatment_catalog.id` é único no banco inteiro: com o id na mão — e ele
 *  aparece na listagem —, uma clínica **alterava o preço** ou **excluía** um
 *  tratamento da outra. Sem erro em tela, e do outro lado o serviço
 *  simplesmente some do cardápio.
 *
 *  A exclusão é a mais grave das quatro: o catálogo é referenciado pela ficha
 *  técnica (quais insumos cada serviço consome) e pelos compromissos da agenda.
 *
 *  Agora as três rotas de gravação passam pelo mesmo filtro da leitura, e um id
 *  de outra clínica devolve **404** — não 403. Dizer "sem permissão" confirmaria
 *  que aquele id existe em algum lugar da plataforma; 404 não conta nada.
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');
const logs = require('../services/logs');
const duracao = require('../services/duracao');

router.get('/api/treatment-catalog', async function (req, res) {
  const db = escopo(req);
  try {
    const [rows] = await db.q(
      'SELECT * FROM treatment_catalog WHERE clinica_id = :clinica ORDER BY name ASC');
    res.json(rows);
  } catch (error) {
    console.error('[catalogo]', error && error.message);
    res.status(500).json({ error: 'Erro ao buscar catalogo' });
  }
});


router.post('/api/treatment-catalog', async function (req, res) {
  const db = escopo(req);
  const { name, price, packagePrice, duration, description, targetRegions, restrictions } = req.body;
  if (!name || price === undefined) return res.status(400).json({ error: 'Nome e Preco sao obrigatorios.' });

  const id = 'tc_' + Math.random().toString(36).substring(2, 9);
  try {
    /* `duration_min` PASSA A SER GRAVADA AQUI (M5.14).
     *
     * Ate 22/09 esta rota so escrevia `duration` (texto). A coluna de minutos,
     * que e' a que a AGENDA usa para calcular o fim do compromisso, era
     * preenchida uma unica vez pela migration 007 e depois so mudava quando
     * alguem salvava uma simulacao na tela de Precificacao. Servico novo
     * nascia sem ela; servico editado ficava com o valor velho, enquanto a
     * tela de Cadastros mostrava o novo. Duas telas, dois numeros, nenhum
     * aviso. */
    const minutos = duracao.minutosDe(duration);

    await db.q(
      'INSERT INTO treatment_catalog (id, name, price, package_price, duration, duration_min,' +
      ' description, target_regions, restrictions, clinica_id)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, :clinica)',
      [id, name, price, packagePrice || null, duration || '', minutos, description || '',
       targetRegions || '', restrictions || '']
    );
    await logs.registrar(db, 'CATALOGO', 'Tratamento cadastrado no catalogo: "' + name + '".');
    res.status(201).json({
      id, name, price, packagePrice, duration, description, targetRegions, restrictions,
      durationMin: minutos,
      /* A tela precisa saber que a duracao nao foi entendida -- senao a clinica
         so descobre quando a agenda nao souber quanto tempo reservar. */
      duracaoEntendida: minutos !== null
    });
  } catch (error) {
    console.error('[catalogo]', error && error.message);
    res.status(500).json({ error: 'Erro ao salvar tratamento no catalogo' });
  }
});


router.patch('/api/treatment-catalog/:id', async function (req, res) {
  const db = escopo(req);
  const { id } = req.params;
  const { name, price, packagePrice, duration, description, targetRegions, restrictions } = req.body;
  try {
    // A CONFERENCIA DE DONO VEM ANTES DA GRAVACAO, e nao junto dela.
    //
    // `UPDATE ... WHERE clinica_id = :clinica AND id = ?` tambem protegeria,
    // mas `affectedRows = 0` significa duas coisas diferentes -- "nao e desta
    // clinica" e "nada mudou porque os valores sao iguais" -- e a rota nao
    // saberia qual responder. Lendo antes, o 404 e inequivoco.
    const [alvo] = await db.q(
      'SELECT id, name FROM treatment_catalog WHERE clinica_id = :clinica AND id = ?', [id]);
    if (!alvo.length) return res.status(404).json({ error: 'Tratamento nao encontrado.' });

    /* Quando a duracao vem nesta chamada, os DOIS campos andam juntos -- o
       texto e os minutos. Era essa separacao que fazia a tela mostrar 90 e a
       agenda marcar 60. Quando ela NAO vem, nenhum dos dois e' tocado: o
       COALESCE cuida do texto, e o `duration_min` so entra no SET se houver
       duracao no pedido. */
    const mexeNaDuracao = duration !== undefined && duration !== null;
    const minutos = mexeNaDuracao ? duracao.minutosDe(duration) : undefined;

    await db.q(
      'UPDATE treatment_catalog SET name = COALESCE(?, name), price = COALESCE(?, price),' +
      ' package_price = COALESCE(?, package_price), duration = COALESCE(?, duration),' +
      (mexeNaDuracao ? ' duration_min = ?,' : '') +
      ' description = COALESCE(?, description), target_regions = COALESCE(?, target_regions),' +
      ' restrictions = COALESCE(?, restrictions) WHERE clinica_id = :clinica AND id = ?',
      [name, price, packagePrice === undefined ? null : packagePrice, duration]
        .concat(mexeNaDuracao ? [minutos] : [])
        .concat([description, targetRegions, restrictions, id])
    );
    await logs.registrar(db, 'CATALOGO',
      'Tratamento "' + (name || alvo[0].name) + '" atualizado no catalogo.');
    res.json({
      message: 'Tratamento atualizado com sucesso!',
      durationMin: mexeNaDuracao ? minutos : undefined,
      duracaoEntendida: mexeNaDuracao ? minutos !== null : undefined
    });
  } catch (error) {
    console.error('[catalogo]', error && error.message);
    res.status(500).json({ error: 'Erro ao atualizar tratamento no catalogo' });
  }
});


router.delete('/api/treatment-catalog/:id', async function (req, res) {
  const db = escopo(req);
  try {
    const [alvo] = await db.q(
      'SELECT id, name FROM treatment_catalog WHERE clinica_id = :clinica AND id = ?',
      [req.params.id]);
    if (!alvo.length) return res.status(404).json({ error: 'Tratamento nao encontrado.' });

    await db.q('DELETE FROM treatment_catalog WHERE clinica_id = :clinica AND id = ?',
      [req.params.id]);
    await logs.registrar(db, 'CATALOGO',
      'Tratamento "' + alvo[0].name + '" excluido do catalogo.');
    res.json({ message: 'Tratamento excluido do catalogo' });
  } catch (error) {
    console.error('[catalogo]', error && error.message);
    res.status(500).json({ error: 'Erro ao excluir' });
  }
});

module.exports = router;

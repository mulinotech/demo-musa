'use strict';
/** Fidelização — Fase 5.
 *
 *  A rota busca, chama `services/fidelidade.js` e grava. A conta de saldo,
 *  validade e desconto não mora aqui.
 *
 *  Permissão: leitura para TODOS os papéis autenticados, e isso é intencional —
 *  a recepção precisa dizer o saldo à paciente no fim do atendimento, e um
 *  programa de pontos que só a gerência consulta não muda comportamento
 *  nenhum. Configuração e ajuste manual são de `admin`, porque ajuste de pontos
 *  é dinheiro em forma de crédito.
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');
const fid = require('../services/fidelidade');
const logs = require('../services/logs');

const novoId = (p) => p + '_' + Math.random().toString(36).slice(2, 10);

/** Neste arquivo, admin quer dizer admin -- e nada mais.
 *
 *  A versao anterior tinha aqui uma porta para a rotina automatica do servidor,
 *  porque a expiracao de pontos era chamada por este arquivo. Ela mudou de
 *  arquivo na M1.4, e a excecao saiu junto: deixar essa porta aberta numa
 *  funcao que hoje guarda a CONFIGURACAO do programa e o AJUSTE manual de
 *  pontos seria uma permissao sem nenhum caminho que a use -- e permissao sem
 *  uso e a que ninguem revisa quando um caminho novo aparece. */
function soAdmin(req, res) {
  if (req.usuario && req.usuario.papel === 'admin') return true;
  res.status(403).json({ error: 'Esta acao e restrita a administrador.' });
  return false;
}

/** A configuração do programa DESTA clínica.
 *
 *  ================================== POR QUE NAO BASTAVA ACRESCENTAR O FILTRO
 *
 *  A versão anterior lia `WHERE id = 'default'` e, não achando, **criava** a
 *  linha. As duas coisas param de funcionar com mais de uma clínica: a leitura
 *  devolveria a configuração da clínica 1 para todas, e a criação é impossível
 *  — a chave primária é `id`, então um segundo `'default'` é recusado pelo
 *  banco. Igual à precificação (M1.2); as duas se resolvem na **M1.2b**.
 *
 *  ============================================ E POR QUE `active: false`
 *
 *  `fid.config(null)` devolve o padrão do serviço, e nele `active` é **true**.
 *  Isso falha ABERTO: a clínica sem configuração veria o programa ligado, a
 *  tela ofereceria resgate, e nada creditaria ponto — porque a cadeia de
 *  efeitos (M1.1c) já devolve "programa nao configurado nesta clinica" nesse
 *  caso. Duas partes do sistema discordando sobre se o programa existe é pior
 *  que qualquer uma das duas estar errada.
 *
 *  Então aqui, sem linha própria, o programa é apresentado **desligado**. É a
 *  verdade: ele não está funcionando para esta clínica.
 */
async function lerConfig(db) {
  const [r] = await db.q(
    "SELECT * FROM loyalty_settings WHERE clinica_id = :clinica AND id = 'default'");
  if (r.length) return { cfg: fid.config(r[0]), proprio: true };
  return { cfg: Object.assign({}, fid.config(null), { active: false }), proprio: false };
}

/** O extrato de pontos de uma paciente.
 *
 *  A consulta MAIS SENSÍVEL deste arquivo, e a razão é aritmética: saldo de
 *  pontos é crédito em dinheiro. Um lançamento de outra clínica somado aqui
 *  vira desconto que esta clínica paga sem ter vendido nada.
 *
 *  O `LEFT JOIN` da recompensa filtra no ON, não no WHERE: no WHERE ele viraria
 *  INNER e todo lançamento sem recompensa — acúmulo, ajuste, expiração, que são
 *  a maioria — desapareceria do extrato. */
async function extratoDoCliente(db, clientId) {
  const [r] = await db.q(`
    SELECT t.id, t.type, t.points, t.description, t.source, t.source_id, t.reward_id, t.expired,
           DATE_FORMAT(t.expires_at, '%Y-%m-%d') AS expires_at,
           DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
           w.name AS reward_name
      FROM loyalty_transactions t
      LEFT JOIN loyalty_rewards w ON w.id = t.reward_id AND w.clinica_id = :clinica
     WHERE t.clinica_id = :clinica AND t.client_id = ?
     ORDER BY t.created_at DESC, t.id DESC
  `, [clientId]);
  return r;
}

/** A paciente é desta clínica? Usado antes de ler ou mexer no saldo dela.
 *  Sem isto, um id de paciente de outra clínica devolveria extrato vazio e
 *  saldo zero -- que é indistinguível de "paciente sem pontos" -- e o ajuste
 *  manual criaria um lançamento DESTA clínica apontando para paciente DAQUELA. */
async function pacienteDaClinica(db, clientId) {
  const [r] = await db.q(
    'SELECT id FROM clients WHERE clinica_id = :clinica AND id = ?', [clientId]);
  return r.length > 0;
}

/* ---------------------------------------------------------- configuração */

router.get('/api/loyalty/settings', async function (req, res) {
  const db = escopo(req);
  try {
    const { cfg, proprio } = await lerConfig(db);
    res.json({ config: cfg, exemplo: fid.exemplo(cfg), configuracaoPropria: proprio });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao ler a configuracao do programa.' });
  }
});

router.put('/api/loyalty/settings', async function (req, res) {
  if (!soAdmin(req, res)) return;
  const db = escopo(req);
  const b = req.body || {};
  const sets = [], v = [];
  const campo = (c, x) => { sets.push(c + ' = ?'); v.push(x); };

  if (b.active !== undefined) campo('active', b.active ? 1 : 0);
  if (b.pointsPerReal !== undefined) {
    const n = Number(b.pointsPerReal);
    if (!isFinite(n) || n <= 0 || n > 100) return res.status(400).json({ error: 'Pontos por real entre 0 e 100.' });
    campo('points_per_real', n);
  }
  if (b.redemptionValue !== undefined) {
    const n = Number(b.redemptionValue);
    if (!isFinite(n) || n < 0 || n > 10) return res.status(400).json({ error: 'Valor do ponto entre 0 e 10 reais.' });
    campo('redemption_value', n);
  }
  if (b.expiryDays !== undefined) {
    const n = Math.round(Number(b.expiryDays));
    // Teto de 5 anos e piso 0 (= nao expira). A clinica tipica usa 90.
    if (!isFinite(n) || n < 0 || n > 1825) return res.status(400).json({ error: 'Validade entre 0 e 1825 dias.' });
    campo('expiry_days', n);
  }
  if (b.minPointsToRedeem !== undefined) {
    const n = Math.round(Number(b.minPointsToRedeem));
    if (!isFinite(n) || n < 0) return res.status(400).json({ error: 'Minimo para resgate invalido.' });
    campo('min_points_to_redeem', n);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar.' });

  try {
    const atual = await lerConfig(db);
    if (!atual.proprio) {
      // Sem linha propria, o UPDATE filtrado nao acha nada e nao grava -- e a
      // tela diria "salvo" sem ter salvado. Recusar alto e dizer por que.
      return res.status(409).json({
        error: 'Esta clinica ainda nao tem programa de pontos proprio. ' +
               'Fale com o administrador da plataforma.'
      });
    }
    await db.q('UPDATE loyalty_settings SET ' + sets.join(', ') +
      " WHERE clinica_id = :clinica AND id = 'default'", v);
    const { cfg } = await lerConfig(db);
    if (b.active !== undefined) {
      await logs.registrar(db, 'FIDELIDADE',
        'Programa de pontos ' + (cfg.active ? 'ativado' : 'desativado') + '.');
    }
    // A mudanca NAO altera pontos ja creditados, de proposito: quem acumulou
    // sob a regra antiga mantem o que tem. Mexer no passado quebraria a
    // confianca da paciente no saldo que ela anotou.
    res.json({ config: cfg, exemplo: fid.exemplo(cfg) });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao salvar a configuracao.' });
  }
});

/* ----------------------------------------------------------- recompensas */

router.get('/api/loyalty/rewards', async function (req, res) {
  const db = escopo(req);
  try {
    const [r] = await db.q(`
      SELECT w.*, c.name AS catalog_name
        FROM loyalty_rewards w
        LEFT JOIN treatment_catalog c ON c.id = w.catalog_id AND c.clinica_id = :clinica
       WHERE w.clinica_id = :clinica
       ORDER BY w.active DESC, w.points_cost
    `);
    res.json(r.map((w) => ({
      id: w.id, name: w.name, description: w.description, pointsCost: w.points_cost,
      type: w.type, value: w.value == null ? null : Number(w.value),
      catalogId: w.catalog_id, catalogName: w.catalog_name || null, active: !!w.active
    })));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao listar as recompensas.' });
  }
});

router.post('/api/loyalty/rewards', async function (req, res) {
  if (!soAdmin(req, res)) return;
  const db = escopo(req);
  const b = req.body || {};
  const nome = String(b.name || '').trim();
  const custo = Math.round(Number(b.pointsCost));
  const TIPOS = ['DESCONTO_VALOR', 'DESCONTO_PCT', 'SERVICO', 'PRODUTO'];
  if (!nome) return res.status(400).json({ error: 'A recompensa precisa de um nome.' });
  if (!isFinite(custo) || custo <= 0) return res.status(400).json({ error: 'Custo em pontos invalido.' });
  if (TIPOS.indexOf(b.type) === -1) return res.status(400).json({ error: 'Tipo de recompensa invalido.' });
  if (b.type === 'DESCONTO_PCT') {
    const n = Number(b.value);
    if (!isFinite(n) || n <= 0 || n > 100) return res.status(400).json({ error: 'Percentual entre 0 e 100.' });
  }
  try {
    // Recompensa do tipo SERVICO aponta para o catalogo, e PRODUTO para o
    // estoque. Um id de outra clinica gravado aqui faria a paciente resgatar um
    // servico que esta clinica nao presta -- e o resgate desconta dinheiro de
    // verdade do atendimento.
    if (b.catalogId) {
      const [c] = await db.q(
        'SELECT id FROM treatment_catalog WHERE clinica_id = :clinica AND id = ?', [b.catalogId]);
      if (!c.length) return res.status(404).json({ error: 'Servico nao encontrado no catalogo.' });
    }
    if (b.productId) {
      const [pr] = await db.q(
        'SELECT id FROM products WHERE clinica_id = :clinica AND id = ?', [b.productId]);
      if (!pr.length) return res.status(404).json({ error: 'Produto nao encontrado.' });
    }

    const id = novoId('rw');
    await db.q(
      `INSERT INTO loyalty_rewards (id, name, description, points_cost, type, value, catalog_id, product_id, clinica_id)
       VALUES (?,?,?,?,?,?,?,?, :clinica)`,
      [id, nome.slice(0, 255), b.description || null, custo, b.type,
       b.value == null || b.value === '' ? null : Number(b.value),
       b.catalogId || null, b.productId || null]
    );
    await logs.registrar(db, 'FIDELIDADE', 'Recompensa criada: ' + nome + ' (' + custo + ' pontos).');
    res.status(201).json({ id });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao criar a recompensa.' });
  }
});

router.patch('/api/loyalty/rewards/:id', async function (req, res) {
  if (!soAdmin(req, res)) return;
  const db = escopo(req);
  const b = req.body || {};
  const sets = [], v = [];
  const campo = (c, x) => { sets.push(c + ' = ?'); v.push(x); };
  if (b.name !== undefined) campo('name', String(b.name).trim().slice(0, 255));
  if (b.description !== undefined) campo('description', b.description || null);
  if (b.pointsCost !== undefined) campo('points_cost', Math.round(Number(b.pointsCost)));
  if (b.value !== undefined) campo('value', b.value == null || b.value === '' ? null : Number(b.value));
  if (b.catalogId !== undefined) campo('catalog_id', b.catalogId || null);
  if (b.active !== undefined) campo('active', b.active ? 1 : 0);
  if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar.' });
  try {
    v.push(req.params.id);
    const [r] = await db.q('UPDATE loyalty_rewards SET ' + sets.join(', ') +
      ' WHERE clinica_id = :clinica AND id = ?', v);
    if (!r.affectedRows) return res.status(404).json({ error: 'Recompensa nao encontrada.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao atualizar a recompensa.' });
  }
});

/* -------------------------------------------------- saldo e extrato */

router.get('/api/clients/:id/loyalty', async function (req, res) {
  const db = escopo(req);
  try {
    if (!await pacienteDaClinica(db, req.params.id)) {
      return res.status(404).json({ error: 'Paciente nao encontrado.' });
    }
    const { cfg } = await lerConfig(db);
    const tx = await extratoDoCliente(db, req.params.id);
    const saldo = fid.saldo(tx, req.query.hoje);
    res.json({
      clientId: req.params.id,
      ativo: cfg.active,
      saldo: saldo,
      vale: fid.valorEmReais(saldo, cfg),
      aExpirar30Dias: fid.aExpirar(tx, 30, req.query.hoje),
      minimoParaResgate: cfg.minPointsToRedeem,
      extrato: tx.map((t) => ({
        id: t.id, tipo: t.type, pontos: Number(t.points), descricao: t.description,
        fonte: t.source, recompensa: t.reward_name || null,
        expiraEm: t.expires_at, expirado: !!Number(t.expired), quando: t.created_at
      }))
    });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao ler o saldo de pontos.' });
  }
});

/** Ajuste manual. Só admin, motivo obrigatório — é crédito em forma de ponto,
 *  e ajuste sem motivo registrado é o buraco que a auditoria fecha. */
router.post('/api/clients/:id/loyalty/adjust', async function (req, res) {
  if (!soAdmin(req, res)) return;
  const db = escopo(req);
  const b = req.body || {};
  const pontos = Math.round(Number(b.points));
  const motivo = String(b.description || '').trim();
  if (!isFinite(pontos) || pontos === 0) return res.status(400).json({ error: 'Informe a quantidade de pontos.' });
  if (!motivo) return res.status(400).json({ error: 'Informe o motivo do ajuste.' });

  try {
    if (!await pacienteDaClinica(db, req.params.id)) {
      return res.status(404).json({ error: 'Paciente nao encontrado.' });
    }
    const { cfg, proprio } = await lerConfig(db);
    if (!proprio) {
      return res.status(409).json({
        error: 'Esta clinica ainda nao tem programa de pontos proprio. ' +
               'Fale com o administrador da plataforma.'
      });
    }
    const tx = await extratoDoCliente(db, req.params.id);
    const saldo = fid.saldo(tx);
    if (pontos < 0 && saldo < -pontos) {
      return res.status(409).json({ error: 'Saldo de ' + saldo + ' ponto(s): nao da para retirar ' + (-pontos) + '.' });
    }
    await db.q(
      `INSERT INTO loyalty_transactions
        (id, client_id, type, points, description, source, expires_at, created_by, clinica_id)
       VALUES (?,?, 'AJUSTE', ?, ?, 'MANUAL', ?, ?, :clinica)`,
      [novoId('lt'), req.params.id, pontos, motivo.slice(0, 255),
       pontos > 0 ? fid.validadeDoAcumulo(null, cfg) : null, req.usuario && req.usuario.sub]
    );
    await logs.registrar(db, 'FIDELIDADE',
      'Ajuste de ' + (pontos > 0 ? '+' : '') + pontos + ' ponto(s). Motivo: ' + motivo);
    const novo = fid.saldo(await extratoDoCliente(db, req.params.id));
    res.json({ ok: true, saldo: novo });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao ajustar os pontos.' });
  }
});

/* ------------------------------------------------- relatório e worker */

/** O custo do programa em reais é um RELATÓRIO, não um lançamento contábil.
 *  Desconto não é dinheiro que saiu — é dinheiro que não entrou. Criar despesa
 *  para ele contaria duas vezes: a receita já veio menor. */
router.get('/api/loyalty/report', async function (req, res) {
  // O relatorio mostra custo do programa e passivo em circulacao: e dado de
  // negocio da mesma natureza do preco e do resultado, que ja sao restritos.
  // O SALDO de um paciente continua legivel por todos -- e a recepcao que diz
  // o saldo a ele no fim do atendimento.
  const papel = req.usuario && req.usuario.papel;
  if (papel !== 'admin' && papel !== 'gerente') {
    return res.status(403).json({ error: 'O relatorio de fidelidade e restrito a admin e gerente.' });
  }
  const db = escopo(req);
  try {
    const { cfg } = await lerConfig(db);
    const de = String(req.query.from || '').slice(0, 10) || fid.hojeISO().slice(0, 8) + '01';
    const ate = String(req.query.to || '').slice(0, 10) || fid.hojeISO();
    // Somas. Sem o filtro, "pontos emitidos" e "custo do programa" saem com o
    // valor das 50 clinicas juntas -- e soma nao tem nome para alguem
    // estranhar. Ver a nota da M1.2 sobre relatorios.
    const [r] = await db.q(`
      SELECT type, SUM(points) AS pontos, COUNT(*) AS n,
             SUM(COALESCE(amount_discounted, 0)) AS reais
        FROM loyalty_transactions
       WHERE clinica_id = :clinica AND DATE(created_at) BETWEEN ? AND ?
       GROUP BY type
    `, [de, ate]);

    const mapa = {};
    for (const l of r) mapa[l.type] = { pontos: Number(l.pontos), transacoes: Number(l.n), reais: Number(l.reais) };
    const em = (t) => (mapa[t] ? mapa[t].pontos : 0);

    const resgatados = Math.abs(em('RESGATE'));

    // Saldo total em circulacao: e o passivo do programa. Nao entra no
    // financeiro como divida -- nao e obrigacao em dinheiro -- mas a clinica
    // precisa saber que existe, porque um dia parte disso vira desconto.
    // O PASSIVO em circulacao. Esta consulta le o historico inteiro, e sem
    // filtro ela somaria o passivo das 50 clinicas num numero so.
    const [tudo] = await db.q(`
      SELECT t.client_id, t.type, t.points, t.expired,
             DATE_FORMAT(t.expires_at, '%Y-%m-%d') AS expires_at,
             DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i:%s') AS created_at, t.id
        FROM loyalty_transactions t
       WHERE t.clinica_id = :clinica
    `);
    const porCliente = new Map();
    for (const t of tudo) {
      if (!porCliente.has(t.client_id)) porCliente.set(t.client_id, []);
      porCliente.get(t.client_id).push(t);
    }
    let circulacao = 0;
    for (const tx of porCliente.values()) circulacao += fid.saldo(tx);

    res.json({
      periodo: { de, ate },
      emitidos: em('ACUMULO'),
      resgatados: resgatados,
      expirados: Math.abs(em('EXPIRACAO')),
      ajustes: em('AJUSTE'),
      estornos: em('ESTORNO'),
      // O custo do programa e o DINHEIRO que o desconto tirou, gravado no
      // resgate -- nao "pontos x valor do ponto", que e estimativa. Desconto
      // percentual em atendimento caro devolve muito mais do que a tabela diz.
      custoEmReais: fid.centavos(mapa.RESGATE ? mapa.RESGATE.reais : 0),
      custoEstimadoPelaTabela: fid.valorEmReais(resgatados, cfg),
      saldoEmCirculacao: circulacao,
      passivoEmReais: fid.valorEmReais(circulacao, cfg),
      pacientesComSaldo: Array.from(porCliente.values()).filter((tx) => fid.saldo(tx) > 0).length
    });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao montar o relatorio de pontos.' });
  }
});

/* ---------------------------------------------------- expiracao de pontos
 *
 * A rota `POST /api/loyalty/expire` MUDOU DE ARQUIVO na M1.4: esta em
 * `routes/expiracao-pontos.js`. Mesmo motivo dos lembretes: a rotina automatica
 * do servidor a chama SEM sessao, e a varredura percorre todas as clinicas por
 * definicao -- `escopo(req)` recusaria, com razao.
 *
 * Ficando aqui, ela prenderia o modulo de fidelidade inteiro na catraca por
 * causa de uma rota. Ver o cabecalho do arquivo novo.
 */

module.exports = router;

'use strict';
const cron = require('../middleware/cron');
/** Agenda — Fase 1, T1.2.
 *
 *  A rota busca, chama services/agenda.js e grava. A regra de conflito é a
 *  mesma função nos três caminhos que precisam dela — criar, editar e
 *  reagendar — porque três cópias da mesma condição é como a agenda de uma
 *  clínica termina com duas pacientes no mesmo horário.
 *
 *  Permissão: autenticado em tudo. `profissional` só enxerga e mexe na própria
 *  agenda; `admin` e `gerente` enxergam todas. Isso é decidido aqui e não em
 *  REGRAS_DE_PAPEL porque depende do dono do registro, não só do papel.
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const ag = require('../services/agenda');
const concluido = require('../services/atendimento-concluido');
const lembretes = require('../workers/lembretes');
const fidelidade = require('../services/fidelidade');
const efeitosFidelidade = require('../services/efeitos-fidelidade');
const { sendWhatsappText } = require('../services/evolution');
const { logSystemEvent } = require('../services/logs');

const novoId = (p) => p + '_' + Math.random().toString(36).slice(2, 10);
const autor = (req) => (req.usuario && req.usuario.nome) || 'Sistema';
const STATUS = ['AGENDADO', 'CONFIRMADO', 'REALIZADO', 'FALTOU', 'CANCELADO'];

/** `profissional` fica preso à própria agenda. Admin e gerente veem tudo. */
function soVeAPropria(req) {
  return req.usuario && req.usuario.papel === 'profissional';
}

function dataHora(v) {
  if (!v) return null;
  const s = String(v).replace('T', ' ').slice(0, 19);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s) ? (s.length === 16 ? s + ':00' : s) : null;
}

function paraTela(a) {
  return {
    id: a.id,
    clientId: a.client_id,
    clientName: a.client_name || null,
    professionalId: a.professional_id,
    professionalName: a.professional_name || null,
    catalogId: a.catalog_id,
    title: a.title,
    startsAt: a.starts_at,
    endsAt: a.ends_at,
    status: a.status,
    kind: a.kind,
    room: a.room,
    price: a.price === null ? null : Number(a.price),
    notes: a.notes,
    confirmedAt: a.confirmed_at,
    completedAt: a.completed_at,
    cancelledReason: a.cancelled_reason,
    rescheduledFrom: a.rescheduled_from
  };
}

/** DATETIME sai daqui como TEXTO, não como Date.
 *
 *  O mysql2 devolve DATETIME como objeto Date e o Express serializa em ISO-UTC:
 *  um compromisso das 09:00 vira "2026-04-15T12:00:00.000Z". Duas consequências
 *  ruins, e as duas silenciosas: o horário mostrado passa a depender do fuso do
 *  navegador de quem abre, e agrupar por dia com os dez primeiros caracteres
 *  joga um compromisso da noite para o dia seguinte.
 *
 *  Este sistema é de UMA clínica, em horário local (AGENTS.md, seção 6). O
 *  DATETIME gravado é a hora combinada com a paciente — não um instante
 *  universal a ser reinterpretado. Por isso formatamos no SQL. */
const FMT = "'%Y-%m-%d %H:%i:%s'";
const SELECT_BASE = `
  SELECT a.id, a.client_id, a.professional_id, a.catalog_id, a.title, a.status, a.kind,
         a.room, a.price, a.notes, a.cancelled_reason, a.rescheduled_from,
         DATE_FORMAT(a.starts_at, ${FMT}) AS starts_at,
         DATE_FORMAT(a.ends_at, ${FMT}) AS ends_at,
         DATE_FORMAT(a.confirmed_at, ${FMT}) AS confirmed_at,
         DATE_FORMAT(a.completed_at, ${FMT}) AS completed_at,
         c.name AS client_name, u.name AS professional_name
    FROM appointments a
    LEFT JOIN clients c ON c.id = a.client_id
    LEFT JOIN users u ON u.id = a.professional_id
`;

/** Compromissos do profissional que podem colidir com a janela pedida.
 *  Busca um dia a mais dos dois lados para não perder um que atravessa
 *  a meia-noite. */
async function agendaDoProfissional(professionalId, inicio, fim) {
  const [r] = await pool.query(
    `SELECT id, professional_id, title, status,
            DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i:%s') AS starts_at,
            DATE_FORMAT(ends_at, '%Y-%m-%d %H:%i:%s') AS ends_at
       FROM appointments
      WHERE professional_id = ?
        AND ends_at > DATE_SUB(?, INTERVAL 1 DAY)
        AND starts_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [professionalId, inicio, fim]
  );
  return r;
}

/* ------------------------------------------------------------- listagem */

router.get('/api/appointments', async function (req, res) {
  try {
    const cond = [], params = [];
    if (req.query.from) { cond.push('a.ends_at >= ?'); params.push(String(req.query.from).slice(0, 10) + ' 00:00:00'); }
    if (req.query.to) { cond.push('a.starts_at <= ?'); params.push(String(req.query.to).slice(0, 10) + ' 23:59:59'); }
    if (req.query.status) { cond.push('a.status = ?'); params.push(req.query.status); }

    let profissional = req.query.professionalId;
    if (soVeAPropria(req)) profissional = req.usuario.sub;
    if (profissional) { cond.push('a.professional_id = ?'); params.push(profissional); }

    const [r] = await pool.query(
      SELECT_BASE + (cond.length ? ' WHERE ' + cond.join(' AND ') : '') + ' ORDER BY a.starts_at',
      params
    );
    res.json(r.map(paraTela));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao carregar a agenda.' });
  }
});

router.get('/api/appointments/availability', async function (req, res) {
  try {
    const profissional = req.query.professionalId || (req.usuario && req.usuario.sub);
    const data = String(req.query.date || '').slice(0, 10);
    const duracao = Number(req.query.durationMin) || 60;
    if (!profissional) return res.status(400).json({ error: 'Informe o profissional.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ error: 'Informe a data no formato AAAA-MM-DD.' });

    const diaSemana = new Date(data + 'T12:00:00').getDay();
    const [grade] = await pool.query(
      'SELECT start_time, end_time FROM professional_availability WHERE professional_id = ? AND weekday = ? ORDER BY start_time',
      [profissional, diaSemana]
    );
    const [compromissos] = await pool.query(
      `SELECT id, status,
              DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i:%s') AS starts_at,
              DATE_FORMAT(ends_at, '%Y-%m-%d %H:%i:%s') AS ends_at
         FROM appointments
        WHERE professional_id = ? AND DATE(starts_at) = ?`,
      [profissional, data]
    );

    res.json({
      data: data,
      duracaoMin: duracao,
      atende: grade.length > 0,
      horarios: ag.janelasLivres({ data, grade, compromissos, duracaoMin: duracao })
    });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao calcular os horarios livres.' });
  }
});

/* ------------------------------------------------- lembretes (T1.5)
 *
 * ATENÇÃO À ORDEM: estas rotas ficam ANTES de `/api/appointments/:id`. O
 * Express casa o primeiro padrão que serve, e `:id` engoliria "reminders".
 * O sintoma seria um 404 dizendo "compromisso nao encontrado" — que manda
 * procurar o defeito no lugar errado.
 */
function soGestao(req, res) {
  // A rotina automatica do servidor tambem dispara a varredura de lembretes --
  // o porteiro so a deixa chegar em /reminders/run. Ver server/middleware/cron.js.
  if (cron.ehServico(req)) return true;
  const papel = req.usuario && req.usuario.papel;
  if (papel === 'admin' || papel === 'gerente') return true;
  res.status(403).json({ error: 'Configuracao de lembretes e restrita a admin e gerente.' });
  return false;
}

const CHAVES_LEMBRETE = ['lembretes_ativos', 'lembrete_antecedencia_h', 'lembrete_template'];

router.get('/api/appointments/reminders/settings', async function (req, res) {
  if (!soGestao(req, res)) return;
  try {
    const cfg = await lembretes.lerConfig(pool);
    res.json(cfg);
  } catch (e) {
    res.status(500).json({ error: 'Falha ao ler a configuracao de lembretes.' });
  }
});

router.put('/api/appointments/reminders/settings', async function (req, res) {
  if (!soGestao(req, res)) return;
  const b = req.body || {};
  const novos = {};
  if (b.ativo !== undefined) novos.lembretes_ativos = b.ativo ? '1' : '0';
  if (b.antecedenciaH !== undefined) {
    const h = Number(b.antecedenciaH);
    if (!isFinite(h) || h < 1 || h > 168) return res.status(400).json({ error: 'Antecedencia entre 1 e 168 horas.' });
    novos.lembrete_antecedencia_h = String(Math.round(h));
  }
  if (b.template !== undefined) {
    const t = String(b.template).trim();
    if (!t) return res.status(400).json({ error: 'O texto do lembrete nao pode ficar vazio.' });
    novos.lembrete_template = t;
  }
  try {
    for (const chave of Object.keys(novos)) {
      if (CHAVES_LEMBRETE.indexOf(chave) === -1) continue;
      await pool.query(
        'INSERT INTO system_settings (chave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)',
        [chave, novos[chave]]
      );
    }
    if (novos.lembretes_ativos !== undefined) {
      await logSystemEvent('AGENDA',
        'Lembrete automatico por WhatsApp ' + (novos.lembretes_ativos === '1' ? 'LIGADO' : 'desligado') + '.',
        autor(req));
    }
    res.json(await lembretes.lerConfig(pool));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao salvar a configuracao de lembretes.' });
  }
});

/** Prévia: decide tudo e não envia nada. É o que se olha ANTES de ligar. */
router.get('/api/appointments/reminders/preview', async function (req, res) {
  if (!soGestao(req, res)) return;
  try {
    res.json(await lembretes.rodarUmaVez(pool, { simular: true }));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao montar a previa dos lembretes.' });
  }
});

/** Uma passada de verdade. Idempotente: rodar duas vezes nao repete mensagem.
 *  Existe para o cron do sistema e para o botao da tela, porque o relogio
 *  interno morre junto com o processo quando o LiteSpeed o recicla. */
router.post('/api/appointments/reminders/run', async function (req, res) {
  if (!soGestao(req, res)) return;
  try {
    const r = await lembretes.rodarUmaVez(pool, { enviar: sendWhatsappText });
    if (r.enviados) {
      await logSystemEvent('AGENDA', r.enviados + ' lembrete(s) de compromisso enviado(s).', autor(req));
    }
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: 'Falha ao enviar os lembretes.' });
  }
});

router.get('/api/appointments/:id', async function (req, res) {
  try {
    const [r] = await pool.query(SELECT_BASE + ' WHERE a.id = ?', [req.params.id]);
    if (!r.length) return res.status(404).json({ error: 'Compromisso nao encontrado.' });
    if (soVeAPropria(req) && r[0].professional_id !== req.usuario.sub) {
      return res.status(403).json({ error: 'Este compromisso e da agenda de outro profissional.' });
    }
    res.json(paraTela(r[0]));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao carregar o compromisso.' });
  }
});

/* ---------------------------------------------------------------- criar */

/** Monta o compromisso a partir do corpo, resolvendo catálogo e duração.
 *  R5: o preço é COPIADO do catálogo, não referenciado — se o catálogo subir
 *  de preço amanhã, o atendimento de hoje não pode mudar de valor. */
async function montar(b, req) {
  const kind = b.kind === 'BLOQUEIO' ? 'BLOQUEIO' : 'ATENDIMENTO';
  const inicio = dataHora(b.startsAt);
  let fim = dataHora(b.endsAt);
  let titulo = String(b.title || '').trim();
  let preco = b.price === undefined || b.price === null || b.price === '' ? null : Number(b.price);

  if (b.catalogId) {
    const [c] = await pool.query('SELECT * FROM treatment_catalog WHERE id = ?', [b.catalogId]);
    if (!c.length) return { erro: { status: 404, error: 'Servico nao encontrado no catalogo.' } };
    if (!titulo) titulo = c[0].name;
    if (preco === null) preco = c[0].price === null ? null : Number(c[0].price);
    if (!fim && inicio && c[0].duration_min) {
      fim = new Date(new Date(inicio.replace(' ', 'T')).getTime() + Number(c[0].duration_min) * 60000)
        .toISOString().replace('T', ' ').slice(0, 19);
    }
  }
  if (!titulo) titulo = kind === 'BLOQUEIO' ? 'Horario bloqueado' : 'Atendimento';
  if (kind === 'BLOQUEIO') preco = null;

  return {
    dados: {
      clientId: kind === 'BLOQUEIO' ? null : (b.clientId || null),
      professionalId: b.professionalId || (req.usuario && req.usuario.sub),
      catalogId: b.catalogId || null,
      title: titulo,
      startsAt: inicio,
      endsAt: fim,
      kind: kind,
      room: b.room || null,
      price: preco,
      notes: b.notes || null
    }
  };
}

router.post('/api/appointments', async function (req, res) {
  try {
    const montado = await montar(req.body || {}, req);
    if (montado.erro) return res.status(montado.erro.status).json({ error: montado.erro.error });
    const d = montado.dados;

    if (soVeAPropria(req) && d.professionalId !== req.usuario.sub) {
      return res.status(403).json({ error: 'Voce so pode agendar na propria agenda.' });
    }

    const existentes = d.startsAt && d.endsAt ? await agendaDoProfissional(d.professionalId, d.startsAt, d.endsAt) : [];
    const problema = ag.validar(d, existentes);
    if (problema) return res.status(problema.status).json({ error: problema.error, conflito: problema.conflito });

    const id = novoId('ap');
    await pool.query(
      `INSERT INTO appointments
        (id, client_id, professional_id, catalog_id, title, starts_at, ends_at, kind, room, price, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, d.clientId, d.professionalId, d.catalogId, d.title, d.startsAt, d.endsAt,
       d.kind, d.room, d.price, d.notes, (req.usuario && req.usuario.sub) || null]
    );
    await logSystemEvent('AGENDA', 'Compromisso criado: ' + d.title + ' em ' + d.startsAt + '.', autor(req));
    res.status(201).json({ id });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao criar o compromisso.' });
  }
});

/* --------------------------------------------------------------- editar */

router.patch('/api/appointments/:id', async function (req, res) {
  const b = req.body || {};
  try {
    const [atualR] = await pool.query('SELECT * FROM appointments WHERE id = ?', [req.params.id]);
    if (!atualR.length) return res.status(404).json({ error: 'Compromisso nao encontrado.' });
    const atual = atualR[0];
    if (soVeAPropria(req) && atual.professional_id !== req.usuario.sub) {
      return res.status(403).json({ error: 'Este compromisso e da agenda de outro profissional.' });
    }

    const inicio = b.startsAt !== undefined ? dataHora(b.startsAt) : ag.instante(atual.starts_at) && atual.starts_at;
    const fim = b.endsAt !== undefined ? dataHora(b.endsAt) : atual.ends_at;
    const profissional = b.professionalId || atual.professional_id;

    // Mexeu em horario ou em profissional? Entao a regra de conflito roda de novo.
    if (b.startsAt !== undefined || b.endsAt !== undefined || b.professionalId !== undefined) {
      const existentes = await agendaDoProfissional(profissional, inicio, fim);
      const problema = ag.validar(
        { id: atual.id, professionalId: profissional, startsAt: inicio, endsAt: fim },
        existentes
      );
      if (problema) return res.status(problema.status).json({ error: problema.error, conflito: problema.conflito });
    }

    const sets = [], valores = [];
    const campo = (nome, valor) => { sets.push(nome + ' = ?'); valores.push(valor); };
    if (b.title !== undefined) campo('title', String(b.title).trim() || atual.title);
    if (b.startsAt !== undefined) campo('starts_at', inicio);
    if (b.endsAt !== undefined) campo('ends_at', fim);
    if (b.professionalId !== undefined) campo('professional_id', profissional);
    if (b.clientId !== undefined) campo('client_id', b.clientId || null);
    if (b.room !== undefined) campo('room', b.room || null);
    if (b.notes !== undefined) campo('notes', b.notes || null);
    if (b.price !== undefined) campo('price', b.price === null || b.price === '' ? null : Number(b.price));
    if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar.' });

    valores.push(req.params.id);
    await pool.query('UPDATE appointments SET ' + sets.join(', ') + ' WHERE id = ?', valores);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao atualizar o compromisso.' });
  }
});

router.patch('/api/appointments/:id/status', async function (req, res) {
  const b = req.body || {};
  if (STATUS.indexOf(b.status) === -1) return res.status(400).json({ error: 'Status invalido.' });
  try {
    const [r] = await pool.query('SELECT * FROM appointments WHERE id = ?', [req.params.id]);
    if (!r.length) return res.status(404).json({ error: 'Compromisso nao encontrado.' });
    if (soVeAPropria(req) && r[0].professional_id !== req.usuario.sub) {
      return res.status(403).json({ error: 'Este compromisso e da agenda de outro profissional.' });
    }

    // REALIZADO nao e uma mudanca de status como as outras: e o evento que faz
    // nascer receita, baixa de estoque e pontos de fidelidade. Ele tem servico
    // proprio, transacional e idempotente (contexto 02). Esta rota nao aplica
    // efeito nenhum por conta propria -- se aplicasse, existiriam dois caminhos
    // para concluir um atendimento, e um deles esqueceria um efeito.
    if (b.status === 'REALIZADO') {
      const saida = await concluido.concluirAtendimento(pool, req.params.id, {
        usuarioId: req.usuario && req.usuario.sub
      });
      if (saida.status) return res.status(saida.status).json({ error: saida.error });
      if (!saida.jaConcluido) {
        await logSystemEvent('AGENDA', '"' + r[0].title + '" concluido.', autor(req));
      }
      return res.json({ ok: true, jaConcluido: !!saida.jaConcluido, efeitos: saida.efeitos });
    }

    // Sair de REALIZADO tambem nao e edicao de campo: os efeitos precisam ser
    // estornados antes. Quem faz isso e /reopen, com motivo obrigatorio.
    if (r[0].completed_at) {
      return res.status(409).json({
        error: 'Este atendimento esta concluido. Use "desfazer conclusao" e informe o motivo.'
      });
    }

    const carimbos = [];
    if (b.status === 'CONFIRMADO') carimbos.push('confirmed_at = NOW()');

    await pool.query(
      'UPDATE appointments SET status = ?, cancelled_reason = ?' +
        (carimbos.length ? ', ' + carimbos.join(', ') : '') + ' WHERE id = ?',
      [b.status, b.status === 'CANCELADO' ? (b.reason || null) : null, req.params.id]
    );

    // Cancelou depois de resgatar? Os pontos voltam: a paciente nao recebeu o
    // beneficio. Uma falha aqui nao pode impedir o cancelamento -- o horario
    // precisa ser liberado de qualquer forma.
    let pontosDevolvidos = null;
    if (b.status === 'CANCELADO') {
      try {
        const est = await efeitosFidelidade.estornarResgate(req.params.id, pool,
          { usuarioId: req.usuario && req.usuario.sub, motivo: 'atendimento cancelado' });
        if (est.estornado) pontosDevolvidos = est.pontos;
      } catch (e) {
        console.error('[agenda] falha ao devolver pontos do resgate:', e.message);
      }
    }

    // A sessao clinica acompanha o compromisso, quando existe vinculo.
    const legado = { REALIZADO: 'REALIZADA', AGENDADO: 'AGENDADA', FALTOU: 'FALTOU', CANCELADO: 'CANCELADA' }[b.status];
    if (legado) {
      await pool.query('UPDATE treatment_sessions SET status = ? WHERE appointment_id = ?', [legado, req.params.id]);
    }

    await logSystemEvent('AGENDA', '"' + r[0].title + '" marcado como ' + b.status + '.', autor(req));
    res.json({ ok: true, pontosDevolvidos: pontosDevolvidos });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao mudar o status do compromisso.' });
  }
});

/* ------------------------------------------------ resgate de pontos (T5.3)
 *
 * A ORDEM DO FLUXO NÃO É NEGOCIÁVEL: desconto → conclusão → acúmulo.
 *
 * O resgate abate o `price` do compromisso ANTES de ele ser concluído. Quando o
 * evento de atendimento realizado rodar, `creditarPontos` vai ver o preço já
 * líquido e acumular sobre o que a paciente realmente pagou.
 *
 * Se o resgate entrasse depois da conclusão, o acúmulo já teria sido creditado
 * sobre o valor cheio — a paciente resgataria R$ 120 e acumularia como se
 * tivesse pago o preço inteiro. O programa passaria a financiar os próprios
 * pontos, e ninguém perceberia até o saldo em circulação explodir. Por isso a
 * rota RECUSA resgate em atendimento já concluído.
 */
router.post('/api/appointments/:id/redeem', async function (req, res) {
  const b = req.body || {};
  const conexao = await pool.getConnection();
  try {
    await conexao.beginTransaction();

    const [ar] = await conexao.query('SELECT * FROM appointments WHERE id = ? FOR UPDATE', [req.params.id]);
    const compromisso = ar[0] || null;
    const [wr] = await conexao.query('SELECT * FROM loyalty_rewards WHERE id = ?', [b.rewardId]);
    const [cr] = await conexao.query("SELECT * FROM loyalty_settings WHERE id = 'default'");
    const cfg = fidelidade.config(cr[0]);

    let saldo = 0, jaResgatou = false;
    if (compromisso && compromisso.client_id) {
      const [tx] = await conexao.query(
        `SELECT id, type, points, expired,
                DATE_FORMAT(expires_at, '%Y-%m-%d') AS expires_at,
                DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
           FROM loyalty_transactions WHERE client_id = ?`,
        [compromisso.client_id]
      );
      saldo = fidelidade.saldo(tx);
      const [jr] = await conexao.query(
        "SELECT id FROM loyalty_transactions WHERE source = 'APPOINTMENT' AND source_id = ? AND type = 'RESGATE'",
        [req.params.id]
      );
      jaResgatou = jr.length > 0;
    }

    const d = fidelidade.podeResgatar({
      config: cfg, premio: wr[0] || null, compromisso: compromisso,
      saldo: saldo, jaResgatou: jaResgatou
    });
    if (!d.ok) { await conexao.rollback(); return res.status(d.status).json({ error: d.error }); }

    await conexao.query('UPDATE appointments SET price = ? WHERE id = ?', [d.precoFinal, req.params.id]);
    await conexao.query(
      `INSERT INTO loyalty_transactions
        (id, client_id, type, points, description, source, source_id, reward_id, amount_discounted, created_by)
       VALUES (?,?, 'RESGATE', ?, ?, 'APPOINTMENT', ?, ?, ?, ?)`,
      ['lt_' + Math.random().toString(36).slice(2, 10), compromisso.client_id, -d.custo,
       ('Resgate: ' + wr[0].name).slice(0, 255), req.params.id, wr[0].id, d.desconto,
       req.usuario && req.usuario.sub]
    );

    await conexao.commit();
    await logSystemEvent('FIDELIDADE',
      'Resgate de "' + wr[0].name + '" (' + d.custo + ' pontos) em "' + compromisso.title + '".', autor(req));

    res.json({ ok: true, recompensa: wr[0].name, pontosUsados: d.custo,
               desconto: d.desconto, precoAnterior: Number(compromisso.price), precoFinal: d.precoFinal,
               saldoDepois: d.pontosDepois, acumuloPrevisto: d.acumuloPrevisto });
  } catch (e) {
    try { await conexao.rollback(); } catch (_) { /* conexao ja pode ter caido */ }
    if (e.code === 'ER_NO_SUCH_TABLE') {
      return res.status(409).json({ error: 'Programa de fidelidade nao instalado neste ambiente.' });
    }
    res.status(500).json({ error: 'Falha ao aplicar o resgate.' });
  } finally {
    conexao.release();
  }
});

/** Desfazer o resgate antes da conclusão: devolve os pontos e o preço.
 *  Existe porque escolher a recompensa errada na recepção é comum, e sem este
 *  caminho a alternativa seria mexer no banco. */
router.delete('/api/appointments/:id/redeem', async function (req, res) {
  const conexao = await pool.getConnection();
  try {
    await conexao.beginTransaction();
    const [ar] = await conexao.query('SELECT * FROM appointments WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!ar.length) { await conexao.rollback(); return res.status(404).json({ error: 'Compromisso nao encontrado.' }); }
    if (ar[0].completed_at) {
      await conexao.rollback();
      return res.status(409).json({ error: 'Atendimento concluido: desfaca a conclusao primeiro.' });
    }

    const [rs] = await conexao.query(
      `SELECT t.*, w.name AS reward_name
         FROM loyalty_transactions t
         LEFT JOIN loyalty_rewards w ON w.id = t.reward_id
        WHERE t.source = 'APPOINTMENT' AND t.source_id = ? AND t.type = 'RESGATE'`,
      [req.params.id]
    );
    if (!rs.length) { await conexao.rollback(); return res.status(409).json({ error: 'Este atendimento nao tem resgate.' }); }
    const resgate = rs[0];

    // O desconto em reais foi GRAVADO no resgate, nao e recalculado. Um premio
    // percentual depende do preco do momento, e esse preco acabou de mudar --
    // recalcular devolveria o valor errado.
    const desconto = fidelidade.centavos(resgate.amount_discounted);
    const precoVolta = fidelidade.centavos(Number(ar[0].price) + desconto);

    await conexao.query('UPDATE appointments SET price = ? WHERE id = ?', [precoVolta, req.params.id]);

    /* ESTE apagamento é a exceção, e a exceção tem regra.
     *
     * Em todo o resto do sistema estorno é lançamento novo e nada se apaga —
     * porque houve um efeito no mundo que precisa ficar registrado. Aqui não
     * houve: o atendimento não foi concluído, nada foi entregue à paciente, e o
     * preço volta ao que era. É uma correção de digitação, não um estorno.
     *
     * Manter o resgate e somar um estorno positivo ao lado teria dois defeitos:
     * inflaria o extrato com um par que não aconteceu, e deixaria a chave
     * (APPOINTMENT, id, RESGATE) ocupada — a recepção não conseguiria escolher
     * outra recompensa para o mesmo atendimento, que é justamente o motivo de
     * ela estar desfazendo.
     *
     * Quem quiser auditar encontra em system_logs, com autor e horário. */
    await conexao.query('DELETE FROM loyalty_transactions WHERE id = ?', [resgate.id]);

    await conexao.commit();
    await logSystemEvent('FIDELIDADE',
      'Resgate desfeito em "' + ar[0].title + '": ' + Math.abs(Number(resgate.points)) + ' ponto(s) devolvidos.', autor(req));
    res.json({ ok: true, pontosDevolvidos: Math.abs(Number(resgate.points)), precoFinal: precoVolta });
  } catch (e) {
    try { await conexao.rollback(); } catch (_) { /* conexao ja pode ter caido */ }
    res.status(500).json({ error: 'Falha ao desfazer o resgate.' });
  } finally {
    conexao.release();
  }
});

/** Desfazer a conclusão. Marcar como realizado por engano acontece toda semana
 *  em recepção; sem este caminho a pessoa "conserta" editando o banco ou
 *  criando um lançamento negativo à mão, e o histórico deixa de fechar.
 *
 *  Só admin e gerente, motivo obrigatório: o estorno mexe em dinheiro, e um
 *  estorno sem motivo registrado é exatamente o buraco que a auditoria fecha. */
router.post('/api/appointments/:id/reopen', async function (req, res) {
  const b = req.body || {};
  const papel = req.usuario && req.usuario.papel;
  if (papel !== 'admin' && papel !== 'gerente') {
    return res.status(403).json({ error: 'Desfazer conclusao e restrito a admin e gerente.' });
  }
  try {
    const [r] = await pool.query('SELECT title FROM appointments WHERE id = ?', [req.params.id]);
    if (!r.length) return res.status(404).json({ error: 'Compromisso nao encontrado.' });

    const saida = await concluido.reverterConclusao(pool, req.params.id, {
      usuarioId: req.usuario && req.usuario.sub,
      motivo: b.reason || b.motivo
    });
    if (saida.status) return res.status(saida.status).json({ error: saida.error });

    await logSystemEvent(
      'AGENDA',
      'Conclusao de "' + r[0].title + '" desfeita. Motivo: ' + saida.motivo,
      autor(req)
    );
    res.json({ ok: true, efeitos: saida.efeitos });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao desfazer a conclusao do atendimento.' });
  }
});

/** R2 — reagendar NÃO edita o registro.
 *  Cria um compromisso novo apontando para o antigo e cancela o antigo. O
 *  histórico de remarcação é o número que diz à clínica quem remarca demais —
 *  editar a data no lugar apaga essa informação para sempre. */
router.post('/api/appointments/:id/reschedule', async function (req, res) {
  const b = req.body || {};
  const conexao = await pool.getConnection();
  try {
    const [r] = await conexao.query('SELECT * FROM appointments WHERE id = ?', [req.params.id]);
    if (!r.length) return res.status(404).json({ error: 'Compromisso nao encontrado.' });
    const antigo = r[0];
    if (soVeAPropria(req) && antigo.professional_id !== req.usuario.sub) {
      return res.status(403).json({ error: 'Este compromisso e da agenda de outro profissional.' });
    }
    if (antigo.status === 'REALIZADO') {
      return res.status(409).json({ error: 'Atendimento ja realizado nao se remarca.' });
    }

    const inicio = dataHora(b.startsAt);
    const fim = dataHora(b.endsAt);
    const profissional = b.professionalId || antigo.professional_id;
    const existentes = await agendaDoProfissional(profissional, inicio, fim);
    const problema = ag.validar({ professionalId: profissional, startsAt: inicio, endsAt: fim }, existentes);
    if (problema) return res.status(problema.status).json({ error: problema.error, conflito: problema.conflito });

    await conexao.beginTransaction();
    const id = novoId('ap');
    await conexao.query(
      `INSERT INTO appointments
        (id, client_id, professional_id, catalog_id, title, starts_at, ends_at, kind, room, price, notes,
         rescheduled_from, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, antigo.client_id, profissional, antigo.catalog_id, antigo.title, inicio, fim,
       antigo.kind, antigo.room, antigo.price, antigo.notes, antigo.id, (req.usuario && req.usuario.sub) || null]
    );
    await conexao.query(
      "UPDATE appointments SET status = 'CANCELADO', cancelled_reason = ? WHERE id = ?",
      [b.reason || 'Reagendado', antigo.id]
    );
    await conexao.query('UPDATE treatment_sessions SET appointment_id = ? WHERE appointment_id = ?', [id, antigo.id]);
    await conexao.commit();

    await logSystemEvent('AGENDA',
      '"' + antigo.title + '" remarcado de ' + antigo.starts_at + ' para ' + inicio + '.', autor(req));
    res.status(201).json({ id, anterior: antigo.id });
  } catch (e) {
    try { await conexao.rollback(); } catch (e2) { /* ja fechada */ }
    res.status(500).json({ error: 'Falha ao remarcar o compromisso.' });
  } finally {
    conexao.release();
  }
});

/** Só bloqueio se apaga. Atendimento se cancela — apagar some com o histórico
 *  de uma paciente que faltou ou desmarcou, que é informação da clínica. */
router.delete('/api/appointments/:id', async function (req, res) {
  try {
    const [r] = await pool.query('SELECT title, kind, professional_id FROM appointments WHERE id = ?', [req.params.id]);
    if (!r.length) return res.status(404).json({ error: 'Compromisso nao encontrado.' });
    if (soVeAPropria(req) && r[0].professional_id !== req.usuario.sub) {
      return res.status(403).json({ error: 'Este compromisso e da agenda de outro profissional.' });
    }
    if (r[0].kind !== 'BLOQUEIO') {
      return res.status(409).json({ error: 'Atendimento nao se apaga: marque como cancelado, para o historico ficar.' });
    }
    await pool.query('DELETE FROM appointments WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao remover o bloqueio.' });
  }
});

/* ------------------------------------------------------- grade semanal */

router.get('/api/availability', async function (req, res) {
  try {
    const profissional = req.query.professionalId || (soVeAPropria(req) ? req.usuario.sub : null);
    const [r] = await pool.query(
      'SELECT * FROM professional_availability' + (profissional ? ' WHERE professional_id = ?' : '') +
        ' ORDER BY professional_id, weekday, start_time',
      profissional ? [profissional] : []
    );
    res.json(r.map((f) => ({
      id: f.id, professionalId: f.professional_id, weekday: f.weekday,
      startTime: String(f.start_time).slice(0, 5), endTime: String(f.end_time).slice(0, 5)
    })));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao carregar a grade de horarios.' });
  }
});

/** Substitui a grade inteira do profissional. Faixa a faixa daria margem a
 *  estados intermediários incoerentes; a grade é um conjunto, não uma lista. */
router.put('/api/availability/:professionalId', async function (req, res) {
  const faixas = (req.body && req.body.faixas) || [];
  if (!Array.isArray(faixas)) return res.status(400).json({ error: 'Envie a lista de faixas.' });
  if (soVeAPropria(req) && req.params.professionalId !== req.usuario.sub) {
    return res.status(403).json({ error: 'Voce so pode editar a propria grade.' });
  }
  for (const f of faixas) {
    const dia = Number(f.weekday);
    if (!isFinite(dia) || dia < 0 || dia > 6) return res.status(400).json({ error: 'Dia da semana invalido.' });
    if (!/^\d{2}:\d{2}/.test(String(f.startTime)) || !/^\d{2}:\d{2}/.test(String(f.endTime))) {
      return res.status(400).json({ error: 'Horario invalido. Use HH:MM.' });
    }
    if (ag.paraMinutos(f.endTime) <= ag.paraMinutos(f.startTime)) {
      return res.status(400).json({ error: 'O fim da faixa precisa ser depois do inicio.' });
    }
  }
  const conexao = await pool.getConnection();
  try {
    await conexao.beginTransaction();
    await conexao.query('DELETE FROM professional_availability WHERE professional_id = ?', [req.params.professionalId]);
    for (const f of faixas) {
      await conexao.query(
        'INSERT INTO professional_availability (id, professional_id, weekday, start_time, end_time) VALUES (?,?,?,?,?)',
        [novoId('av'), req.params.professionalId, Number(f.weekday),
         String(f.startTime).slice(0, 5) + ':00', String(f.endTime).slice(0, 5) + ':00']
      );
    }
    await conexao.commit();
    res.json({ ok: true, faixas: faixas.length });
  } catch (e) {
    try { await conexao.rollback(); } catch (e2) { /* ja fechada */ }
    res.status(500).json({ error: 'Falha ao salvar a grade de horarios.' });
  } finally {
    conexao.release();
  }
});

module.exports = router;

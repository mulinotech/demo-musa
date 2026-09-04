'use strict';
/** Documentos clínicos — Fase 4.
 *
 *  DADO PESSOAL SENSÍVEL (LGPD art. 5º, II). Três consequências práticas que
 *  estão implementadas aqui e não são enfeite:
 *
 *  1. `vendedor` não entra em nenhuma rota deste módulo. Está na tabela de
 *     papéis, inclusive com padrão de rota aninhada — porque prefixo não
 *     expressa `/api/clients/:id/documents` e o furo passaria calado.
 *
 *  2. TODA leitura de documento assinado é registrada em `system_logs`. Trilha
 *     de acesso é o que permite responder "quem viu isso?" — e essa pergunta
 *     aparece quando já é tarde.
 *
 *  3. O documento nunca é servido por link direto. Não há arquivo em diretório
 *     público; o conteúdo sai por rota autenticada, e é isso que impede que uma
 *     URL adivinhável exponha prontuário.
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const doc = require('../services/documentos');
const { logSystemEvent } = require('../services/logs');

const novoId = (p) => p + '_' + Math.random().toString(36).slice(2, 10);
const autor = (req) => (req.usuario && req.usuario.nome) || 'Sistema';

/** IP de quem assinou. Atrás do LiteSpeed a conexão vem do proxy, então o
 *  cabeçalho encaminhado é o que tem o endereço real — e ficamos com o PRIMEIRO
 *  da lista, que é o cliente; os seguintes são proxies. */
function ipDaRequisicao(req) {
  const enc = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (enc || req.socket.remoteAddress || '').slice(0, 45);
}

async function lerDocumento(id) {
  const [r] = await pool.query(`
    SELECT d.*, c.name AS client_name,
           DATE_FORMAT(d.signed_at, '%d/%m/%Y às %H:%i') AS signed_at_br,
           DATE_FORMAT(d.created_at, '%Y-%m-%d %H:%i:%s') AS created_at_txt
      FROM client_documents d
      JOIN clients c ON c.id = d.client_id
     WHERE d.id = ?
  `, [id]);
  return r.length ? r[0] : null;
}

async function lerModelo(id) {
  const [r] = await pool.query('SELECT * FROM document_templates WHERE id = ?', [id]);
  return r.length ? r[0] : null;
}

function paraTela(d) {
  return {
    id: d.id,
    clientId: d.client_id,
    clientName: d.client_name || null,
    templateId: d.template_id,
    templateVersion: d.template_version,
    appointmentId: d.appointment_id,
    type: d.type,
    title: d.title,
    answers: doc.parseJson(d.answers_json, {}),
    status: d.status,
    contentHash: d.content_hash,
    signerName: d.signer_name,
    signerDocument: d.signer_document,
    signedAt: d.signed_at_br || null,
    cancelledReason: d.cancelled_reason,
    createdAt: d.created_at_txt
  };
}

/* -------------------------------------------------------------- modelos */

router.get('/api/document-templates', async function (req, res) {
  try {
    const [r] = await pool.query(
      'SELECT * FROM document_templates' + (req.query.active === '1' ? ' WHERE active = 1' : '') +
      ' ORDER BY type, name, version DESC'
    );
    res.json(r.map((t) => ({
      id: t.id, name: t.name, type: t.type, catalogId: t.catalog_id, version: t.version,
      fields: doc.parseJson(t.fields_json, { sections: [] }),
      bodyMarkdown: t.body_markdown, active: !!t.active
    })));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao listar os modelos.' });
  }
});

/** Editar modelo publicado cria a VERSÃO SEGUINTE, não altera a existente.
 *
 *  Um documento já assinado aponta para a versão que foi assinada. Se o modelo
 *  mudasse no lugar, o histórico passaria a mostrar perguntas que aquela
 *  paciente nunca viu — e a assinatura dela cobriria um texto que não existia. */
router.post('/api/document-templates', async function (req, res) {
  const b = req.body || {};
  const nome = String(b.name || '').trim();
  if (!nome) return res.status(400).json({ error: 'O modelo precisa de um nome.' });
  if (doc.TIPOS.indexOf(b.type) === -1) return res.status(400).json({ error: 'Tipo de modelo invalido.' });
  const def = b.fields || { sections: [] };
  if (!Array.isArray(def.sections)) return res.status(400).json({ error: 'Estrutura de perguntas invalida.' });

  try {
    let versao = 1;
    let base = null;
    if (b.baseId) {
      base = await lerModelo(b.baseId);
      if (!base) return res.status(404).json({ error: 'Modelo de origem nao encontrado.' });
      const [m] = await pool.query('SELECT MAX(version) AS v FROM document_templates WHERE name = ?', [base.name]);
      versao = Number(m[0].v || 1) + 1;
      // A versao anterior sai de circulacao para novos documentos, mas continua
      // no banco: e ela que os documentos ja assinados referenciam.
      await pool.query('UPDATE document_templates SET active = 0 WHERE id = ?', [base.id]);
    }

    const id = novoId('tpl');
    await pool.query(
      `INSERT INTO document_templates (id, name, type, catalog_id, version, fields_json, body_markdown, created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, nome.slice(0, 255), b.type, b.catalogId || null, versao,
       JSON.stringify(def), b.bodyMarkdown || (base && base.body_markdown) || null,
       req.usuario && req.usuario.sub]
    );
    await logSystemEvent('DOCUMENTOS',
      'Modelo "' + nome + '" salvo na versao ' + versao + '.', autor(req));
    res.status(201).json({ id, version: versao });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao salvar o modelo.' });
  }
});

router.patch('/api/document-templates/:id', async function (req, res) {
  const b = req.body || {};
  // Só metadados. Mudar perguntas exige versão nova — ver o comentário acima.
  const sets = [], v = [];
  if (b.active !== undefined) { sets.push('active = ?'); v.push(b.active ? 1 : 0); }
  if (b.catalogId !== undefined) { sets.push('catalog_id = ?'); v.push(b.catalogId || null); }
  if (!sets.length) {
    return res.status(400).json({
      error: 'Para mudar perguntas ou texto, salve um modelo novo a partir deste (cria a versao seguinte).'
    });
  }
  try {
    v.push(req.params.id);
    const [r] = await pool.query('UPDATE document_templates SET ' + sets.join(', ') + ' WHERE id = ?', v);
    if (!r.affectedRows) return res.status(404).json({ error: 'Modelo nao encontrado.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao atualizar o modelo.' });
  }
});

/* ---------------------------------------------------- documentos do paciente */

router.get('/api/clients/:id/documents', async function (req, res) {
  try {
    const [r] = await pool.query(`
      SELECT d.*, c.name AS client_name,
             DATE_FORMAT(d.signed_at, '%d/%m/%Y às %H:%i') AS signed_at_br,
             DATE_FORMAT(d.created_at, '%Y-%m-%d %H:%i:%s') AS created_at_txt
        FROM client_documents d
        JOIN clients c ON c.id = d.client_id
       WHERE d.client_id = ?
       ORDER BY d.created_at DESC
    `, [req.params.id]);
    res.json(r.map(paraTela));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao listar os documentos do paciente.' });
  }
});

router.post('/api/clients/:id/documents', async function (req, res) {
  const b = req.body || {};
  try {
    const modelo = b.templateId ? await lerModelo(b.templateId) : null;
    if (b.templateId && !modelo) return res.status(404).json({ error: 'Modelo nao encontrado.' });

    const [cl] = await pool.query('SELECT id, name FROM clients WHERE id = ?', [req.params.id]);
    if (!cl.length) return res.status(404).json({ error: 'Paciente nao encontrado.' });

    const id = novoId('doc');
    await pool.query(
      `INSERT INTO client_documents
        (id, client_id, template_id, template_version, appointment_id, type, title, answers_json, status, created_by)
       VALUES (?,?,?,?,?,?,?,?, 'RASCUNHO', ?)`,
      [id, req.params.id, modelo ? modelo.id : null, modelo ? modelo.version : null,
       b.appointmentId || null, (modelo && modelo.type) || b.type || 'OUTRO',
       String(b.title || (modelo && modelo.name) || 'Documento').slice(0, 255),
       JSON.stringify(b.answers || {}), req.usuario && req.usuario.sub]
    );
    res.status(201).json({ id });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao criar o documento.' });
  }
});

router.patch('/api/documents/:id', async function (req, res) {
  const b = req.body || {};
  try {
    const d = await lerDocumento(req.params.id);
    const pode = doc.podeEditar(d);
    if (!pode.ok) return res.status(pode.status).json({ error: pode.error });

    const sets = ['answers_json = ?'], v = [JSON.stringify(b.answers || {})];
    if (b.title !== undefined) { sets.push('title = ?'); v.push(String(b.title).slice(0, 255)); }
    v.push(req.params.id);
    await pool.query('UPDATE client_documents SET ' + sets.join(', ') + ' WHERE id = ?', v);

    // Alertas já valem no rascunho: a contraindicação existe assim que a
    // paciente responde, não quando o documento é assinado.
    const modelo = d.template_id ? await lerModelo(d.template_id) : null;
    res.json({ ok: true, alertas: doc.alertas(modelo, b.answers || {}) });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao salvar as respostas.' });
  }
});

/** Congela o documento: renderiza, calcula o hash e trava a edição. */
router.post('/api/documents/:id/finalize', async function (req, res) {
  try {
    const d = await lerDocumento(req.params.id);
    if (!d) return res.status(404).json({ error: 'Documento nao encontrado.' });
    const modelo = d.template_id ? await lerModelo(d.template_id) : null;
    const respostas = doc.parseJson(d.answers_json, {});

    const problemas = doc.validar(modelo, respostas);
    const pode = doc.podeFinalizar(d, problemas);
    if (!pode.ok) return res.status(pode.status).json({ error: pode.error, problemas: pode.problemas });

    let procedimento = null;
    if (d.appointment_id) {
      const [ap] = await pool.query('SELECT title FROM appointments WHERE id = ?', [d.appointment_id]);
      if (ap.length) procedimento = ap[0].title;
    }

    const html = doc.renderizar({
      modelo: modelo, respostas: respostas, titulo: d.title,
      cliente: { name: d.client_name }, procedimento: procedimento
    });
    const hash = doc.hashDoConteudo(html);

    await pool.query(
      `UPDATE client_documents
          SET rendered_html = ?, content_hash = ?, status = 'AGUARDANDO_ASSINATURA'
        WHERE id = ? AND status = 'RASCUNHO'`,
      [html, hash, req.params.id]
    );
    await logSystemEvent('DOCUMENTOS',
      '"' + d.title + '" de ' + d.client_name + ' gerado para assinatura.', autor(req));
    res.json({ ok: true, contentHash: hash, status: 'AGUARDANDO_ASSINATURA' });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao gerar o documento.' });
  }
});

router.post('/api/documents/:id/sign', async function (req, res) {
  const b = req.body || {};
  try {
    const d = await lerDocumento(req.params.id);
    const pode = doc.podeAssinar(d, b);
    if (!pode.ok) return res.status(pode.status).json({ error: pode.error });

    // O hash NÃO é recalculado na assinatura: ele foi calculado quando o
    // conteúdo foi congelado, e é justamente por não mudar que serve de prova.
    await pool.query(
      `UPDATE client_documents
          SET status = 'ASSINADO', signer_name = ?, signer_document = ?, signature_image = ?,
              signed_at = NOW(), signed_ip = ?, signed_user_agent = ?
        WHERE id = ? AND status = 'AGUARDANDO_ASSINATURA'`,
      [String(b.signerName).trim().slice(0, 255), pode.cpf, String(b.signatureImage).slice(0, 2000000),
       ipDaRequisicao(req), String(req.headers['user-agent'] || '').slice(0, 255), req.params.id]
    );
    await logSystemEvent('DOCUMENTOS',
      '"' + d.title + '" assinado por ' + String(b.signerName).trim() + '. Integridade: ' +
      String(d.content_hash || '').slice(0, 12) + '...', autor(req));
    res.json({ ok: true, status: 'ASSINADO', contentHash: d.content_hash });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao registrar a assinatura.' });
  }
});

/** O documento para ler e imprimir. Rota autenticada, e cada leitura de
 *  documento ASSINADO vira registro na trilha — é o que responde "quem viu
 *  isso?". Rascunho não gera registro: seria ruído sem valor de auditoria. */
router.get('/api/documents/:id/view', async function (req, res) {
  try {
    const d = await lerDocumento(req.params.id);
    if (!d) return res.status(404).json({ error: 'Documento nao encontrado.' });

    if (!d.rendered_html) {
      return res.status(409).json({ error: 'Documento ainda em rascunho: gere para assinatura primeiro.' });
    }

    // Verificação de integridade na leitura: se o texto guardado não bate com o
    // hash registrado, alguém mexeu no banco por fora. Melhor a página dizer
    // isso do que apresentar um documento adulterado como legítimo.
    const confere = doc.hashDoConteudo(d.rendered_html) === d.content_hash;

    if (d.status === 'ASSINADO') {
      await logSystemEvent('LGPD',
        'Documento assinado "' + d.title + '" de ' + d.client_name + ' visualizado.', autor(req));
    }

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(doc.paginaCompleta(d, { hashConfere: confere }));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao abrir o documento.' });
  }
});

router.post('/api/documents/:id/cancel', async function (req, res) {
  const motivo = String((req.body || {}).reason || '').trim();
  if (!motivo) return res.status(400).json({ error: 'Informe o motivo do cancelamento.' });
  try {
    const d = await lerDocumento(req.params.id);
    if (!d) return res.status(404).json({ error: 'Documento nao encontrado.' });
    if (d.status === 'CANCELADO') return res.status(409).json({ error: 'Documento ja cancelado.' });

    // Cancelar NUNCA apaga. O documento assinado continua guardado, com o
    // conteudo e a assinatura -- so deixa de valer.
    await pool.query(
      "UPDATE client_documents SET status = 'CANCELADO', cancelled_reason = ? WHERE id = ?",
      [motivo.slice(0, 255), req.params.id]
    );
    await logSystemEvent('DOCUMENTOS',
      '"' + d.title + '" de ' + d.client_name + ' cancelado. Motivo: ' + motivo, autor(req));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao cancelar o documento.' });
  }
});

/* -------------------------------------------------------- alertas clínicos */

/** As contraindicações do paciente, vindas da anamnese mais recente que tenha
 *  respostas estruturadas. Consultada pela ficha e pelo compromisso da agenda. */
router.get('/api/clients/:id/alerts', async function (req, res) {
  try {
    const [docs] = await pool.query(`
      SELECT d.id, d.title, d.answers_json, d.template_id, d.status,
             DATE_FORMAT(d.created_at, '%d/%m/%Y') AS quando
        FROM client_documents d
       WHERE d.client_id = ? AND d.type = 'ANAMNESE' AND d.status <> 'CANCELADO'
       ORDER BY d.created_at DESC
    `, [req.params.id]);

    const modelos = new Map();
    const achados = [];
    let origem = null;

    for (const d of docs) {
      if (!d.template_id) continue;
      if (!modelos.has(d.template_id)) modelos.set(d.template_id, await lerModelo(d.template_id));
      const encontrados = doc.alertas(modelos.get(d.template_id), doc.parseJson(d.answers_json, {}));
      if (encontrados.length) {
        achados.push.apply(achados, encontrados);
        origem = { documentId: d.id, titulo: d.title, quando: d.quando, status: d.status };
        break;   // a anamnese mais recente com alerta e a que vale
      }
    }

    // Anamnese antiga em texto livre nao tem estrutura para avaliar. Dizer isso
    // e melhor do que devolver "nenhum alerta" -- que sugere que alguem checou.
    const soTextoLivre = !origem && docs.some((d) => !d.template_id);
    res.json({
      clientId: req.params.id,
      alertas: achados,
      origem: origem,
      semAnamnese: docs.length === 0,
      apenasTextoLivre: soTextoLivre
    });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao ler os alertas clinicos.' });
  }
});

/* ------------------------------------------------------------- LGPD */

/** Portabilidade (LGPD art. 18, V). Devolve tudo o que a clínica guarda sobre a
 *  paciente, em JSON. A exportação em si é um evento registrado — levar dado de
 *  saúde para fora do sistema é exatamente o que a trilha precisa mostrar. */
router.get('/api/clients/:id/export', async function (req, res) {
  try {
    const [cl] = await pool.query('SELECT * FROM clients WHERE id = ?', [req.params.id]);
    if (!cl.length) return res.status(404).json({ error: 'Paciente nao encontrado.' });

    const um = async (sql, p) => (await pool.query(sql, p || [req.params.id]))[0];

    const cliente = Object.assign({}, cl[0]);
    delete cliente.imageBase64;   // a foto vai por download proprio, nao inflando o JSON
    const temFoto = !!cl[0].imageBase64;

    const saida = {
      geradoEm: new Date().toISOString(),
      aviso: 'Exportacao de dados pessoais, incluindo dados de saude (LGPD art. 18, V). ' +
             'Trate este arquivo como confidencial.',
      cliente: cliente,
      possuiFotoDeCadastro: temFoto,
      documentos: await um(`SELECT id, type, title, answers_json, status, content_hash, signer_name,
                                   signed_at, created_at
                              FROM client_documents WHERE client_id = ? ORDER BY created_at`),
      compromissos: await um(`SELECT id, title, starts_at, ends_at, status, price
                                FROM appointments WHERE client_id = ? ORDER BY starts_at`),
      interacoes: await um('SELECT id, type, content, direction, created_at FROM interactions WHERE client_id = ? ORDER BY created_at'),
      planos: await um('SELECT * FROM treatment_plans WHERE client_id = ? ORDER BY created_at')
    };

    try {
      saida.pontos = await um('SELECT type, points, description, expires_at, created_at FROM loyalty_transactions WHERE client_id = ? ORDER BY created_at');
    } catch (e) { if (e.code !== 'ER_NO_SUCH_TABLE') throw e; }

    await logSystemEvent('LGPD',
      'Dados de ' + cl[0].name + ' exportados (portabilidade).', autor(req));

    res.set('Content-Disposition', 'attachment; filename="dados-' + req.params.id + '.json"');
    res.json(saida);
  } catch (e) {
    res.status(500).json({ error: 'Falha ao exportar os dados do paciente.' });
  }
});

module.exports = router;

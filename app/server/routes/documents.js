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

/** A linha e desta clinica? Uma consulta so, para rota com `:id` poder responder
 *  404 em vez de 200 vazio. Vive aqui e e repetida nos outros modulos de
 *  proposito: importar rota de outro arquivo cria dependencia entre modulos que
 *  nao tem nada a ver um com o outro. */
async function ehDestaClinica(db, tabela, id) {
  const [r] = await db.q(
    'SELECT 1 FROM `' + tabela + '` WHERE clinica_id = :clinica AND id = ? LIMIT 1', [id]);
  return r.length > 0;
}
const escopo = require('../db/escopo');
const doc = require('../services/documentos');
const logs = require('../services/logs');

const novoId = (p) => p + '_' + Math.random().toString(36).slice(2, 10);

/** IP de quem assinou. Atrás do LiteSpeed a conexão vem do proxy, então o
 *  cabeçalho encaminhado é o que tem o endereço real — e ficamos com o PRIMEIRO
 *  da lista, que é o cliente; os seguintes são proxies. */
function ipDaRequisicao(req) {
  const enc = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (enc || req.socket.remoteAddress || '').slice(0, 45);
}

/** Um documento, com o nome da paciente.
 *
 *  ============================== O FILTRO AQUI PROTEGE CINCO ROTAS DE UMA VEZ
 *
 *  Esta função é lida por `patch`, `finalize`, `sign`, `view` e `cancel`. As
 *  cinco começam com ela e devolvem 404 quando ela devolve nada — então o
 *  filtro de clínica aqui é o que impede um id de documento de outra clínica de
 *  ser editado, congelado, **assinado**, lido ou cancelado por esta.
 *
 *  Isto não é vazamento comum: `client_documents` é anamnese e termo de
 *  consentimento. Dado pessoal sensível, LGPD art. 5º, II — a categoria que a
 *  lei trata com mais rigor, e a única deste sistema em que o vazamento não tem
 *  conserto possível depois de acontecido.
 *
 *  O `JOIN clients` filtra também: a paciente é parte do documento (o nome dela
 *  entra no texto renderizado e na assinatura), e uma junção sem filtro traria
 *  o nome de uma paciente de outra clínica para dentro de um termo. */
async function lerDocumento(db, id) {
  const [r] = await db.q(`
    SELECT d.*, c.name AS client_name,
           DATE_FORMAT(d.signed_at, '%d/%m/%Y às %H:%i') AS signed_at_br,
           DATE_FORMAT(d.emitido_em, '%d/%m/%Y às %H:%i') AS emitido_em_br,
             DATE_FORMAT(d.created_at, '%Y-%m-%d %H:%i:%s') AS created_at_txt
      FROM client_documents d
      JOIN clients c ON c.id = d.client_id AND c.clinica_id = :clinica
     WHERE d.clinica_id = :clinica AND d.id = ?
  `, [id]);
  return r.length ? r[0] : null;
}

async function lerModelo(db, id) {
  const [r] = await db.q(
    'SELECT * FROM document_templates WHERE clinica_id = :clinica AND id = ?', [id]);
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
    createdAt: d.created_at_txt,
    // Quem emitiu -- so existe em receita e atestado, e vem do CARIMBO no
    // documento, nunca de uma juncao com `users`: o papel tem de continuar
    // dizendo o que era verdade no dia em que saiu.
    emitidoPor: d.emitido_por_nome
      ? {
        nome: d.emitido_por_nome,
        conselho: d.emitido_por_conselho || null,
        numero: d.emitido_por_numero || null,
        uf: d.emitido_por_uf || null,
        em: d.emitido_em_br || null
      }
      : null
  };
}

/* -------------------------------------------------------------- modelos */

router.get('/api/document-templates', async function (req, res) {
  const db = escopo(req);
  try {
    const [r] = await db.q(
      'SELECT * FROM document_templates WHERE clinica_id = :clinica' +
      (req.query.active === '1' ? ' AND active = 1' : '') +
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
  const db = escopo(req);
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
      base = await lerModelo(db, b.baseId);
      if (!base) return res.status(404).json({ error: 'Modelo de origem nao encontrado.' });
      // O CONTADOR DE VERSAO e por clinica. Sem o filtro, duas clinicas com um
      // modelo de nome igual -- "Anamnese Facial" e o exemplo obvio --
      // compartilhariam a numeracao: a clinica B salvaria a versao 2 do modelo
      // dela sem nunca ter tido uma versao 1, porque a A tinha. Nao vaza
      // conteudo, e a historia de versoes fica sem sentido para as duas.
      const [m] = await db.q(
        'SELECT MAX(version) AS v FROM document_templates WHERE clinica_id = :clinica AND name = ?',
        [base.name]);
      versao = Number(m[0].v || 1) + 1;
      // A versao anterior sai de circulacao para novos documentos, mas continua
      // no banco: e ela que os documentos ja assinados referenciam.
      await db.q('UPDATE document_templates SET active = 0 ' +
        'WHERE clinica_id = :clinica AND id = ?', [base.id]);
    }

    const id = novoId('tpl');
    await db.q(
      `INSERT INTO document_templates (id, name, type, catalog_id, version, fields_json, body_markdown, created_by, clinica_id)
       VALUES (?,?,?,?,?,?,?,?, :clinica)`,
      [id, nome.slice(0, 255), b.type, b.catalogId || null, versao,
       JSON.stringify(def), b.bodyMarkdown || (base && base.body_markdown) || null,
       req.usuario && req.usuario.sub]
    );
    await logs.registrar(db, 'DOCUMENTOS',
      'Modelo "' + nome + '" salvo na versao ' + versao + '.');
    res.status(201).json({ id, version: versao });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao salvar o modelo.' });
  }
});

router.patch('/api/document-templates/:id', async function (req, res) {
  const db = escopo(req);
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
    const [r] = await db.q('UPDATE document_templates SET ' + sets.join(', ') +
      ' WHERE clinica_id = :clinica AND id = ?', v);
    if (!r.affectedRows) return res.status(404).json({ error: 'Modelo nao encontrado.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao atualizar o modelo.' });
  }
});

/* ---------------------------------------------------- documentos do paciente */

router.get('/api/clients/:id/documents', async function (req, res) {
  const db = escopo(req);
  try {
    /* A PACIENTE E DESTA CLINICA? Sem esta pergunta, um id de outra clinica
     * responde 200 com lista vazia -- o que nao vaza dado, mas afirma que a
     * paciente existe e nao tem documento. Medido na M4.1. */
    if (!(await ehDestaClinica(db, 'clients', req.params.id))) {
      return res.status(404).json({ error: 'Paciente nao encontrada.' });
    }
    const [r] = await db.q(`
      SELECT d.*, c.name AS client_name,
             DATE_FORMAT(d.signed_at, '%d/%m/%Y às %H:%i') AS signed_at_br,
             DATE_FORMAT(d.emitido_em, '%d/%m/%Y às %H:%i') AS emitido_em_br,
             DATE_FORMAT(d.created_at, '%Y-%m-%d %H:%i:%s') AS created_at_txt
        FROM client_documents d
        JOIN clients c ON c.id = d.client_id AND c.clinica_id = :clinica
       WHERE d.clinica_id = :clinica AND d.client_id = ?
       ORDER BY d.created_at DESC
    `, [req.params.id]);
    res.json(r.map(paraTela));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao listar os documentos do paciente.' });
  }
});

router.post('/api/clients/:id/documents', async function (req, res) {
  const db = escopo(req);
  const b = req.body || {};
  try {
    const modelo = b.templateId ? await lerModelo(db, b.templateId) : null;
    if (b.templateId && !modelo) return res.status(404).json({ error: 'Modelo nao encontrado.' });

    const [cl] = await db.q(
      'SELECT id, name FROM clients WHERE clinica_id = :clinica AND id = ?', [req.params.id]);
    if (!cl.length) return res.status(404).json({ error: 'Paciente nao encontrado.' });

    // O compromisso vinculado tambem e conferido: um documento clinico
    // apontando para atendimento de outra clinica cruzaria prontuario com
    // agenda alheia, e o texto renderizado traria o procedimento errado.
    if (b.appointmentId) {
      const [ap] = await db.q(
        'SELECT id FROM appointments WHERE clinica_id = :clinica AND id = ?', [b.appointmentId]);
      if (!ap.length) return res.status(404).json({ error: 'Compromisso nao encontrado.' });
    }

    const id = novoId('doc');
    await db.q(
      `INSERT INTO client_documents
        (id, client_id, template_id, template_version, appointment_id, type, title, answers_json, status, created_by, clinica_id)
       VALUES (?,?,?,?,?,?,?,?, 'RASCUNHO', ?, :clinica)`,
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
  const db = escopo(req);
  const b = req.body || {};
  try {
    const d = await lerDocumento(db, req.params.id);
    const pode = doc.podeEditar(d);
    if (!pode.ok) return res.status(pode.status).json({ error: pode.error });

    const sets = ['answers_json = ?'], v = [JSON.stringify(b.answers || {})];
    if (b.title !== undefined) { sets.push('title = ?'); v.push(String(b.title).slice(0, 255)); }
    v.push(req.params.id);
    await db.q('UPDATE client_documents SET ' + sets.join(', ') +
      ' WHERE clinica_id = :clinica AND id = ?', v);

    // Alertas já valem no rascunho: a contraindicação existe assim que a
    // paciente responde, não quando o documento é assinado.
    const modelo = d.template_id ? await lerModelo(db, d.template_id) : null;
    res.json({ ok: true, alertas: doc.alertas(modelo, b.answers || {}) });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao salvar as respostas.' });
  }
});

/** Quem esta emitindo, do CADASTRO -- e nao do que a tela mandar.
 *
 *  O numero do conselho e o que a farmacia confere e o que o RH confere. Se
 *  viesse no corpo da requisicao, qualquer pessoa autenticada emitiria receita
 *  com o registro de outra profissional, e o papel sairia perfeito. Vem do
 *  token, entao so pode ser o proprio. */
async function quemEmite(db, req) {
  const id = req.usuario && req.usuario.sub;
  if (!id) return null;
  const [r] = await db.q(
    'SELECT id, name, funcao, conselho, conselho_numero, conselho_uf' +
    ' FROM users WHERE clinica_id = :clinica AND id = ?', [id]);
  if (!r.length) return null;
  return {
    id: r[0].id, nome: r[0].name, funcao: r[0].funcao, conselho: r[0].conselho,
    numero: r[0].conselho_numero, uf: r[0].conselho_uf
  };
}

/** Congela o documento: renderiza, calcula o hash e trava a edição. */
router.post('/api/documents/:id/finalize', async function (req, res) {
  const db = escopo(req);
  try {
    const d = await lerDocumento(db, req.params.id);
    if (!d) return res.status(404).json({ error: 'Documento nao encontrado.' });
    const modelo = d.template_id ? await lerModelo(db, d.template_id) : null;
    const respostas = doc.parseJson(d.answers_json, {});

    const problemas = doc.validar(modelo, respostas);
    const pode = doc.podeFinalizar(d, problemas);
    if (!pode.ok) return res.status(pode.status).json({ error: pode.error, problemas: pode.problemas });

    /* RECEITA E ATESTADO SO SAEM COM REGISTRO PROFISSIONAL (M5.5).
     *
     * Repare que nao ha lista de papeis aqui. Quem pode emitir e quem TEM
     * conselho e numero no cadastro -- o que e a mesma coisa na vida real e
     * uma coisa so para manter. O admin que apenas administra o sistema e
     * recusado pela mesma linha que recusa a recepcao. */
    const emissor = await quemEmite(db, req);
    const podeEmitir = doc.podeEmitir(d, emissor);
    if (!podeEmitir.ok) return res.status(podeEmitir.status).json({ error: podeEmitir.error });

    let procedimento = null;
    if (d.appointment_id) {
      const [ap] = await db.q(
        'SELECT title FROM appointments WHERE clinica_id = :clinica AND id = ?', [d.appointment_id]);
      if (ap.length) procedimento = ap[0].title;
    }

    /* O NOME DA CLINICA VEM DA CLINICA. A variavel `{{clinica}}` do modelo
     * tinha um padrao fixo com o nome da clinica da demonstracao -- e o padrao
     * valia para todo mundo. Termo de consentimento da clinica B saindo com o
     * cabecalho da clinica A e o tipo de vazamento que ninguem chama de
     * vazamento ate o dia em que a paciente le o papel. */
    const minha = await db.minhaClinica();

    const html = doc.renderizar({
      modelo: modelo, respostas: respostas, titulo: d.title,
      cliente: { name: d.client_name }, procedimento: procedimento,
      clinica: (minha && minha.nome) || undefined
    });
    const hash = doc.hashDoConteudo(html);
    const novoStatus = doc.statusAoFinalizar(d.type);
    const emitido = novoStatus === 'EMITIDO';

    await db.q(
      `UPDATE client_documents
          SET rendered_html = ?, content_hash = ?, status = ?,
              emitido_por_id = ?, emitido_por_nome = ?, emitido_por_funcao = ?,
              emitido_por_conselho = ?, emitido_por_numero = ?, emitido_por_uf = ?,
              timbre_clinica = ?, timbre_endereco = ?, timbre_telefone = ?, timbre_contato = ?,
              timbre_email = ?,
              emitido_em = ` + (emitido ? 'NOW()' : 'NULL') + `
        WHERE clinica_id = :clinica AND id = ? AND status = 'RASCUNHO'`,
      [html, hash, novoStatus,
       emitido ? emissor.id : null,
       emitido ? emissor.nome : null,
       emitido ? (emissor.funcao || null) : null,
       emitido ? (emissor.conselho || null) : null,
       emitido ? (emissor.numero || null) : null,
       emitido ? (emissor.uf || null) : null,
       // O TIMBRE VAI CARIMBADO em todo documento congelado, emitido ou nao: a
       // clinica muda de endereco, e o termo assinado no ano passado tem de
       // continuar dizendo o endereco de onde ele saiu.
       (minha && minha.nome) || null,
       (minha && minha.endereco) || null,
       (minha && minha.telefone) || null,
       (minha && minha.contato) || null,
       (minha && minha.email) || null,
       req.params.id]
    );
    await logs.registrar(db, 'DOCUMENTOS', emitido
      ? '"' + d.title + '" de ' + d.client_name + ' emitido por ' + emissor.nome + ' (' +
        (emissor.conselho || '') + ' ' + (emissor.numero || '') + ').'
      : '"' + d.title + '" de ' + d.client_name + ' gerado para assinatura.');
    res.json({ ok: true, contentHash: hash, status: novoStatus });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao gerar o documento.' });
  }
});

router.post('/api/documents/:id/sign', async function (req, res) {
  const db = escopo(req);
  const b = req.body || {};
  try {
    const d = await lerDocumento(db, req.params.id);

    /* A RECUSA VEM ANTES DE QUALQUER OUTRA (M5.5). `podeAssinar` recusaria
     * sozinha, por estado -- receita nasce EMITIDO e nunca passa por
     * AGUARDANDO_ASSINATURA -- mas recusaria dizendo "documento ainda nao foi
     * gerado", que e falso e manda a recepcao tentar de novo. A frase daqui
     * diz o que E: quem assina receita e a profissional, no papel. */
    const emTela = doc.podeAssinarEmTela(d);
    if (!emTela.ok) return res.status(emTela.status).json({ error: emTela.error });

    const pode = doc.podeAssinar(d, b);
    if (!pode.ok) return res.status(pode.status).json({ error: pode.error });

    // O hash NÃO é recalculado na assinatura: ele foi calculado quando o
    // conteúdo foi congelado, e é justamente por não mudar que serve de prova.
    await db.q(
      `UPDATE client_documents
          SET status = 'ASSINADO', signer_name = ?, signer_document = ?, signature_image = ?,
              signed_at = NOW(), signed_ip = ?, signed_user_agent = ?
        WHERE clinica_id = :clinica AND id = ? AND status = 'AGUARDANDO_ASSINATURA'`,
      [String(b.signerName).trim().slice(0, 255), pode.cpf, String(b.signatureImage).slice(0, 2000000),
       ipDaRequisicao(req), String(req.headers['user-agent'] || '').slice(0, 255), req.params.id]
    );
    await logs.registrar(db, 'DOCUMENTOS',
      '"' + d.title + '" assinado por ' + String(b.signerName).trim() + '. Integridade: ' +
      String(d.content_hash || '').slice(0, 12) + '...');
    res.json({ ok: true, status: 'ASSINADO', contentHash: d.content_hash });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao registrar a assinatura.' });
  }
});

/** O documento para ler e imprimir. Rota autenticada, e cada leitura de
 *  documento ASSINADO vira registro na trilha — é o que responde "quem viu
 *  isso?". Rascunho não gera registro: seria ruído sem valor de auditoria. */
router.get('/api/documents/:id/view', async function (req, res) {
  const db = escopo(req);
  try {
    const d = await lerDocumento(db, req.params.id);
    if (!d) return res.status(404).json({ error: 'Documento nao encontrado.' });

    if (!d.rendered_html) {
      return res.status(409).json({ error: 'Documento ainda em rascunho: gere para assinatura primeiro.' });
    }

    // Verificação de integridade na leitura: se o texto guardado não bate com o
    // hash registrado, alguém mexeu no banco por fora. Melhor a página dizer
    // isso do que apresentar um documento adulterado como legítimo.
    const confere = doc.hashDoConteudo(d.rendered_html) === d.content_hash;

    /* A TRILHA VALE PARA O EMITIDO TAMBEM. Receita e atestado sao dado de
     * saude como a anamnese e -- deixar a leitura deles fora do registro seria
     * responder "quem viu o prontuario?" com meia lista. */
    if (d.status === 'ASSINADO' || d.status === 'EMITIDO') {
      await logs.registrar(db, 'LGPD',
        'Documento ' + (d.status === 'EMITIDO' ? 'emitido' : 'assinado') +
        ' "' + d.title + '" de ' + d.client_name + ' visualizado.');
    }

    /* O timbre ATUAL vai junto, e serve so de recurso: `paginaCompleta` usa o
     * que esta carimbado no documento e cai aqui apenas para documento antigo,
     * anterior a migration 035. */
    const minha = await db.minhaClinica();
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(doc.paginaCompleta(d, {
      hashConfere: confere,
      timbre: minha ? {
        clinica: minha.nome, endereco: minha.endereco, telefone: minha.telefone,
        contato: minha.contato, email: minha.email
      } : null
    }));
  } catch (e) {
    res.status(500).json({ error: 'Falha ao abrir o documento.' });
  }
});

router.post('/api/documents/:id/cancel', async function (req, res) {
  const db = escopo(req);
  const motivo = String((req.body || {}).reason || '').trim();
  if (!motivo) return res.status(400).json({ error: 'Informe o motivo do cancelamento.' });
  try {
    const d = await lerDocumento(db, req.params.id);
    if (!d) return res.status(404).json({ error: 'Documento nao encontrado.' });
    if (d.status === 'CANCELADO') return res.status(409).json({ error: 'Documento ja cancelado.' });

    // Cancelar NUNCA apaga. O documento assinado continua guardado, com o
    // conteudo e a assinatura -- so deixa de valer.
    await db.q(
      "UPDATE client_documents SET status = 'CANCELADO', cancelled_reason = ? " +
      'WHERE clinica_id = :clinica AND id = ?',
      [motivo.slice(0, 255), req.params.id]
    );
    await logs.registrar(db, 'DOCUMENTOS',
      '"' + d.title + '" de ' + d.client_name + ' cancelado. Motivo: ' + motivo);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao cancelar o documento.' });
  }
});

/* -------------------------------------------------------- alertas clínicos */

/** As contraindicações do paciente, vindas da anamnese mais recente que tenha
 *  respostas estruturadas. Consultada pela ficha e pelo compromisso da agenda. */
router.get('/api/clients/:id/alerts', async function (req, res) {
  const db = escopo(req);
  try {
    /* AQUI O 404 NAO E DETALHE: e a rota que a profissional abre segundos antes
     * de aplicar o produto. Com id de outra clinica ela respondia
     * `semAnamnese: true`, que se le como "nenhuma contraindicacao" -- para uma
     * paciente que nem e desta clinica. Medido na M4.1. */
    if (!(await ehDestaClinica(db, 'clients', req.params.id))) {
      return res.status(404).json({ error: 'Paciente nao encontrada.' });
    }
    // A rota que a profissional abre segundos antes de aplicar o produto.
    // Alerta de contraindicacao da paciente ERRADA aqui nao e vazamento de
    // dado: e risco clinico.
    const [docs] = await db.q(`
      SELECT d.id, d.title, d.answers_json, d.template_id, d.status,
             DATE_FORMAT(d.created_at, '%d/%m/%Y') AS quando
        FROM client_documents d
       WHERE d.clinica_id = :clinica AND d.client_id = ?
         AND d.type = 'ANAMNESE' AND d.status <> 'CANCELADO'
       ORDER BY d.created_at DESC
    `, [req.params.id]);

    const modelos = new Map();
    const achados = [];
    let origem = null;

    for (const d of docs) {
      if (!d.template_id) continue;
      if (!modelos.has(d.template_id)) modelos.set(d.template_id, await lerModelo(db, d.template_id));
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
  const db = escopo(req);
  try {
    /* ======================= A ROTA MAIS PERIGOSA DO SISTEMA, E POR QUE
     *
     * Ela despeja, num arquivo, TUDO o que a clínica guarda sobre uma pessoa:
     * cadastro, anamnese com as respostas, termos assinados, agenda,
     * conversas, planos de tratamento e pontos. Seis consultas, um `id` na URL.
     *
     * Sem filtro de clínica, trocar esse `id` pelo de uma paciente de outra
     * clínica entrega o prontuário dela inteiro — e o pedido nem parece
     * suspeito, porque é exatamente a mesma requisição que a portabilidade
     * legítima faz (LGPD art. 18, V). Não haveria erro em tela, e a trilha
     * registraria "dados exportados" como se fosse normal.
     *
     * Por isso o filtro está em TODAS as seis, e a primeira conferência é o
     * dono da paciente: id de outra clínica devolve 404 antes de qualquer
     * leitura acontecer.
     */
    const [cl] = await db.q(
      'SELECT * FROM clients WHERE clinica_id = :clinica AND id = ?', [req.params.id]);
    if (!cl.length) return res.status(404).json({ error: 'Paciente nao encontrado.' });

    const um = async (sql) => (await db.q(sql, [req.params.id]))[0];

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
                              FROM client_documents
                             WHERE clinica_id = :clinica AND client_id = ? ORDER BY created_at`),
      compromissos: await um(`SELECT id, title, starts_at, ends_at, status, price
                                FROM appointments
                               WHERE clinica_id = :clinica AND client_id = ? ORDER BY starts_at`),
      interacoes: await um('SELECT id, type, content, direction, created_at FROM interactions ' +
                           'WHERE clinica_id = :clinica AND client_id = ? ORDER BY created_at'),
      planos: await um('SELECT * FROM treatment_plans ' +
                       'WHERE clinica_id = :clinica AND client_id = ? ORDER BY created_at')
    };

    try {
      saida.pontos = await um('SELECT type, points, description, expires_at, created_at ' +
        'FROM loyalty_transactions WHERE clinica_id = :clinica AND client_id = ? ORDER BY created_at');
    } catch (e) { if (e.code !== 'ER_NO_SUCH_TABLE') throw e; }

    await logs.registrar(db, 'LGPD',
      'Dados de ' + cl[0].name + ' exportados (portabilidade).');

    res.set('Content-Disposition', 'attachment; filename="dados-' + req.params.id + '.json"');
    res.json(saida);
  } catch (e) {
    res.status(500).json({ error: 'Falha ao exportar os dados do paciente.' });
  }
});

module.exports = router;

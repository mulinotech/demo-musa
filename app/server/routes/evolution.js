'use strict';
/** O Gerenciador de WhatsApp — instância, conversas e envio pela tela.
 *
 *  ================================================= O QUE A M1.6b MUDOU AQUI
 *
 *  O webhook saiu para `routes/webhook-whatsapp.js` (chega sem sessão, ver o
 *  cabeçalho de lá). O que ficou são rotas autenticadas, e as duas que falam com
 *  o banco passaram a filtrar:
 *
 *  - **histórico da conversa** (`/messages`) casava o contato por telefone em
 *    `leads` e `clients` **sem filtro**, e trazia as interações dele. Telefone
 *    repetido entre clínicas é caso real — a mesma pessoa pode ser paciente de
 *    dois consultórios —, então a clínica A lia a conversa que a clínica B teve
 *    com a mesma pessoa;
 *  - **envio** (`/send`) fazia a mesma busca por telefone e, não achando,
 *    **criava um lead**. Sem filtro, ela achava o contato da vizinha e gravava a
 *    mensagem enviada na conversa dela.
 *
 *  ============================ O QUE FILTRO DE BANCO NAO RESOLVE, E POR ISSO
 *                                        ESTAS ROTAS PASSAM A RECUSAR
 *
 *  **A instância de WhatsApp é UMA para as 50 clínicas.** O número, o QR code, a
 *  lista de conversas e a lista de contatos vêm da Evolution, não do nosso
 *  banco. Então `/chats`, `/contacts` e a parte de `/messages` que vem do
 *  WhatsApp mostram **a caixa de entrada compartilhada** — a conversa da clínica
 *  B aparece na tela da clínica A porque é literalmente o mesmo WhatsApp.
 *
 *  Nenhum `WHERE clinica_id` conserta isso: o dado não está no banco. E é o tipo
 *  de vazamento que passaria por qualquer conferência de filtro, porque não há
 *  filtro envolvido.
 *
 *  Por isso as rotas que leem da instância **recusam com 503 quando existe mais
 *  de uma clínica cadastrada** — a mesma escolha da captação pública de lead, e
 *  pela mesma razão: com uma clínica está correto; com duas, mostrar é vazar, e
 *  recusar alto é a única resposta honesta enquanto a **M2.1** não der uma
 *  instância por clínica.
 *
 *  O `/send` NÃO recusa: ele já filtra o destinatário pelo banco, e a mensagem
 *  sai correta em conteúdo e em destino. O que continua errado ali é o
 *  **remetente** — a paciente recebe do número da instalação, não do
 *  consultório dela. Isso é identidade, não vazamento, e também é M2.1.
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');
const cfgSvc = require('../services/clinica-config');
const logs = require('../services/logs');
const { SIMULATED_INSTANCES, EvolutionService, sendWhatsappText, getEvolutionManagerUrl, normalizeWhatsappNumber, jidToNumber } = require('../services/evolution');

const MOTIVO_CARIMBAR_INSTANCIA =
  'gravar a instancia recem-criada na propria clinica: `clinicas` nao tem coluna ' +
  'clinica_id (ela E a lista de clinicas), entao a camada nao consegue filtrar aqui';

/** A instância desta clínica, ou uma recusa pronta.
 *
 *  ================================== O QUE SUBSTITUIU A RECUSA DA M2.1a
 *
 *  Na M2.1a estas rotas recusavam com 503 quando existia mais de uma clínica,
 *  porque a instância era **uma para todas** e mostrar a caixa de entrada
 *  compartilhada seria entregar a conversa de uma clínica para outra — sem que
 *  nenhum filtro pudesse ajudar, porque o dado não está no nosso banco.
 *
 *  Com a instância virando campo da clínica, a recusa deixa de ser necessária:
 *  cada uma lê a caixa de entrada **dela**. O que sobra é o caso da clínica
 *  **sem** instância, e aí a resposta é 409 com o que fazer — não uma lista
 *  vazia, que pareceria "você não tem conversa nenhuma". */
async function instanciaOuRecusa(db, res) {
  const instancia = await cfgSvc.instancia(db);
  if (!instancia) {
    res.status(409).json({
      error: 'Esta clinica ainda nao tem WhatsApp conectado.',
      semInstancia: true
    });
    return null;
  }
  return instancia;
}

/** A instância DESTA clínica, e mais nada.
 *
 *  ============================ POR QUE "LIVRE" NAO E CRITERIO -- MEDIDO EM 10/09
 *
 *  A primeira versão desta rota devolvia a instância da clínica **mais as
 *  livres**, com o raciocínio de que "instância livre, por definição, não é de
 *  outra clínica". Está certo dentro do sistema e **errado no mundo**.
 *
 *  A tela de produção mostrou três instâncias no servidor da Evolution, e uma
 *  delas era `Nathi Estética Avançada_Oficial` — outro negócio, no mesmo
 *  servidor. "Livre" só quer dizer "não vinculada a nenhuma clínica DESTE CRM";
 *  não quer dizer "de ninguém". Com 50 clínicas, cada admin veria o nome e o
 *  número de WhatsApp dos outros projetos hospedados ali.
 *
 *  Ninguém teria descoberto isso com dados inventados: no ensaio, toda instância
 *  ou é de uma clínica ou é livre-de-verdade. Foi a instalação real que mostrou
 *  a terceira categoria.
 *
 *  Então a lista ficou **mais restrita**: só a dela. E a clínica nova não precisa
 *  mais da lista — `POST` cria a instância dela e devolve o QR. Quem precisa
 *  enxergar o servidor inteiro é a plataforma, e isso é M3. */
router.get('/api/evolution/instances', async function (req, res) {
  const db = escopo(req);
  try {
    const minha = await cfgSvc.instancia(db);
    if (!minha) return res.json([]);

    const lista = await EvolutionService.listInstances();
    res.json(lista
      .filter((i) => i.name === minha)
      .map((i) => Object.assign({}, i, { minha: true })));
  } catch (error) {
    console.error('[evolution]', error && error.message);
    res.status(500).json({ error: 'Falha ao consultar a instancia de WhatsApp.' });
  }
});


/** Vincular uma instância que JÁ EXISTE é operação da plataforma, não da clínica.
 *
 *  Para escolher entre instâncias existentes é preciso enxergar o servidor da
 *  Evolution — e ele hospeda outros negócios além das clínicas deste CRM (ver a
 *  rota acima). Uma clínica que pudesse vincular por nome poderia tomar a
 *  instância de qualquer coisa que estivesse ali, bastando adivinhar o nome.
 *
 *  A clínica conecta o WhatsApp dela **criando** a instância dela (`POST`
 *  abaixo), que é o caminho que não exige ver nada de ninguém. Vincular uma
 *  existente fica para a M3, com o papel de plataforma. */
router.put('/api/evolution/instance', async function (req, res) {
  return res.status(403).json({
    error: 'Vincular uma instancia existente e operacao da plataforma. ' +
           'Para conectar o WhatsApp desta clinica, use "Conectar meu WhatsApp".'
  });
});


/** Cria a instância desta clínica na Evolution e já a vincula.
 *
 *  O NOME E DERIVADO DA CLINICA, e não vem do corpo da requisição. Aceitar o
 *  nome de fora deixaria uma clínica criar uma instância com o nome que a outra
 *  usaria depois — não vaza nada hoje, e amanhã é uma briga por nome que ninguém
 *  vai entender. Derivado, o nome é previsível e não colide. */
router.post('/api/evolution/instances', async function (req, res) {
  const db = escopo(req);
  try {
    const jaTem = await cfgSvc.instancia(db);
    if (jaTem) {
      return res.status(409).json({
        error: 'Esta clinica ja tem uma instancia: "' + jaTem + '".', instance: jaTem });
    }
    const nome = 'musa-' + String(db.clinicaId).replace(/[^A-Za-z0-9_-]/g, '');
    const created = await EvolutionService.createInstance(nome);

    const cru = escopo.todasAsClinicas(MOTIVO_CARIMBAR_INSTANCIA);
    await cru.q('UPDATE clinicas SET evolution_instance = ? WHERE id = ?', [nome, db.clinicaId]);
    await logs.registrar(db, 'WHATSAPP', 'Instancia de WhatsApp criada: "' + nome + '".');

    res.status(201).json(Object.assign({ instance: nome }, created));
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Esta instancia nao esta disponivel.' });
    }
    console.error('[evolution]', error && error.message);
    res.status(500).json({ error: 'Falha ao criar a instancia de WhatsApp.' });
  }
});


/** O QR Code — lido pela própria clínica (decisão da Silvia em 09/09).
 *
 *  WhatsApp desconecta sozinho com frequência. Centralizar a releitura do QR na
 *  Mulino transformaria cada desconexão num chamado, com a clínica sem lembrete
 *  até alguém atender. Então a tela é dela.
 *
 *  **Só a instância dela.** O QR de outra instância é a sessão de WhatsApp de
 *  outro consultório: quem o lê passa a receber e a enviar as mensagens daquela
 *  clínica. É o pior objeto deste módulo para servir sem conferir dono. */
router.get('/api/evolution/instances/connect/:name', async function (req, res) {
  const db = escopo(req);
  try {
    const minha = await cfgSvc.instancia(db);
    if (!minha) return res.status(409).json({ error: 'Esta clinica ainda nao tem instancia.' });
    if (req.params.name !== minha) {
      return res.status(404).json({ error: 'Instancia nao encontrada.' });
    }
    const connection = await EvolutionService.connectInstance(minha);
    res.json(connection);
  } catch (error) {
    console.error('[evolution]', error && error.message);
    res.status(502).json({ error: 'Falha ao obter o QR Code do WhatsApp.' });
  }
});

// 13.1. Status resumido da integração (usado pelo Gerenciador WhatsApp nativo)

router.get('/api/evolution/status', async function (req, res) {
  const db = escopo(req);
  try {
    const configured = EvolutionService.isConfigured();
    const instance = await cfgSvc.instancia(db);

    // Tres estados, e a tela precisa distinguir os tres: o servidor da Evolution
    // nao configurado (problema da instalacao, e da Mulino), a clinica sem
    // instancia (problema dela, e ela resolve), e a instancia desconectada
    // (problema dela, e o QR resolve). Antes os dois primeiros viravam o mesmo
    // "close", e ninguem sabia a quem recorrer.
    if (!configured) {
      // A INSTANCIA DA CLINICA VAI JUNTO MESMO ASSIM. A versao anterior
      // devolvia `instance: null` aqui, e com isso "a plataforma nao esta
      // configurada" ficava indistinguivel de "esta clinica nao conectou o
      // WhatsApp" -- os dois problemas se resolvem em lugares diferentes, por
      // pessoas diferentes. Foi o proprio ensaio que apontou.
      return res.json({ configured: false, instance: instance, state: 'close',
                        semInstancia: !instance, managerUrl: getEvolutionManagerUrl() });
    }
    if (!instance) {
      return res.json({ configured: true, instance: null, state: 'close',
                        semInstancia: true, managerUrl: getEvolutionManagerUrl() });
    }
    let state = 'close';
    try {
      const st = await EvolutionService.connectionState(instance);
      state = st.state;
    } catch (e) {
      state = 'close';
    }
    res.json({ configured: true, instance: instance, state: state,
               semInstancia: false, managerUrl: getEvolutionManagerUrl() });
  } catch (error) {
    console.error('[evolution]', error && error.message);
    res.status(500).json({ error: 'Erro ao consultar o status do WhatsApp.' });
  }
});

// 13.2. Conversas reais da instância do WhatsApp

router.get('/api/evolution/chats', async function (req, res) {
  const db = escopo(req);
  try {
    // A instancia vem da CLINICA, e nao de `req.query.instance`. Aceitar da
    // requisicao era o furo mais barato de todos: bastava trocar um nome na URL
    // para ler a caixa de entrada do consultorio vizinho.
    const instance = await instanciaOuRecusa(db, res);
    if (!instance) return;
    const chats = await EvolutionService.findChats(instance);
    res.json(chats);
  } catch (error) {
    res.status(502).json({ error: 'Não foi possível carregar as conversas do WhatsApp.', details: error.message });
  }
});

// 13.3. Contatos salvos na instância do WhatsApp

router.get('/api/evolution/contacts', async function (req, res) {
  const db = escopo(req);
  try {
    // A instancia vem da CLINICA, e nao de `req.query.instance`. Aceitar da
    // requisicao era o furo mais barato de todos: bastava trocar um nome na URL
    // para ler a caixa de entrada do consultorio vizinho.
    const instance = await instanciaOuRecusa(db, res);
    if (!instance) return;
    const contacts = await EvolutionService.findContacts(instance);
    res.json(contacts);
  } catch (error) {
    res.status(502).json({ error: 'Não foi possível carregar os contatos do WhatsApp.', details: error.message });
  }
});

// 13.4. Histórico de mensagens de uma conversa

router.get('/api/evolution/messages', async function(req, res) {
  const rawJid = req.query.jid || '';
  const number = normalizeWhatsappNumber(req.query.number || rawJid);
  const remoteJid = rawJid.includes('@') ? rawJid : (number ? `${number}@s.whatsapp.net` : '');
  if (!remoteJid) {
    return res.status(400).json({ error: 'Informe o contato (jid ou number).' });
  }
  const limit = Number(req.query.limit) || 60;

  const db = escopo(req);

  // 1) Histórico registrado no próprio CRM (sempre disponível)
  let crmMessages = [];
  if (number) {
    try {
      const last8 = number.slice(-8);
      // O FILTRO ENTRA NAS DUAS SUBCONSULTAS, e nao so na de fora.
      //
      // `interactions.clinica_id` sozinho protegeria a linha; as subconsultas
      // resolvem QUEM e o contato daquele telefone, e telefone repetido entre
      // clinicas e caso real. Sem filtro nelas, o `IN` recebe o id do contato da
      // vizinha -- e as interacoes daquele id que forem desta clinica saem, o que
      // e raro, mas o conjunto de ids ja teria vazado a existencia do contato.
      const [rows] = await db.q(
        `SELECT i.id, i.content, i.direction, i.type, i.created_at AS createdAt
           FROM interactions i
          WHERE i.clinica_id = :clinica
            AND i.client_id IN (
                  SELECT id FROM leads
                   WHERE clinica_id = :clinica
                     AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(whatsapp, '+', ''), '-', ''), ' ', ''), '(', ''), 8) = ?
                  UNION
                  SELECT id FROM clients
                   WHERE clinica_id = :clinica
                     AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(phone, '+', ''), '-', ''), ' ', ''), '(', ''), 8) = ?
                )
          ORDER BY i.created_at ASC
          LIMIT ?`,
        [last8, last8, limit]
      );
      crmMessages = rows.map(r => ({
        id: `crm_${r.id}`,
        direction: r.direction,
        content: r.content,
        createdAt: new Date(r.createdAt).toISOString(),
        source: 'crm'
      }));
    } catch (dbErr) {
      console.error('[Evolution Messages] Falha ao ler histórico do CRM:', dbErr.message);
    }
  }

  // 2) Histórico direto do WhatsApp (quando a Evolution conseguir devolver)
  let waMessages = [];
  let waError = null;
  try {
    const instance = await cfgSvc.instancia(db);
    if (!instance) throw new Error('esta clinica ainda nao tem WhatsApp conectado');
    waMessages = await EvolutionService.findMessages(instance, remoteJid, limit);
  } catch (error) {
    waError = error.message;
    console.warn('[Evolution Messages] WhatsApp indisponível:', error.message);
  }

  // Mesclar as duas fontes, removendo duplicidades (mesmo texto no mesmo minuto)
  const seen = new Set();
  const merged = [];
  for (const msg of [...waMessages, ...crmMessages]) {
    const bucket = `${msg.direction}|${(msg.content || '').trim()}|${String(msg.createdAt).slice(0, 16)}`;
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    merged.push(msg);
  }
  merged.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  if (merged.length === 0 && waError) {
    return res.status(502).json({ error: 'Não foi possível carregar o histórico da conversa.', details: waError });
  }
  res.json(merged.slice(-limit));
});

// 13.5. Envio direto pelo Gerenciador WhatsApp (também registra no CRM)

router.post('/api/evolution/send', async function(req, res) {
  const db = escopo(req);
  const { number, text, name, jid } = req.body || {};
  const targetNumber = normalizeWhatsappNumber(number || jidToNumber(jid));

  if (!targetNumber) {
    return res.status(400).json({ error: 'Informe um número de WhatsApp válido.' });
  }
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: 'A mensagem não pode estar vazia.' });
  }

  try {
    const instancia = await cfgSvc.instancia(db);
    if (!instancia) {
      return res.status(409).json({
        error: 'Conecte o WhatsApp desta clinica antes de enviar. ' +
               'Sem instancia, a mensagem sairia do numero de outro consultorio.'
      });
    }
    const result = await sendWhatsappText(targetNumber, String(text), instancia);

    // Espelhar a mensagem no CRM: localizar (ou criar) o lead correspondente
    let clientId = null;
    try {
      const last8 = targetNumber.slice(-8);
      const [clients] = await db.q(
        "SELECT id FROM clients WHERE clinica_id = :clinica" +
        " AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(phone, '+', ''), '-', ''), ' ', ''), '(', ''), 8) = ? LIMIT 1",
        [last8]
      );
      const [leads] = await db.q(
        "SELECT id FROM leads WHERE clinica_id = :clinica" +
        " AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(whatsapp, '+', ''), '-', ''), ' ', ''), '(', ''), 8) = ? LIMIT 1",
        [last8]
      );

      if (clients.length > 0) {
        clientId = clients[0].id;
      } else if (leads.length > 0) {
        clientId = leads[0].id;
      } else {
        // Sem filtro, esta busca ACHAVA o contato da vizinha e a mensagem
        // enviada era gravada na conversa dela. Com filtro, nao achando, nasce
        // um lead DESTA clinica -- que e o certo: quem mandou a mensagem foi
        // esta clinica, e o contato e dela.
        clientId = 'l_' + Math.random().toString(36).substring(2, 9);
        await db.q(
          'INSERT INTO leads (id, name, whatsapp, treatment, message, source, status, clinica_id)' +
          ' VALUES (?, ?, ?, ?, ?, ?, ?, :clinica)',
          [clientId, (name && String(name).trim()) || `WhatsApp ${targetNumber.slice(-4)}`, targetNumber, 'Atendimento Geral', 'Conversa iniciada pelo Gerenciador WhatsApp.', 'site', 'contatado']
        );
      }

      await db.q(
        'INSERT INTO interactions (id, client_id, type, content, direction, clinica_id)' +
        ' VALUES (?, ?, ?, ?, ?, :clinica)',
        ['i_' + Math.random().toString(36).substring(2, 9), clientId, 'whatsapp', String(text), 'out']
      );
    } catch (dbErr) {
      console.error('[Evolution Send] Mensagem enviada, mas falhou o registro no CRM:', dbErr.message);
    }

    res.json({ success: true, number: targetNumber, clientId, result });
  } catch (error) {
    console.error('[Evolution Send Error]:', error.message);
    res.status(502).json({ error: 'Falha ao enviar a mensagem pelo WhatsApp.', details: error.message });
  }
});


router.post('/api/evolution/instances/simulate-connect', function(req, res) {
  const { instanceName, number } = req.body;
  const inst = SIMULATED_INSTANCES.find(i => i.name === instanceName);
  if (inst) {
    inst.status = 'open';
    inst.number = number || '5511900000000';
    inst.qrcode = undefined;
  }
  res.json({ success: true });
});

module.exports = router;

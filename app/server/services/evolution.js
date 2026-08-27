'use strict';
/** Integracao com a Evolution API (WhatsApp): cliente HTTP com retry,
 *  cache de instancia, normalizacao de numero e o modo simulado.
 *  Nao depende do banco nem do Express. */
const path = require('path');
const https = require('https');
const http = require('http');
const url = require('url');

let SIMULATED_INSTANCES = [
  {
    name: 'Musa_Estetica_Oficial',
    status: 'open',
    number: '5511900000000',
  }
];

// Erros de rede transitórios que valem uma nova tentativa.
// "socket hang up" (ECONNRESET) acontece quando o Node reaproveita um socket
// keep-alive que a Evolution API acabou de fechar - a requisição nunca chega ao
// servidor, portanto repetir é seguro e não gera mensagem duplicada.
const RETRYABLE_NET_ERRORS = ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN', 'ESOCKETTIMEDOUT'];

function isRetryableNetworkError(err) {
  if (!err) return false;
  if (RETRYABLE_NET_ERRORS.indexOf(err.code) !== -1) return true;
  return /socket hang up|read ECONNRESET|before secure TLS/i.test(err.message || '');
}

// Executa UMA tentativa de requisição HTTP/HTTPS nativa.
// `responseStarted` indica se o servidor já começou a responder - usado para
// decidir se é seguro repetir a requisição.
function performRequest(options, postData, timeoutMs) {
  return new Promise((resolve, reject) => {
    const client = options.protocol === 'http:' ? http : https;
    const postPayload = postData ? JSON.stringify(postData) : null;

    // Clonar os headers para que uma retentativa não herde Content-Length antigo
    const requestOptions = Object.assign({}, options, {
      headers: Object.assign({}, options.headers),
      // agent: false => socket novo e exclusivo por requisição (sem keep-alive).
      // É isto que elimina o erro intermitente "socket hang up".
      agent: false
    });

    if (postPayload) {
      requestOptions.headers['Content-Length'] = Buffer.byteLength(postPayload);
    }

    let responseStarted = false;
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      err.responseStarted = responseStarted;
      reject(err);
    };

    const req = client.request(requestOptions, (res) => {
      responseStarted = true;
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('aborted', () => fail(new Error('Resposta interrompida pelo servidor (aborted).')));
      res.on('error', fail);
      res.on('end', () => {
        if (settled) return;
        settled = true;
        try {
          resolve({ data: JSON.parse(data), statusCode: res.statusCode });
        } catch (e) {
          resolve({ data, statusCode: res.statusCode });
        }
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Tempo limite excedido ao falar com a Evolution API.'));
    });

    req.on('error', (e) => {
      console.error('[HTTP Request Error]:', requestOptions.method, requestOptions.path, '-', e.message);
      fail(e);
    });

    if (postPayload) {
      req.write(postPayload);
    }
    req.end();
  });
}

// Helper público: faz a requisição com retentativa automática em falhas de socket.
async function makeHttpsRequest(options, postData, config) {
  const timeoutMs = (config && config.timeoutMs) || 45000;
  const maxAttempts = (config && config.attempts) || 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await performRequest(options, postData, timeoutMs);
    } catch (err) {
      lastError = err;
      // Se o servidor já começou a responder, repetir pode duplicar o efeito
      // colateral (ex.: mensagem enviada duas vezes). Nesse caso, aborta.
      if (err.responseStarted || !isRetryableNetworkError(err) || attempt === maxAttempts) {
        break;
      }
      console.warn(`[Evolution API] Falha de rede (${err.message}). Tentativa ${attempt + 1}/${maxAttempts}...`);
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }

  throw lastError;
}

// URL pública do painel da Evolution (o navegador do usuário precisa alcançá-la;
// EVOLUTION_API_URL costuma ser um endereço interno como 127.0.0.1:8090).
function getEvolutionManagerUrl() {
  const publicUrl = process.env.VITE_EVOLUTION_MANAGER_URL || process.env.EVOLUTION_MANAGER_URL;
  if (publicUrl) return publicUrl.replace(/\/+$/, '');
  return getEvolutionBaseUrl() + '/manager';
}

function getEvolutionBaseUrl() {
  let apiUrl = process.env.EVOLUTION_API_URL || 'https://eapi.mulinotech.com';
  if (apiUrl && !apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) {
    apiUrl = 'https://' + apiUrl;
  }
  return apiUrl.replace(/\/+$/, '');
}

function getRequestOptions(method, path, hasBody = false) {
  const parsedUrl = url.parse(getEvolutionBaseUrl());
  const headers = {
    'apikey': process.env.EVOLUTION_API_KEY || '',
    'Accept': 'application/json',
    // Sem keep-alive: cada chamada usa um socket novo (ver performRequest).
    'Connection': 'close',
    'User-Agent': 'MusaCRM/1.0'
  };
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }
  return {
    protocol: parsedUrl.protocol,
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
    path: (parsedUrl.pathname === '/' ? '' : parsedUrl.pathname) + path,
    method: method,
    headers: headers
  };
}

// Normaliza um número brasileiro para o formato aceito pelo WhatsApp (55 + DDD + número)
function normalizeWhatsappNumber(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= 11 && !digits.startsWith('55')) {
    digits = '55' + digits;
  }
  return digits;
}

function jidToNumber(jid) {
  return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

// Alguns endpoints da Evolution devolvem colunas JSON como string
function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (e) {
    return null;
  }
}

// Converte o corpo de uma mensagem do Baileys em texto legível
function describeMessageBody(body, fallback) {
  const m = body || {};
  const text = m.conversation
    || m.extendedTextMessage?.text
    || m.imageMessage?.caption
    || m.videoMessage?.caption
    || m.documentMessage?.caption
    || '';
  if (text) return text;
  if (m.imageMessage) return '[Imagem]';
  if (m.audioMessage) return '[Áudio]';
  if (m.videoMessage) return '[Vídeo]';
  if (m.documentMessage) return `[Documento] ${m.documentMessage.fileName || ''}`.trim();
  if (m.stickerMessage) return '[Sticker]';
  if (m.locationMessage) return '[Localização]';
  if (m.contactMessage || m.contactsArrayMessage) return '[Contato]';
  if (m.reactionMessage) return `[Reação] ${m.reactionMessage.text || ''}`.trim();
  return fallback === undefined ? '[Mensagem não suportada]' : fallback;
}

// Cache curto do nome da instância ativa para evitar uma chamada extra
// (e um socket extra) em cada envio de mensagem.
let INSTANCE_NAME_CACHE = { name: null, at: 0 };
const INSTANCE_CACHE_TTL = 60 * 1000;

const EvolutionService = {
  isConfigured: function() {
    return !!(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY);
  },
  // Extrai a lista de instâncias em qualquer um dos formatos das versões 1.x / 2.x
  // A v2.3.7 retorna { value: [...], Count: N } enquanto versões anteriores retornam []
  normalizeInstances: function(raw) {
    // Suporte ao formato v2.3.x: { value: [...], Count: N }
    let arr = raw;
    if (raw && !Array.isArray(raw) && Array.isArray(raw.value)) {
      arr = raw.value;
    }
    if (!Array.isArray(arr)) return [];
    return arr.map((item) => {
      const inst = item.instance || item;
      const state = inst.connectionStatus || inst.status || inst.state || '';
      const owner = inst.ownerJid || inst.owner || inst.number || '';
      return {
        name: inst.name || inst.instanceName || '',
        status: state === 'open' ? 'open' : (state === 'connecting' ? 'connecting' : 'close'),
        number: jidToNumber(owner),
        profileName: inst.profileName || inst.profileStatus || ''
      };
    }).filter(i => !!i.name);
  },
  listInstances: async function() {
    if (!this.isConfigured()) return SIMULATED_INSTANCES;
    // Evolution API v2 expõe /instance/fetchInstances (o antigo /instance/list
    // retornava 404 e deixava a lista de instâncias sempre vazia no painel).
    const endpoints = ['/instance/fetchInstances', '/instance/list'];
    let lastError = null;
    for (const endpoint of endpoints) {
      try {
        const response = await makeHttpsRequest(getRequestOptions('GET', endpoint));
        if (response.statusCode === 404) continue;
        const list = this.normalizeInstances(response.data);
        if (list.length > 0) return list;
      } catch (e) {
        lastError = e;
      }
    }
    if (lastError) console.error('[Evolution API] Erro ao listar instancias:', lastError.message);
    return [];
  },
  connectionState: async function(instanceName) {
    if (!this.isConfigured()) {
      const inst = SIMULATED_INSTANCES.find(i => i.name === instanceName);
      return { instance: instanceName, state: inst ? inst.status : 'close' };
    }
    const response = await makeHttpsRequest(getRequestOptions('GET', `/instance/connectionState/${encodeURIComponent(instanceName)}`));
    const state = response.data?.instance?.state || response.data?.state || 'close';
    return { instance: instanceName, state };
  },
  createInstance: async function(name) {
    const formattedName = name.trim().replace(/\s+/g, '_');
    if (!this.isConfigured()) {
      if (SIMULATED_INSTANCES.some(i => i.name === formattedName)) {
        throw new Error('Instancia com este nome ja existe.');
      }
      const newInst = { name: formattedName, status: 'connecting' };
      SIMULATED_INSTANCES.push(newInst);
      return newInst;
    }
    const options = getRequestOptions('POST', '/instance/create', true);
    const postData = {
      instanceName: formattedName,
      token: '',
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS'
    };
    const response = await makeHttpsRequest(options, postData);
    if (response.statusCode >= 400) {
      throw new Error(this.describeApiError(response));
    }
    const data = response.data?.instance || response.data;
    return { name: data.instanceName || formattedName, status: 'connecting' };
  },
  connectInstance: async function(name) {
    if (!this.isConfigured()) {
      const inst = SIMULATED_INSTANCES.find(i => i.name === name);
      if (!inst) throw new Error('Instancia nao encontrada.');
      const qrcodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=https://demo-musa.mulinotech.com/scan/${name}&color=4A3C35&bgcolor=FAF7F5`;
      inst.qrcode = qrcodeUrl;
      return { qrcode: qrcodeUrl };
    }
    const options = getRequestOptions('GET', `/instance/connect/${encodeURIComponent(name)}`);
    const response = await makeHttpsRequest(options);
    if (response.statusCode >= 400) {
      throw new Error(this.describeApiError(response));
    }
    // v2 devolve { pairingCode, code, base64 } - o <img> do painel precisa do base64
    const base64 = response.data?.base64 || response.data?.qrcode?.base64 || '';
    const code = response.data?.code || response.data?.qrcode?.code || '';
    let qrcode = '';
    if (base64) {
      qrcode = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
    } else if (code) {
      // Sem base64: gerar a imagem a partir do payload textual do QR
      qrcode = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(code)}`;
    }
    return { qrcode, pairingCode: response.data?.pairingCode || '' };
  },
  // Extrai a mensagem de erro real devolvida pela Evolution API
  describeApiError: function(response) {
    const body = response && response.data;
    if (body && typeof body === 'object') {
      const raw = body.response?.message || body.message || body.error;
      if (Array.isArray(raw)) return raw.map(r => (typeof r === 'string' ? r : JSON.stringify(r))).join(' | ');
      if (typeof raw === 'string') return raw;
      if (raw) return JSON.stringify(raw);
    }
    if (typeof body === 'string' && body.trim()) return body.slice(0, 300);
    return `A Evolution API respondeu com o status ${response?.statusCode}.`;
  },
  sendText: async function(instanceName, number, message) {
    const cleanNumber = normalizeWhatsappNumber(number);
    if (!cleanNumber) throw new Error('Número de WhatsApp inválido.');
    if (!this.isConfigured()) {
      console.log(`[SIMULADO WhatsApp] Mensagem enviada para ${cleanNumber}: ${message}`);
      return { status: 'success', simulated: true };
    }

    const instance = instanceName || await this.getInstanceName();

    // Evolution API v2 usa /message/sendText/{instanceName} com { number, text }
    const options = getRequestOptions('POST', `/message/sendText/${encodeURIComponent(instance)}`, true);
    let response = await makeHttpsRequest(options, { number: cleanNumber, text: message, delay: 800 });

    // Se a v2 falhar por 404/400, tentar o formato legado v1
    if (response.statusCode === 404 || response.statusCode === 400) {
      const fallbackOptions = getRequestOptions('POST', `/message/sendText/${encodeURIComponent(instance)}`, true);
      const fallbackData = {
        number: cleanNumber,
        options: { delay: 800, presence: 'composing' },
        textMessage: { text: message }
      };
      const fallbackResponse = await makeHttpsRequest(fallbackOptions, fallbackData);
      if (fallbackResponse.statusCode >= 200 && fallbackResponse.statusCode < 300) {
        return fallbackResponse.data;
      }
      response = response.statusCode === 404 ? fallbackResponse : response;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(this.describeApiError(response));
    }
    return response.data;
  },
  // Lista as conversas existentes na instância (WhatsApp real)
  findChats: async function(instanceName) {
    if (!this.isConfigured()) return [];
    const instance = instanceName || await this.getInstanceName();
    const options = getRequestOptions('POST', `/chat/findChats/${encodeURIComponent(instance)}`, true);
    const response = await makeHttpsRequest(options, {});
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(this.describeApiError(response));
    }
    // v2.3.7 retorna { value: [...], Count: N }; versões antigas retornam [] direto
    const body = response.data;
    let raw;
    if (Array.isArray(body)) {
      raw = body;
    } else if (body && Array.isArray(body.value)) {
      raw = body.value;
    } else {
      raw = body?.chats || body?.records || [];
    }
    return raw.map((chat) => {
      const jid = chat.remoteJid || chat.id || '';
      const last = chat.lastMessage || {};
      // lastMessage.message pode vir como STRING JSON ou objeto
      const lastMsgBody = parseMaybeJson(last.message) || (typeof last.message === 'object' ? last.message : {}) || {};
      return {
        jid,
        number: jidToNumber(jid),
        name: chat.pushName || chat.name || jidToNumber(jid),
        profilePicUrl: chat.profilePicUrl || chat.profilePictureUrl || '',
        unreadCount: chat.unreadCount || 0,
        lastMessage: describeMessageBody(lastMsgBody, ''),
        updatedAt: chat.updatedAt || (last.messageTimestamp ? new Date(Number(last.messageTimestamp) * 1000).toISOString() : null)
      };
    })
      // Somente conversas 1:1 endereçadas por telefone. As entradas "@lid" (novo
      // endereçamento do WhatsApp) não expõem número e não permitem responder,
      // e "@g.us" são grupos.
      .filter(c => String(c.jid).endsWith('@s.whatsapp.net') && c.number)
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
  },
  // Lista os contatos salvos na instância
  findContacts: async function(instanceName) {
    if (!this.isConfigured()) return [];
    const instance = instanceName || await this.getInstanceName();
    const options = getRequestOptions('POST', `/chat/findContacts/${encodeURIComponent(instance)}`, true);
    const response = await makeHttpsRequest(options, {});
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(this.describeApiError(response));
    }
    // v2.3.7 retorna { value: [...], Count: N }; versões antigas retornam [] direto
    const body = response.data;
    let raw;
    if (Array.isArray(body)) {
      raw = body;
    } else if (body && Array.isArray(body.value)) {
      raw = body.value;
    } else {
      raw = body?.contacts || body?.records || [];
    }
    return raw.map((contact) => {
      const jid = contact.remoteJid || contact.id || '';
      return {
        jid,
        number: jidToNumber(jid),
        name: contact.pushName || contact.name || contact.verifiedName || jidToNumber(jid),
        profilePicUrl: contact.profilePicUrl || contact.profilePictureUrl || '',
        isGroup: String(jid).includes('@g.us')
      };
    }).filter(c => c.jid && c.number && !c.isGroup);
  },
  // Normaliza um registro de mensagem da Evolution
  mapMessageRecord: function(msg) {
    const key = parseMaybeJson(msg.key) || {};
    const body = parseMaybeJson(msg.message) || {};
    const ts = Number(msg.messageTimestamp || 0);
    return {
      id: key.id || String(msg.id || Math.random()),
      remoteJid: key.remoteJid || '',
      direction: key.fromMe ? 'out' : 'in',
      content: describeMessageBody(body),
      pushName: msg.pushName || '',
      createdAt: ts ? new Date(ts * 1000).toISOString() : (msg.createdAt || new Date().toISOString()),
      source: 'whatsapp'
    };
  },
  requestMessages: async function(instance, payload) {
    const options = getRequestOptions('POST', `/chat/findMessages/${encodeURIComponent(instance)}`, true);
    const response = await makeHttpsRequest(options, payload);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(this.describeApiError(response));
    }
    const body = response.data;
    // v2.3.7 retorna { value: [...], Count: N }; versões antigas retornam [] ou { records: [] }
    let raw;
    if (Array.isArray(body)) {
      raw = body;
    } else if (body && Array.isArray(body.value)) {
      raw = body.value;
    } else {
      raw = body?.messages?.records || body?.records || [];
    }
    return Array.isArray(raw) ? raw : [];
  },
  // Histórico de mensagens de uma conversa.
  // Observação: neste deployment (Evolution + MySQL) o filtro `where.key.remoteJid`
  // do endpoint /chat/findMessages não funciona (limitação do filtro JSON do
  // Prisma no MySQL) e devolve sempre 0 registros. Por isso, quando o filtro vem
  // vazio, varremos as páginas mais recentes e filtramos aqui pelo remoteJid.
  findMessages: async function(instanceName, remoteJid, limit) {
    if (!this.isConfigured()) return [];
    const instance = instanceName || await this.getInstanceName();
    const max = limit || 60;

    try {
      const filtered = await this.requestMessages(instance, { where: { key: { remoteJid } }, limit: max, offset: max });
      const mapped = filtered.map(m => this.mapMessageRecord(m)).filter(m => !remoteJid || m.remoteJid === remoteJid);
      if (mapped.length > 0) {
        return mapped.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(-max);
      }
    } catch (e) {
      console.warn('[Evolution API] findMessages filtrado falhou:', e.message);
    }

    // Fallback limitado: 2 páginas de 300 mensagens mais recentes da instância
    const collected = [];
    for (let page = 1; page <= 2; page++) {
      const records = await this.requestMessages(instance, { page, offset: 300 });
      if (records.length === 0) break;
      for (const rec of records) {
        const mapped = this.mapMessageRecord(rec);
        if (mapped.remoteJid === remoteJid) collected.push(mapped);
      }
      if (collected.length >= max) break;
    }
    return collected.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(-max);
  },
  getInstanceName: async function(forceRefresh) {
    const envName = process.env.EVOLUTION_INSTANCE_NAME;
    if (envName) return envName;

    const now = Date.now();
    if (!forceRefresh && INSTANCE_NAME_CACHE.name && (now - INSTANCE_NAME_CACHE.at) < INSTANCE_CACHE_TTL) {
      return INSTANCE_NAME_CACHE.name;
    }

    try {
      const list = await this.listInstances();
      if (list && list.length > 0) {
        // Preferir sempre uma instância realmente conectada
        const connected = list.find(i => i.status === 'open') || list[0];
        INSTANCE_NAME_CACHE = { name: connected.name, at: now };
        return connected.name;
      }
    } catch (e) {
      console.error('Erro ao listar instancias:', e.message);
    }
    return INSTANCE_NAME_CACHE.name || 'evolution';
  }
};

// Envia uma mensagem de texto e, em caso de falha, explica o motivo real
// (o mais comum é a instância desconectada do WhatsApp).
async function sendWhatsappText(number, content) {
  const instance = await EvolutionService.getInstanceName();
  try {
    return await EvolutionService.sendText(instance, number, content);
  } catch (err) {
    let state = null;
    try {
      state = (await EvolutionService.connectionState(instance)).state;
    } catch (e) {
      // Sem diagnóstico extra: mantém o erro original
    }
    if (state && state !== 'open') {
      throw new Error(`a instância "${instance}" está desconectada do WhatsApp (estado: ${state}). Leia o QR Code novamente na aba "Integração WhatsApp".`);
    }
    throw err;
  }
}

// 5. Configuração Geral CRM
module.exports = {
  SIMULATED_INSTANCES: SIMULATED_INSTANCES,
  EvolutionService: EvolutionService,
  sendWhatsappText: sendWhatsappText,
  getEvolutionManagerUrl: getEvolutionManagerUrl,
  normalizeWhatsappNumber: normalizeWhatsappNumber,
  jidToNumber: jidToNumber
};

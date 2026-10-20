'use strict';
/** A chamada ao Gemini, num lugar só (relatório de QA de 15/10).
 *
 *  BUG-20: com o provedor sobrecarregado, a tela mostrava, em inglês, "This
 *  model is currently experiencing high demand…" e parava ali. Sobrecarga é
 *  passageira — a segunda tentativa costuma passar. Então:
 *
 *  - até 3 tentativas, com espera crescente (1,5 s e 4 s), só para os erros
 *    que são de fato passageiros (429, 500, 503, "high demand", "overloaded",
 *    tempo esgotado);
 *  - tempo limite por tentativa, para a tela não ficar girando para sempre;
 *  - o erro que sobra chega em PORTUGUÊS, dizendo o que fazer.
 */
const https = require('https');

const MODELO = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const ESPERAS_MS = [1500, 4000];
const LIMITE_MS = 60000;

class ErroDaIA extends Error {
  constructor(mensagem, passageiro) {
    super(mensagem);
    this.passageiro = !!passageiro;
  }
}

/** A mensagem do provedor → o que a pessoa lê. Pura, para o teste. */
function traduzirErro(status, mensagem) {
  const m = String(mensagem || '').toLowerCase();
  if (status === 429 || /quota|rate limit|resource.?exhausted/.test(m)) {
    return 'A IA atingiu o limite de uso neste momento. Tente de novo em alguns minutos.';
  }
  if (status === 503 || /high demand|overloaded|unavailable|try again later/.test(m)) {
    return 'A IA está sobrecarregada agora. Tentamos três vezes; tente de novo em alguns instantes.';
  }
  if (/timeout|tempo/.test(m)) {
    return 'A IA demorou demais para responder. Tente de novo.';
  }
  if (status === 400 || /api key|permission|invalid/.test(m)) {
    return 'A chave da IA foi recusada pelo provedor. Peça a um administrador para conferir a configuração.';
  }
  return 'A IA não conseguiu responder agora. Tente de novo em instantes.';
}

function ehPassageiro(status, mensagem) {
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  return /high demand|overloaded|unavailable|try again|timeout|deadline/i.test(String(mensagem || ''));
}

function umaTentativa(apiKey, corpo) {
  return new Promise(function (resolve, reject) {
    const payload = JSON.stringify(corpo);
    const u = new URL('https://generativelanguage.googleapis.com/v1beta/models/' + MODELO +
                      ':generateContent?key=' + apiKey);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, function (res) {
      let texto = '';
      res.on('data', function (c) { texto += c; });
      res.on('end', function () {
        let data;
        try { data = JSON.parse(texto); } catch (e) {
          return reject(new ErroDaIA(traduzirErro(res.statusCode, 'resposta invalida'), ehPassageiro(res.statusCode, '')));
        }
        if (data.error || res.statusCode >= 400) {
          const msg = (data.error && data.error.message) || ('HTTP ' + res.statusCode);
          const st = (data.error && data.error.code) || res.statusCode;
          console.error('[IA] provedor recusou (' + st + '): ' + msg);
          return reject(new ErroDaIA(traduzirErro(st, msg), ehPassageiro(st, msg)));
        }
        const parte = data.candidates && data.candidates[0] && data.candidates[0].content &&
                      data.candidates[0].content.parts && data.candidates[0].content.parts[0];
        resolve((parte && parte.text) || '');
      });
    });
    req.setTimeout(LIMITE_MS, function () { req.destroy(new Error('timeout')); });
    req.on('error', function (e) {
      reject(new ErroDaIA(traduzirErro(0, e && e.message), true));
    });
    req.write(payload);
    req.end();
  });
}

const esperar = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

/** Gera texto. `parts` no formato do Gemini; `instrucao` vai como system
 *  instruction (as regras do laudo não podem ser "esquecidas" no meio). */
async function gerar(apiKey, parts, instrucao, opcoes) {
  const corpo = { contents: [{ role: 'user', parts: parts }] };
  if (instrucao) corpo.systemInstruction = { parts: [{ text: instrucao }] };
  if (opcoes && opcoes.temperatura !== undefined) {
    corpo.generationConfig = { temperature: opcoes.temperatura };
  }
  let ultimo;
  for (let i = 0; i <= ESPERAS_MS.length; i++) {
    try {
      return await umaTentativa(apiKey, corpo);
    } catch (e) {
      ultimo = e;
      if (!e.passageiro || i === ESPERAS_MS.length) break;
      await esperar(ESPERAS_MS[i]);
    }
  }
  throw ultimo;
}

module.exports = { gerar: gerar, traduzirErro: traduzirErro, ehPassageiro: ehPassageiro, ErroDaIA: ErroDaIA };

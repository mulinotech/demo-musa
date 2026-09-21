'use strict';
/** As duas rotas de IA: laudo de avaliacao facial e sugestao de resposta.
 *
 *  ================================================= O QUE A M1.6b MUDOU AQUI
 *
 *  Era uma consulta so, e vazava do jeito mais dificil de perceber:
 *  `suggest-reply` lia o historico de conversa por `client_id` **sem filtro** e
 *  mandava esse historico para a IA como contexto. Ou seja: a clinica A pedia
 *  uma sugestao de resposta e recebia um texto **construido sobre a conversa da
 *  paciente da clinica B** -- com nome, valores negociados, o que a pessoa
 *  contou. E o vazamento chegava reescrito, o que e pior: nao ha id nem marca na
 *  resposta, so um texto plausivel que alguem copia e manda no WhatsApp.
 *
 *  Agora o historico e lido pela camada, e contato que nao e desta clinica
 *  devolve 404 antes de qualquer chamada externa. A ordem importa aqui pelo
 *  mesmo motivo da rota de interacoes: o dado sai do sistema quando a chamada e
 *  feita, e conferir depois nao traz de volta.
 *
 *  ============================================ O QUE AINDA NAO MUDOU (M2)
 *
 *  O nome da clinica esta **escrito no proprio prompt** ("Dra. Musa Estetica de
 *  Elite", "Dra. Musa"). Com 50 clinicas, a IA sugere resposta assinada pela
 *  clinica errada e o laudo sai com o nome da especialista de outro consultorio.
 *  Nao e vazamento -- e identidade visual e textual por clinica, que e M2.
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');
const path = require('path');
const https = require('https');

router.post('/api/gemini/analyze-skin', async function(req, res) {
  const { anamneseText, imageBase64, clientName } = req.body;
  const apiKey = process.env.GEMINI_API_KEY || '';

  /* SEM CHAVE, ESTA ROTA RECUSA. ANTES ELA INVENTAVA UM LAUDO (M5.12, 21/09).
   *
   * ======================================================= O QUE ESTAVA AQUI
   *
   * Quando a clínica não tinha a chave do Gemini configurada, esta rota
   * respondia **200** com um texto montado no código:
   *
   *     ## LAUDO DE AVALIAÇÃO FACIAL DIGITAL - CLÍNICA PREMIUM
   *     **Paciente:** <nome da paciente>
   *     **Data da Avaliação:** <hoje>
   *     **Dermatologista / Especialista em Estética Avançada:** Dra. Musa
   *
   * Três coisas erradas ao mesmo tempo, e todas graves:
   *
   * 1. É um **documento clínico fabricado**. Não veio de IA nenhuma nem de
   *    avaliação nenhuma — foi escrito aqui dentro, com o nome da paciente
   *    preenchido para parecer um laudo de verdade.
   * 2. Vem **assinado por "Dra. Musa"**, que é a profissional de UMA das 50
   *    clínicas. Qualquer outra clínica recebia um laudo com o nome de uma
   *    profissional que não é a dela e que nunca viu aquela paciente.
   * 3. A tela **gravava na ficha** assim que chegava (o PATCH automático que
   *    saiu de `ClientDirectory` nesta mesma tarefa). Ou seja: bastava clicar
   *    em "Gerar Laudo Clínico IA" numa clínica sem chave para o prontuário
   *    ganhar um laudo falso, assinado por outra pessoa, sem um único aviso.
   *
   * Recusar é a única resposta honesta. A tela já sabe o que fazer com o 400:
   * mostra onde configurar a chave e oferece escrever o laudo à mão. */
  if (!apiKey) {
    return res.status(400).json({
      error: 'A análise por IA não está configurada para esta clínica.',
      details: 'Peça a um administrador para informar a chave do Gemini. ' +
        'Enquanto isso, o laudo pode ser escrito manualmente.'
    });
  }

  try {
    const prompt = `Você é um Dermatologista e Especialista em Estética Avançada atuando em uma clínica premium.
Paciente: ${clientName || 'Paciente'}
Data: ${new Date().toLocaleDateString('pt-BR')}

Baseado nas seguintes anotações de anamnese do paciente: "${anamneseText}"
(E na foto fornecida, se houver).

Elabore um LAUDO DE AVALIAÇÃO FACIAL DIGITAL premium. 
O laudo deve conter:
1. ANÁLISE DERMATOLÓGICA TÉCNICA (use termos técnicos adequados)
2. PLANO DE TRATAMENTO SUGERIDO (ex: Lavien, Ultraformer MPT, Bioestimulador)
3. RECOMENDAÇÕES HOME CARE

Responda apenas com o texto do laudo, bem formatado e profissional.`;

    const parts = [{ text: prompt }];

    if (imageBase64) {
      const matches = imageBase64.match(/^data:(.+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        parts.push({
          inline_data: {
            mime_type: matches[1],
            data: matches[2]
          }
        });
      }
    }

    const payload = JSON.stringify({ contents: [{ parts }] });
    const u = new URL(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`);

    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const reqGemini = https.request(options, (resGemini) => {
      let responseBody = '';
      resGemini.on('data', (chunk) => responseBody += chunk);
      resGemini.on('end', () => {
        try {
          const data = JSON.parse(responseBody);
          if (data.error) {
            return res.status(500).json({ error: 'Erro ao gerar o laudo via IA', details: data.error.message });
          }
          const report = data.candidates?.[0]?.content?.parts?.[0]?.text || "Não foi possível gerar a resposta.";
          res.json({ report });
        } catch (e) {
          res.status(500).json({ error: 'Erro ao gerar o laudo via IA', details: e.message });
        }
      });
    });

    reqGemini.on('error', (e) => {
      res.status(500).json({ error: 'Erro ao gerar o laudo via IA', details: e.message });
    });

    reqGemini.write(payload);
    reqGemini.end();

  } catch (error) {
    res.status(500).json({ error: 'Erro ao gerar o laudo via IA', details: error.message });
  }
});


router.post('/api/gemini/suggest-reply', async function(req, res) {
  const db = escopo(req);
  const { clientId } = req.body;
  const apiKey = process.env.GEMINI_API_KEY || '';

  if (!apiKey) {
    return res.status(400).json({ error: 'Chave API do Gemini não configurada.' });
  }

  try {
    // O DONO DO CONTATO, ANTES DE QUALQUER CHAMADA EXTERNA. Sem isto, o
    // historico da paciente da vizinha viraria contexto de prompt -- e voltaria
    // reescrito, sem id e sem marca, so um texto que alguem copia e envia.
    const [dono] = await db.q(
      'SELECT id FROM leads WHERE clinica_id = :clinica AND id = ?' +
      ' UNION SELECT id FROM clients WHERE clinica_id = :clinica AND id = ?',
      [clientId, clientId]);
    if (!dono.length) return res.status(404).json({ error: 'Contato nao encontrado.' });

    const [interactions] = await db.q(
      'SELECT content, direction FROM interactions' +
      ' WHERE clinica_id = :clinica AND client_id = ? ORDER BY created_at ASC LIMIT 10',
      [clientId]);
    let historicoTexto = interactions.map(i => `${i.direction === 'in' ? 'Cliente' : 'Clínica'}: ${i.content}`).join('\n');
    if (!historicoTexto) historicoTexto = "(Nenhum histórico de mensagens ainda)";

    const prompt = `Você é um Concierge de uma Clínica de Estética Premium chamada Dra. Musa Estética de Elite.
Seu objetivo é sugerir uma ÚNICA mensagem de resposta (curta, humana, persuasiva e elegante) para enviar ao cliente no WhatsApp.
O foco é acolher o cliente e tentar agendar uma avaliação estética presencial.

Histórico da conversa:
${historicoTexto}

Escreva apenas a mensagem sugerida. Evite ser robótico. Use emojis se apropriado (✨, 🤍, etc).`;

    const payload = JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }]
    });

    const u = new URL(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`);
    
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const reqGemini = https.request(options, (resGemini) => {
      let responseBody = '';
      resGemini.on('data', (chunk) => responseBody += chunk);
      resGemini.on('end', () => {
        try {
          const data = JSON.parse(responseBody);
          if (data.error) {
            return res.status(500).json({ error: 'Erro na IA', details: data.error.message });
          }
          const suggestedMessage = data.candidates?.[0]?.content?.parts?.[0]?.text || "Olá! Como posso ajudar?";
          res.json({ suggestion: suggestedMessage.trim() });
        } catch (e) {
          res.status(500).json({ error: 'Erro ao gerar resposta', details: e.message });
        }
      });
    });

    reqGemini.on('error', (e) => {
      res.status(500).json({ error: 'Erro de conexao com a IA', details: e.message });
    });

    reqGemini.write(payload);
    reqGemini.end();

  } catch (error) {
    res.status(500).json({ error: 'Erro ao gerar sugestão via IA', details: error.message });
  }
});

// 6. Listar Clientes

module.exports = router;

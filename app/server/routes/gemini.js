'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const path = require('path');
const https = require('https');

router.post('/api/gemini/analyze-skin', async function(req, res) {
  const { anamneseText, imageBase64, clientName } = req.body;
  const apiKey = process.env.GEMINI_API_KEY || '';

  if (!apiKey) {
    const defaultResponse = `
## LAUDO DE AVALIAÇÃO FACIAL DIGITAL - CLÍNICA PREMIUM

**Paciente:** ${clientName || 'Paciente Premium'}
**Data da Avaliação:** ${new Date().toLocaleDateString('pt-BR')}
**Dermatologista / Especialista em Estética Avançada:** Dra. Musa
`;
    return res.json({ report: defaultResponse });
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
  const { clientId } = req.body;
  const apiKey = process.env.GEMINI_API_KEY || '';

  if (!apiKey) {
    return res.status(400).json({ error: 'Chave API do Gemini não configurada.' });
  }

  try {
    const [interactions] = await pool.query('SELECT content, direction FROM interactions WHERE client_id = ? ORDER BY created_at ASC LIMIT 10', [clientId]);
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

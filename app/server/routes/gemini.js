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
const logs = require('../services/logs');
const ia = require('../services/ia-gemini');
const laudo = require('../services/laudo-ia');

/** Nome da clínica e nomes do catálogo -- o que a IA pode citar. */
async function identidade(db) {
  const c = await db.minhaClinica();
  const [cat] = await db.q('SELECT name FROM treatment_catalog WHERE clinica_id = :clinica ORDER BY name');
  return {
    clinica: (c && c.nome) || 'a clínica',
    catalogo: cat.map(function (t) { return t.name; })
  };
}

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

  /* QA de 15/10, BUG-04: ver server/services/laudo-ia.js. */
  if (!laudo.entradaSuficiente(anamneseText, !!imageBase64)) {
    return res.status(422).json({
      error: 'Dados insuficientes para a pré-avaliação.',
      details: 'Descreva a queixa, a região e o histórico relevante (pelo menos algumas frases) ' +
        'ou envie a foto. Com uma anotação curta como "teste", a IA só poderia inventar.'
    });
  }

  try {
    const db = escopo(req);
    const quem = await identidade(db);
    const parts = [{
      text: 'Paciente: ' + (clientName || 'Paciente') + '\n' +
            'Data: ' + new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + '\n' +
            'Foto enviada: ' + (imageBase64 ? 'sim' : 'NÃO — não descreva nada visual') + '\n\n' +
            'Anotações da profissional (única fonte de informação):\n<<' + String(anamneseText || '') + '>>'
    }];

    if (imageBase64) {
      const matches = imageBase64.match(/^data:(.+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        parts.push({ inline_data: { mime_type: matches[1], data: matches[2] } });
      }
    }

    const texto = await ia.gerar(apiKey, parts, laudo.instrucao(quem.clinica, quem.catalogo), { temperatura: 0.2 });
    const report = laudo.limparLaudo(texto);
    if (!report) {
      return res.status(502).json({ error: 'A IA não devolveu texto.', details: 'Tente de novo ou escreva o laudo manualmente.' });
    }
    // QA de 15/10, BUG-22: o uso da IA sobre dado de saude nao deixava rastro.
    await logs.registrar(db, 'IA_LAUDO',
      'Pre-avaliacao por IA gerada (rascunho, nao salvo) para "' + String(clientName || 'paciente').slice(0, 80) + '".')
      .catch(function () {});
    res.json({ report: report });
  } catch (error) {
    res.status(500).json({
      error: 'Não foi possível gerar a pré-avaliação.',
      details: (error instanceof ia.ErroDaIA) ? error.message : 'Tente de novo em instantes; se continuar, escreva o laudo manualmente.'
    });
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

    /* QA de 15/10, BUG-16. A consulta pegava as 10 PRIMEIRAS mensagens da
     * conversa (ORDER BY ASC LIMIT 10): numa conversa longa, a IA nunca via o
     * que a paciente acabou de dizer, e respondia sobre "queda capilar", um
     * assunto de semanas atras. Agora sao as 15 MAIS RECENTES, em ordem, e a
     * ultima mensagem da paciente vai destacada; o catalogo vai junto para a
     * IA nao oferecer o que a clinica nao faz. */
    const [recentes] = await db.q(
      'SELECT content, direction, created_at FROM interactions' +
      ' WHERE clinica_id = :clinica AND client_id = ? ORDER BY created_at DESC, id DESC LIMIT 15',
      [clientId]);
    const interactions = recentes.slice().reverse();
    let historicoTexto = interactions.map(i => `${i.direction === 'in' ? 'Paciente' : 'Clínica'}: ${i.content}`).join('\n');
    if (!historicoTexto) historicoTexto = '(Nenhum histórico de mensagens ainda)';
    const ultimaDaPaciente = recentes.find(i => i.direction === 'in');

    const quem = await identidade(db);
    const instrucao = [
      'Você é a concierge da clínica de estética "' + quem.clinica + '" e sugere UMA mensagem de WhatsApp',
      'para a equipe enviar. Curta, humana, elegante, em português do Brasil.',
      'REGRAS: responda diretamente à ÚLTIMA mensagem da paciente — é ela que importa; o histórico é só contexto.',
      'Se ela pediu para falar com alguém, confirme que vai encaminhar. Se perguntou preço, diga que o valor',
      'depende da avaliação e ofereça horário, sem inventar números. Ofereça apenas procedimentos deste',
      'catálogo: ' + (quem.catalogo.join('; ') || '(catálogo vazio — não cite procedimentos)') + '.',
      'Não prometa resultado. Escreva só a mensagem, sem aspas. Emojis com moderação (✨, 🤍).'
    ].join('\n');
    const pedido = 'Conversa (da mais antiga para a mais recente):\n' + historicoTexto + '\n\n' +
      'ÚLTIMA MENSAGEM DA PACIENTE, a que deve ser respondida: ' +
      (ultimaDaPaciente ? '"' + ultimaDaPaciente.content + '"' : '(ela ainda não escreveu — faça uma abordagem de boas-vindas)');

    try {
      const sugestao = await ia.gerar(apiKey, [{ text: pedido }], instrucao, { temperatura: 0.6 });
      res.json({ suggestion: laudo.limparLaudo(sugestao).replace(/^["“]|["”]$/g, '') || 'Olá! Como posso ajudar?' });
    } catch (e) {
      res.status(500).json({ error: 'Erro na IA', details: (e instanceof ia.ErroDaIA) ? e.message : 'Tente de novo em instantes.' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro ao gerar sugestão via IA', details: 'Tente de novo em instantes.' });
  }
});

// 6. Listar Clientes

module.exports = router;

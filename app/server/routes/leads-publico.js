'use strict';
/** A CAPTACAO PUBLICA DE LEAD — a única rota de gravação sem sessão.
 *
 *  ======================================================= POR QUE ELA EXISTE
 *
 *  `POST /api/leads` está em `ROTAS_PUBLICAS`: é o formulário do site e o quiz
 *  que postam aqui, de fora, sem ninguém logado. Foi recortada de
 *  `routes/leads.js` na M1.6 pela mesma razão que as rotas de lembrete foram
 *  recortadas da agenda: ela **não pode** usar `escopo(req)` — não há sessão de
 *  onde tirar a clínica.
 *
 *  ============================ COMO ELA SABE DE QUEM É O LEAD (decidido 11/09)
 *
 *  **Pela chave de captação da clínica**, na URL:
 *
 *      POST /api/leads?captacao=cap_xxxxxxxxxxxxxxxxxxxxxxxx
 *
 *  A chave nasce na migration 029, uma por clínica, e **não é uma senha**: ela
 *  vive no código da página de quem a usa. O que ela permite é criar um lead
 *  naquela clínica, e nada mais — não lê paciente, não lê agenda, não lê nada.
 *  O risco que ela carrega é lead falso, e o remédio para isso é o limite de
 *  envios por IP logo abaixo, não o sigilo.
 *
 *  As outras duas saídas foram descartadas em 11/09, e o motivo de cada uma fica
 *  registrado para ninguém reabrir a discussão do zero: **endereço próprio por
 *  clínica** tem exatamente a mesma exposição (o endereço também está no código
 *  da página) e dá o mesmo trabalho de embutir em cada site; **token de
 *  integração** seria de fato secreto, mas exige que o site da clínica tenha
 *  servidor capaz de guardar segredo — e a maioria tem landing page com
 *  formulário em JavaScript, que não guarda segredo nenhum. Travaria a captação
 *  da maior parte delas.
 *
 *  ====================================== O QUE ACONTECE SEM CHAVE, E POR QUÊ
 *
 *  **Com uma clínica só, o pedido sem chave continua sendo aceito.** É a ponte:
 *  o formulário que está no ar hoje não tem chave nenhuma, e ele não pode parar
 *  de gravar no dia em que esta migration rodar. Enquanto a resposta para "de
 *  quem é este lead?" for óbvia, ela é dada.
 *
 *  **A partir da segunda clínica, sem chave é recusa.** 503, alto e visível,
 *  com registro nos logs da plataforma — decidido em 11/09 contra a alternativa
 *  de estacionar o lead para triagem manual. O raciocínio: lead estacionado vai
 *  para um lugar que ninguém olha (linha sem clínica é invisível em todas as
 *  telas desde a M1.6a), e o problema só apareceria semanas depois como "o site
 *  parou de trazer cliente". A recusa aparece no mesmo dia em que alguém errar a
 *  configuração de um site, e quem enviou vê uma mensagem dizendo o que fazer.
 *
 *  **Chave que não existe é sempre recusa**, com uma clínica ou com cinquenta.
 *  Ali não há ambiguidade: alguém configurou um site errado.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const escopo = require('../db/escopo');
const logs = require('../services/logs');

const MOTIVO = 'captacao publica de lead: nao ha sessao de onde tirar a clinica -- ' +
               'ela vem da chave de captacao na URL, ou da unica clinica que existir';

/** Limite de envios, e ele é o remédio de verdade contra a chave ser pública.
 *
 *  O limite global da aplicação é 120 pedidos por minuto em `/api`, generoso
 *  demais para um formulário de site: um visitante de verdade envia um lead,
 *  talvez dois se errar algo.
 *
 *  **Por IP, e não por chave, de propósito.** Limitar por chave deixaria um
 *  atacante desligar a captação de uma clínica só gastando a cota dela — a
 *  defesa viraria o ataque.
 *
 *  ================================ POR QUE 30 E NÃO 10, E O QUE PRECISA SER MEDIDO
 *
 *  A aplicação **não declara `trust proxy`**, e ela roda atrás de proxy (as
 *  respostas saem com `server: nginx`). Sem essa declaração, o Express enxerga
 *  o IP do proxy em `req.ip` para todo mundo — o que tornaria este limite
 *  **somado entre todos os visitantes**, e não por pessoa.
 *
 *  Enquanto isso não estiver medido, 10/min seria perigoso: um único spammer
 *  gastaria a cota e **derrubaria a captação de visitantes reais** — a proteção
 *  virando o estrago. 30/min é a escolha conservadora: ainda freia envio em
 *  massa e dificilmente alcança gente de verdade, nos dois cenários.
 *
 *  A medição está no roteiro de publicação (olhar `ip_address` na trilha de
 *  auditoria: se todos os registros mostrarem o mesmo endereço, é o do proxy).
 *  Se confirmar, `app.set('trust proxy', 1)` conserta **duas** coisas de uma vez
 *  — este limite passa a ser por pessoa, e a trilha de auditoria passa a
 *  registrar quem de fato agiu, em vez do proxy. E aí este número volta para 10. */
const limite = rateLimit({
  windowMs: 60000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitos envios em pouco tempo. Tente de novo em um minuto.' }
});

/** De quem é este lead? Devolve `{ clinicaId }` ou `{ recusa }` com o texto que
 *  vai para o log da plataforma.
 *
 *  Pura de propósito: a regra "sem chave só vale com uma clínica" é a parte que
 *  erra, e assim ela fica testável sem subir banco. */
function decidirClinica(chave, clinicas) {
  if (clinicas.length === 0) {
    return { recusa: 'nenhuma clinica ativa nesta instalacao' };
  }
  if (chave) {
    const achada = clinicas.filter((c) => c.chave_captacao === chave)[0];
    if (!achada) {
      return { recusa: 'a chave de captacao "' + chave + '" nao pertence a nenhuma clinica ' +
                       'ativa. Algum site esta configurado com chave errada, antiga, ou de uma ' +
                       'clinica que foi suspensa.' };
    }
    return { clinicaId: achada.id };
  }
  if (clinicas.length === 1) {
    // A ponte: enquanto a resposta e obvia, ela e dada.
    return { clinicaId: clinicas[0].id };
  }
  return { recusa: clinicas.length + ' clinicas ativas e o formulario nao mandou chave de ' +
                   'captacao. Configure o formulario do site com ?captacao=<chave>; a chave de ' +
                   'cada clinica aparece na tela de Funil & Leads dela.' };
}

router.post('/api/leads', limite, async function (req, res) {
  const { id, name, whatsapp, email, treatment, message, scoreResult,
          date, status, salespersonId, source } = req.body;

  if (!name || !whatsapp || !treatment) {
    return res.status(400).json({ error: 'Campos obrigatorios ausentes (name, whatsapp, treatment).' });
  }

  // A chave pode vir na URL (o caso normal: um formulario HTML postando) ou no
  // corpo (quem monta o envio por codigo acha mais natural). As duas servem.
  const chave = String(req.query.captacao || req.body.captacao || '').trim();

  const cru = escopo.todasAsClinicas(MOTIVO);

  try {
    const [clinicas] = await cru.q(
      "SELECT id, chave_captacao FROM clinicas WHERE status = 'ativa' ORDER BY id");
    const dono = decidirClinica(chave, clinicas);

    if (dono.recusa) {
      console.error('[leads publico] RECUSADO: ' + dono.recusa);
      await logs.daInstalacao(MOTIVO, 'LEAD_SEM_CLINICA',
        'Lead do site RECUSADO: ' + dono.recusa + ' -- nome "' + String(name).slice(0, 60) +
        '", whatsapp ' + String(whatsapp).slice(0, 20) + '. O contato NAO foi gravado.',
        'Sistema (Site/Formulario)', req.ip);
      return res.status(503).json({
        error: 'Cadastro indisponivel no momento. Fale com a clinica pelo WhatsApp.'
      });
    }

    const clinicaId = dono.clinicaId;

    // A partir daqui existe dono, entao o trabalho acontece DENTRO do escopo
    // dele -- inclusive o registro de auditoria. Antes, o log da captacao ia
    // para a instalacao, e linha sem clinica nao aparece em tela nenhuma desde
    // a M1.6a: a clinica que recebeu o lead nunca via o registro de que ele
    // tinha chegado.
    const db = escopo.paraClinica(clinicaId, { autor: 'Sistema (Site/Formulario)', ip: req.ip });

    const leadId = id || Math.random().toString(36).substring(2, 9);
    await db.q(
      `INSERT INTO leads (id, name, whatsapp, email, treatment, message, score_result,
                          salesperson_id, source, date, status, clinica_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, :clinica)`,
      [leadId, name, whatsapp, email || null, treatment, message || '', scoreResult || null,
       salespersonId || null, source || 'site',
       date ? new Date(date) : new Date(), status || 'novo']
    );

    const primeiroNome = (name || '').trim().split(' ')[0] || name;
    await logs.registrar(db, 'LEAD_CREATE',
      'Novo lead pelo site: "' + primeiroNome + '" (' + whatsapp + ') - Interesse: ' + treatment);

    // O id precisa voltar para o frontend poder selecionar a conversa recem-criada
    res.status(201).json({ id: leadId, message: 'Lead inserido com sucesso!' });
  } catch (error) {
    console.error('[leads publico]', error && error.message);
    res.status(500).json({ error: 'Erro ao salvar o lead' });
  }
});

module.exports = router;
module.exports.decidirClinica = decidirClinica;

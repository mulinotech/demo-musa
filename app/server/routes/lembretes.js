'use strict';
/** Configuração e disparo dos lembretes de compromisso.
 *
 *  ================================================ POR QUE SAIU DA AGENDA
 *
 *  Estas quatro rotas viviam em `routes/appointments.js` e saíram na M1.1c por
 *  um motivo concreto: a rotina automática do servidor chama `/reminders/run`
 *  **sem sessão**, e enquanto estivesse no mesmo arquivo a agenda inteira ficaria
 *  presa na catraca por causa dela.
 *
 *  ============================================= O QUE A M2.1b MUDOU AQUI
 *
 *  As outras três rotas **passaram a usar a camada**, e o arquivo saiu da
 *  catraca. A configuração agora vive em `clinica_settings`, uma linha por
 *  clínica, e a instância de WhatsApp é campo da clínica.
 *
 *  **A mudança mais importante não é de filtro, é de alcance.** `/reminders/run`
 *  tem dois chamadores, e eles querem coisas diferentes:
 *
 *  - o **cron** chama sem sessão, e a passada dele é de TODAS as clínicas;
 *  - a **tela** chama com sessão, e ali "Enviar agora" tem de disparar **só os
 *    lembretes desta clínica**.
 *
 *  Sem essa distinção, a gerente da Clínica A clicando num botão da tela dela
 *  dispararia mensagem de WhatsApp para pacientes das outras 49 — cada uma pelo
 *  número certo, o que torna o estrago silencioso e completo. Envio não tem
 *  desfazer. É a diferença entre uma rota e duas, e ela não aparece em teste
 *  feito com uma clínica só.
 *
 *  ================================================= ATENÇÃO AO MONTAR
 *
 *  Em `server/app.js` este router entra **ANTES** de `routes/appointments`. O
 *  Express casa o primeiro padrão que serve, e o `/api/appointments/:id` da
 *  agenda engoliria "reminders" — o sintoma seria um 404 dizendo "compromisso
 *  nao encontrado", que manda procurar o defeito no lugar errado. Há teste
 *  conferindo a ordem em `tests/rotas-protegidas.test.js`.
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');
const cron = require('../middleware/cron');
const lembretes = require('../workers/lembretes');
const cfgSvc = require('../services/clinica-config');
const { sendWhatsappText } = require('../services/evolution');
const logs = require('../services/logs');

function soGestao(req, res) {
  // A rotina automatica do servidor tambem dispara a varredura de lembretes --
  // o porteiro so a deixa chegar em /reminders/run. Ver server/middleware/cron.js.
  if (cron.ehServico(req)) return true;
  const papel = req.usuario && req.usuario.papel;
  if (papel === 'admin' || papel === 'gerente') return true;
  res.status(403).json({ error: 'Configuracao de lembretes e restrita a admin e gerente.' });
  return false;
}

router.get('/api/appointments/reminders/settings', async function (req, res) {
  if (!soGestao(req, res)) return;
  try {
    res.json(await cfgSvc.lerLembrete(escopo(req)));
  } catch (e) {
    console.error('[lembretes]', e && e.message);
    res.status(500).json({ error: 'Falha ao ler a configuracao de lembretes.' });
  }
});

router.put('/api/appointments/reminders/settings', async function (req, res) {
  if (!soGestao(req, res)) return;
  const db = escopo(req);
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
    // LIGAR SEM INSTANCIA E RECUSADO, e nao aceito-e-ignorado.
    //
    // Guardar '1' e depois nao enviar deixaria a tela dizendo "ligado" enquanto
    // nada sai -- duas partes do sistema discordando, que e pior do que
    // qualquer uma estar errada. E o mesmo conserto que a fidelidade recebeu na
    // M1.4, quando `config(null)` devolvia `active: true`.
    if (novos.lembretes_ativos === '1') {
      const inst = await cfgSvc.instancia(db);
      if (!inst) {
        return res.status(409).json({
          error: 'Conecte o WhatsApp desta clinica antes de ligar os lembretes. ' +
                 'Sem instancia nao ha por onde enviar.'
        });
      }
    }

    await cfgSvc.salvarLembrete(db, novos);

    if (novos.lembretes_ativos !== undefined) {
      await logs.registrar(db, 'AGENDA',
        'Lembrete automatico por WhatsApp ' +
        (novos.lembretes_ativos === '1' ? 'LIGADO' : 'desligado') + '.');
    }
    res.json(await cfgSvc.lerLembrete(db));
  } catch (e) {
    console.error('[lembretes]', e && e.message);
    res.status(500).json({ error: 'Falha ao salvar a configuracao de lembretes.' });
  }
});

/** Prévia: decide tudo e não envia nada. É o que se olha ANTES de ligar.
 *
 *  Só desta clínica — a prévia existe para alguém conferir os nomes e os
 *  horários antes de mandar, e nome de paciente de outra clínica aqui seria
 *  vazamento com o texto da mensagem pronto do lado. */
router.get('/api/appointments/reminders/preview', async function (req, res) {
  if (!soGestao(req, res)) return;
  const db = escopo(req);
  try {
    const cfg = await cfgSvc.lerLembrete(db);
    res.json(await lembretes.umaClinica(db, cfg, { simular: true }));
  } catch (e) {
    console.error('[lembretes]', e && e.message);
    res.status(500).json({ error: 'Falha ao montar a previa dos lembretes.' });
  }
});

/** Uma passada de verdade. Idempotente: rodar duas vezes nao repete mensagem.
 *
 *  DOIS ALCANCES, e a diferença importa mais do que qualquer filtro deste
 *  arquivo (ver o cabeçalho): o cron varre todas as clínicas; a tela dispara só
 *  a desta. */
router.post('/api/appointments/reminders/run', async function (req, res) {
  if (!soGestao(req, res)) return;
  try {
    if (cron.ehServico(req)) {
      const r = await lembretes.rodarUmaVez({ enviar: sendWhatsappText });
      if (r.enviados || r.comErro) {
        await logs.daInstalacao(
          'uma passada do cron percorre todas as clinicas ativas por definicao',
          'AGENDA',
          r.enviados + ' lembrete(s) enviado(s) em ' + r.clinicas + ' clinica(s)' +
          (r.comErro ? '; ' + r.comErro + ' clinica(s) com erro' : '') + '.',
          'Sistema', req.ip);
      }
      return res.json(r);
    }

    // Com sessao: SO esta clinica.
    const db = escopo(req);
    const cfg = await cfgSvc.lerLembrete(db);
    const r = await lembretes.umaClinica(db, cfg, { enviar: sendWhatsappText });
    if (r.enviados) {
      await logs.registrar(db, 'AGENDA',
        r.enviados + ' lembrete(s) de compromisso enviado(s).');
    }
    res.json(r);
  } catch (e) {
    console.error('[lembretes]', e && e.message);
    res.status(500).json({ error: 'Falha ao enviar os lembretes.' });
  }
});

module.exports = router;

'use strict';
/** A varredura que expira pontos — separada na M1.4.
 *
 *  ============================================== POR QUE SAIU DA FIDELIDADE
 *
 *  Esta rota vivia em `routes/loyalty.js`. Saiu por dois impedimentos, os
 *  mesmos das rotas de lembrete (ver `routes/lembretes.js`):
 *
 *  1. **A rotina automática do servidor a chama sem sessão.** O cron não é uma
 *     pessoa, não tem clínica, e `escopo(req)` recusaria a requisição — com
 *     razão.
 *
 *  2. **A varredura percorre TODAS as clínicas por definição.** Uma passada
 *     expira o ponto vencido de quem quer que seja; ela não é uma operação de
 *     uma clínica.
 *
 *  Ficando junto, prendia o módulo de fidelidade inteiro na catraca por causa
 *  de uma rota. Assim a exceção fica do tamanho dela: um arquivo, uma rota, e o
 *  motivo escrito.
 *
 *  ============================================== O QUE FALTA AQUI (M2.3)
 *
 *  `workers/expiracao-pontos.js` hoje varre a tabela inteira de uma vez. Com 50
 *  clínicas isso continua *correto* — ponto vencido é ponto vencido, e a linha
 *  de expiração que ele grava herda a clínica do acúmulo que expirou —, mas
 *  duas coisas precisam mudar na M2.3:
 *
 *  - a varredura passa a usar `escopo.todasAsClinicas(motivo)`, para a exceção
 *    ficar escrita no código e não só neste comentário;
 *  - **o erro em uma clínica não pode interromper as outras 49.** Hoje uma
 *    exceção no meio da varredura para tudo. Capture por clínica, registre,
 *    siga.
 *
 *  E a validade dos pontos vem de `loyalty_settings`, que é uma linha só no
 *  banco (M1.2b). Enquanto ela não for por clínica, a validade é a mesma para
 *  todas — o que hoje é verdade e amanhã é defeito.
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');
const cron = require('../middleware/cron');
const logs = require('../services/logs');

function soAdminOuCron(req, res) {
  // A rotina automatica do servidor dispara a expiracao, e o porteiro so a
  // deixa chegar AQUI. Ver server/middleware/cron.js.
  if (cron.ehServico(req)) return true;
  if (req.usuario && req.usuario.papel === 'admin') return true;
  res.status(403).json({ error: 'Esta acao e restrita a administrador.' });
  return false;
}

/** DOIS ALCANCES, como o disparo de lembretes (ver a regra 18 do plano).
 *
 *  O cron chama sem sessão e varre todas as clínicas — é o trabalho dele. A tela
 *  chama com sessão, e ali "expirar agora" tem de mexer **só no extrato desta
 *  clínica**. Mexer no saldo de pontos das outras 49 não é vazamento de leitura:
 *  é alterar crédito de paciente de quem não pediu, e cada linha dessas aparece
 *  no extrato dela como se a clínica tivesse feito. */
router.post('/api/loyalty/expire', async function (req, res) {
  if (!soAdminOuCron(req, res)) return;
  const worker = require('../workers/expiracao-pontos');
  try {
    if (cron.ehServico(req)) {
      const r = await worker.rodarUmaVez();
      if (r.expirados || r.comErro) {
        await logs.daInstalacao(
          'a varredura de expiracao percorre todas as clinicas ativas por definicao',
          'FIDELIDADE',
          r.expirados + ' acumulo(s) expirado(s) em ' + r.clinicas + ' clinica(s), ' +
          r.pontos + ' ponto(s)' +
          (r.comErro ? '; ' + r.comErro + ' clinica(s) com erro' : '') + '.',
          'Sistema', req.ip);
      }
      return res.json(r);
    }

    // Com sessao: SO esta clinica.
    const db = escopo(req);
    const r = await worker.umaClinica(db);
    if (r.expirados) {
      await logs.registrar(db, 'FIDELIDADE',
        r.expirados + ' acumulo(s) expirado(s), ' + r.pontos + ' ponto(s).');
    }
    res.json(r);
  } catch (e) {
    console.error('[fidelidade] falha na expiracao:', e && e.message);
    res.status(500).json({ error: 'Falha ao processar a expiracao de pontos.' });
  }
});

module.exports = router;

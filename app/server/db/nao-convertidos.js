'use strict';
/** A catraca da fase M1: quem ainda pode falar com o banco direto.
 *
 *  ======================================================= COMO ELA FUNCIONA
 *
 *  Todo arquivo de `server/routes/` que chama `pool.query` ou `conn.query`
 *  precisa estar nesta lista. O teste `tests/camada.test.js` falha de duas
 *  formas, e as duas importam:
 *
 *  1. Arquivo que usa o banco direto e NÃO está na lista → **falha**. É o que
 *     impede um módulo já convertido de voltar atrás, e o que impede rota nova
 *     de nascer sem filtro.
 *
 *  2. Arquivo que está na lista e NÃO usa mais o banco direto → **falha**. É o
 *     que obriga a lista a encolher: terminou de converter um módulo, tire-o
 *     daqui. Sem isso a lista vira decoração e ninguém percebe que ela parou de
 *     proteger.
 *
 *  A catraca só gira num sentido. Um arquivo que sai daqui não volta.
 *
 *  ========================================================= POR QUE EXISTE
 *
 *  A camada (`escopo.js`) só protege quem a usa. Enquanto a M1 não converter as
 *  220 consultas, `pool.query` continua existindo em toda parte — e sem esta
 *  lista não haveria nada distinguindo "ainda não convertido" de "convertido e
 *  alguém furou".
 *
 *  Ela estava planejada para a M4.2, no fim de tudo. Veio para cá porque a M1
 *  converte módulo a módulo: com a catraca, cada módulo tem um critério de
 *  pronto que se verifica sozinho. No fim, ela seria só um relatório do
 *  estrago.
 *
 *  ============================================================== O NÚMERO
 *
 *  19 arquivos, 157 chamadas diretas em 04/09. O objetivo da M1 é esta lista
 *  ficar vazia. Quando ficar, apague o arquivo e o teste que o lê.
 */

module.exports = [
  'appointments.js',        // M1.1
  'clients.js',             // M1.1
  'treatments.js',          // M1.1
  'treatment-plans.js',     // M1.1
  'finance.js',             // M1.2
  'pricing.js',             // M1.2
  'reports.js',             // M1.2
  'stock.js',               // M1.3
  'loyalty.js',             // M1.4
  'documents.js',           // M1.5
  'catalog.js',             // M1.6
  'evolution.js',           // M1.6
  'interactions.js',        // M1.6
  'leads.js',               // M1.6
  'logs.js',                // M1.6
  'salespeople.js',         // M1.6
  'users.js',               // M1.6

  // Estes dois NÃO são da M1, e não saem da lista pelo mesmo caminho:
  'auth.js',                // o login acontece ANTES de existir sessao: e ele
                            // que descobre a clinica. Nao pode usar escopo(req).
  'gemini.js'               // le configuracao da instalacao, nao dado de clinica.
                            // Revisar na M1.6 e decidir: ou vira escopo, ou vira
                            // todasAsClinicas com motivo escrito.
];

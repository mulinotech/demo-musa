'use strict';
/** AS ROTAS COM `:id`, E O QUE A VARREDURA DE ESCRITA CRUZADA TENTA NELAS (M4.1).
 *
 *  Este arquivo existe para a varredura deixar de ser "as rotas que eu lembrei".
 *  Ele e lido por dois lugares:
 *
 *   - `scripts/verificar-vazamento.mjs`, que usa a tabela para tentar alterar e
 *     apagar linha da clinica vizinha, rota por rota;
 *   - `tests/multi-inquilino.test.js`, que ENUMERA as rotas montadas na
 *     aplicacao e cobra que toda rota com parametro esteja aqui ou na lista de
 *     excecoes abaixo, com motivo escrito.
 *
 *  Rota nova com `:id` que ninguem acrescentar aqui deixa o teste vermelho antes
 *  de ir para producao. E a mesma ideia da lista da plataforma: nega por padrao.
 */

const FAMILIAS = [
  ['pacientes', 'clients', [
    ['PATCH',  '/api/clients/{ID}', { name: 'Invadida' }],
    ['DELETE', '/api/clients/{ID}', null],
    ['GET',    '/api/clients/{ID}/documents', null],
    ['GET',    '/api/clients/{ID}/alerts', null],
    ['GET',    '/api/clients/{ID}/export', null],
    ['GET',    '/api/clients/{ID}/loyalty', null],
    ['POST',   '/api/clients/{ID}/loyalty/adjust', { pontos: 999, motivo: 'invasao' }],
    ['POST',   '/api/clients/{ID}/documents', { templateId: 'x', respostas: {} }]
  ]],
  ['agenda', 'appointments', [
    ['GET',    '/api/appointments/{ID}', null],
    ['PATCH',  '/api/appointments/{ID}', { title: 'Invadido' }],
    ['PATCH',  '/api/appointments/{ID}/status', { status: 'CANCELADO' }],
    ['DELETE', '/api/appointments/{ID}', null],
    ['POST',   '/api/appointments/{ID}/reopen', null],
    ['POST',   '/api/appointments/{ID}/reschedule', { startsAt: '2030-01-01T10:00:00Z' }]
  ]],
  ['funil', 'leads', [
    ['PUT',    '/api/leads/{ID}', { status: 'arquivado' }],
    ['DELETE', '/api/leads/{ID}', null]
  ]],
  ['equipe comercial', 'salespeople', [
    ['PATCH',  '/api/salespeople/{ID}', { name: 'Invadido' }],
    ['DELETE', '/api/salespeople/{ID}', null]
  ]],
  ['catalogo', 'treatment_catalog', [
    ['PATCH',  '/api/treatment-catalog/{ID}', { name: 'Invadido' }],
    ['DELETE', '/api/treatment-catalog/{ID}', null],
    ['GET',    '/api/services/{ID}/supplies', null],
    ['PUT',    '/api/services/{ID}/supplies', { itens: [] }]
  ]],
  ['planos', 'treatment_plans', [
    ['PATCH',  '/api/treatment-plans/{ID}', { status: 'CANCELADO' }],
    ['DELETE', '/api/treatment-plans/{ID}', null]
  ]],
  ['atendimentos', 'treatments', [
    ['PATCH',  '/api/treatments/{ID}', { notes: 'invadido' }]
  ]],
  ['sessoes', 'treatment_sessions', [
    ['PATCH',  '/api/treatment-sessions/{ID}', { status: 'REALIZADA' }]
  ]],
  ['estoque', 'products', [
    ['PATCH',  '/api/products/{ID}', { name: 'Invadido' }],
    ['GET',    '/api/products/{ID}/batches', null]
  ]],
  ['financeiro', 'cash_entries', [
    ['PATCH',  '/api/finance/entries/{ID}', { amount: 1 }],
    ['PATCH',  '/api/finance/entries/{ID}/pay', null],
    ['DELETE', '/api/finance/entries/{ID}', null]
  ]],
  ['categorias financeiras', 'finance_categories', [
    ['PATCH',  '/api/finance/categories/{ID}', { name: 'Invadida' }]
  ]],
  ['custos fixos', 'fixed_costs', [
    ['PATCH',  '/api/fixed-costs/{ID}', { amount: 1 }],
    ['DELETE', '/api/fixed-costs/{ID}', null]
  ]],
  ['despesas recorrentes', 'recurring_expenses', [
    ['PATCH',  '/api/recurring-expenses/{ID}', { amount: 1 }]
  ]],
  ['acessos', 'users', [
    ['PATCH',  '/api/users/{ID}', { name: 'Invadido' }],
    // A agenda de disponibilidade de uma PROFISSIONAL da vizinha.
    /* Faixa de VERDADE, e nao lista vazia: com a lista vazia a rota so
     * apagava (nada) e respondia 200, sem nunca tentar GRAVAR grade apontando
     * para gente da outra clinica -- que e o que interessa medir. */
    ['PUT',    '/api/availability/{ID}',
      { faixas: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }] }]
  ]],
  ['premios de fidelidade', 'loyalty_rewards', [
    ['PATCH',  '/api/loyalty/rewards/{ID}', { name: 'Invadido' }]
  ]],
  ['documentos clinicos', 'client_documents', [
    ['PATCH',  '/api/documents/{ID}', { respostas: {} }],
    ['POST',   '/api/documents/{ID}/finalize', null],
    ['POST',   '/api/documents/{ID}/cancel', null],
    ['POST',   '/api/documents/{ID}/sign', { assinatura: 'x' }],
    ['GET',    '/api/documents/{ID}/view', null]
  ]],
  ['modelos de documento', 'document_templates', [
    ['PATCH',  '/api/document-templates/{ID}', { name: 'Invadido' }]
  ]]
];

/** Rotas com parametro que NAO entram na varredura, e o porque de cada uma.
 *  Excecao sem motivo escrito e so uma rota esquecida com outro nome. */
const FORA_DA_VARREDURA = {
  'POST /api/appointments/:id/redeem':
    'gasta pontos num compromisso; o id de outra clinica ja e recusado pela leitura do ' +
    'compromisso, e o bloco [E] mede isso com resgate de verdade',
  'DELETE /api/appointments/:id/redeem':
    'desfaz o resgate acima, pela mesma leitura',
  'GET /api/evolution/instances/connect/:name':
    'o parametro e o NOME de uma instancia de WhatsApp, nao um id de linha desta ' +
    'instalacao -- o bloco [N] mede o dono da instancia',
  'GET /api/plataforma/clinicas/:id/conferencia':
    'rota de plataforma: quem a alcanca nao tem clinica, e o bloco [T] mede o alcance dela',
  'POST /api/plataforma/clinicas/:id/entrar':
    'idem -- e o bloco [U] mede a concessao de suporte',
  'PATCH /api/plataforma/clinicas/:id/status':
    'idem -- e o bloco [V] mede suspender, encerrar e reativar'
};

module.exports = { FAMILIAS, FORA_DA_VARREDURA };

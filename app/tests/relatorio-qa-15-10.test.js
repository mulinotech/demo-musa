'use strict';
/** As regras puras que nasceram do relatório de QA de 15/10.
 *
 *  Cada bloco cita o BUG do relatório que a regra fecha. A maior parte das
 *  correções é de fiação (rota chamando o serviço certo); o que dá para fixar
 *  sem banco está aqui, e é a parte em que um descuido futuro reabriria o
 *  defeito sem ninguém notar.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const site = require('../server/routes/site-publico');
const { procedimentoDaMensagem } = require('../server/services/procedimento-da-mensagem');
const { dataPura } = require('../server/services/data-pura');
const fin = require('../server/services/financeiro');
const laudo = require('../server/services/laudo-ia');
const ia = require('../server/services/ia-gemini');
const { sinaisDeRisco } = require('../server/services/sinais-de-risco');
const conversao = require('../server/services/conversao-de-lead');
const { ehRotaPublica } = require('../server/middleware/autenticacao');

/* ---------------------------------------------------- BUG-01 / BUG-02 / 25 */

test('BUG-02: o WhatsApp do site sai do cadastro, com DDI, e o numero de mentira nao vale', function () {
  assert.strictEqual(site.whatsappDoCadastro('(11) 94524-2662'), '5511945242662');
  assert.strictEqual(site.whatsappDoCadastro('+55 11 94524-2662'), '5511945242662');
  assert.strictEqual(site.whatsappDoCadastro('(11) 90000-0000'), null, 'o placeholder do modelo nao e contato');
  assert.strictEqual(site.whatsappDoCadastro(''), null);
  assert.strictEqual(site.whatsappDoCadastro('123'), null);
});

test('BUG-01: a rota do site e publica, e so por GET', function () {
  assert.ok(ehRotaPublica('GET', '/api/site'), 'sem isto o site nao descobre a chave de captacao');
  assert.ok(!ehRotaPublica('POST', '/api/site'));
});

test('BUG-25: item de teste do catalogo nao sai para o site', function () {
  assert.ok(site.ehItemDeTeste('TESTE 2109'));
  assert.ok(site.ehItemDeTeste('Tratamento de Teste do Rodrigo 1709'));
  assert.ok(site.ehItemDeTeste('Procedimento TESTE 28/08'));
  assert.ok(!site.ehItemDeTeste('Ultraformer MPT'));
  assert.ok(!site.ehItemDeTeste('Testosterona'), 'palavra que so comeca com "teste" nao e item de teste');
});

/* ------------------------------------------------------------------ BUG-03 */

test('BUG-03: o procedimento citado na mensagem do WhatsApp e o do catalogo', function () {
  const cat = ['Ultraformer MPT', 'Lavien BB Laser', 'Bumbum Max', 'Limpeza de Pele Premium'];
  assert.strictEqual(procedimentoDaMensagem('Vi o anuncio, quanto custa o Bumbum Max?', cat), 'Bumbum Max');
  assert.strictEqual(procedimentoDaMensagem('Voces fazem limpeza de pele?', cat), 'Limpeza de Pele Premium');
  assert.strictEqual(procedimentoDaMensagem('quero ultraformer sabado', cat), 'Ultraformer MPT');
  assert.strictEqual(procedimentoDaMensagem('oi, tudo bem?', cat), null, 'sem certeza, nao chuta');
  assert.strictEqual(procedimentoDaMensagem('quero laser', cat), null, '"laser" sozinho nao identifica');
});

/* ------------------------------------------------------------------ BUG-06 */

test('BUG-06: dia vai ao banco como o dia que a pessoa escolheu', function () {
  assert.strictEqual(dataPura('2026-10-15'), '2026-10-15', 'era aqui que virava 14/10');
  // o que o navegador reenvia depois de ler do banco (meia-noite em Brasilia)
  assert.strictEqual(dataPura('2026-10-15T03:00:00.000Z'), '2026-10-15');
  // 22h30 de 15/10 em Brasilia ja e dia 16 em UTC
  assert.strictEqual(dataPura('2026-10-16T01:30:00Z'), '2026-10-15');
  assert.strictEqual(dataPura('15/10/2026'), '2026-10-15');
  assert.strictEqual(dataPura(''), null);
  assert.strictEqual(dataPura('lixo'), null);
});

test('BUG-06: salvar de novo nao anda a data (a deriva 15 -> 14 -> 13)', function () {
  let d = '2026-10-15';
  for (let i = 0; i < 5; i++) d = dataPura(d);
  assert.strictEqual(d, '2026-10-15');
});

/* ------------------------------------------------------------------ BUG-07 */

test('BUG-07: estorno abate a receita, nao vira despesa nem conta a pagar', function () {
  const L = [
    { type: 'RECEITA', source: 'APPOINTMENT', amount: 280, entry_date: '2026-10-15' },
    { type: 'DESPESA', source: 'REVERSAL', amount: 280, entry_date: '2026-10-15' },
    { type: 'RECEITA', source: 'APPOINTMENT', amount: 280, entry_date: '2026-10-15' },
    { type: 'DESPESA', source: 'MANUAL', amount: 1000, entry_date: '2026-10-10', paid_at: '2026-10-10' }
  ];
  const r = fin.resumo(L, { de: '2026-10-01', ate: '2026-10-31', hoje: '2026-10-20' });
  assert.strictEqual(r.receitaTotal, 280, 'Realizado -> Desfazer -> Realizado e UMA receita');
  assert.strictEqual(r.despesaTotal, 1000);
  assert.strictEqual(r.resultado, -720);
  assert.strictEqual(r.aPagar.total, 0, 'estorno nao e conta a pagar');
});

/* ------------------------------------------------------------------ BUG-04 */

test('BUG-04: anotacao vazia ou "teste" nao vai para a IA', function () {
  assert.ok(!laudo.entradaSuficiente('teste', false));
  assert.ok(!laudo.entradaSuficiente('', false));
  assert.ok(!laudo.entradaSuficiente('flacidez leve', false));
  assert.ok(laudo.entradaSuficiente('35 anos, flacidez leve na papada. Sem foto.', false));
  assert.ok(laudo.entradaSuficiente('', true), 'com foto ha o que descrever');
});

test('BUG-04: a saida perde o markdown e qualquer identidade medica', function () {
  const bruto = [
    '### **LAUDO DE AVALIACAO**',
    '**MÉDICO RESPONSÁVEL:** Dr(a). Dermatologista — CRM/RQE',
    '* **Especialidade:** Dermatologia',
    '**CLÍNICA DERMATOLÓGICA E DE ESTÉTICA**',
    '* Queixa de flacidez na papada'
  ].join('\n');
  const t = laudo.limparLaudo(bruto);
  assert.ok(!/\*\*|###/.test(t), 'markdown cru saia na tela');
  assert.ok(!/CRM|RQE|m[eé]dico respons/i.test(t), 'identidade medica que a clinica nao tem');
  assert.ok(!/dermatol[oó]gica/i.test(t));
  assert.ok(/• Queixa de flacidez na papada/.test(t));
});

test('BUG-04: o prompt proibe exame inventado e manda usar o catalogo', function () {
  const i = laudo.instrucao('Dra. Musa Estetica', ['Ultraformer MPT']);
  assert.ok(/N[ÃA]O examinou/.test(i));
  assert.ok(/Ultraformer MPT/.test(i));
  assert.ok(/CRM, RQE/.test(i));
});

/* ------------------------------------------------------------------ BUG-20 */

test('BUG-20: erro do provedor chega em portugues, e sobrecarga e tentada de novo', function () {
  const m = ia.traduzirErro(503, 'This model is currently experiencing high demand.');
  assert.ok(/sobrecarregada/.test(m));
  assert.ok(!/high demand/i.test(m));
  assert.ok(ia.ehPassageiro(503, ''));
  assert.ok(ia.ehPassageiro(0, 'This model is currently experiencing high demand'));
  assert.ok(!ia.ehPassageiro(400, 'API key not valid'), 'chave errada nao melhora tentando de novo');
});

/* ------------------------------------------------------------------ BUG-17 */

test('BUG-17: contraindicacao escrita na ficha e encontrada; negacao nao dispara', function () {
  const achados = sinaisDeRisco('31 anos, GESTANTE 20 semanas, usa isotretinoína há 2 meses.')
    .map(function (s) { return s.rotulo; });
  assert.ok(achados.indexOf('Gestação') !== -1);
  assert.ok(achados.indexOf('Isotretinoína (Roacutan)') !== -1);
  assert.deepStrictEqual(sinaisDeRisco('não gestante, nega uso de isotretinoina, sem marcapasso'), []);
  assert.deepStrictEqual(sinaisDeRisco('35 anos, flacidez leve na papada'), []);
});

/* ------------------------------------------------------------------ BUG-12 */

test('BUG-12: um formato so de telefone, venha de onde vier', function () {
  assert.strictEqual(conversao.telefoneParaGravar('+55 11 94524-2662'), '5511945242662');
  assert.strictEqual(conversao.telefoneParaGravar('(11) 94524-2662'), '5511945242662');
  assert.strictEqual(conversao.telefoneParaGravar('5511945242662'), '5511945242662');
  assert.strictEqual(conversao.telefoneParaGravar('123'), '123', 'o que nao se entende fica como veio');
});

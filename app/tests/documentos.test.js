'use strict';
/** Documentos clínicos e anamnese (Fase 4).
 *
 *  O Definition of Done pede quatro provas de código, e três delas são sobre
 *  coisas que não se conserta depois: imutabilidade do documento assinado,
 *  estabilidade do hash e bloqueio do vendedor em dado de saúde.
 *
 *  A quarta — alerta de contraindicação aparecendo — é a que muda desfecho
 *  clínico, não jurídico.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const d = require('../server/services/documentos');
const { regraPara } = require('../server/middleware/autorizacao');

const MODELO = {
  name: 'Anamnese estética',
  body_markdown: '## Anamnese\n\nPaciente: **{{paciente}}**\nData: {{data}}\n\n{{respostas}}',
  fields_json: JSON.stringify({
    sections: [{
      title: 'Histórico de saúde',
      fields: [
        { key: 'gestante', label: 'Está gestante ou amamentando?', type: 'boolean', required: true, alert: true },
        { key: 'alergias', label: 'Possui alergia?', type: 'boolean', required: true, alert: true },
        { key: 'alergias_quais', label: 'Quais?', type: 'text', showIf: { field: 'alergias', equals: true } },
        { key: 'fototipo', label: 'Fototipo', type: 'select', options: ['I', 'II', 'III'] },
        { key: 'dor', label: 'Sensibilidade à dor', type: 'scale', min: 0, max: 10 },
        { key: 'queixa', label: 'Queixa principal', type: 'textarea', required: true }
      ]
    }]
  })
};

/* --------------------------------------------------------- validação */

test('pergunta obrigatoria em branco impede seguir, citando o rotulo', function () {
  const p = d.validar(MODELO, { gestante: false });
  // A mensagem tem de citar a pergunta, nao a chave tecnica: "queixa" nao diz
  // nada a quem esta com o tablet na mao.
  assert.ok(p.some((x) => /Possui alergia/.test(x.erro)));
  assert.ok(p.some((x) => /Queixa principal/.test(x.erro)));
});

test('pergunta CONDICIONAL nao e exigida quando a condicao nao vale', function () {
  // Exigir "quais alergias?" de quem respondeu que nao tem alergia travaria o
  // formulario para sempre.
  const p = d.validar(MODELO, { gestante: false, alergias: false, queixa: 'manchas' });
  assert.deepStrictEqual(p, []);
});

test('escala fora da faixa e recusada', function () {
  const base = { gestante: false, alergias: false, queixa: 'x' };
  assert.ok(d.validar(MODELO, { ...base, dor: 11 }).length);
  assert.ok(d.validar(MODELO, { ...base, dor: -1 }).length);
  assert.deepStrictEqual(d.validar(MODELO, { ...base, dor: 7 }), []);
});

test('opcao fora da lista e recusada', function () {
  const base = { gestante: false, alergias: false, queixa: 'x' };
  assert.ok(d.validar(MODELO, { ...base, fototipo: 'IX' }).length);
  assert.deepStrictEqual(d.validar(MODELO, { ...base, fototipo: 'II' }), []);
});

/* ---------------------------------------------------------- alertas */

test('RESPOSTA MARCADA COM alert APARECE NA LISTA DE CONTRAINDICACOES', function () {
  const a = d.alertas(MODELO, { gestante: true, alergias: true, alergias_quais: 'dipirona' });
  assert.strictEqual(a.length, 2);
  assert.strictEqual(a[0].rotulo, 'Está gestante ou amamentando?');
  // O detalhe vem junto: "tem alergia" sem dizer a que nao ajuda ninguem.
  const alergia = a.find((x) => x.campo === 'alergias');
  assert.strictEqual(alergia.detalhe, 'dipirona');
});

test('resposta NEGATIVA nao gera alerta', function () {
  // Este e o teste que impede o erro oposto: uma faixa vermelha em toda ficha
  // treina a equipe a ignorar a faixa.
  assert.deepStrictEqual(d.alertas(MODELO, { gestante: false, alergias: false }), []);
  assert.deepStrictEqual(d.alertas(MODELO, {}), []);
});

test('campo sem alert nunca vira contraindicacao', function () {
  assert.deepStrictEqual(d.alertas(MODELO, { queixa: 'qualquer coisa', dor: 10 }), []);
});

/* ------------------------------------------------------ renderizacao */

test('o documento renderizado traz as respostas em portugues', function () {
  const html = d.renderizar({
    modelo: MODELO, cliente: { name: 'Ana Beatriz Rocha' }, data: '01/09/2026',
    respostas: { gestante: false, alergias: true, alergias_quais: 'dipirona', fototipo: 'III', dor: 6, queixa: 'manchas' }
  });
  assert.match(html, /Ana Beatriz Rocha/);
  assert.match(html, /Possui alergia\?<\/th><td>Sim/);
  assert.match(html, /Não/, 'booleano falso sai como "Não", nao como "false"');
  assert.match(html, /6 de 10/, 'escala sai com a faixa');
  assert.match(html, /class="atencao"/, 'a linha de contraindicacao sai destacada');
});

test('pergunta condicional oculta nao aparece no documento', function () {
  const html = d.renderizar({ modelo: MODELO, respostas: { alergias: false } });
  assert.ok(!/Quais\?/.test(html));
});

test('RESPOSTA COM HTML E ESCAPADA', function () {
  // Resposta de paciente e entrada nao confiavel, mesmo vindo do tablet da
  // recepcao. Sem escapar, o script acaba dentro do documento que outras
  // pessoas da clinica vao abrir depois.
  const html = d.renderizar({
    modelo: MODELO,
    respostas: { queixa: '<script>alert(1)</script>', alergias: false, gestante: false }
  });
  assert.ok(!/<script>/.test(html), 'nenhuma tag executavel sobrou');
  assert.match(html, /&lt;script&gt;/);
});

test('anamnese migrada em texto livre aparece identificada', function () {
  const html = d.renderizar({ modelo: MODELO, respostas: { texto_livre: 'Paciente relata rosácea.' } });
  assert.match(html, /cadastro anterior/i);
  assert.match(html, /rosácea/);
});

/* --------------------------------------------------------------- hash */

test('O HASH DE UM DOCUMENTO NAO MUDA AO SER LIDO DE NOVO', function () {
  const html = '<h2>Termo</h2><p>Conteudo congelado</p>';
  const a = d.hashDoConteudo(html);
  const b = d.hashDoConteudo(html);
  assert.strictEqual(a, b);
  assert.strictEqual(a.length, 64);
});

test('mudar um caractere muda o hash', function () {
  const a = d.hashDoConteudo('<p>Autorizo o procedimento.</p>');
  const b = d.hashDoConteudo('<p>Autorizo o procedimento!</p>');
  assert.notStrictEqual(a, b, 'e isto que faz o hash servir de prova de integridade');
});

test('o hash e do TEXTO renderizado, nao das respostas', function () {
  // Se fosse das respostas, o mesmo hash valeria para dois textos diferentes --
  // bastaria mudar o corpo do modelo. E o texto LIDO que precisa ser provavel.
  const respostas = { gestante: false, alergias: false, queixa: 'x' };
  const um = d.renderizar({ modelo: MODELO, respostas: respostas, data: '01/09/2026' });
  const outro = d.renderizar({
    modelo: Object.assign({}, MODELO, { body_markdown: '## Outro texto\n\n{{respostas}}' }),
    respostas: respostas, data: '01/09/2026'
  });
  assert.notStrictEqual(d.hashDoConteudo(um), d.hashDoConteudo(outro));
});

/* ------------------------------------------------- travas de estado */

test('FINALIZAR E DEPOIS TENTAR EDITAR DA ERRO', function () {
  // A prova central do modulo. Se o conteudo pudesse mudar depois de gerado, a
  // assinatura nao provaria nada.
  assert.strictEqual(d.podeEditar({ status: 'RASCUNHO' }).ok, true);

  const gerado = d.podeEditar({ status: 'AGUARDANDO_ASSINATURA' });
  assert.strictEqual(gerado.ok, false);
  assert.strictEqual(gerado.status, 409);
  assert.match(gerado.error, /imut/i);
  assert.match(gerado.error, /documento novo/, 'e diz o que fazer no lugar');

  assert.strictEqual(d.podeEditar({ status: 'ASSINADO' }).ok, false);
  assert.strictEqual(d.podeEditar({ status: 'CANCELADO' }).ok, false);
});

test('so rascunho valido pode ser gerado para assinatura', function () {
  assert.strictEqual(d.podeFinalizar({ status: 'RASCUNHO' }, []).ok, true);
  assert.strictEqual(d.podeFinalizar({ status: 'ASSINADO' }, []).ok, false);

  const comProblema = d.podeFinalizar({ status: 'RASCUNHO' }, [{ campo: 'x', erro: 'Responda: Queixa principal' }]);
  assert.strictEqual(comProblema.status, 400);
  assert.match(comProblema.error, /Queixa principal/);
});

test('assinar exige documento gerado, nome e traco', function () {
  const pronto = { status: 'AGUARDANDO_ASSINATURA' };
  const traco = 'data:image/png;base64,iVBORw0KG';

  assert.strictEqual(d.podeAssinar({ status: 'RASCUNHO' }, { signerName: 'Ana', signatureImage: traco }).ok, false);
  assert.strictEqual(d.podeAssinar(pronto, { signerName: '', signatureImage: traco }).status, 400);

  // Assinatura em branco e o erro silencioso classico: o canvas existe, a
  // pessoa nao desenha, e o documento fica "assinado" sem nada.
  const semTraco = d.podeAssinar(pronto, { signerName: 'Ana' });
  assert.strictEqual(semTraco.status, 400);
  assert.match(semTraco.error, /branco/);

  assert.strictEqual(d.podeAssinar(pronto, { signerName: 'Ana', signatureImage: traco }).ok, true);
});

test('documento ja assinado nao se assina de novo', function () {
  const r = d.podeAssinar({ status: 'ASSINADO' }, {
    signerName: 'Outra Pessoa', signatureImage: 'data:image/png;base64,x'
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /ja foi assinado/);
});

test('CPF com digitos a menos e recusado; sem CPF passa', function () {
  const pronto = { status: 'AGUARDANDO_ASSINATURA' };
  const base = { signerName: 'Ana', signatureImage: 'data:image/png;base64,x' };
  assert.strictEqual(d.podeAssinar(pronto, { ...base, signerDocument: '123' }).status, 400);
  assert.strictEqual(d.podeAssinar(pronto, { ...base, signerDocument: '390.533.447-05' }).ok, true);
  assert.strictEqual(d.podeAssinar(pronto, base).cpf, null);
});

/* -------------------------------------------------- pagina e rodape */

test('a pagina do documento assinado traz hash, IP e o aviso correto', function () {
  const pagina = d.paginaCompleta({
    id: 'doc_1', title: 'Termo', status: 'ASSINADO',
    rendered_html: '<h2>Termo</h2>', content_hash: 'a'.repeat(64),
    signer_name: 'Ana Beatriz', signer_document: '39053344705',
    signature_image: 'data:image/png;base64,x',
    signed_at: '01/09/2026 às 14:32', signed_ip: '191.0.0.1', signed_user_agent: 'Mozilla/5.0'
  });
  assert.match(pagina, /Ana Beatriz/);
  assert.match(pagina, /a{64}/, 'o hash aparece no rodape');
  assert.match(pagina, /191\.0\.0\.1/);

  // O aviso sobre o TIPO de assinatura e obrigatorio, e a negativa tambem:
  // chamar isto de "assinatura digital certificada" seria afirmacao falsa
  // sobre o valor probatorio.
  assert.match(pagina, /eletr.nica simples/i);
  assert.match(pagina, /14\.063\/2020/);
  assert.match(pagina, /N.o<\/strong> é assinatura digital qualificada|não. é assinatura digital qualificada/i);
  assert.match(pagina, /ICP-Brasil/);
});

test('a pagina avisa quando o conteudo nao corresponde ao hash', function () {
  const pagina = d.paginaCompleta(
    { id: 'doc_1', title: 'T', status: 'ASSINADO', rendered_html: '<p>x</p>', content_hash: 'b'.repeat(64) },
    { hashConfere: false }
  );
  assert.match(pagina, /nao corresponde ao hash/i);
});

test('documento cancelado diz que o conteudo foi mantido', function () {
  const pagina = d.paginaCompleta({
    id: 'doc_1', title: 'T', status: 'CANCELADO', rendered_html: '<p>x</p>',
    cancelled_reason: 'Emitido para a paciente errada.'
  });
  assert.match(pagina, /cancelado/i);
  assert.match(pagina, /paciente errada/);
  assert.match(pagina, /mantido/i, 'cancelar nunca apaga');
});

/* ------------------------------------------------------------ LGPD */

test('VENDEDOR RECEBE 403 EM TODAS AS ROTAS DO MODULO', function () {
  // Dado de saude e dado pessoal sensivel. O time comercial nao tem por que ver
  // historico clinico de paciente.
  const rotas = [
    ['GET', '/api/clients/cl_1/documents'],
    ['POST', '/api/clients/cl_1/documents'],
    ['GET', '/api/clients/cl_1/alerts'],
    ['GET', '/api/clients/cl_1/export'],
    ['GET', '/api/documents/doc_1'],
    ['GET', '/api/documents/doc_1/view'],
    ['POST', '/api/documents/doc_1/sign'],
    ['GET', '/api/document-templates'],
    ['POST', '/api/document-templates']
  ];
  for (const [metodo, caminho] of rotas) {
    const regra = regraPara(metodo, caminho);
    assert.ok(regra, 'sem regra, a rota fica aberta: ' + metodo + ' ' + caminho);
    assert.ok(!regra.papeis.includes('vendedor'), 'vendedor entraria em ' + caminho);
    assert.ok(regra.papeis.includes('profissional'), 'quem atende precisa entrar: ' + caminho);
  }
});

test('a rota ANINHADA em /api/clients tem regra propria', function () {
  // Este e o furo que a regra por prefixo nao pega: `/api/clients` nao tem
  // regra para GET, entao `/api/clients/:id/documents` ficaria liberado para
  // qualquer autenticado -- inclusive vendedor -- sem nenhum erro aparecer.
  assert.strictEqual(regraPara('GET', '/api/clients'), null, 'a lista de pacientes segue liberada');
  const doc = regraPara('GET', '/api/clients/cl_1/documents');
  assert.ok(doc && !doc.papeis.includes('vendedor'));
});

test('o padrao de rota aninhada nao vaza para caminhos parecidos', function () {
  // `/api/clients/cl_1/loyalty` NAO deve casar com a regra de documentos: o
  // saldo de pontos e legivel por todos, de proposito.
  const pontos = regraPara('GET', '/api/clients/cl_1/loyalty');
  assert.ok(!pontos || pontos.papeis.includes('vendedor'),
    'a recepcao e o comercial podem dizer o saldo de pontos');
});

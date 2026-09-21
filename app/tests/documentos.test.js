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

/* ==========================================================================
 * RECEITUÁRIO E ATESTADO (M5.5, 16/09)
 *
 * A diferença entre estes dois tipos e os outros quatro cabe numa frase: aqui
 * quem assina é a PROFISSIONAL, e o sistema não assina por ela. Os testes
 * abaixo travam as consequências dessa frase, que são cinco e todas visíveis no
 * papel impresso.
 * ========================================================================== */

const M55 = require('../db/migrations/034_receita_e_atestado.js');

const MODELO_ATESTADO = {
  name: 'Atestado',
  body_markdown: M55.CORPO_ATESTADO,
  fields_json: JSON.stringify(M55.ATESTADO)
};
const MODELO_RECEITA = {
  name: 'Receituário',
  body_markdown: M55.CORPO_RECEITA,
  fields_json: JSON.stringify(M55.RECEITA)
};

test('receita e atestado vao para EMITIDO; anamnese e termo, para a fila da paciente', function () {
  // O status decide a tela inteira: quem cai em AGUARDANDO_ASSINATURA ganha o
  // campo de desenho. Uma receita nessa fila pediria que a paciente assinasse a
  // propria prescricao.
  assert.strictEqual(d.statusAoFinalizar('RECEITA'), 'EMITIDO');
  assert.strictEqual(d.statusAoFinalizar('ATESTADO'), 'EMITIDO');
  assert.strictEqual(d.statusAoFinalizar('ANAMNESE'), 'AGUARDANDO_ASSINATURA');
  assert.strictEqual(d.statusAoFinalizar('TERMO_CONSENTIMENTO'), 'AGUARDANDO_ASSINATURA');
});

test('a assinatura em tela e RECUSADA em receita e atestado, com a frase certa', function () {
  const r = d.podeAssinarEmTela({ type: 'RECEITA', status: 'EMITIDO' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, 409);
  // A frase importa tanto quanto a recusa: "documento ainda nao foi gerado"
  // mandaria a recepcao tentar de novo.
  assert.ok(/profissional/i.test(r.error), 'a recusa tem de dizer QUEM assina');
  assert.strictEqual(d.podeAssinarEmTela({ type: 'ANAMNESE' }).ok, true);
  assert.strictEqual(d.podeAssinarEmTela({ type: 'TERMO_CONSENTIMENTO' }).ok, true);
});

test('sem conselho e numero no cadastro, nao sai receita nem atestado', function () {
  const semNada = d.podeEmitir({ type: 'RECEITA' }, { nome: 'Dra. Ana' });
  assert.strictEqual(semNada.ok, false);
  assert.strictEqual(semNada.status, 409);
  assert.ok(/cadastro/i.test(semNada.error), 'a recusa tem de dizer ONDE preencher');

  // Meio registro nao emite: conselho sem numero e papel que a farmacia devolve.
  assert.strictEqual(
    d.podeEmitir({ type: 'ATESTADO' }, { nome: 'Dra. Ana', conselho: 'CRM' }).ok, false);
  assert.strictEqual(
    d.podeEmitir({ type: 'ATESTADO' }, { nome: 'Dra. Ana', numero: '12345' }).ok, false);

  assert.strictEqual(
    d.podeEmitir({ type: 'RECEITA' }, { nome: 'Dra. Ana', conselho: 'CRM', numero: '12345' }).ok, true);

  // E a anamnese NAO passa a exigir conselho: a recepcao continua preenchendo.
  assert.strictEqual(d.podeEmitir({ type: 'ANAMNESE' }, null).ok, true);
});

test('o CID so entra no papel com a autorizacao da paciente', function () {
  // Resolucao CFM 1.658/2002: o diagnostico e da paciente, e o atestado vai
  // para a mao do empregador. Sem autorizacao, a linha inteira SOME -- nao sai
  // "CID:" em branco, que contaria que existe um diagnostico omitido.
  const semAutorizacao = d.renderizar({
    modelo: MODELO_ATESTADO, titulo: 'Atestado', cliente: { name: 'Ana' },
    respostas: { atendimento_data: '2026-09-16', atendimento_hora: '14:30',
                 cid_autorizado: false, cid: 'F41.1' }
  });
  assert.ok(!/CID/.test(semAutorizacao), 'o CID nao pode aparecer sem autorizacao');
  assert.ok(!/F41\.1/.test(semAutorizacao), 'nem o codigo, em lugar nenhum do papel');

  const comAutorizacao = d.renderizar({
    modelo: MODELO_ATESTADO, titulo: 'Atestado', cliente: { name: 'Ana' },
    respostas: { atendimento_data: '2026-09-16', atendimento_hora: '14:30',
                 cid_autorizado: true, cid: 'F41.1' }
  });
  assert.ok(/F41\.1/.test(comAutorizacao));
  assert.ok(/1\.658/.test(comAutorizacao), 'o papel cita a resolucao que permite o CID ali');

  // E a validacao nao exige o campo escondido -- senao o formulario trava.
  const problemas = d.validar(MODELO_ATESTADO, {
    atendimento_data: '2026-09-16', atendimento_hora: '14:30', cid_autorizado: false });
  assert.deepStrictEqual(problemas, []);
});

test('atestado de comparecimento NAO afirma afastamento', function () {
  // Zero dia nao e afastamento. Se a frase saisse com "0 dia(s)", o RH leria
  // como afastamento concedido e a paciente responderia por isso.
  for (const dias of [undefined, '', 0, '0']) {
    const html = d.renderizar({
      modelo: MODELO_ATESTADO, titulo: 'Atestado', cliente: { name: 'Ana' },
      respostas: { atendimento_data: '2026-09-16', atendimento_hora: '14:30',
                   afastamento_dias: dias }
    });
    assert.ok(!/afastamento/i.test(html), 'afastamento_dias=' + JSON.stringify(dias));
    assert.ok(/esteve sob atendimento/i.test(html), 'o comparecimento continua atestado');
  }
  const comAfastamento = d.renderizar({
    modelo: MODELO_ATESTADO, titulo: 'Atestado', cliente: { name: 'Ana' },
    respostas: { atendimento_data: '2026-09-16', atendimento_hora: '14:30', afastamento_dias: 3 }
  });
  assert.ok(/afastamento/i.test(comAfastamento) && /<strong>3<\/strong>/.test(comAfastamento));
});

test('a data do atendimento sai no formato de quem le o papel', function () {
  // O <input type="date"> entrega 2026-09-16. Atestado com a data ao contrario
  // levanta duvida antes de ser lido.
  const html = d.renderizar({
    modelo: MODELO_ATESTADO, titulo: 'Atestado', cliente: { name: 'Ana' },
    respostas: { atendimento_data: '2026-09-16', atendimento_hora: '14:30' }
  });
  assert.ok(/16\/09\/2026/.test(html));
  assert.ok(!/2026-09-16/.test(html));
});

test('o corpo que coloca as respostas no texto nao leva a tabela de formulario', function () {
  // Receita escrita por extenso E repetida numa tabela abaixo e documento que
  // ninguem le ate o fim -- e o fim e onde fica a identificacao de quem emitiu.
  const html = d.renderizar({
    modelo: MODELO_RECEITA, titulo: 'Receituário', cliente: { name: 'Ana' },
    respostas: { prescricao: 'Dipirona 500mg' }
  });
  assert.ok(!/<table/.test(html), 'nao pode sair tabela de respostas');
  assert.strictEqual((html.match(/Dipirona 500mg/g) || []).length, 1, 'a prescricao aparece UMA vez');

  // E a anamnese continua com a tabela: a mudanca nao pode ter alcancado ela.
  assert.ok(/<table/.test(d.renderizar({
    modelo: MODELO, cliente: { name: 'Ana' },
    respostas: { gestante: false, alergias: false, queixa: 'manchas' }
  })), 'a anamnese continua com a tabela de respostas');
});

test('o nome no cabecalho e o da clinica que emitiu', function () {
  // `{{clinica}}` tinha um padrao fixo com o nome da clinica da demonstracao, e
  // o padrao valia para as 50. Papel da clinica B com o cabecalho da clinica A
  // e o vazamento que so aparece quando a paciente le o documento.
  const html = d.renderizar({
    modelo: MODELO_RECEITA, titulo: 'Receituário', cliente: { name: 'Ana' },
    clinica: 'Clinica da Vizinha', respostas: { prescricao: 'Dipirona 500mg' }
  });
  assert.ok(/Clinica da Vizinha/.test(html));
  assert.ok(!/Musa Est/.test(html), 'o nome da clinica da demonstracao nao pode vazar');
});

test('a resposta que entra na frase e ESCAPADA', function () {
  // O texto e escrito por gente, e o documento e aberto por outras pessoas
  // depois. Entrada de formulario e entrada nao confiavel mesmo vinda do
  // tablet da recepcao.
  const html = d.renderizar({
    modelo: MODELO_RECEITA, titulo: 'Receituário', cliente: { name: 'Ana' },
    respostas: { prescricao: '<script>alert(1)</script>' }
  });
  assert.ok(!/<script>/.test(html));
  assert.ok(/&lt;script&gt;/.test(html));
});

test('a pagina do EMITIDO nao se apresenta como assinada', function () {
  const pagina = d.paginaCompleta({
    id: 'doc_1', title: 'Atestado', status: 'EMITIDO',
    rendered_html: '<p>corpo</p>', content_hash: 'a'.repeat(64),
    emitido_por_nome: 'Dra. Ana Lima', emitido_por_conselho: 'CRM',
    emitido_por_numero: '12345', emitido_por_uf: 'SP', emitido_em: '16/09/2026 às 14:40'
  }, { hashConfere: true });

  assert.ok(/Dra\. Ana Lima/.test(pagina));
  assert.ok(/CRM 12345\/SP/.test(pagina), 'o registro sai como a farmacia le');
  assert.ok(/não<\/strong> assina/.test(pagina), 'o papel diz que o sistema nao assina');
  // E nao pode carregar o aviso da assinatura eletronica da paciente, que
  // afirma validade que este documento nao tem.
  assert.ok(!/Assinatura eletrônica simples/.test(pagina));
  assert.ok(/a\.repeat|aaaaaaaa/.test(pagina) || pagina.indexOf('a'.repeat(64)) !== -1,
    'o codigo de integridade sai no rodape');
});

test('os dois tipos novos estao na lista de tipos aceitos', function () {
  assert.ok(d.TIPOS.includes('RECEITA') && d.TIPOS.includes('ATESTADO'));
  assert.ok(d.STATUS.includes('EMITIDO'));
  // A ordem dos quatro primeiros nao pode mudar: o ENUM do banco guarda indice,
  // e reordenar reescreveria o tipo de todo documento ja gravado.
  assert.deepStrictEqual(d.TIPOS.slice(0, 3),
    ['ANAMNESE', 'TERMO_CONSENTIMENTO', 'ORIENTACAO']);
});

test('a pagina traz o botao de imprimir, e ele NAO sai no papel', function () {
  // O PDF sai da propria caixa de impressao do navegador ("Salvar como PDF"),
  // e nao de um segundo desenho do documento gerado no servidor. Um layout de
  // PDF escrito a mao divergiria da tela na primeira mudanca de modelo -- e
  // divergencia entre o que se le e o que se assina e o que este modulo existe
  // para impedir.
  const pagina = d.paginaCompleta({
    id: 'doc_1', title: 'Receituário', status: 'EMITIDO',
    rendered_html: '<p>corpo</p>', content_hash: 'a'.repeat(64),
    emitido_por_nome: 'Dra. Ana', emitido_em_br: '16/09/2026 às 16:37'
  }, { hashConfere: true });

  assert.ok(/window\.print\(\)/.test(pagina), 'sem o botao, imprimir vira "descubra o Ctrl+P"');
  // A barra precisa estar DENTRO de naoImprimir, senao o botao sai impresso no
  // meio da receita.
  assert.ok(/class="barra naoImprimir"/.test(pagina));
  assert.ok(/@media print\{[\s\S]*?\.naoImprimir\{display:none\}/.test(pagina),
    'a regra de impressao que esconde a barra sumiu do CSS');
});

test('a data de emissao sai formatada, e nunca o Date cru', function () {
  // Saiu "Wed Sep 16 2026 19:37:16 GMT+0000 (Coordinated Universal Time)" no
  // rodape do primeiro receituario impresso. O campo cru do banco e um Date; o
  // formatado vem da consulta como `emitido_em_br`.
  const comBr = d.paginaCompleta({
    id: 'doc_1', title: 'Receituário', status: 'EMITIDO', rendered_html: '<p>x</p>',
    content_hash: 'a'.repeat(64), emitido_por_nome: 'Dra. Ana',
    emitido_em: new Date('2026-09-16T19:37:16Z'), emitido_em_br: '16/09/2026 às 16:37'
  }, {});
  assert.ok(/Emitido em: 16\/09\/2026 às 16:37/.test(comBr));
  assert.ok(!/GMT|Wed |Sep /.test(comBr), 'o Date cru vazou para o papel');
});

/* ======================================================= O TIMBRE (M5.6, 17/09)
 *
 * O papel passou a se identificar no alto e no pé. Quem recebe um atestado — o
 * RH, a farmácia, a escola — lê o cabeçalho antes do texto.
 */

const EMITIDO_COM_TIMBRE = {
  id: 'doc_1', title: 'Atestado', status: 'EMITIDO',
  rendered_html: '<p>corpo do atestado</p>', content_hash: 'a'.repeat(64),
  emitido_por_nome: 'Dra. Silvia Torres', emitido_por_funcao: 'Biomédica Esteta',
  emitido_por_conselho: 'CRBM', emitido_por_numero: '12345', emitido_por_uf: 'SP',
  emitido_em_br: '17/09/2026 às 09:10',
  timbre_clinica: 'Clínica Musa', timbre_endereco: 'Rua Alegre, 123 — São Paulo, SP',
  timbre_telefone: '(11) 3456-7890', timbre_contato: '@clinicamusa'
};

test('o documento emitido sai com cabecalho de quem assina e rodape da clinica', function () {
  const p = d.paginaCompleta(EMITIDO_COM_TIMBRE, { hashConfere: true });

  assert.ok(/class="timbre-nome">Dra\. Silvia Torres</.test(p), 'o nome vai no alto');
  assert.ok(/class="timbre-funcao">Biomédica Esteta</.test(p), 'a funcao vai sob o nome');
  assert.ok(/class="timbre-tipo">Atestado</.test(p), 'o tipo do documento sai centralizado');
  assert.ok(/Rua Alegre, 123/.test(p) && /\(11\) 3456-7890 - @clinicamusa/.test(p),
    'endereco e contato vao no rodape');

  // O conselho NAO sobe para o cabecalho: ele pertence ao bloco da assinatura,
  // que e onde quem confere o papel procura por ele.
  const alto = p.slice(0, p.indexOf('corpo do atestado'));
  assert.ok(!/CRBM/.test(alto), 'o conselho fica com a assinatura, e nao no cabecalho');
  assert.ok(/CRBM 12345\/SP/.test(p), 'mas ele continua no papel');
});

test('anamnese e termo NAO repetem o titulo no cabecalho', function () {
  // O corpo deles ja traz o proprio titulo escrito dentro do texto. Imprimir o
  // tipo tambem a direita sairia duas vezes no mesmo papel.
  const p = d.paginaCompleta({
    id: 'doc_2', title: 'Anamnese estética geral', status: 'ASSINADO',
    rendered_html: '<h3>Anamnese</h3><p>x</p>', content_hash: 'b'.repeat(64),
    signer_name: 'Ana', signed_at: '17/09/2026 às 09:00',
    timbre_clinica: 'Clínica Musa', timbre_endereco: 'Rua Alegre, 123'
  }, {});
  // A busca e pelo ATRIBUTO: o nome da classe tambem aparece no CSS da pagina,
  // e procurar so por "timbre-tipo" acharia a regra de estilo.
  assert.ok(!/class="timbre-tipo"/.test(p), 'o tipo a direita e so do documento emitido');
  assert.ok(/class="timbre-nome">Clínica Musa</.test(p),
    'sem emissor, o cabecalho e da clinica');
  assert.ok(/Rua Alegre, 123/.test(p), 'o rodape vale para todo documento impresso');
});

test('o timbre CARIMBADO vence o cadastro atual', function () {
  // A clinica muda de endereco. A receita do ano passado tem de continuar
  // dizendo o endereco de onde ela saiu -- e e por isso que as colunas
  // `timbre_*` existem em vez de uma juncao com `clinicas`.
  const p = d.paginaCompleta(EMITIDO_COM_TIMBRE, {
    timbre: { clinica: 'Outro Nome', endereco: 'Endereco Novo, 999',
              telefone: '(99) 0000-0000', contato: '@novo' }
  });
  assert.ok(/Rua Alegre, 123/.test(p), 'vale o que estava carimbado');
  assert.ok(!/Endereco Novo/.test(p), 'o endereco de hoje nao pode reescrever o papel de ontem');
});

test('documento ANTIGO, sem carimbo, cai no timbre de hoje', function () {
  // Os assinados antes da migration 035 nao tem as colunas preenchidas. Sem
  // este recurso eles imprimiriam sem rodape nenhum.
  const p = d.paginaCompleta({
    id: 'doc_3', title: 'Termo', status: 'ASSINADO',
    rendered_html: '<p>x</p>', content_hash: 'c'.repeat(64), signer_name: 'Ana'
  }, { timbre: { clinica: 'Clínica Musa', endereco: 'Rua de Hoje, 7', telefone: '(11) 1111-1111' } });
  assert.ok(/Rua de Hoje, 7/.test(p));
  assert.ok(/class="timbre-nome">Clínica Musa</.test(p));
});

test('sem timbre nenhum, o papel sai sem cabecalho e sem rodape -- e nao quebrado', function () {
  const p = d.paginaCompleta({
    id: 'doc_4', title: 'Termo', status: 'RASCUNHO', rendered_html: '<p>x</p>'
  }, {});
  assert.ok(!/class="timbre"/.test(p) && !/class="rodape-timbre"/.test(p));
  assert.ok(/<p>x<\/p>/.test(p), 'o corpo continua saindo');
});

test('o corpo do atestado nao repete o titulo nem o nome da clinica', function () {
  // Eles subiram para o cabecalho na 035. Deixa-los no corpo imprimiria tudo
  // duas vezes -- e o corpo antigo esta travado aqui para que a troca nao se
  // desfaça sem alguem perceber.
  const T = require('../db/migrations/035_timbre.js');
  assert.ok(!/^## /m.test(T.CORPO_ATESTADO), 'sem titulo no corpo');
  assert.ok(!/\{\{clinica\}\}/.test(T.CORPO_ATESTADO), 'sem o nome da clinica no corpo');
  assert.ok(!/^## /m.test(T.CORPO_RECEITA) && !/\{\{clinica\}\}/.test(T.CORPO_RECEITA));
  // E o conteudo que importa continua la.
  assert.ok(/\{\{campo\.atendimento_data\}\}/.test(T.CORPO_ATESTADO));
  assert.ok(/1\.658\/2002/.test(T.CORPO_ATESTADO), 'a citacao do CFM nao pode ter sumido');
  assert.ok(/\{\{campo\.prescricao\}\}/.test(T.CORPO_RECEITA));
});

test('a ordem do papel: nome, tipo, corpo, assinatura, ENDERECO, avisos', function () {
  // Quem confere um atestado le de cima para baixo e para na assinatura -- e e
  // ali que procura de onde o papel saiu. Os avisos e o codigo de integridade
  // ficam depois: sao leitura de quem contesta o documento, nao de quem o
  // recebe. A ordem foi pedida assim depois do primeiro atestado impresso.
  const p = d.paginaCompleta(EMITIDO_COM_TIMBRE, { hashConfere: true });
  const corpo = p.slice(p.indexOf('<body>'));
  const marcos = ['class="timbre-nome"', 'class="timbre-tipo"', 'corpo do atestado',
    'CRBM 12345/SP', 'class="rodape-timbre"', 'class="aviso"', 'class="rodape"'];
  let anterior = -1;
  for (const m of marcos) {
    const onde = corpo.indexOf(m);
    assert.ok(onde !== -1, 'sumiu do papel: ' + m);
    assert.ok(onde > anterior, m + ' saiu fora de ordem');
    anterior = onde;
  }
});

test('o papel cala o cabecalho que o NAVEGADOR imprime sozinho', function () {
  // O Chrome carimba data, hora, titulo e URL nas margens -- e como a pagina
  // abre numa aba em branco, saia "about:blank" no pe do atestado. Zerar a
  // margem de @page tira o espaco onde esses carimbos moram.
  const p = d.paginaCompleta(EMITIDO_COM_TIMBRE, {});
  assert.ok(/@page\{margin:0\}/.test(p), 'sem isto volta o "about:blank" no pe do papel');
  // E a margem visual do papel tem de voltar de outro jeito, senao o texto
  // encosta na borda da folha.
  assert.ok(/@media print\{body\{padding:16mm 14mm\}/.test(p));
});

test('sem bloco de assinatura, o endereco cai no fim da folha', function () {
  // Rascunho e cancelado nao tem assinatura para o endereco seguir.
  const p = d.paginaCompleta({
    id: 'doc_5', title: 'Atestado', status: 'CANCELADO', rendered_html: '<p>x</p>',
    cancelled_reason: 'erro de digitacao',
    timbre_endereco: 'Rua Alegre, 123'
  }, {});
  const corpo = p.slice(p.indexOf('<body>'));
  assert.ok(corpo.indexOf('class="rodape-timbre"') > corpo.indexOf('class="aviso"'),
    'sem assinatura, ele vai para o fim -- e nao some');
  assert.strictEqual((corpo.match(/class="rodape-timbre"/g) || []).length, 1,
    'e sai UMA vez so');
});

/* ================================= O PÉ DO RECEITUÁRIO (M5.7, 17/09)
 *
 * Receita e atestado são lidos por gente diferente, e isso desenha o papel:
 *
 *   atestado → vai para o RH, que para na assinatura   → endereço logo abaixo dela
 *   receita  → vai para a farmácia e depois para casa  → faixa de contato no pé
 *
 * E o conselho segue a mesma lógica: no balcão da farmácia ele é procurado no
 * alto, antes da prescrição; no atestado, junto da assinatura.
 */

const BASE_EMITIDO = {
  id: 'doc_r', rendered_html: '<p>CORPO</p>', content_hash: 'a'.repeat(64), status: 'EMITIDO',
  emitido_por_nome: 'Cíntia Campos', emitido_por_funcao: 'Médica Cardiologista',
  emitido_por_conselho: 'CRM', emitido_por_numero: '123456', emitido_por_uf: 'SP',
  emitido_em_br: '17/09/2026 às 10:00',
  timbre_clinica: 'Clínica', timbre_endereco: 'Rua Alegre, 123 - Cidade Brasileira',
  timbre_telefone: '(12) 3456-7890', timbre_email: 'ola@grandesite.com.br', timbre_contato: ''
};
const receitaPagina = (extra) => d.paginaCompleta(
  Object.assign({}, BASE_EMITIDO, { type: 'RECEITA', title: 'Receituário' }, extra || {}), {});
const corpoDe = (p) => p.slice(p.indexOf('<body>'));

test('o receituario traz o conselho no ALTO, junto do nome', function () {
  const c = corpoDe(receitaPagina());
  assert.ok(/class="timbre-registro">CRM 123456\/SP</.test(c));
  // E antes da prescricao: e ali que a farmacia procura.
  assert.ok(c.indexOf('timbre-registro') < c.indexOf('CORPO'));
});

test('o receituario fecha com a faixa de contato no PE da folha', function () {
  const c = corpoDe(receitaPagina());
  assert.ok(/class="faixa">Contato: \(12\) 3456-7890 ou ola@grandesite\.com\.br<br>Rua Alegre/.test(c),
    'a faixa sai no formato que a paciente procura: telefone ou e-mail, e o endereco abaixo');
  // Depois dos avisos, e nao colada na assinatura: o miolo fica para a receita.
  assert.ok(c.indexOf('class="faixa"') > c.indexOf('class="aviso"'));
  assert.ok(!/class="rodape-timbre"/.test(c), 'e o rodape do atestado nao sai junto');
});

test('o ATESTADO nao mudou: endereco sob a assinatura, conselho com ela', function () {
  // A M5.7 e so do receituario. Este teste existe para que a proxima mexida no
  // pe da receita nao arraste o atestado junto sem ninguem ver.
  const c = corpoDe(d.paginaCompleta(
    Object.assign({}, BASE_EMITIDO, { type: 'ATESTADO', title: 'Atestado' }), {}));
  assert.ok(!/class="faixa"/.test(c), 'o atestado nao ganha faixa');
  assert.ok(!/class="timbre-registro"/.test(c), 'nem conselho no cabecalho');
  assert.ok(c.indexOf('class="rodape-timbre"') < c.indexOf('class="aviso"'),
    'o endereco continua logo abaixo da assinatura');
  assert.ok(/CRM 123456\/SP/.test(c), 'e o conselho continua no papel, com a assinatura');
});

test('a faixa some quando a clinica nao preencheu contato nenhum', function () {
  const c = corpoDe(receitaPagina({
    timbre_endereco: null, timbre_telefone: null, timbre_email: null, timbre_contato: null }));
  assert.ok(!/class="faixa"/.test(c), 'faixa vazia seria so uma linha solta no pe do papel');
});

test('a faixa usa o que houver, e nao inventa separador', function () {
  const so = corpoDe(receitaPagina({
    timbre_telefone: null, timbre_email: null, timbre_contato: null }));
  assert.ok(/class="faixa">Rua Alegre/.test(so), 'so o endereco, sem a palavra "Contato:"');
  assert.ok(!/Contato:/.test(so));

  const semEndereco = corpoDe(receitaPagina({ timbre_endereco: null }));
  assert.ok(/Contato: \(12\) 3456-7890 ou ola@grandesite\.com\.br<\/div>/.test(semEndereco));
});

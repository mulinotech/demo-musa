'use strict';
/** Documentos clínicos e anamnese — regras puras (T4.2).
 *
 *  TRÊS REGRAS QUE SUSTENTAM O VALOR JURÍDICO DO MÓDULO
 *
 *  1. DEPOIS DE FINALIZADO, O CONTEÚDO É IMUTÁVEL. O documento que a paciente
 *     leu e assinou é congelado em `rendered_html`, e o hash é calculado sobre
 *     esse texto. Permitir edição depois disso destruiria a única coisa que dá
 *     valor à assinatura: a certeza de que o que está guardado é o que foi
 *     assinado. Corrigir significa emitir documento novo.
 *
 *  2. O HASH É DO HTML CONGELADO, não das respostas. Se fosse das respostas, o
 *     mesmo hash valeria para dois textos diferentes — bastaria mudar o corpo do
 *     modelo. É o texto lido que precisa ser provável.
 *
 *  3. A ASSINATURA É ELETRÔNICA SIMPLES, e a tela precisa dizer isso. Desenho em
 *     tela + carimbo de tempo + IP + hash têm validade entre as partes pela MP
 *     2.200-2/2001 e pela Lei 14.063/2020, porque comprovam autoria e
 *     integridade. NÃO é assinatura digital qualificada com certificado
 *     ICP-Brasil. Chamar de "assinatura digital certificada" em qualquer texto
 *     de interface seria afirmação falsa sobre o valor probatório.
 *
 *  Nada aqui toca banco: recebe modelo e respostas, devolve texto e decisão.
 */

const crypto = require('crypto');

/* RECEITA e ATESTADO entraram na M5.5 (16/09), e sao de uma natureza diferente
 * dos outros quatro: quem os assina e a PROFISSIONAL, nao a paciente. Por isso
 * existe `EMITIDO` ao lado de `AGUARDANDO_ASSINATURA` -- mandar uma receita
 * para a fila de "aguardando assinatura da paciente" seria pedir que ela
 * assinasse a propria prescricao. */
const TIPOS = ['ANAMNESE', 'TERMO_CONSENTIMENTO', 'ORIENTACAO', 'RECEITA', 'ATESTADO', 'OUTRO'];
const STATUS = ['RASCUNHO', 'AGUARDANDO_ASSINATURA', 'ASSINADO', 'EMITIDO', 'CANCELADO'];

/** Os tipos que a profissional emite e assina -- no papel, com a propria mao.
 *  Tudo o que muda de comportamento por causa disso pergunta por aqui, em vez
 *  de repetir a lista em cinco lugares. */
const TIPOS_EMITIDOS = ['RECEITA', 'ATESTADO'];
function ehEmitidoPelaProfissional(tipo) {
  return TIPOS_EMITIDOS.indexOf(String(tipo || '').toUpperCase()) !== -1;
}
const TIPOS_DE_CAMPO = ['text', 'textarea', 'boolean', 'select', 'multiselect', 'date', 'number', 'scale'];

/* ------------------------------------------------------------ utilidades */

function parseJson(v, padrao) {
  if (v == null) return padrao;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (e) { return padrao; }
}

/** Escapa HTML. Sem isto, uma resposta com `<script>` acaba dentro do
 *  documento renderizado — e o documento é exibido para outras pessoas da
 *  clínica depois. Resposta de paciente é entrada não confiável como qualquer
 *  outra, ainda que venha do tablet da recepção. */
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function campos(modelo) {
  const def = parseJson(modelo && modelo.fields_json, { sections: [] });
  const lista = [];
  for (const s of (def.sections || [])) {
    for (const f of (s.fields || [])) lista.push(Object.assign({ secao: s.title }, f));
  }
  return lista;
}

/** Uma pergunta condicional só existe quando a condição é satisfeita. Isso vale
 *  para a validação também: exigir "quais alergias?" de quem respondeu que não
 *  tem alergia travaria o formulário para sempre. */
function visivel(campo, respostas) {
  if (!campo.showIf) return true;
  const alvo = respostas ? respostas[campo.showIf.field] : undefined;
  if ('equals' in campo.showIf) return alvo === campo.showIf.equals;
  if ('in' in campo.showIf) return (campo.showIf.in || []).indexOf(alvo) !== -1;
  return true;
}

function vazio(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/* ------------------------------------------------------------ validação */

/** Devolve a lista de problemas. Vazia = pode seguir.
 *  A mensagem cita o rótulo da pergunta, não a chave técnica: "gestante" não
 *  diz nada a quem está com o tablet na mão. */
function validar(modelo, respostas) {
  const r = respostas || {};
  const problemas = [];
  for (const c of campos(modelo)) {
    if (!visivel(c, r)) continue;
    const v = r[c.key];
    if (c.required && vazio(v)) {
      problemas.push({ campo: c.key, erro: 'Responda: ' + c.label });
      continue;
    }
    if (vazio(v)) continue;
    if (c.type === 'number' && !isFinite(Number(v))) {
      problemas.push({ campo: c.key, erro: c.label + ': informe um número.' });
    }
    if (c.type === 'scale') {
      const n = Number(v);
      const min = c.min == null ? 0 : Number(c.min);
      const max = c.max == null ? 10 : Number(c.max);
      if (!isFinite(n) || n < min || n > max) {
        problemas.push({ campo: c.key, erro: c.label + ': valor entre ' + min + ' e ' + max + '.' });
      }
    }
    if (c.type === 'select' && Array.isArray(c.options) && c.options.indexOf(v) === -1) {
      problemas.push({ campo: c.key, erro: c.label + ': opção inválida.' });
    }
  }
  return problemas;
}

/* -------------------------------------------------------------- alertas */

/** Contraindicações: respostas marcadas com `alert` que vieram afirmativas.
 *
 *  É este pedaço que transforma anamnese de papel digitalizado em ferramenta de
 *  segurança clínica. Uma anamnese guardada num PDF que ninguém abre não impede
 *  aplicação de toxina em gestante; um aviso vermelho no topo da ficha, sim. */
function alertas(modelo, respostas) {
  const r = respostas || {};
  const achados = [];
  for (const c of campos(modelo)) {
    if (!c.alert) continue;
    const v = r[c.key];
    // Afirmativo depende do tipo: booleano true, ou qualquer texto preenchido.
    const afirmativo = c.type === 'boolean' ? v === true : !vazio(v);
    if (!afirmativo) continue;
    const detalheKey = c.key + '_quais';
    achados.push({
      campo: c.key,
      rotulo: c.label,
      valor: c.type === 'boolean' ? 'Sim' : String(v),
      detalhe: r[detalheKey] ? String(r[detalheKey]) : null
    });
  }
  return achados;
}

/* ----------------------------------------------------------- renderização */

function valorLegivel(campo, v) {
  if (vazio(v)) return '—';
  if (campo.type === 'boolean') return v === true ? 'Sim' : 'Não';
  if (Array.isArray(v)) return v.join(', ');
  if (campo.type === 'scale') return String(v) + ' de ' + (campo.max == null ? 10 : campo.max);
  // O <input type="date"> entrega 2026-09-16, e e assim que ficava no papel.
  // Atestado que a paciente leva ao RH com a data escrita ao contrario e um
  // documento que levanta duvida antes de ser lido.
  if (campo.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
    return String(v).split('-').reverse().join('/');
  }
  return String(v);
}

/** Tabela de respostas, por seção. Vai dentro do corpo do documento no lugar de
 *  `{{respostas}}` — ou no fim, se o modelo não tiver a variável. */
function tabelaDeRespostas(modelo, respostas) {
  const r = respostas || {};
  const def = parseJson(modelo && modelo.fields_json, { sections: [] });
  const partes = [];

  // Anamnese migrada do cadastro antigo: texto livre, sem estrutura.
  if (r.texto_livre) {
    partes.push('<h3>Anamnese registrada no cadastro anterior</h3><p class="livre">' +
                esc(r.texto_livre).replace(/\n/g, '<br>') + '</p>');
  }

  for (const s of (def.sections || [])) {
    const linhas = [];
    for (const f of (s.fields || [])) {
      const c = f;
      if (!visivel(c, r)) continue;
      const marca = c.alert && (c.type === 'boolean' ? r[c.key] === true : !vazio(r[c.key]));
      linhas.push(
        '<tr' + (marca ? ' class="atencao"' : '') + '><th>' + esc(c.label) + '</th><td>' +
        esc(valorLegivel(c, r[c.key])) + (marca ? ' <span class="tag">atenção</span>' : '') + '</td></tr>'
      );
    }
    if (linhas.length) {
      partes.push('<h3>' + esc(s.title || 'Respostas') + '</h3><table>' + linhas.join('') + '</table>');
    }
  }
  return partes.join('\n');
}

/** Markdown mínimo: títulos, negrito, itálico, lista e parágrafo. Não uso
 *  biblioteca de propósito — o corpo do documento é escrito pela clínica, e um
 *  conversor completo aceitaria HTML embutido, que é justamente o que não se
 *  quer num documento que outras pessoas vão abrir. */
function markdownSimples(txt) {
  const linhas = String(txt || '').split('\n');
  const saida = [];
  let emLista = false;
  for (const linha of linhas) {
    const l = linha.trim();
    if (!l) { if (emLista) { saida.push('</ul>'); emLista = false; } continue; }

    if (/^-\s+/.test(l)) {
      if (!emLista) { saida.push('<ul>'); emLista = true; }
      saida.push('<li>' + inline(l.replace(/^-\s+/, '')) + '</li>');
      continue;
    }
    if (emLista) { saida.push('</ul>'); emLista = false; }

    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) { const n = h[1].length + 1; saida.push('<h' + n + '>' + inline(h[2]) + '</h' + n + '>'); continue; }
    saida.push('<p>' + inline(l) + '</p>');
  }
  if (emLista) saida.push('</ul>');
  return saida.join('\n');
}

function inline(t) {
  return esc(t)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)_([^_]+)_(?=\s|$|[.,;:!?])/g, '$1<em>$2</em>');
}

const CSS = [
  'body{font-family:Georgia,serif;color:#2b1c12;max-width:46rem;margin:0 auto;padding:2.5rem 1.5rem;line-height:1.6}',
  'h2{font-size:1.4rem;margin:0 0 1rem;border-bottom:1px solid #ddd;padding-bottom:.5rem}',
  'h3{font-size:1.05rem;margin:1.6rem 0 .5rem}',
  'table{width:100%;border-collapse:collapse;margin:.5rem 0 1rem;font-size:.86rem}',
  'th{text-align:left;font-weight:600;width:58%;padding:.4rem .6rem;border-bottom:1px solid #eee;vertical-align:top}',
  'td{padding:.4rem .6rem;border-bottom:1px solid #eee;vertical-align:top}',
  'tr.atencao th,tr.atencao td{background:#fdf1ee}',
  '.tag{font-family:system-ui,sans-serif;font-size:.62rem;text-transform:uppercase;letter-spacing:.08em;color:#9e3b28;border:1px solid #e3b7ad;border-radius:2px;padding:.05rem .3rem;margin-left:.3rem}',
  '.livre{white-space:pre-line;background:#faf7f2;padding:.8rem;border-left:3px solid #ddd}',
  '.rodape{margin-top:2.5rem;padding-top:1rem;border-top:1px solid #ddd;font-family:ui-monospace,monospace;font-size:.66rem;color:#6b5443;line-height:1.7}',
  '.assinatura{margin-top:2rem;padding-top:1rem;border-top:1px solid #ddd}',
  '.assinatura img{max-width:16rem;display:block;margin:.5rem 0}',
  '.aviso{font-family:system-ui,sans-serif;font-size:.72rem;color:#6b5443;background:#faf7f2;border:1px solid #e6dbc9;padding:.6rem .8rem;margin-top:1rem}',
  /* ================================== O LOGO DA CLINICA (M6.2, 24/09)
   *
   * `max-height` e nao `height`: o logo de cada clinica tem uma proporcao, e
   * fixar os dois lados esticaria a marca de alguem. A altura de 18mm e a que
   * cabe acima do nome sem empurrar a prescricao para a segunda folha.
   *
   * Alinhado a ESQUERDA porque o nome de quem assina (`.timbre-nome`) esta a
   * esquerda desde a M5.6. Centralizar so o logo deixaria a marca fora de
   * prumo com o nome logo abaixo -- e isso so aparece depois de impresso. */
  '.timbre-logo{display:block;margin:0 0 .9rem;max-height:18mm;max-width:60%}',
  '.timbre{margin-bottom:.2rem}',
  '.timbre-nome{font-size:1.6rem;font-weight:700;line-height:1.15}',
  '.timbre-funcao{font-family:system-ui,sans-serif;font-size:.66rem;letter-spacing:.2em;text-transform:uppercase;color:#6b5443;margin-top:.3rem}',
  '.timbre-registro{font-family:system-ui,sans-serif;font-size:.72rem;color:#6b5443;margin-top:.35rem}',
  '.timbre-tipo{font-size:1.5rem;color:#8a7361;text-align:center;margin:1.8rem 0 2rem}',
  '.faixa{margin-top:3rem;padding-top:.9rem;border-top:1px solid #ccc;text-align:center;font-size:.78rem;color:#6b5443;line-height:1.8;letter-spacing:.02em}',
  '.rodape-timbre{margin-top:1.6rem;padding-top:.7rem;border-top:1px solid #ddd;font-size:.72rem;letter-spacing:.04em;color:#6b5443;line-height:1.7}',
  '.barra{font-family:system-ui,sans-serif;display:flex;gap:.6rem;align-items:center;justify-content:flex-end;margin:-1rem 0 1.6rem;padding-bottom:1rem;border-bottom:1px solid #eee}',
  '.barra button{font:inherit;font-size:.78rem;font-weight:600;cursor:pointer;background:#4a3728;color:#f5ede1;border:none;border-radius:6px;padding:.5rem .9rem}',
  '.barra button:hover{background:#3a2b1f}',
  '.barra span{font-size:.72rem;color:#6b5443}',
  /* ============ O CABECALHO QUE O NAVEGADOR IMPRIME POR CONTA PROPRIA
   *
   * O Chrome carimba data, hora, titulo da pagina, URL e numero de pagina nas
   * margens do papel -- e como a pagina do documento e aberta numa aba em
   * branco, a URL sai como "about:blank" no pe do atestado. Num documento que
   * a paciente leva para o trabalho, isso e ruido que levanta duvida.
   *
   * Zerar a margem de `@page` tira o espaco onde esses carimbos moram, e o
   * navegador para de desenha-los. A margem visual do papel volta como padding
   * do corpo, so na impressao. (Se algum navegador insistir, a caixa de
   * impressao tem a opcao "Cabecalhos e rodapes" para desmarcar.) */
  '@page{margin:0}',
  '@media print{body{padding:16mm 14mm} .naoImprimir{display:none}}'
].join('');

/**
 * Renderiza o documento FINAL. O texto que sai daqui é o que a paciente lê,
 * o que é assinado e o que entra no hash — os três são o mesmo.
 */
function renderizar(p) {
  const modelo = p.modelo || {};
  const respostas = p.respostas || {};
  const cliente = p.cliente || {};
  const corpo = modelo.body_markdown || '## {{titulo}}\n\nPaciente: **{{paciente}}**\nData: {{data}}\n\n{{respostas}}';

  const variaveis = {
    titulo: p.titulo || modelo.name || 'Documento',
    paciente: cliente.name || '—',
    cpf: cliente.cpf || cliente.document || '—',
    procedimento: p.procedimento || '—',
    data: p.data || new Date().toISOString().slice(0, 10).split('-').reverse().join('/'),
    clinica: p.clinica || 'Dra. Musa Estética de Elite'
  };

  let texto = String(corpo);
  const tabela = tabelaDeRespostas(modelo, respostas);
  /* O modelo que coloca as respostas UMA A UMA no texto (`{{campo.x}}`) nao
   * leva a tabela no fim. Sem esta condicao, a receita saia com a prescricao
   * escrita por extenso E logo abaixo a mesma prescricao numa tabela de
   * formulario respondido -- documento repetido e documento que ninguem le ate
   * o fim, e no fim e onde fica a identificacao de quem emitiu. */
  const temMarca = texto.indexOf('{{respostas}}') !== -1 || texto.indexOf('{{campo.') !== -1;
  texto = texto.replace(/\{\{respostas\}\}/g, ' RESPOSTAS ');
  /* ======== {{se campo.x}} ... {{/se}} e {{campo.x}} entraram na M5.5 (16/09)
   *
   * Ate aqui havia so `{{respostas}}`, que despeja a TABELA inteira. Serve para
   * anamnese e nao serve para atestado: "necessitando de 3 dias de afastamento"
   * precisa do valor NO MEIO DA FRASE, e a linha do CID tem de SUMIR quando a
   * paciente nao autorizou o diagnostico (CFM 1.658/2002) -- em vez de sair
   * "CID:" em branco, que e o atestado que o RH devolve.
   *
   * O bloco vem primeiro: ele decide o que sobra do texto antes de qualquer
   * valor ser colocado. */
  const porChave = {};
  for (const c of campos(modelo)) porChave[c.key] = c;

  /* PERGUNTA ESCONDIDA NAO TEM RESPOSTA -- nem aqui.
   *
   * A resposta de um campo com `showIf` insatisfeito continua GRAVADA: a tela
   * apaga ao desmarcar, mas o servidor nao pode depender disso. A tabela de
   * `{{respostas}}` ja pulava esses campos (`visivel`); o texto tinha de pular
   * tambem.
   *
   * O caso que fez isto aparecer e o CID do atestado: marcar a autorizacao,
   * digitar o codigo, DESMARCAR e emitir imprimia o diagnostico da paciente no
   * papel que vai para a mao do empregador -- contra a Resolucao CFM
   * 1.658/2002, e sem nenhum erro aparecer. Um teste pegou; a tela nao pegaria. */
  function valorDe(chave) {
    const c = porChave[chave];
    if (c && !visivel(c, respostas)) return undefined;
    return respostas[chave];
  }

  texto = texto.replace(/\{\{se campo\.([\w-]+)\}\}([\s\S]*?)\{\{\/se\}\}/g,
    function (_, chave, dentro) {
      const v = valorDe(chave);
      // Zero conta como nao respondido AQUI, e so aqui: o bloco pergunta se ha
      // o que dizer, e "afastamento de 0 dia(s)" nao e afastamento nenhum.
      if (vazio(v) || v === 0 || v === '0') return '';
      return dentro;
    });

  // O valor passa pelo MESMO `valorLegivel` da tabela: booleano sai "Sim" e nao
  // "true", escala sai "3 de 10". Quem le o papel nao le JavaScript.
  texto = texto.replace(/\{\{campo\.([\w-]+)\}\}/g, function (_, chave) {
    const v = valorDe(chave);
    if (vazio(v)) return '';
    return porChave[chave] ? valorLegivel(porChave[chave], v) : String(v);
  });

  texto = texto.replace(/\{\{(\w+)\}\}/g, function (_, k) {
    return variaveis[k] === undefined ? '' : String(variaveis[k]);
  });

  let html = markdownSimples(texto).replace(/<p> RESPOSTAS <\/p>| RESPOSTAS /g, tabela);
  if (!temMarca && tabela) html += '\n' + tabela;

  return html;
}

/** SHA-256 do conteúdo congelado. É o que prova que o documento guardado é o
 *  mesmo que foi assinado. */
function hashDoConteudo(html) {
  return crypto.createHash('sha256').update(String(html == null ? '' : html), 'utf8').digest('hex');
}

/** Documento completo para exibição e impressão, com assinatura e rodapé de
 *  integridade. O rodapé é obrigatório: sem hash, data, IP e o aviso sobre o
 *  tipo de assinatura, o papel impresso não sustenta nada. */
function paginaCompleta(doc, opcoes) {
  const o = opcoes || {};
  const partes = ['<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">',
    '<title>' + esc(doc.title) + '</title><style>' + CSS + '</style></head><body>'];

  /* A BARRA DE IMPRESSAO (M5.5, 16/09).
   *
   * `window.print()` do proprio navegador -- e nao um PDF gerado no servidor.
   * A caixa de impressao do navegador ja oferece "Salvar como PDF", entao o
   * arquivo sai identico ao que a profissional acabou de conferir na tela, sem
   * um segundo desenho do documento para manter em sincronia. Um layout de PDF
   * escrito a mao em biblioteca divergiria da tela na primeira mudanca de
   * modelo, e divergencia entre o que se le e o que se assina e exatamente o
   * que este modulo existe para impedir.
   *
   * A barra tem a classe `naoImprimir`: ela some no papel. */
  /* ================================= O TIMBRE (M5.6, 17/09)
   *
   * Quem recebe um atestado -- o RH, a farmacia, a escola -- le o cabecalho
   * antes de ler o texto, e papel sem cabecalho parece rascunho por mais
   * correto que esteja.
   *
   * O valor CARIMBADO no documento vem primeiro; o cadastro atual e so o
   * recurso para documento antigo, anterior a esta migration. A clinica muda de
   * endereco, e a receita do ano passado tem de continuar dizendo de onde ela
   * saiu. */
  const atual = o.timbre || {};
  const timbre = {
    clinica: doc.timbre_clinica || atual.clinica || '',
    endereco: doc.timbre_endereco || atual.endereco || '',
    telefone: doc.timbre_telefone || atual.telefone || '',
    contato: doc.timbre_contato || atual.contato || '',
    email: doc.timbre_email || atual.email || '',
    logo: doc.timbre_logo || atual.logo || ''
  };

  /* O RECEITUARIO TEM O PE PROPRIO (M5.7, 17/09).
   *
   * No atestado o endereco vem logo abaixo da assinatura, porque quem confere
   * um atestado para ali. A receita e outra leitura: ela vai para a farmacia e
   * depois para a gaveta de casa, e o que a paciente procura nela e como falar
   * com a clinica. Por isso o contato dela desce para uma faixa centralizada no
   * PE DA FOLHA, e o miolo fica livre para a prescricao.
   *
   * Sem fundo colorido de proposito: receita e impressa em preto e branco e em
   * modo economico na maioria das clinicas, e faixa escura vira borrao cinza. */
  const receita = String(doc.type || '').toUpperCase() === 'RECEITA';
  const emitido = doc.status === 'EMITIDO';

  /* O ENDERECO VEM LOGO ABAIXO DA ASSINATURA, e nao no fim da folha.
   *
   * Quem confere um atestado le de cima para baixo e para na assinatura: e ali
   * que ele procura de onde o papel saiu. Os avisos e o codigo de integridade
   * continuam depois, porque sao leitura de quem contesta o documento, e nao de
   * quem o recebe.
   *
   * Em documento sem bloco de assinatura (rascunho, cancelado) ele cai no fim
   * da folha, que e o unico lugar que sobra. */
  let timbreSaiu = false;
  function rodapeDoTimbre() {
    if (receita) {
      // "Contato: (11) 3456-7890 ou contato@clinica.com.br" / endereco -- a
      // linha que a paciente procura quando precisa remarcar ou tirar duvida.
      const canais = [timbre.telefone, timbre.email, timbre.contato].filter(Boolean);
      const linhas = [];
      if (canais.length) linhas.push('Contato: ' + canais.join(' ou '));
      if (timbre.endereco) linhas.push(timbre.endereco);
      if (!linhas.length) return '';
      timbreSaiu = true;
      return '<div class="faixa">' + linhas.map(esc).join('<br>') + '</div>';
    }
    const pe = [timbre.endereco,
      [timbre.telefone, timbre.email, timbre.contato].filter(Boolean).join(' - ')].filter(Boolean);
    if (!pe.length) return '';
    timbreSaiu = true;
    return '<div class="rodape-timbre">' + pe.map(esc).join('<br>') + '</div>';
  }

  // No RECEITUARIO o conselho sobe para o cabecalho, junto do nome: e ali que o
  // balcao da farmacia procura por ele antes de ler a prescricao. No atestado
  // ele fica com a assinatura, que e onde o RH olha.
  const registro = emitido && doc.emitido_por_conselho
    ? esc(doc.emitido_por_conselho) + ' ' + esc(doc.emitido_por_numero || '') +
      (doc.emitido_por_uf ? '/' + esc(doc.emitido_por_uf) : '')
    : '';

  // Em documento EMITIDO o cabecalho e de QUEM ASSINA; nos outros, da clinica.
  // O conselho nao sobe para o cabecalho de proposito: ele pertence ao bloco da
  // assinatura, que e onde quem confere o papel procura por ele.
  const titular = emitido && doc.emitido_por_nome
    ? esc(doc.emitido_por_nome) : esc(timbre.clinica);
  const funcao = emitido && doc.emitido_por_funcao ? esc(doc.emitido_por_funcao) : '';

  /* O LOGO VEM ANTES DO NOME, e sai mesmo em rascunho: quem confere a previa
   * precisa ver o papel como ele vai ficar, e o logo e a primeira coisa que
   * quem recebe o documento enxerga.
   *
   * So entra se for data URL de imagem -- a mesma lista de `timbre-logo.js`.
   * A validacao ja aconteceu na gravacao; esta segunda conferencia existe
   * porque aqui se escreve HTML, e documento antigo pode ter sido carimbado
   * antes de a regra existir. */
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(timbre.logo)) {
    partes.push('<img class="timbre-logo" src="' + timbre.logo + '" alt="' +
      esc(timbre.clinica || 'Logo da clinica') + '">');
  }

  if (titular || funcao) {
    partes.push('<div class="timbre">' +
      (titular ? '<div class="timbre-nome">' + titular + '</div>' : '') +
      (funcao ? '<div class="timbre-funcao">' + funcao + '</div>' : '') +
      (receita && registro ? '<div class="timbre-registro">' + registro + '</div>' : '') +
      '</div>');
  }
  // O tipo do documento vem ABAIXO do nome e centralizado -- e so no emitido:
  // anamnese e termo ja trazem o proprio titulo dentro do texto, e repeti-lo
  // aqui imprimiria duas vezes no mesmo papel.
  if (emitido && doc.title) {
    partes.push('<div class="timbre-tipo">' + esc(doc.title) + '</div>');
  }

  partes.push('<div class="barra naoImprimir">' +
    '<span>Imprima e assine. Para gerar PDF, escolha "Salvar como PDF" na caixa de impressão.</span>' +
    '<button type="button" onclick="window.print()">Imprimir / Salvar em PDF</button>' +
    '</div>');

  partes.push(doc.rendered_html || '');

  if (doc.status === 'ASSINADO') {
    partes.push('<div class="assinatura">');
    if (doc.signature_image) {
      partes.push('<img src="' + esc(doc.signature_image) + '" alt="Assinatura de ' + esc(doc.signer_name) + '">');
    }
    partes.push('<p><strong>' + esc(doc.signer_name || '') + '</strong>' +
                (doc.signer_document ? '<br>CPF ' + esc(doc.signer_document) : '') + '</p>');
    partes.push('</div>');
    partes.push(rodapeDoTimbre());
    partes.push('<div class="aviso"><strong>Assinatura eletrônica simples.</strong> ' +
      'Este documento foi assinado por desenho em tela, com registro de data, hora, endereço IP e ' +
      'código de integridade do conteúdo (SHA-256). Tem validade entre as partes nos termos da MP ' +
      '2.200-2/2001 e da Lei 14.063/2020. <strong>Não</strong> é assinatura digital qualificada com ' +
      'certificado ICP-Brasil.</div>');
    partes.push('<div class="rodape">' +
      'Documento: ' + esc(doc.id) + '<br>' +
      'Assinado em: ' + esc(doc.signed_at || '') + '<br>' +
      'IP de origem: ' + esc(doc.signed_ip || '') + '<br>' +
      'Navegador: ' + esc(String(doc.signed_user_agent || '').slice(0, 120)) + '<br>' +
      'Integridade (SHA-256): ' + esc(doc.content_hash || '') +
      (o.hashConfere === false ? '<br><strong>ATENCAO: o conteudo nao corresponde ao hash registrado.</strong>' : '') +
      '</div>');
  } else if (doc.status === 'EMITIDO') {
    /* ============ RECEITA E ATESTADO: QUEM ASSINA E A PROFISSIONAL (M5.5)
     *
     * O papel sai com a identificacao dela e uma LINHA PARA ASSINAR A MAO. Nao
     * ha assinatura em tela aqui, e o aviso diz isso com todas as letras: um
     * documento que se apresenta como assinado sem estar e pior do que um
     * documento em branco.
     *
     * O conselho e o numero vem do cadastro dela e sao carimbados no momento da
     * emissao -- se ela trocar de registro depois, o documento antigo continua
     * dizendo o que era verdade quando foi emitido. */
    partes.push('<div class="assinatura">');
    partes.push('<p style="border-top:1px solid #333;padding-top:6px;margin-top:48px;">' +
      '<strong>' + esc(doc.emitido_por_nome || '') + '</strong>' +
      (doc.emitido_por_conselho
        ? '<br>' + esc(doc.emitido_por_conselho) + ' ' + esc(doc.emitido_por_numero || '') +
          (doc.emitido_por_uf ? '/' + esc(doc.emitido_por_uf) : '')
        : '') +
      '</p>');
    partes.push('</div>');
    // A receita pula esta linha: a faixa dela sai no PE DA FOLHA, depois dos
    // avisos, e nao colada na assinatura.
    if (!receita) partes.push(rodapeDoTimbre());
    partes.push('<div class="aviso"><strong>Documento emitido pela profissional identificada acima.</strong> ' +
      'Para ter validade, precisa da assinatura dela &mdash; de próprio punho, no papel impresso, ' +
      'ou por assinatura digital com certificado ICP-Brasil feita fora deste sistema. ' +
      'O Musa registra o conteúdo, a data e o código de integridade; <strong>não</strong> assina ' +
      'pela profissional.</div>');
    partes.push('<div class="rodape">' +
      'Documento: ' + esc(doc.id) + '<br>' +
      // `emitido_em_br` vem formatado da consulta; o campo cru e um Date, e
      // imprimia "Wed Sep 16 2026 19:37:16 GMT+0000" no rodape do papel.
      'Emitido em: ' + esc(doc.emitido_em_br || doc.emitido_em || '') + '<br>' +
      'Integridade (SHA-256): ' + esc(doc.content_hash || '') +
      (o.hashConfere === false ? '<br><strong>ATENCAO: o conteudo nao corresponde ao hash registrado.</strong>' : '') +
      '</div>');
  } else if (doc.status === 'AGUARDANDO_ASSINATURA') {
    partes.push('<div class="aviso">Documento gerado e aguardando assinatura. ' +
      'Código de integridade: ' + esc(doc.content_hash || '') + '</div>');
  } else if (doc.status === 'CANCELADO') {
    partes.push('<div class="aviso"><strong>Documento cancelado.</strong> ' +
      esc(doc.cancelled_reason || '') + ' O conteúdo é mantido para fins de histórico.</div>');
  }

  if (!timbreSaiu) partes.push(rodapeDoTimbre());

  partes.push('</body></html>');
  return partes.join('\n');
}

/* -------------------------------------------------- travas de estado */

/** Rascunho é a única situação em que as respostas mudam. */
function podeEditar(doc) {
  if (!doc) return { ok: false, status: 404, error: 'Documento nao encontrado.' };
  if (doc.status === 'RASCUNHO') return { ok: true };
  if (doc.status === 'CANCELADO') return { ok: false, status: 409, error: 'Documento cancelado nao se edita.' };
  return { ok: false, status: 409,
    error: 'Documento já gerado é imutável — é isso que dá valor à assinatura. Emita um documento novo para corrigir.' };
}

/** Receita e atestado NAO passam pela assinatura em tela. A recusa e explicita
 *  porque a alternativa -- deixar passar -- produziria um papel com o desenho da
 *  paciente embaixo da prescricao dela mesma. */
function podeAssinarEmTela(doc) {
  if (doc && ehEmitidoPelaProfissional(doc.type)) {
    return { ok: false, status: 409,
      error: 'Receita e atestado sao assinados pela profissional, no papel impresso ' +
             'ou por certificado ICP-Brasil fora do sistema. Nao ha assinatura da paciente aqui.' };
  }
  return { ok: true };
}

/** O status que o documento assume ao ser congelado depende de QUEM assina.
 *  Anamnese e termo vao para a fila da paciente; receita e atestado ja saem
 *  prontos para a profissional assinar de proprio punho. */
function statusAoFinalizar(tipo) {
  return ehEmitidoPelaProfissional(tipo) ? 'EMITIDO' : 'AGUARDANDO_ASSINATURA';
}

/** Receita e atestado so saem com o registro profissional preenchido.
 *
 *  Nao e formalidade: papel sem conselho e numero nao e receita nem atestado --
 *  a farmacia nao dispensa e o RH nao aceita. Recusar aqui, com a frase que diz
 *  ONDE preencher, custa um clique; descobrir na portaria da empresa custa o
 *  dia da paciente.
 *
 *  A trava tambem responde "quem pode emitir": nao ha lista de papeis: ha o
 *  cadastro. Quem tem registro profissional emite, e o resto e recusado pela
 *  mesma linha -- inclusive o admin que so mexe no sistema. */
function podeEmitir(doc, emissor) {
  if (!ehEmitidoPelaProfissional(doc && doc.type)) return { ok: true };
  const e = emissor || {};
  if (!String(e.nome || '').trim()) {
    return { ok: false, status: 409, error: 'Quem emite precisa estar identificado.' };
  }
  if (!String(e.conselho || '').trim() || !String(e.numero || '').trim()) {
    return { ok: false, status: 409,
      error: 'Para emitir receita ou atestado, preencha o conselho e o numero de registro ' +
             'no seu cadastro (aba Usuarios).' };
  }
  return { ok: true };
}

function podeFinalizar(doc, problemas) {
  if (!doc) return { ok: false, status: 404, error: 'Documento nao encontrado.' };
  if (doc.status !== 'RASCUNHO') {
    return { ok: false, status: 409, error: 'Somente rascunho pode ser gerado para assinatura.' };
  }
  if (problemas && problemas.length) {
    return { ok: false, status: 400, error: problemas[0].erro, problemas: problemas };
  }
  return { ok: true };
}

function podeAssinar(doc, p) {
  p = p || {};
  if (!doc) return { ok: false, status: 404, error: 'Documento nao encontrado.' };
  if (doc.status === 'ASSINADO') return { ok: false, status: 409, error: 'Este documento ja foi assinado.' };
  if (doc.status !== 'AGUARDANDO_ASSINATURA') {
    return { ok: false, status: 409, error: 'Gere o documento para assinatura antes de assinar.' };
  }
  if (!String(p.signerName || '').trim()) {
    return { ok: false, status: 400, error: 'Informe o nome completo de quem assina.' };
  }
  const cpf = String(p.signerDocument || '').replace(/\D/g, '');
  if (cpf && cpf.length !== 11) {
    return { ok: false, status: 400, error: 'CPF deve ter 11 digitos.' };
  }
  if (!String(p.signatureImage || '').startsWith('data:image/')) {
    return { ok: false, status: 400, error: 'Assinatura em branco: peça para assinar no campo.' };
  }
  return { ok: true, cpf: cpf || null };
}

module.exports = {
  TIPOS: TIPOS, STATUS: STATUS, TIPOS_DE_CAMPO: TIPOS_DE_CAMPO, CSS: CSS,
  parseJson: parseJson, esc: esc, campos: campos, visivel: visivel,
  validar: validar, alertas: alertas,
  renderizar: renderizar, tabelaDeRespostas: tabelaDeRespostas, markdownSimples: markdownSimples,
  hashDoConteudo: hashDoConteudo, paginaCompleta: paginaCompleta,
  podeEditar: podeEditar, podeFinalizar: podeFinalizar, podeAssinar: podeAssinar,
  TIPOS_EMITIDOS: TIPOS_EMITIDOS, ehEmitidoPelaProfissional: ehEmitidoPelaProfissional,
  podeAssinarEmTela: podeAssinarEmTela, statusAoFinalizar: statusAoFinalizar,
  podeEmitir: podeEmitir
};

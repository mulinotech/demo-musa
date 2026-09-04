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

const TIPOS = ['ANAMNESE', 'TERMO_CONSENTIMENTO', 'ORIENTACAO', 'OUTRO'];
const STATUS = ['RASCUNHO', 'AGUARDANDO_ASSINATURA', 'ASSINADO', 'CANCELADO'];
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
  '@media print{body{padding:0} .naoImprimir{display:none}}'
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
  const temMarca = texto.indexOf('{{respostas}}') !== -1;
  texto = texto.replace(/\{\{respostas\}\}/g, ' RESPOSTAS ');
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

  partes.push(doc.rendered_html || '');

  if (doc.status === 'ASSINADO') {
    partes.push('<div class="assinatura">');
    if (doc.signature_image) {
      partes.push('<img src="' + esc(doc.signature_image) + '" alt="Assinatura de ' + esc(doc.signer_name) + '">');
    }
    partes.push('<p><strong>' + esc(doc.signer_name || '') + '</strong>' +
                (doc.signer_document ? '<br>CPF ' + esc(doc.signer_document) : '') + '</p>');
    partes.push('</div>');
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
  } else if (doc.status === 'AGUARDANDO_ASSINATURA') {
    partes.push('<div class="aviso">Documento gerado e aguardando assinatura. ' +
      'Código de integridade: ' + esc(doc.content_hash || '') + '</div>');
  } else if (doc.status === 'CANCELADO') {
    partes.push('<div class="aviso"><strong>Documento cancelado.</strong> ' +
      esc(doc.cancelled_reason || '') + ' O conteúdo é mantido para fins de histórico.</div>');
  }

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
  podeEditar: podeEditar, podeFinalizar: podeFinalizar, podeAssinar: podeAssinar
};

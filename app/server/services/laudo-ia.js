'use strict';
/** O texto que a IA escreve na ficha da paciente — e o que ela NÃO pode escrever.
 *
 *  Relatório de QA de 15/10, BUG-04 (bloqueador, 5 de 5 rodadas). Com a nota
 *  "teste", a IA devolvia "a avaliação digital tridimensional e o mapeamento
 *  cutâneo computadorizado revelam… Fototipo III… elastose actínica" e assinava
 *  "MÉDICO RESPONSÁVEL: Dr(a). Dermatologista — CRM/RQE". Com "sem foto, não
 *  examinada", escrevia "Ao exame clínico dermatológico…". Cabeçalho "CLÍNICA
 *  DERMATOLÓGICA" em todas as rodadas, marcas fora do catálogo, markdown cru.
 *
 *  Isso é um documento clínico inventado, com identidade médica que a clínica
 *  não tem. Três travas, cada uma pegando o que a anterior deixar passar:
 *
 *  1. ENTRADA INSUFICIENTE NÃO VAI PARA A IA. Nota de menos de 4 palavras e sem
 *     foto volta com "dados insuficientes" — não há o que descrever.
 *  2. O PROMPT proíbe achado não informado, exame que não aconteceu,
 *     diagnóstico, identidade médica e procedimento fora do catálogo; e manda a
 *     IA usar o nome da clínica.
 *  3. A LIMPEZA na saída tira markdown e derruba qualquer linha que ainda
 *     traga CRM, RQE, "médico responsável" ou especialidade médica.
 *
 *  Revisão jurídica/regulatória do texto continua recomendada antes de
 *  demonstração (está no relatório) — isto aqui é a parte técnica.
 */

const MIN_PALAVRAS = 4;

function palavras(texto) {
  return String(texto || '').trim().split(/\s+/).filter(function (p) { return /[a-zà-ú0-9]/i.test(p); });
}

/** A entrada dá para escrever alguma coisa honesta? */
function entradaSuficiente(anotacao, temFoto) {
  if (temFoto) return true;
  const p = palavras(anotacao);
  if (p.length < MIN_PALAVRAS) return false;
  if (/^(teste|test|asdf|xxx|ok)$/i.test(String(anotacao || '').trim())) return false;
  return true;
}

function instrucao(clinica, catalogo) {
  const lista = (catalogo && catalogo.length) ? catalogo.join('; ') : '(catálogo vazio)';
  return [
    'Você ajuda a equipe da clínica de estética "' + (clinica || 'a clínica') + '" a organizar uma',
    'PRÉ-AVALIAÇÃO ESTÉTICA a partir do que a profissional anotou. Você NÃO é médico, NÃO examinou a',
    'paciente e NÃO viu nada além do texto (e da foto, se houver). O texto é um RASCUNHO que a',
    'profissional responsável vai revisar.',
    '',
    'REGRAS OBRIGATÓRIAS:',
    '1. Descreva SOMENTE o que está nas anotações ou é visível na foto enviada. Não invente achados,',
    '   medidas, fototipo, biotipo, espessura de derme, idade ou histórico que não foram informados.',
    '2. Nunca diga que houve exame, "exame clínico", "exame dermatológico", "avaliação tridimensional",',
    '   "mapeamento computadorizado", dermatoscopia ou qualquer procedimento de avaliação que não aconteceu.',
    '   Escreva "segundo a anotação" ou "relato da paciente".',
    '3. Não faça diagnóstico nem liste hipóteses diagnósticas. Use "queixa", "observação", "pontos a avaliar".',
    '4. Não se identifique como médico, dermatologista, "clínica dermatológica" ou especialidade médica.',
    '   Não escreva CRM, RQE, "médico responsável" nem nome de profissional. O cabeçalho é:',
    '   "PRÉ-AVALIAÇÃO ESTÉTICA — ' + (clinica || 'Clínica') + '".',
    '5. Sugira procedimentos APENAS desta lista do catálogo da clínica, com o nome exato: ' + lista + '.',
    '   Não cite marcas comerciais nem parâmetros técnicos de aparelho (ponteiras, joules, mm).',
    '6. Se houver gestação, amamentação, uso de isotretinoína, anticoagulante, doença autoimune,',
    '   infecção ativa ou outro sinal de risco, abra o texto com "ATENÇÃO — POSSÍVEL CONTRAINDICAÇÃO:"',
    '   e oriente a não realizar o procedimento até avaliação presencial; não sugira o procedimento.',
    '7. Se as anotações não permitirem uma sugestão responsável, escreva "Dados insuficientes para',
    '   sugerir um plano — completar a anamnese presencialmente." e pare.',
    '8. Não use afirmações absolutas ("100% seguro", "resultado garantido").',
    '9. Texto simples, sem markdown: nada de **, #, tabelas. Use títulos em MAIÚSCULAS e listas com "•".',
    '',
    'ESTRUTURA: cabeçalho; DADOS INFORMADOS; OBSERVAÇÕES A PARTIR DA ANOTAÇÃO; PONTOS A CONFIRMAR NA',
    'AVALIAÇÃO PRESENCIAL; PROCEDIMENTOS DO CATÁLOGO A CONSIDERAR; CUIDADOS EM CASA; e a linha final',
    '"Rascunho gerado por IA a partir da anotação — não substitui a avaliação da profissional responsável."'
  ].join('\n');
}

const LINHA_PROIBIDA = /\b(CRM|RQE)\b|m[ée]dic[oa]\s+respons[áa]vel|especialidade\s*:?\s*dermatolog|dr\(a\)\.?\s*dermatolog/i;

/** Tira markdown e o que restar de identidade médica. Pura, para o teste. */
function limparLaudo(texto) {
  return String(texto || '')
    .split('\n')
    .filter(function (l) { return !LINHA_PROIBIDA.test(l); })
    .map(function (l) {
      return l
        .replace(/^\s{0,3}#{1,6}\s*/, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .replace(/^(\s*)[*-]\s+/, '$1• ')
        .replace(/cl[íi]nica\s+(de\s+)?dermatol[óo]gica/gi, 'clínica de estética')
        .replace(/cl[íi]nica\s+de\s+dermatologia/gi, 'clínica de estética');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { entradaSuficiente: entradaSuficiente, instrucao: instrucao, limparLaudo: limparLaudo };

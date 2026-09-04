'use strict';
/** Lembrete de compromisso por WhatsApp — T1.5, regras puras.
 *
 *  Tudo aqui é função pura: recebe dados, devolve decisão. Quem fala com o
 *  banco e com a Evolution API é `server/workers/lembretes.js`. A separação
 *  vale muito neste módulo em particular, porque o efeito colateral é uma
 *  mensagem no celular de uma paciente — não dá para "testar em produção".
 *
 *  DUAS DECISÕES QUE MUDAM O COMPORTAMENTO E MERECEM SER LIDAS
 *
 *  1. O gatilho é UM INSTANTE, não uma faixa.
 *     O desenho original mandava buscar compromissos entre agora+23h e
 *     agora+25h. Numa aplicação que dorme — e esta dorme: o LiteSpeed recicla
 *     o processo Node quando ninguém acessa — a faixa é uma armadilha. Se o
 *     processo ficar três horas parado, os compromissos cuja faixa passou
 *     nesse intervalo NUNCA recebem lembrete, e ninguém fica sabendo. Aqui a
 *     regra é "já passou do momento de enviar e ainda não enviei": um
 *     despertar tardio manda o lembrete atrasado, que é infinitamente melhor
 *     do que não mandar.
 *
 *  2. Resposta é comparada INTEIRA, nunca "contém".
 *     "1" confirma. "1 hora antes dá?" não confirma nada — é uma pergunta.
 *     Procurar o dígito dentro do texto marcaria essa paciente como
 *     confirmada e a clínica seguraria um horário que ninguém garantiu.
 *     Texto livre não é interpretado: vira atendimento humano.
 */

/* Janela civilizada de envio. Ninguém recebe mensagem de clínica às 3 da
 * manhã — e uma clínica que faz isso perde a paciente, não ganha a
 * confirmação. */
const JANELA = { de: 8, ate: 20 };
const ANTECEDENCIA_H = 24;

const TEMPLATE_PADRAO =
  'Ola {paciente}! Passando para lembrar do seu horario na Dra. Musa: ' +
  '{procedimento}, {data} as {hora}, com {profissional}.\n\n' +
  'Responda 1 para confirmar ou 2 se precisar remarcar.';

/* ------------------------------------------------------------ tempo */

/** 'AAAA-MM-DD HH:MM:SS' (ou Date) -> Date em hora LOCAL.
 *  O `T` é obrigatório: sem ele o Safari devolve Invalid Date. */
function instante(v) {
  if (v instanceof Date) return v;
  return new Date(String(v).replace(' ', 'T'));
}

function texto(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
         ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

/** Quando o lembrete deste compromisso deve sair.
 *
 *  Vinte e quatro horas antes, empurrado para dentro da janela civilizada.
 *  Empurrar para TRÁS e não para frente é deliberado: um lembrete que sai
 *  antes da hora continua servindo; um que sai depois compete com a paciente
 *  já a caminho — ou já em casa, tendo faltado. */
function momentoDeEnvio(startsAt, op) {
  op = op || {};
  const janela = op.janela || JANELA;
  const horas = op.antecedenciaH == null ? ANTECEDENCIA_H : Number(op.antecedenciaH);

  const inicio = instante(startsAt);
  if (isNaN(inicio)) return null;

  const d = new Date(inicio.getTime() - horas * 3600000);

  if (d.getHours() < janela.de) {
    // Cedo demais: o último instante válido é o fim da janela do dia anterior.
    d.setDate(d.getDate() - 1);
    d.setHours(janela.ate, 0, 0, 0);
  } else if (d.getHours() > janela.ate || (d.getHours() === janela.ate && (d.getMinutes() || d.getSeconds()))) {
    // Tarde demais: recua para o fim da janela do próprio dia.
    d.setHours(janela.ate, 0, 0, 0);
  }
  return texto(d);
}

/* -------------------------------------------------------- a decisão */

const STATUS_QUE_RECEBEM = ['AGENDADO', 'CONFIRMADO'];

/** Decide se ESTE compromisso recebe lembrete AGORA, e diz por quê quando não.
 *  O motivo não é enfeite: é o que a tela de prévia mostra, e é o que evita a
 *  pergunta "por que a fulana não recebeu?" virar investigação no banco. */
function deveEnviar(c, agora, op) {
  if (!c) return { enviar: false, motivo: 'compromisso inexistente' };
  if (c.kind === 'BLOQUEIO') return { enviar: false, motivo: 'bloqueio de horario' };
  if (STATUS_QUE_RECEBEM.indexOf(c.status) === -1) {
    return { enviar: false, motivo: 'status ' + String(c.status).toLowerCase() };
  }
  if (c.reminder_sent_at) return { enviar: false, motivo: 'lembrete ja enviado' };
  if (!String(c.phone || '').replace(/\D/g, '')) {
    return { enviar: false, motivo: 'paciente sem telefone' };
  }

  const momento = momentoDeEnvio(c.starts_at, op);
  if (!momento) return { enviar: false, motivo: 'data invalida' };

  const ag = instante(agora);
  const inicio = instante(c.starts_at);

  // Depois da hora marcada não existe lembrete, existe cobrança.
  if (ag >= inicio) return { enviar: false, motivo: 'horario ja passou', momento: momento };
  if (ag < instante(momento)) return { enviar: false, motivo: 'ainda cedo', momento: momento };

  // Atrasado quer dizer que o processo esteve dormindo. Vai assim mesmo, mas
  // fica registrado — é o sintoma de que o disparo externo parou de rodar.
  const atraso = Math.round((ag - instante(momento)) / 60000);
  return { enviar: true, momento: momento, atrasadoMin: atraso > 30 ? atraso : 0 };
}

/* ----------------------------------------------------------- texto */

function dataBR(v) {
  const d = instante(v);
  if (isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getDate()) + '/' + p(d.getMonth() + 1);
}

function horaBR(v) {
  const d = instante(v);
  if (isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes());
}

/** Preenche o template. Variável desconhecida fica como está — some sozinha
 *  seria pior: ninguém descobre o erro de digitação até a paciente receber
 *  uma frase pela metade. */
function montarMensagem(template, c) {
  const t = String(template || TEMPLATE_PADRAO);
  const valores = {
    paciente: primeiroNome(c.client_name),
    procedimento: c.title || 'seu atendimento',
    data: dataBR(c.starts_at),
    hora: horaBR(c.starts_at),
    profissional: primeiroNome(c.professional_name) || 'nossa equipe'
  };
  return t.replace(/\{(paciente|procedimento|data|hora|profissional)\}/g, function (_, chave) {
    return valores[chave] == null ? '' : String(valores[chave]);
  });
}

function primeiroNome(nome) {
  const s = String(nome || '').trim();
  return s ? s.split(/\s+/)[0] : '';
}

/* ------------------------------------------------------- a resposta */

function normalizar(t) {
  return String(t || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // tira acento
    .toLowerCase()
    .replace(/[.!,;:)\]}"'\s]+$/g, '')                  // pontuacao no fim
    .replace(/^[\s(\[{"']+/g, '')
    .trim();
}

const CONFIRMA = ['1', 'confirmar', 'confirmo', 'confirmado', 'confirmada', 'sim', 'ok', 'esta confirmado'];
const REMARCA = ['2', 'remarcar', 'reagendar', 'preciso remarcar', 'quero remarcar'];

/** Interpreta a resposta ao lembrete. Devolve null para QUALQUER coisa que não
 *  seja exatamente uma das respostas previstas — inclusive frases que contêm
 *  "1" ou "sim" no meio. Nesses casos o fluxo normal de atendimento humano
 *  continua, que é o certo: a pessoa está falando, não apertando um botão. */
function interpretarResposta(txt) {
  const t = normalizar(txt);
  if (!t) return null;
  if (CONFIRMA.indexOf(t) !== -1) return 'CONFIRMAR';
  if (REMARCA.indexOf(t) !== -1) return 'REMARCAR';
  return null;
}

module.exports = {
  JANELA: JANELA,
  ANTECEDENCIA_H: ANTECEDENCIA_H,
  TEMPLATE_PADRAO: TEMPLATE_PADRAO,
  instante: instante,
  momentoDeEnvio: momentoDeEnvio,
  deveEnviar: deveEnviar,
  montarMensagem: montarMensagem,
  interpretarResposta: interpretarResposta,
  normalizar: normalizar,
  dataBR: dataBR,
  horaBR: horaBR
};

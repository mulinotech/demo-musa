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
const ANTECEDENCIA_H = 26;

/* ============================================ A RÉGUA DE TRÊS DISPAROS (M6.7)
 *
 * A clínica pediu, nestas palavras: 26 h antes pedir confirmação; **2 h** depois
 * do 1º, se não houve resposta, lembrar que há uma profissional reservada
 * exclusivamente para aquele horário; **4 h** depois do 2º, se ainda não houve
 * resposta, avisar que o horário está cancelado e se colocar à disposição.
 *
 * As esperas são CONTADAS DO ENVIO ANTERIOR, não do horário do atendimento.
 * Contar do atendimento parece equivalente e não é: um envio empurrado para
 * dentro da janela civilizada (ver `JANELA`) sai mais cedo ou mais tarde do que
 * a conta previa, e a partir daí as três mensagens se amontoariam na mesma hora
 * — ou a terceira sairia ANTES da segunda. O que a paciente recebe tem de ter
 * intervalo de verdade entre uma mensagem e outra.
 */
const ESPERA_H = { 2: 2, 3: 4 };
const ULTIMA_ETAPA = 3;

const TEMPLATE_PADRAO =
  'Ola {paciente}! Passando para lembrar do seu horario na Dra. Musa: ' +
  '{procedimento}, {data} as {hora}, com {profissional}.\n\n' +
  'Responda 1 para confirmar ou 2 se precisar remarcar.';

/* A SEGUNDA MENSAGEM diz por que a confirmação importa, em vez de repetir o
 * pedido. Repetir a primeira soa a sistema quebrado; dizer que existe uma
 * profissional com aquela hora bloqueada é a informação que faz a pessoa
 * responder — e é verdade, que é o que separa isto de pressão inventada. */
const TEMPLATE_COBRANCA =
  'Oi {paciente}, tudo bem? Ate agora nao recebemos sua confirmacao nem um ' +
  'pedido de remarcacao para {procedimento}, {data} as {hora}.\n\n' +
  'Temos uma profissional reservada exclusivamente para te atender nesse ' +
  'horario.\n\nResponda 1 para confirmar ou 2 se precisar remarcar.';

/* A TERCEIRA INFORMA UM FATO CONSUMADO, e por isso o worker só a envia depois
 * de cancelar de verdade no banco. Mandar "esta cancelado" e deixar o horario
 * ocupado seria a clinica mentindo por escrito -- e a paciente aparecendo. */
const TEMPLATE_CANCELAMENTO =
  '{paciente}, como nao recebemos confirmacao nem pedido de remarcacao, o ' +
  'horario de {data} as {hora} foi cancelado.\n\n' +
  'Seguimos a disposicao para agendar em outra data que fique melhor para ' +
  'voce -- e so responder por aqui. 🌸';

const TEMPLATES = { 1: TEMPLATE_PADRAO, 2: TEMPLATE_COBRANCA, 3: TEMPLATE_CANCELAMENTO };

/** O texto desta etapa: o que a clínica escreveu, ou o padrão.
 *  A etapa 1 continua lendo `cfg.template`, que é o campo que a tela sempre
 *  ofereceu — renomeá-lo apagaria o texto que as clínicas já escreveram. */
function templateDaEtapa(cfg, etapa) {
  cfg = cfg || {};
  if (etapa === 1) return cfg.template || TEMPLATE_PADRAO;
  if (etapa === 2) return cfg.templateCobranca || TEMPLATE_COBRANCA;
  if (etapa === 3) return cfg.templateCancelamento || TEMPLATE_CANCELAMENTO;
  return TEMPLATE_PADRAO;
}

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

/** Quando sai a COBRANÇA da etapa seguinte: N horas depois do último envio,
 *  empurrada para dentro da janela civilizada — mas para FRENTE.
 *
 *  Esta é a diferença que justifica a função existir em vez de reusar
 *  `momentoDeEnvio` com outro argumento. Lá, um horário fora da janela recua:
 *  um lembrete que sai antes da hora continua servindo. Aqui, recuar colocaria
 *  a cobrança ANTES da mensagem que ela cobra — a paciente receberia "ainda não
 *  recebemos sua confirmação" antes do pedido de confirmação.
 *
 *  Então a cobrança que cairia às 22 h espera as 8 h do dia seguinte. Chega
 *  atrasada, e atrasada é a única forma de chegar certa. */
function momentoDaCobranca(ultimoEnvio, horas, op) {
  op = op || {};
  const janela = op.janela || JANELA;
  const base = instante(ultimoEnvio);
  if (isNaN(base)) return null;

  const d = new Date(base.getTime() + Number(horas) * 3600000);

  if (d.getHours() < janela.de) {
    d.setHours(janela.de, 0, 0, 0);
  } else if (d.getHours() > janela.ate ||
             (d.getHours() === janela.ate && (d.getMinutes() || d.getSeconds()))) {
    d.setDate(d.getDate() + 1);
    d.setHours(janela.de, 0, 0, 0);
  }
  return texto(d);
}

/* -------------------------------------------------------- a decisão */

const STATUS_QUE_RECEBEM = ['AGENDADO', 'CONFIRMADO'];

/** Em que etapa este compromisso está.
 *
 *  `reminder_sent_at` preenchido com etapa 0 significa UM compromisso que
 *  recebeu o lembrete antigo e que a migration 044 não alcançou — uma linha
 *  criada entre o ALTER e o UPDATE, ou um banco onde a 044 ainda não rodou.
 *  Ele conta como etapa 1. Contar como 0 faria a régua mandar o primeiro
 *  lembrete de novo para quem já o recebeu, e é a repetição que a paciente
 *  lê como "esse consultório está com problema". */
function etapaAtual(c) {
  const n = Number(c && c.reminder_stage);
  const jaSaiuUm = !!(c && c.reminder_sent_at);
  if (!isFinite(n) || n < 0) return jaSaiuUm ? 1 : 0;
  if (n === 0 && jaSaiuUm) return 1;
  return Math.min(n, ULTIMA_ETAPA);
}

/** Decide se ESTE compromisso recebe mensagem AGORA, em que etapa, e diz por
 *  quê quando não. O motivo não é enfeite: é o que a tela de prévia mostra, e é
 *  o que evita a pergunta "por que a fulana não recebeu?" virar investigação no
 *  banco.
 *
 *  ============================================ O QUE PARA A RÉGUA, E POR QUÊ
 *
 *  - **`reminder_reply_at` preenchido.** A paciente escreveu alguma coisa. Não
 *    interessa o quê: qualquer texto dela é assunto de gente, e cobrar quem
 *    acabou de responder é o jeito mais rápido de perder a paciente. O webhook
 *    carimba essa coluna em toda mensagem recebida de quem tem lembrete aberto,
 *    e não só no "1" e no "2" — era esse o buraco que cancelaria o horário de
 *    quem respondeu "posso chegar 10 minutos depois?".
 *  - **status CONFIRMADO.** Confirmou, por WhatsApp ou pelo balcão. A etapa 1
 *    ainda sai para ela (é lembrete, e lembrete serve para quem vem); as etapas
 *    2 e 3 não, porque são cobrança de uma resposta que já veio.
 *  - **o horário já passou.** Depois da hora marcada não existe lembrete,
 *    existe cobrança. */
function deveEnviar(c, agora, op) {
  if (!c) return { enviar: false, motivo: 'compromisso inexistente' };
  if (c.kind === 'BLOQUEIO') return { enviar: false, motivo: 'bloqueio de horario' };
  if (STATUS_QUE_RECEBEM.indexOf(c.status) === -1) {
    return { enviar: false, motivo: 'status ' + String(c.status).toLowerCase() };
  }
  if (!String(c.phone || '').replace(/\D/g, '')) {
    return { enviar: false, motivo: 'paciente sem telefone' };
  }

  const feita = etapaAtual(c);
  const proxima = feita + 1;

  if (feita >= ULTIMA_ETAPA) {
    return { enviar: false, etapa: feita, motivo: 'regua concluida' };
  }
  if (feita >= 1 && c.reminder_reply_at) {
    return { enviar: false, etapa: feita, motivo: 'paciente ja respondeu' };
  }
  if (feita >= 1 && c.status === 'CONFIRMADO') {
    return { enviar: false, etapa: feita, motivo: 'ja confirmado' };
  }

  let momento;
  if (proxima === 1) {
    momento = momentoDeEnvio(c.starts_at, op);
  } else {
    /* Sem `reminder_last_at` não há de onde contar a espera. Acontece com linha
     * antiga que a migration 044 não alcançou; a régua para, em vez de inventar
     * uma base e cobrar na hora errada. */
    const base = c.reminder_last_at || c.reminder_sent_at;
    if (!base) return { enviar: false, etapa: feita, motivo: 'sem registro do envio anterior' };
    const espera = (op && op.esperaH && op.esperaH[proxima]) || ESPERA_H[proxima];
    momento = momentoDaCobranca(base, espera, op);
  }
  if (!momento) return { enviar: false, etapa: feita, motivo: 'data invalida' };

  const ag = instante(agora);
  const inicio = instante(c.starts_at);
  if (isNaN(inicio)) return { enviar: false, etapa: feita, motivo: 'data invalida' };

  if (ag >= inicio) return { enviar: false, etapa: feita, motivo: 'horario ja passou', momento: momento };
  if (ag < instante(momento)) return { enviar: false, etapa: feita, motivo: 'ainda cedo', momento: momento };

  // Atrasado quer dizer que o processo esteve dormindo. Vai assim mesmo, mas
  // fica registrado — é o sintoma de que o disparo externo parou de rodar.
  const atraso = Math.round((ag - instante(momento)) / 60000);
  return { enviar: true, etapa: proxima, cancela: proxima === ULTIMA_ETAPA,
           momento: momento, atrasadoMin: atraso > 30 ? atraso : 0 };
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
  ESPERA_H: ESPERA_H,
  ULTIMA_ETAPA: ULTIMA_ETAPA,
  TEMPLATE_PADRAO: TEMPLATE_PADRAO,
  TEMPLATE_COBRANCA: TEMPLATE_COBRANCA,
  TEMPLATE_CANCELAMENTO: TEMPLATE_CANCELAMENTO,
  TEMPLATES: TEMPLATES,
  templateDaEtapa: templateDaEtapa,
  momentoDaCobranca: momentoDaCobranca,
  etapaAtual: etapaAtual,
  instante: instante,
  momentoDeEnvio: momentoDeEnvio,
  deveEnviar: deveEnviar,
  montarMensagem: montarMensagem,
  interpretarResposta: interpretarResposta,
  normalizar: normalizar,
  dataBR: dataBR,
  horaBR: horaBR
};

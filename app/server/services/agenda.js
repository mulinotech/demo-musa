'use strict';
/** Agenda — regras de calendário (T1.1 e T1.2).
 *
 *  Funções puras: recebem compromissos e devolvem decisões. A rota busca do
 *  banco e pergunta aqui. Os três caminhos que precisam da regra de conflito —
 *  criar, editar e reagendar — usam a mesma função, e é por isso que ela não
 *  mora dentro de nenhum handler.
 *
 *  A REGRA QUE MAIS SE ERRA: dois compromissos que se ENCOSTAM não conflitam.
 *  Um termina 10:00, o outro começa 10:00 — a agenda inteira de uma clínica é
 *  feita disso. Usar `<=` no lugar de `<` transforma um dia normal de trabalho
 *  numa sequência de erros de conflito, e é o tipo de coisa que ninguém percebe
 *  em revisão de código porque a expressão "parece" certa.
 *
 *  A outra: ao editar, o compromisso não pode conflitar consigo mesmo.
 */

const STATUS_QUE_NAO_OCUPAM = ['CANCELADO', 'FALTOU'];
const GRADE_MIN = 15;

/** Aceita Date ou string; devolve minutos desde a época, para comparar sem
 *  depender de fuso — a clínica é uma só e trabalha em horário local. */
function instante(v) {
  if (v === null || v === undefined || v === '') return NaN;
  if (v instanceof Date) return v.getTime();
  const t = new Date(String(v).replace(' ', 'T')).getTime();
  return isNaN(t) ? NaN : t;
}

function ocupa(compromisso) {
  return STATUS_QUE_NAO_OCUPAM.indexOf(compromisso.status) === -1;
}

/** R1 — dois intervalos se sobrepõem?
 *  Encostar NÃO é sobrepor: por isso `<` dos dois lados. */
function sobrepoe(aInicio, aFim, bInicio, bFim) {
  return aInicio < bFim && aFim > bInicio;
}

/**
 * R1 — conflito de horário do mesmo profissional.
 *
 * @param {object} novo        { id?, professionalId, startsAt, endsAt }
 * @param {Array}  existentes  compromissos do mesmo profissional
 * @returns {null|object}      o compromisso conflitante, ou null
 */
function conflito(novo, existentes) {
  const inicio = instante(novo.startsAt);
  const fim = instante(novo.endsAt);
  if (isNaN(inicio) || isNaN(fim)) return null;

  for (const c of existentes || []) {
    // Editar um compromisso nao pode conflitar com ele mesmo.
    if (novo.id && c.id === novo.id) continue;
    if (String(c.professional_id || c.professionalId) !== String(novo.professionalId)) continue;
    if (!ocupa(c)) continue;
    if (sobrepoe(inicio, fim, instante(c.starts_at || c.startsAt), instante(c.ends_at || c.endsAt))) {
      return c;
    }
  }
  return null;
}

/** Validação de um compromisso antes de gravar. Devolve null se está tudo bem,
 *  ou { status, error } pronto para a rota responder. */
function validar(novo, existentes) {
  const inicio = instante(novo.startsAt);
  const fim = instante(novo.endsAt);
  if (isNaN(inicio) || isNaN(fim)) {
    return { status: 400, error: 'Informe o inicio e o fim do compromisso.' };
  }
  if (fim <= inicio) {
    return { status: 400, error: 'O fim do compromisso precisa ser depois do inicio.' };
  }
  if ((fim - inicio) > 12 * 3600 * 1000) {
    return { status: 400, error: 'Um compromisso nao pode passar de 12 horas.' };
  }
  if (!novo.professionalId) {
    return { status: 400, error: 'Escolha o profissional responsavel.' };
  }
  const c = conflito(novo, existentes);
  if (c) {
    return {
      status: 409,
      error: 'Este profissional ja tem "' + (c.title || 'outro compromisso') + '" nesse horario.',
      conflito: { id: c.id, title: c.title, startsAt: c.starts_at || c.startsAt, endsAt: c.ends_at || c.endsAt }
    };
  }
  return null;
}

/* --------------------------------------------------------------- R4 */

function paraMinutos(hhmm) {
  const p = String(hhmm).split(':');
  return Number(p[0]) * 60 + Number(p[1] || 0);
}

function paraHora(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/** Minutos desde a meia-noite daquele dia, para um DATETIME. */
function minutoDoDia(valor, data) {
  const t = instante(valor);
  if (isNaN(t)) return null;
  const base = new Date(String(data) + 'T00:00:00').getTime();
  return Math.round((t - base) / 60000);
}

/**
 * R4 — janelas livres de um profissional numa data.
 *
 * Parte da grade semanal, subtrai o que está ocupado e devolve só as janelas
 * onde a duração pedida cabe. Alinhado em grade de 15 minutos, porque horário
 * de clínica é 09:00, 09:15, 09:30 — e não 09:07.
 *
 * @param {object} p
 * @param {string} p.data          'AAAA-MM-DD'
 * @param {Array}  p.grade         [{ start_time, end_time }] daquele dia da semana
 * @param {Array}  p.compromissos  compromissos do profissional naquele dia
 * @param {number} p.duracaoMin    duração desejada
 */
function janelasLivres(p) {
  p = p || {};
  const duracao = Number(p.duracaoMin) || 60;
  if (duracao <= 0) return [];

  const ocupados = (p.compromissos || [])
    .filter(ocupa)
    .map(function (c) {
      return {
        de: minutoDoDia(c.starts_at || c.startsAt, p.data),
        ate: minutoDoDia(c.ends_at || c.endsAt, p.data)
      };
    })
    .filter(function (o) { return o.de !== null && o.ate !== null && o.ate > o.de; })
    .sort(function (a, b) { return a.de - b.de; });

  const saida = [];
  for (const faixa of p.grade || []) {
    let cursor = paraMinutos(faixa.start_time || faixa.startTime);
    const fimFaixa = paraMinutos(faixa.end_time || faixa.endTime);

    const dentro = ocupados.filter(function (o) { return o.ate > cursor && o.de < fimFaixa; });
    for (const o of dentro) {
      if (o.de - cursor >= duracao) saida.push([cursor, o.de]);
      cursor = Math.max(cursor, o.ate);
    }
    if (fimFaixa - cursor >= duracao) saida.push([cursor, fimFaixa]);
  }

  // Uma janela de 09:00 as 12:00 com duracao de 60 vira tres horarios
  // oferecidos, nao um intervalo abstrato: quem marca escolhe um horario.
  const horarios = [];
  for (const [de, ate] of saida) {
    const primeiro = Math.ceil(de / GRADE_MIN) * GRADE_MIN;
    for (let m = primeiro; m + duracao <= ate; m += GRADE_MIN) {
      horarios.push({ inicio: paraHora(m), fim: paraHora(m + duracao) });
    }
  }
  return horarios;
}

/** Mapeia o status legado de treatment_sessions para o status de agenda.
 *  PENDENTE nao vira compromisso: sessao prevista nao e horario marcado. */
const STATUS_LEGADO = {
  REALIZADA: 'REALIZADO',
  AGENDADA: 'AGENDADO',
  FALTOU: 'FALTOU',
  CANCELADA: 'CANCELADO',
  REAGENDADA: 'CANCELADO'
};

function statusDaSessao(legado) {
  return STATUS_LEGADO[String(legado || '').toUpperCase()] || null;
}

module.exports = {
  conflito,
  validar,
  sobrepoe,
  janelasLivres,
  statusDaSessao,
  ocupa,
  instante,
  paraHora,
  paraMinutos,
  GRADE_MIN,
  STATUS_QUE_NAO_OCUPAM
};

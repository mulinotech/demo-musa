'use strict';
/** As sessões programadas viram horário na agenda (M6.3, 24/09).
 *
 *  ===================================================== POR QUE ISTO EXISTE
 *
 *  Item do bloco de Agenda do PDF de 19/09: *"a sessão da ficha tem que
 *  aparecer na agenda"*. Desde a M5.12 o plano PROGRAMA as datas — dez sessões,
 *  dez datas, calculadas pelo ritmo. Mas programar não é agendar: a data ficava
 *  na ficha da paciente e a agenda da clínica não sabia dela.
 *
 *  Na prática isso significava que a recepção marcava as dez sessões à mão, uma
 *  a uma, relendo as datas da outra tela — ou não marcava, e a sala aparecia
 *  livre num dia que já tinha dona.
 *
 *  ============================== POR QUE PROGRAMAR E AGENDAR SÃO DUAS COISAS
 *
 *  Uma data não é um compromisso. Compromisso tem **hora**, tem
 *  **profissional** e ocupa uma sala — e nada disso o ritmo do tratamento sabe.
 *  Por isso a hora e o profissional são perguntados uma vez, aqui, e valem para
 *  a série: é o que a clínica faz de verdade quando vende um protocolo de dez
 *  sessões ("toda terça às 9h, com a Carla").
 *
 *  ========================================= O QUE ESTA REGRA SE RECUSA A FAZER
 *
 *  **Não agenda sessão que já aconteceu.** `REALIZADA`, `FALTOU`, `CANCELADA` e
 *  `REAGENDADA` são fatos sobre o passado — a mesma lista congelada da M5.12.
 *
 *  **Não agenda data que já passou.** Criar compromisso para a terça retrasada
 *  encheria o histórico da agenda de atendimentos que nunca existiram, e o
 *  relatório do mês passado mudaria depois de fechado.
 *
 *  **Não agenda de novo o que já está agendado.** A sessão que aponta para um
 *  compromisso é pulada; sem isso, clicar duas vezes criaria a segunda linha na
 *  agenda para o mesmo tratamento — a mesma duplicata da M6.2, em outra tela.
 *
 *  **Não empurra nada para o dia seguinte quando o horário está ocupado.** O
 *  conflito é DITO, com o nome do que já está lá, e aquela sessão fica sem
 *  compromisso. Mover sozinho o horário de uma paciente é decisão de gente: a
 *  clínica pode preferir outro profissional, outra hora, ou remarcar a própria
 *  sessão. O que não pode é o sistema escolher e não contar.
 *
 *  Este arquivo é puro: recebe as sessões e devolve os horários. Quem fala com
 *  o banco é a rota, e é lá que o conflito é medido contra a agenda de verdade.
 */

const CONGELADAS = ['REALIZADA', 'FALTOU', 'CANCELADA', 'REAGENDADA'];

/** "09:00" -> 540. Devolve `null` para o que não é hora. */
function minutosDaHora(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function doisDigitos(n) {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM-DD' + minutos -> 'YYYY-MM-DD HH:MM:SS'.
 *
 *  A soma é feita em MINUTOS e o dia só avança se precisar -- e não com
 *  `new Date`, que aplicaria o fuso do servidor a uma data que é local da
 *  clínica. Uma sessão às 23h30 com uma hora de duração termina no dia
 *  seguinte, e isso é conta de calendário, não de relógio de servidor. */
function carimbo(data, minutos) {
  const dia = String(data).slice(0, 10);
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!partes) return null;
  let m = minutos;
  let d = new Date(Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3])));
  while (m >= 1440) { m -= 1440; d = new Date(d.getTime() + 86400000); }
  return d.getUTCFullYear() + '-' + doisDigitos(d.getUTCMonth() + 1) + '-' +
    doisDigitos(d.getUTCDate()) + ' ' + doisDigitos(Math.floor(m / 60)) + ':' +
    doisDigitos(m % 60) + ':00';
}

/** Quais sessões viram compromisso, e em que horário.
 *
 *  @param {object} p  { sessoes, hora, duracaoMin, hoje }
 *     sessoes    [{ id, n, status, sessionDate, appointmentId }]
 *     hoje       'YYYY-MM-DD' -- a fronteira do passado. Vem de fora para o
 *                teste poder fixá-la; sem isso ele quebraria sozinho amanhã.
 *  @returns {object} { erro } ou { marcar, pular }
 */
function horariosDasSessoes(p) {
  const o = p || {};
  const inicio = minutosDaHora(o.hora);
  if (inicio === null) {
    return { erro: 'Informe a hora no formato 09:00.' };
  }
  const duracao = Number(o.duracaoMin);
  if (!isFinite(duracao) || duracao <= 0) {
    return { erro: 'Informe quantos minutos dura a sessão.' };
  }
  if (duracao > 600) {
    // O mesmo teto de `services/duracao.js`: acima disso é erro de digitação.
    return { erro: 'Uma sessão de mais de 10 horas não é sessão — confira a duração.' };
  }

  const hoje = String(o.hoje || '').slice(0, 10);
  const sessoes = Array.isArray(o.sessoes) ? o.sessoes : [];
  const marcar = [], pular = [];

  for (const s of sessoes) {
    const dia = s.sessionDate ? String(s.sessionDate).slice(0, 10) : '';

    if (s.appointmentId) {
      pular.push({ n: s.n, porque: 'já está na agenda' });
      continue;
    }
    if (CONGELADAS.indexOf(String(s.status || '')) !== -1) {
      pular.push({ n: s.n, porque: 'já aconteceu (' + String(s.status).toLowerCase() + ')' });
      continue;
    }
    if (!dia) {
      pular.push({ n: s.n, porque: 'sem data programada' });
      continue;
    }
    if (hoje && dia < hoje) {
      pular.push({ n: s.n, porque: 'a data ' + dia + ' já passou' });
      continue;
    }

    const i = carimbo(dia, inicio);
    const f = carimbo(dia, inicio + duracao);
    if (!i || !f) {
      pular.push({ n: s.n, porque: 'a data "' + dia + '" não é uma data' });
      continue;
    }
    marcar.push({ id: s.id, n: s.n, dia: dia, inicio: i, fim: f });
  }

  return { marcar: marcar, pular: pular };
}

module.exports = { CONGELADAS, minutosDaHora, carimbo, horariosDasSessoes };

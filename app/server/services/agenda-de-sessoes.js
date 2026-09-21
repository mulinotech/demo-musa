'use strict';
/** As datas das sessões de um plano (M5.12, 21/09)
 *
 *  ===================================================== POR QUE ISTO EXISTE
 *
 *  Item 3 do bloco de Pacientes do PDF de 19/09. Plano de 10 sessões obrigava a
 *  recepção a abrir **dez janelas** e digitar **dez datas**, uma a uma.
 *
 *  E o mais incômodo é que o sistema já tinha o que precisava: o formulário do
 *  plano pergunta a **data de início** e a **periodicidade** (semanal,
 *  quinzenal, mensal), grava as duas em `treatment_plans`... e cria as dez
 *  sessões com `session_date` vazio. Os dois campos eram coletados e jogados
 *  fora na hora de fazer a única coisa que eles serviam para fazer.
 *
 *  ======================================= AS TRÊS DECISÕES DESTE ARQUIVO
 *
 *  1. **"Mensal" se ancora no dia do mês, e não na data anterior.**
 *     Começando em 31 de janeiro, as datas são 31/01, 28/02, 31/03 — e não
 *     31/01, 28/02, 28/03. Encadear a partir da data já encurtada faria o plano
 *     escorregar para trás um pouco a cada mês, e ninguém perceberia, porque
 *     cada data isolada parece certa.
 *
 *  2. **Domingo é AVISADO, nunca movido.** O sistema não sabe em que dias esta
 *     clínica abre — isso não está cadastrado em lugar nenhum. Empurrar sozinho
 *     para segunda seria inventar uma regra de funcionamento que ninguém
 *     informou; deixar passar em silêncio seria marcar paciente num dia fechado.
 *     Então as datas saem como saíram e a tela diz quais caíram em domingo.
 *
 *  3. **Isto PROGRAMA, não agenda.** O que sai daqui é a data prevista de cada
 *     sessão do plano, e não compromisso na Agenda com horário e profissional.
 *     Chamar de "agendado" o que ninguém confirmou é a mesma promessa vazia do
 *     "PACIENTE PREMIUM" — e aqui teria consequência pior, porque a paciente
 *     apareceria na porta.
 */

/** Quantos dias cada periodicidade anda. `null` = anda de mês em mês. */
const INTERVALOS = { Semanal: 7, Quinzenal: 14, Mensal: null };

/** 'AAAA-MM-DD' -> {a, m, d}, ou null se não for data. */
function partes(iso) {
  const t = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const [a, m, d] = t.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // 31 de fevereiro nao existe, e o Date aceitaria virando 03/03.
  const prova = new Date(Date.UTC(a, m - 1, d));
  if (prova.getUTCMonth() !== m - 1 || prova.getUTCDate() !== d) return null;
  return { a, m, d };
}

function paraIso(a, m, d) {
  const p = (n) => String(n).padStart(2, '0');
  return a + '-' + p(m) + '-' + p(d);
}

/** Quantos dias tem aquele mês. Fevereiro de ano bissexto incluído. */
function diasDoMes(ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** N meses depois, ancorado no DIA de origem.
 *
 *  Dia 31 num mês de 30 vira o último dia daquele mês — mas a âncora continua
 *  sendo 31, então o mês seguinte volta para 31. Ver a decisão 1. */
function somarMeses(base, quantos) {
  const total = (base.a * 12) + (base.m - 1) + quantos;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  return { a: ano, m: mes, d: Math.min(base.d, diasDoMes(ano, mes)) };
}

function somarDias(base, quantos) {
  const dt = new Date(Date.UTC(base.a, base.m - 1, base.d));
  dt.setUTCDate(dt.getUTCDate() + quantos);
  return { a: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function ehDomingo(iso) {
  const p = partes(iso);
  if (!p) return false;
  return new Date(Date.UTC(p.a, p.m - 1, p.d)).getUTCDay() === 0;
}

/** As datas previstas das sessões.
 *
 *  @param {object} e { inicio, periodicidade, total, intervaloDias }
 *  @returns {{datas: string[], avisos: string[], erro: string|null}}
 *
 *  Quando não dá para calcular, volta `erro` preenchido e `datas` vazia. Não
 *  lança: quem chama é uma tela, e tela que quebra some inteira em vez de
 *  explicar o que faltou.
 */
function datasDasSessoes(e) {
  e = e || {};
  const base = partes(e.inicio);
  const total = Number(e.total);

  if (!base) {
    return { datas: [], avisos: [], erro: 'Informe a data da primeira sessão.' };
  }
  if (!Number.isInteger(total) || total < 1) {
    return { datas: [], avisos: [], erro: 'O plano precisa ter pelo menos uma sessão.' };
  }
  if (total > 20) {
    /* O formulario ja limita em 20. A trava existe de novo aqui porque esta
       funcao tambem e chamada pelo servidor, e limite que so vive na tela nao e
       limite. */
    return { datas: [], avisos: [], erro: 'No máximo 20 sessões por plano.' };
  }

  const periodicidade = String(e.periodicidade || '').trim();
  const conhecida = Object.prototype.hasOwnProperty.call(INTERVALOS, periodicidade);
  let passoEmDias = null;

  if (conhecida) {
    passoEmDias = INTERVALOS[periodicidade];
  } else {
    /* "Customizado" -- e qualquer coisa que a clinica escreveu antes de a lista
       existir -- so programa com um intervalo em dias informado. */
    const dias = Number(e.intervaloDias);
    if (!Number.isInteger(dias) || dias < 1 || dias > 365) {
      return {
        datas: [], avisos: [],
        erro: 'Para esta periodicidade, informe de quantos em quantos dias (1 a 365).'
      };
    }
    passoEmDias = dias;
  }

  const datas = [];
  for (let i = 0; i < total; i++) {
    const p = passoEmDias === null ? somarMeses(base, i) : somarDias(base, i * passoEmDias);
    datas.push(paraIso(p.a, p.m, p.d));
  }

  const avisos = [];
  const domingos = datas.filter(ehDomingo);
  if (domingos.length) {
    avisos.push(
      (domingos.length === 1 ? '1 sessão cai' : domingos.length + ' sessões caem') +
      ' em domingo (' + domingos.join(', ') + '). ' +
      'As datas ficaram como estão — ajuste as que a clínica não atende.');
  }

  return { datas, avisos, erro: null };
}

module.exports = { INTERVALOS, partes, diasDoMes, somarMeses, somarDias, ehDomingo, datasDasSessoes };

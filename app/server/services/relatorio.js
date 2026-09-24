'use strict';
/** O relatório impresso para de inventar número (M6.4, 24/09).
 *
 *  =================================================== O QUE FOI ENCONTRADO
 *
 *  `routes/reports.js` monta o PDF que a clínica imprime e leva para reunião.
 *  Auditando as treze consultas dele, **seis dos números impressos não eram
 *  medidos** — eram constantes escritas no código, indistinguíveis dos
 *  medidos na folha impressa:
 *
 *    tempoMedioConversaoEmDias: 3.5      // "tempo padrão simulado"
 *    tempoMedioResposta: '12 minutos'
 *    satisfacaoMedia: '4.9 / 5.0'
 *    taxaRetorno: Math.round(taxaRetorno || 24)        // cai em 24%
 *    horarioPico: ... || '14:00 - 15:00'               // cai num horário
 *    alertasAniversario: (i * 5 + 3) % 28 + 1          // ver abaixo
 *
 *  O último é o pior do arquivo inteiro. **`clients` não tem data de
 *  nascimento** — a coluna não existe. O relatório listava pacientes REAIS,
 *  com nome e telefone, ao lado de aniversários calculados a partir da
 *  POSIÇÃO DELAS NA LISTA. Uma clínica que confiasse nessa página mandaria
 *  "feliz aniversário" para a paciente errada, no dia errado, com o nome
 *  certo — e o erro voltaria como constrangimento, não como bug.
 *
 *  É a mesma falha da M5.13 no laudo da IA, em outra tela: o sistema afirma o
 *  que não sabe, e a tela fica coerente.
 *
 *  ================================================= A REGRA DESTE ARQUIVO
 *
 *  **Número que não pode ser medido volta `null`, e a folha diz por quê.**
 *  Nunca um valor plausível. Um `null` que vira "não medido" no papel custa
 *  uma linha feia; um 4,9 inventado custa uma decisão tomada em cima dele.
 *
 *  Três dos seis viraram medição de verdade, porque o dado existe e ninguém
 *  tinha ido buscá-lo: tempo de resposta (de `interactions.direction`), tempo
 *  de conversão (de `leads.converted_at`, que a M5.10 criou) e horário de
 *  pico. Os outros três não têm de onde sair, e saíram da folha.
 *
 *  ======================================== POR QUE MEDIANA, E NÃO MÉDIA
 *
 *  Tempo de resposta e tempo de conversão são distribuições com cauda longa: a
 *  mensagem respondida na segunda de manhã depois de chegar na sexta à noite
 *  vale 60 horas, e três dessas levantam a MÉDIA de um mês inteiro de respostas
 *  de dez minutos. A mediana diz o que acontece num atendimento típico, que é
 *  a pergunta que a clínica está fazendo.
 */

/** O elemento do meio. Lista vazia devolve `null`, e não zero. */
function mediana(numeros) {
  const l = (numeros || []).filter((n) => typeof n === 'number' && isFinite(n))
    .slice().sort((a, b) => a - b);
  if (!l.length) return null;
  const meio = Math.floor(l.length / 2);
  return l.length % 2 ? l[meio] : (l[meio - 1] + l[meio]) / 2;
}

/** O instante, venha ele de onde vier.
 *
 *  ============================== POR QUE ISTO NÃO É `new Date(String(v))`
 *
 *  O mysql2 devolve DATETIME como **objeto Date**, e DATE_FORMAT devolve
 *  string. As duas formas chegam aqui, das duas consultas diferentes que usam
 *  este arquivo.
 *
 *  A primeira versão fazia `String(v).replace(' ', 'T')` para aceitar o formato
 *  do MySQL (`2026-09-09 10:00:00`). Num objeto Date, `String(v)` vira
 *  `"Wed Sep 09 2026 00:00:00 GMT+0000"` e o `replace` troca o PRIMEIRO espaço:
 *  sai `"WedTSep 09 ..."`, que não é data nenhuma.
 *
 *  O efeito foi silencioso e exatamente do tipo que esta tarefa veio corrigir:
 *  o tempo de conversão voltava `null` — "não medido" — com os dados presentes
 *  no banco. Apareceu no ensaio contra banco de verdade, e não no teste puro,
 *  porque o teste passava strings.
 */
function instante(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const t = new Date(String(v).replace(' ', 'T')).getTime();
  return isNaN(t) ? null : t;
}

/** Quanto a clínica demora para responder.
 *
 *  Para cada mensagem RECEBIDA sem resposta pendente, procura a próxima
 *  ENVIADA para a mesma paciente. O intervalo entre as duas é uma resposta.
 *
 *  Duas decisões:
 *
 *  - Mensagens recebidas em sequência contam UMA vez. A paciente que manda
 *    quatro mensagens seguidas e recebe uma resposta esperou uma vez, não
 *    quatro — contar quatro faria a mediana parecer melhor do que é.
 *  - Recebida sem resposta nenhuma **não entra na conta**. Ela não tem
 *    intervalo. Entra em `semResposta`, que é um número que a clínica precisa
 *    ver ainda mais do que o tempo médio.
 *
 *  @param {Array} interacoes  { clientId, direction, createdAt }, qualquer ordem
 *  @returns {object} { minutos, amostra, semResposta }
 */
function tempoDeResposta(interacoes) {
  const porPaciente = new Map();
  for (const i of (interacoes || [])) {
    const t = instante(i.createdAt || i.created_at);
    const quem = i.clientId || i.client_id;
    if (t === null || !quem) continue;
    if (!porPaciente.has(quem)) porPaciente.set(quem, []);
    porPaciente.get(quem).push({ t: t, dir: i.direction });
  }

  const esperas = [];
  let semResposta = 0;

  for (const lista of porPaciente.values()) {
    lista.sort((a, b) => a.t - b.t);
    let pendente = null;                 // a PRIMEIRA recebida ainda sem resposta
    for (const m of lista) {
      if (m.dir === 'in') {
        if (pendente === null) pendente = m.t;
      } else if (m.dir === 'out' && pendente !== null) {
        esperas.push((m.t - pendente) / 60000);
        pendente = null;
      }
    }
    if (pendente !== null) semResposta++;
  }

  const med = mediana(esperas);
  return {
    minutos: med === null ? null : Math.round(med),
    amostra: esperas.length,
    semResposta: semResposta
  };
}

/** Quantos dias o lead leva do primeiro contato até a venda fechada.
 *
 *  Sai de `leads.converted_at`, que a M5.10 criou e **não preencheu para trás**
 *  ("vínculo adivinhado é vínculo errado"). Então a amostra volta junto: uma
 *  mediana de dois leads não é a mesma informação que uma de duzentos, e a
 *  folha precisa poder dizer sobre quantos ela está falando.
 *
 *  @param {Array} leads  { date, convertedAt }
 *  @returns {object} { dias, amostra }
 */
function tempoDeConversao(leads) {
  const dias = [];
  for (const l of (leads || [])) {
    const inicio = instante(l.date);
    const fim = instante(l.convertedAt || l.converted_at);
    if (inicio === null || fim === null) continue;
    const d = (fim - inicio) / 86400000;
    /* Conversão ANTES da entrada é data errada em algum dos dois campos, e
       média com número negativo é pior do que amostra menor. */
    if (d < 0) continue;
    dias.push(d);
  }
  const med = mediana(dias);
  return { dias: med === null ? null : Math.round(med * 10) / 10, amostra: dias.length };
}

/** Os estágios do funil em que o lead ainda está sendo trabalhado, e o de
 *  venda fechada. Os mesmos nomes do Kanban. */
const FECHADO = 'arquivado';

/** Quantos dos leads do período viraram VENDA FECHADA.
 *
 *  ================================== O DEFEITO QUE ESTAVA AQUI
 *
 *  A conta antiga contava `status = 'agendado'` como convertido. No Kanban,
 *  `agendado` é a coluna **"Proposta Enviada"** — quem fechou já saiu dela e
 *  está em `arquivado`, "Venda Fechada".
 *
 *  Ou seja: a taxa de conversão do relatório contava as propostas ABERTAS e
 *  ignorava as vendas FEITAS. Uma clínica que fechasse todos os leads do mês
 *  imprimiria 0% de conversão.
 *
 *  @returns {object} { pct, fechados, total }
 */
function taxaDeConversao(leads) {
  const lista = leads || [];
  const total = lista.length;
  const fechados = lista.filter((l) => String(l.status || '') === FECHADO).length;
  return {
    pct: total ? Math.round((fechados / total) * 1000) / 10 : null,
    fechados: fechados,
    total: total
  };
}

/** A hora do dia com mais mensagens. `null` quando não houve mensagem --
 *  e não um horário plausível, que era o que a folha imprimia. */
function horarioDePico(interacoes) {
  const contagem = new Map();
  for (const i of (interacoes || [])) {
    const t = instante(i.createdAt || i.created_at);
    if (t === null) continue;
    const h = new Date(t).getHours();
    contagem.set(h, (contagem.get(h) || 0) + 1);
  }
  if (!contagem.size) return null;
  let melhor = null;
  for (const [h, n] of contagem.entries()) {
    if (!melhor || n > melhor.n || (n === melhor.n && h < melhor.hora)) melhor = { hora: h, n: n };
  }
  const dois = (n) => String(n).padStart(2, '0');
  return { hora: melhor.hora, faixa: dois(melhor.hora) + ':00 - ' + dois((melhor.hora + 1) % 24) + ':00', mensagens: melhor.n };
}

/** Quantas pacientes voltaram para um segundo plano de tratamento.
 *
 *  Sem paciente nenhuma a taxa é `null`, e não os 24% que o código antigo
 *  usava de reserva. Zero paciente não é 24% de retorno de coisa nenhuma. */
function taxaDeRetorno(pacientesComPlano, pacientesComMaisDeUm) {
  const total = Number(pacientesComPlano) || 0;
  if (!total) return { pct: null, comMaisDeUm: 0, total: 0 };
  const varios = Number(pacientesComMaisDeUm) || 0;
  return { pct: Math.round((varios / total) * 1000) / 10, comMaisDeUm: varios, total: total };
}

module.exports = {
  FECHADO, mediana, tempoDeResposta, tempoDeConversao,
  taxaDeConversao, horarioDePico, taxaDeRetorno
};

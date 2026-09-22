'use strict';
/** Quanto tempo dura um serviço, em minutos (M5.14, 22/09)
 *
 *  ===================================================== POR QUE ISTO EXISTE
 *
 *  O catálogo guarda a duração em **duas colunas**:
 *
 *      duration      VARCHAR(50)  — texto, como sempre foi
 *      duration_min  INT NULL     — minutos, criada pela migration 007
 *
 *  E só uma das duas é escrita pela tela de Cadastros: a de texto. `duration_min`
 *  foi preenchida **uma vez**, pela própria migration, e depois disso só muda
 *  quando alguém salva uma simulação na tela de Precificação.
 *
 *  ================================================ O QUE ISSO PRODUZ NA CLÍNICA
 *
 *  1. **Serviço cadastrado depois da migration nasce sem `duration_min`.** A
 *     Agenda usa essa coluna para calcular o fim do compromisso
 *     (`routes/appointments.js`): sem ela, o horário fica em aberto e a grade
 *     não sabe quanto tempo aquele atendimento ocupa.
 *
 *  2. **Pior: editar a duração não muda o que a Agenda usa.** A recepção troca
 *     "60" por "90" em Cadastros, a tela passa a mostrar 90 min — e a Agenda
 *     continua marcando 60, porque `duration_min` ficou como estava. Duas
 *     telas do mesmo sistema, dois números, nenhum aviso. É o defeito da
 *     semana inteira outra vez: o dado está certo num lugar e velho no outro,
 *     e a tela fica coerente enquanto isso.
 *
 *  3. A Precificação pede a duração de novo, mesmo já cadastrada.
 *
 *  Este arquivo é a regra que lê o texto e devolve minutos — ou **admite que
 *  não entendeu**. Ele é puro: a gravação fica em `routes/catalog.js`.
 *
 *  ============================ POR QUE NÃO HÁ UMA TRAVA SÓ PARA FAIXA
 *
 *  A primeira versão tinha uma linha extra recusando "40 a 60 minutos" antes de
 *  qualquer outra coisa. A conferência de sabotagem apagou essa linha e
 *  **nenhum teste quebrou**: todos os padrões abaixo são ancorados (`^...$`),
 *  então uma faixa já não casa com nenhum deles e cai no `null` do fim.
 *
 *  A linha saiu. Trava que não muda resultado nenhum é pior do que trava
 *  nenhuma: ela promete uma proteção que não está exercendo, e quem lê passa a
 *  confiar nela. O que protege de verdade é o teste "A FAIXA NAO VIRA NUMERO" —
 *  se alguém afrouxar uma âncora para aceitar mais uma forma de escrever, é ele
 *  que fica vermelho.
 *
 *  ========================================= POR QUE ELE PREFERE NÃO ENTENDER
 *
 *  `duration` tem conteúdo herdado irregular: há "60", há "1h30" e há
 *  **"40 a 60 minutos"**. Para uma faixa, qualquer número escolhido é chute — e
 *  esse chute vira o tamanho do compromisso na agenda de uma pessoa de verdade.
 *  Então faixa devolve `null`, e quem chama pergunta em vez de arbitrar. É a
 *  mesma escolha do `ambiguo` da M5.10 e do `legado` da M5.11.
 */

/** O teto: 10 horas. Acima disso não é duração de procedimento — é erro de
 *  digitação, e aceitar transformaria um dia inteiro de agenda em um
 *  atendimento só. */
const MAXIMO_MINUTOS = 600;

/** Minutos a partir do texto, ou `null` quando não dá para ter certeza.
 *
 *  Entende, nesta ordem:
 *    "90", "90 min", "90 minutos"     -> 90
 *    "1h", "1 hora", "2 h"            -> 60, 120
 *    "1h30", "1h 30min", "1:30"       -> 90
 *  E recusa, de propósito:
 *    "40 a 60 minutos", "30-45"       -> null  (faixa: escolher é chutar)
 *    "cerca de 1h", "meia hora"       -> null  (não é número)
 *    "0", "-30", "900"                -> null  (fora do que é duração)
 */
function minutosDe(texto) {
  if (typeof texto === 'number') return valida(texto);

  const t = String(texto == null ? '' : texto).trim().toLowerCase();
  if (!t) return null;

  // "1:30" — hora e minuto separados por dois-pontos
  let m = t.match(/^(\d{1,2})\s*:\s*([0-5]?\d)$/);
  if (m) return valida(Number(m[1]) * 60 + Number(m[2]));

  // "1h30", "1h 30min", "1 h 30 minutos"
  m = t.match(/^(\d{1,2})\s*h(?:oras?)?\s*(\d{1,2})\s*(?:m|min|minutos?)?$/);
  if (m) return valida(Number(m[1]) * 60 + Number(m[2]));

  // "1h", "2 horas"
  m = t.match(/^(\d{1,2})\s*h(?:oras?)?$/);
  if (m) return valida(Number(m[1]) * 60);

  // "90", "90 min", "90 minutos"
  m = t.match(/^(\d{1,4})\s*(?:m|min|minutos?)?$/);
  if (m) return valida(Number(m[1]));

  /* Qualquer outra coisa -- "cerca de 1h", "meia hora", "a combinar" -- fica
     sem resposta. Devolver um numero aqui seria inventar o tamanho de um
     compromisso na agenda de alguem. */
  return null;
}

function valida(n) {
  if (!Number.isFinite(n)) return null;
  const inteiro = Math.round(n);
  if (inteiro < 1 || inteiro > MAXIMO_MINUTOS) return null;
  return inteiro;
}

/** Minutos viram frase de gente: 90 -> "1 h 30 min". */
function descrever(minutos) {
  const n = valida(minutos);
  if (n === null) return '';
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (!h) return m + ' min';
  if (!m) return h + ' h';
  return h + ' h ' + m + ' min';
}

module.exports = { MAXIMO_MINUTOS, minutosDe, descrever };

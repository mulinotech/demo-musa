'use strict';
/** Sinais de contraindicação escritos em TEXTO LIVRE na ficha.
 *
 *  Relatório de QA de 15/10, BUG-17: a nota "GESTANTE 20 semanas, usa
 *  isotretinoína" estava na ficha (campo de anamnese da Skin AI) e o plano de
 *  Ultraformer foi criado sem um aviso. A Agenda só olhava a anamnese
 *  estruturada de Documentos; o texto livre não conversava com nada.
 *
 *  Isto não substitui a anamnese estruturada — é a rede que pega o que foi
 *  ESCRITO e ninguém transformou em formulário. Por isso é deliberadamente
 *  sensível: um alerta a mais custa uma confirmação; um a menos pode custar uma
 *  paciente. Negação simples ("não gestante", "nega uso de…", "sem
 *  marcapasso") não dispara.
 *
 *  Pura, para o teste conferir sem banco.
 */

const SINAIS = [
  { rotulo: 'Gestação', termos: ['gestante', 'gravida', 'gestacao', 'semanas de gestacao'] },
  { rotulo: 'Amamentação', termos: ['amamentando', 'amamenta', 'lactante', 'lactacao'] },
  { rotulo: 'Isotretinoína (Roacutan)', termos: ['isotretinoina', 'roacutan', 'roacutam'] },
  { rotulo: 'Anticoagulante', termos: ['anticoagulante', 'varfarina', 'marevan', 'rivaroxabana', 'xarelto'] },
  { rotulo: 'Marcapasso / implante metálico', termos: ['marcapasso', 'marca-passo', 'implante metalico'] },
  { rotulo: 'Doença autoimune', termos: ['autoimune', 'lupus'] },
  { rotulo: 'Infecção ou herpes ativa', termos: ['herpes ativa', 'infeccao ativa', 'lesao ativa'] },
  { rotulo: 'Quimioterapia / câncer em tratamento', termos: ['quimioterapia', 'radioterapia', 'cancer em tratamento'] },
  { rotulo: 'Alergia grave', termos: ['anafilaxia', 'alergia grave'] }
];

function normalizar(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NEGACAO = /(^| )(nao|nega|negou|sem|nunca)( [a-z]+){0,2} $/;

/** Os sinais encontrados no texto: `[{ rotulo, trecho }]`. */
function sinaisDeRisco(texto) {
  const t = ' ' + normalizar(texto) + ' ';
  const achados = [];
  for (const s of SINAIS) {
    for (const termo of s.termos) {
      let i = t.indexOf(' ' + termo);
      let achou = false;
      while (i !== -1) {
        const antes = t.slice(Math.max(0, i - 25), i + 1);
        if (!NEGACAO.test(antes)) { achou = true; break; }
        i = t.indexOf(' ' + termo, i + 1);
      }
      if (achou) {
        achados.push({ rotulo: s.rotulo, trecho: termo });
        break;
      }
    }
  }
  return achados;
}

module.exports = { sinaisDeRisco: sinaisDeRisco, SINAIS: SINAIS };

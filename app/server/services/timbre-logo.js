'use strict';
/** A imagem que vira logo do timbre (M6.2, 24/09).
 *
 *  ============================== POR QUE UM ARQUIVO SÓ PARA VALIDAR UMA IMAGEM
 *
 *  Porque o que entra aqui vai ser **impresso no papel timbrado de uma clínica
 *  de saúde** e guardado, carimbado, dentro de documentos que a paciente assina.
 *  Três coisas podem dar errado, e as três são silenciosas:
 *
 *  1. **SVG.** É o formato que a designer manda, e é o único da lista que
 *     executa código: `<svg><script>` roda quando o documento é aberto no
 *     navegador para imprimir — e o documento é aberto com os dados da paciente
 *     na tela. Recusar SVG não é excesso de zelo: é a única entrada de HTML
 *     arbitrário que este sistema teria.
 *
 *  2. **Tamanho.** O logo entra na linha da clínica e sai em toda leitura do
 *     timbre. Uma foto de 8 MB colada aqui deixa lenta a tela de emissão de
 *     todo mundo, e o sintoma aparece longe da causa.
 *
 *  3. **Data URL torta.** `data:image/png;base64,` seguido de qualquer coisa
 *     gravaria sem erro e só falharia na impressão, semanas depois, quando
 *     alguém precisasse do papel.
 *
 *  Por isso a regra é função pura e tem teste: são casos que ninguém reproduz à
 *  mão clicando na tela.
 *
 *  ========================================= O LIMITE, E POR QUE ESTE NÚMERO
 *
 *  250 KB. Um logo de clínica em PNG com 600px de largura pesa entre 20 e 80 KB;
 *  250 KB aceita com folga uma marca detalhada e recusa uma fotografia colada
 *  por engano. A tela reduz a imagem antes de enviar, então este limite quase
 *  nunca é alcançado por quem faz a coisa certa — ele existe para o outro caso.
 */

/** Os formatos que o navegador imprime e que não executam nada. */
const TIPOS = ['image/png', 'image/jpeg', 'image/webp'];

const LIMITE_BYTES = 250 * 1024;

/** Esta data URL serve de logo?
 *
 *  @returns {object} { ok, tipo, bytes, erro }
 */
function validarLogo(dataUrl) {
  const texto = String(dataUrl || '').trim();
  if (!texto) return { ok: false, erro: 'Escolha uma imagem.' };

  const m = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(texto);
  if (!m) {
    return { ok: false,
      erro: 'A imagem não chegou em formato reconhecível. Envie um arquivo PNG, JPG ou WEBP.' };
  }

  const tipo = m[1].toLowerCase();
  if (TIPOS.indexOf(tipo) === -1) {
    return { ok: false, tipo: tipo,
      erro: tipo === 'image/svg+xml'
        /* A frase diz o que fazer, e não só o que foi recusado: quem tem o logo
           em SVG tem como exportar em PNG em qualquer editor. */
        ? 'SVG não é aceito no timbre — exporte o logo como PNG e envie de novo.'
        : 'Formato não aceito (' + tipo + '). Use PNG, JPG ou WEBP.' };
  }

  const base = m[2].replace(/\s+/g, '');
  /* base64 sempre vem em blocos de 4. Um resto diferente de zero e' dado
     truncado -- grava sem erro e so falha na hora de imprimir. */
  if (base.length % 4 !== 0) {
    return { ok: false, tipo: tipo, erro: 'A imagem chegou incompleta. Tente enviar de novo.' };
  }

  const preenchimento = (base.match(/=+$/) || [''])[0].length;
  const bytes = Math.floor(base.length / 4) * 3 - preenchimento;
  if (bytes <= 0) {
    return { ok: false, tipo: tipo, erro: 'O arquivo está vazio.' };
  }
  if (bytes > LIMITE_BYTES) {
    return { ok: false, tipo: tipo, bytes: bytes,
      erro: 'A imagem tem ' + Math.round(bytes / 1024) + ' KB e o limite do timbre é ' +
            Math.round(LIMITE_BYTES / 1024) + ' KB. Use uma versão menor do logo.' };
  }

  return { ok: true, tipo: tipo, bytes: bytes, dataUrl: 'data:' + tipo + ';base64,' + base };
}

module.exports = { TIPOS, LIMITE_BYTES, validarLogo };

/**
 * O logo antes de subir (M6.2, 24/09).
 *
 * ====================================== POR QUE A IMAGEM É REDUZIDA NO NAVEGADOR
 *
 * O arquivo que a clínica tem do próprio logo é o que a designer entregou: um
 * PNG de 2000px, entre 1 e 6 MB. O timbre imprime esse logo com 18mm de altura
 * — nenhum olho, nenhuma impressora e nenhum PDF aproveitam o resto.
 *
 * Reduzir aqui resolve três coisas de uma vez: o envio deixa de ser recusado
 * pelo limite de 250 KB do servidor, a linha da clínica não engorda (ela é lida
 * em toda abertura de documento), e a pessoa não precisa saber o que é
 * "redimensionar uma imagem" para conseguir pôr a marca no papel.
 *
 * ============================================ O QUE ESTE ARQUIVO NÃO FAZ
 *
 * **Não valida.** A regra do que é um logo aceitável (formato, tamanho, a
 * recusa de SVG) vive no servidor, em `services/timbre-logo.js`, porque é lá
 * que ela protege — validação de navegador é conveniência, nunca proteção.
 *
 * Aqui é `.mjs` pelo mesmo motivo de `telefone.mjs` e `selecao.mjs`: assim a
 * suíte do servidor, que é CommonJS, consegue `import()` deste arquivo sem
 * passar pelo esbuild.
 */

/** 600px de largura: o logo sai com 18mm no papel, e 600px cobre isso com
 *  folga até em impressão de 300dpi (18mm ≈ 213px). */
export const LARGURA_MAXIMA_LOGO = 600;

/** A altura vira a proporcional — nunca uma altura fixa, que esticaria a marca. */
export function novaMedida(largura, altura, maxima) {
  const l = Number(largura) || 0;
  const a = Number(altura) || 0;
  if (l <= 0 || a <= 0) return null;
  if (l <= maxima) return { largura: l, altura: a };
  return { largura: maxima, altura: Math.max(1, Math.round((a * maxima) / l)) };
}

/** O arquivo escolhido vira uma data URL de PNG, reduzida.
 *
 *  PNG e não JPG: logo tem fundo transparente e área de cor chapada. JPG
 *  perderia a transparência (fundo preto no papel) e sujaria as bordas do
 *  desenho com artefato de compressão, que numa marca aparece.
 *
 *  Devolve `{ ok, dataUrl, erro }` — e um `erro` daqui é sempre de leitura do
 *  arquivo, nunca de regra: a regra é do servidor.
 */
export function reduzirLogo(arquivo, maxima) {
  const limite = maxima || LARGURA_MAXIMA_LOGO;
  return new Promise((resolver) => {
    if (!arquivo) return resolver({ ok: false, erro: "Escolha um arquivo." });
    const leitor = new FileReader();
    leitor.onerror = () => resolver({ ok: false, erro: "Não foi possível ler o arquivo." });
    leitor.onload = () => {
      const img = new Image();
      img.onerror = () => resolver({
        ok: false,
        erro: "O arquivo não parece ser uma imagem que o navegador saiba abrir.",
      });
      img.onload = () => {
        const m = novaMedida(img.naturalWidth, img.naturalHeight, limite);
        if (!m) return resolver({ ok: false, erro: "A imagem não tem tamanho utilizável." });
        const tela = document.createElement("canvas");
        tela.width = m.largura;
        tela.height = m.altura;
        const ctx = tela.getContext("2d");
        if (!ctx) return resolver({ ok: false, erro: "O navegador não conseguiu preparar a imagem." });
        ctx.drawImage(img, 0, 0, m.largura, m.altura);
        resolver({ ok: true, dataUrl: tela.toDataURL("image/png"), largura: m.largura, altura: m.altura });
      };
      img.src = String(leitor.result || "");
    };
    leitor.readAsDataURL(arquivo);
  });
}

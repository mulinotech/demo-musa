/**
 * Atualização automática de tela (M5.9, 21/09).
 *
 * ===================================================== POR QUE ISTO EXISTE
 *
 * O CRM não se atualizava sozinho em lugar nenhum. A mensagem da paciente
 * chegava, era gravada corretamente, e **só aparecia quando alguém recarregava
 * a página** — e a recepção não recarrega: ela deixa a tela de Atendimento
 * aberta e espera. Na prática, a conversa ficava parada na tela enquanto a
 * paciente esperava resposta do outro lado.
 *
 * Isso é primo do defeito de 18/09: o dado estava certo no banco e errado na
 * tela, e nada avisava.
 *
 * ========================================= AS TRÊS REGRAS, E POR QUE CADA UMA
 *
 * 1. **Aba escondida não consulta.** Recepção deixa o CRM aberto o dia inteiro
 *    numa aba de trás. Bater no servidor a cada 20 segundos por aba esquecida,
 *    vezes 50 clínicas, é carga inventada sem ninguém olhando.
 *
 * 2. **Voltar para a aba atualiza na hora.** É exatamente o instante em que a
 *    pessoa quer ver o que chegou; esperar o próximo ciclo faria a tela parecer
 *    velha justo quando ela é olhada.
 *
 * 3. **Uma consulta por vez.** Se a anterior não voltou, o ciclo é pulado em
 *    vez de enfileirado. Servidor lento viraria uma fila que cresce sozinha —
 *    e a tela fica mais lenta quanto mais precisa de ajuda.
 *
 * A atualização é sempre SILENCIOSA: sem "carregando", sem a tela piscar. A
 * pessoa está lendo uma conversa, e conteúdo que salta embaixo do olho é pior
 * do que conteúdo que demora 20 segundos.
 */
import { useEffect, useRef } from "react";

/**
 * @param aoAtualizar  o que buscar. Deve ser silencioso.
 * @param intervaloMs  de quanto em quanto tempo. 20 s por padrão.
 * @param ligado       permite desligar sem tirar o hook da árvore.
 */
export function useAtualizacaoAutomatica(
  aoAtualizar: () => Promise<unknown> | unknown,
  intervaloMs = 20000,
  ligado = true,
) {
  /* A função vai para uma ref: quem chama quase sempre passa uma arrow nova a
     cada render, e depender dela no useEffect recriaria o temporizador a cada
     render — o efeito colateral seria consultar muito mais do que o combinado. */
  const fn = useRef(aoAtualizar);
  fn.current = aoAtualizar;

  useEffect(() => {
    if (!ligado) return;
    let vivo = true;
    let rodando = false;

    const rodar = async () => {
      if (!vivo || rodando) return;                    // regra 3
      if (typeof document !== "undefined" && document.hidden) return;   // regra 1
      rodando = true;
      try {
        await fn.current();
      } catch {
        /* Falha de rede não pode derrubar o ciclo: a próxima tentativa vem em
           20 segundos, e é assim que a tela se recupera de uma queda curta. */
      } finally {
        rodando = false;
      }
    };

    const id = window.setInterval(rodar, intervaloMs);

    const aoVoltar = () => { if (!document.hidden) rodar(); };          // regra 2
    document.addEventListener("visibilitychange", aoVoltar);

    return () => {
      vivo = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [intervaloMs, ligado]);
}

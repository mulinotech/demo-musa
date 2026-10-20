/**
 * Caixas de diálogo DO SISTEMA, no lugar das janelas nativas do navegador
 * (relatório de QA de 15/10, UX-02).
 *
 * `window.confirm`, `window.prompt` e `alert()` param a aba inteira, não seguem
 * a identidade visual e — o que pesou no relatório — travaram a automação de
 * testes na primeira rodada, em "Gerar para assinatura". Estas três funções têm
 * o mesmo uso (uma linha, com `await`) e desenham um cartão do próprio CRM.
 *
 * Não precisam de provider: cada chamada monta o cartão num nó próprio e o
 * desmonta ao responder.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";

type Pedido =
  | { tipo: "confirmar"; texto: string; ok: string; perigo?: boolean }
  | { tipo: "texto"; texto: string; ok: string; obrigatorio?: boolean; valor?: string }
  | { tipo: "aviso"; texto: string; ok: string };

function abrir<T>(pedido: Pedido): Promise<T> {
  return new Promise((resolver) => {
    const no = document.createElement("div");
    document.body.appendChild(no);
    const raiz = createRoot(no);
    const fechar = (v: T) => {
      raiz.unmount();
      no.remove();
      resolver(v);
    };
    raiz.render(<Cartao pedido={pedido} aoFechar={fechar as (v: unknown) => void} />);
  });
}

function Cartao({ pedido, aoFechar }: { pedido: Pedido; aoFechar: (v: unknown) => void }) {
  const [valor, setValor] = useState(pedido.tipo === "texto" ? pedido.valor || "" : "");
  const faltaTexto = pedido.tipo === "texto" && pedido.obrigatorio && !valor.trim();
  const cancelar = () => aoFechar(pedido.tipo === "confirmar" ? false : pedido.tipo === "texto" ? null : undefined);
  const aceitar = () => {
    if (faltaTexto) return;
    aoFechar(pedido.tipo === "confirmar" ? true : pedido.tipo === "texto" ? valor.trim() : undefined);
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[200] bg-brand-brown/40 backdrop-blur-xs flex items-center justify-center p-4"
      onKeyDown={(e) => { if (e.key === "Escape") cancelar(); }}
    >
      <div className="bg-white border border-brand-gold/30 rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4">
        <p className="text-sm text-brand-brown whitespace-pre-line leading-relaxed">{pedido.texto}</p>
        {pedido.tipo === "texto" && (
          <textarea
            autoFocus
            rows={3}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); aceitar(); } }}
            className="w-full p-2.5 rounded-xl border border-brand-gold/30 text-xs text-brand-brown focus:outline-none focus:ring-2 focus:ring-brand-gold"
          />
        )}
        <div className="flex justify-end gap-2">
          {pedido.tipo !== "aviso" && (
            <button onClick={cancelar} className="px-4 py-2 text-xs font-medium text-brand-brown/70 cursor-pointer">
              Cancelar
            </button>
          )}
          <button
            autoFocus={pedido.tipo !== "texto"}
            onClick={aceitar}
            disabled={!!faltaTexto}
            className={
              "px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50 " +
              (pedido.tipo === "confirmar" && pedido.perigo ? "bg-red-600 text-white" : "bg-brand-brown text-brand-beige")
            }
          >
            {pedido.ok}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Pergunta sim/não. Resolve `true` só no botão de confirmar. */
export function confirmar(texto: string, opcoes?: { ok?: string; perigo?: boolean }): Promise<boolean> {
  return abrir<boolean>({ tipo: "confirmar", texto, ok: (opcoes && opcoes.ok) || "Confirmar", perigo: opcoes && opcoes.perigo });
}

/** Pede um texto. Resolve `null` se cancelar. */
export function pedirTexto(texto: string, opcoes?: { ok?: string; obrigatorio?: boolean; valor?: string }): Promise<string | null> {
  return abrir<string | null>({ tipo: "texto", texto, ok: (opcoes && opcoes.ok) || "OK", obrigatorio: opcoes && opcoes.obrigatorio, valor: opcoes && opcoes.valor });
}

/** Mostra um aviso com um botão. */
export function avisar(texto: string): Promise<void> {
  return abrir<void>({ tipo: "aviso", texto, ok: "OK" });
}

/**
 * A faixa do modo suporte (M3.1b).
 *
 * Sessão de leitura precisa de aviso permanente na tela: sem ele, quem está
 * dando suporte tenta salvar, leva 403 e acha que o sistema quebrou.
 */
import { useState, useEffect } from "react";
import { modoSuporte, sairDoSuporte } from "../lib/plataforma";
import { Eye, X } from "lucide-react";

export default function FaixaDeSuporte() {
  const [modo, setModo] = useState(modoSuporte());

  useEffect(() => {
    const encerrou = () => setModo(null);
    window.addEventListener("musa:suporte-encerrado", encerrou);
    // A cada minuto: o prazo pode ter vencido com a aba aberta.
    const t = setInterval(() => setModo(modoSuporte()), 60000);
    return () => {
      window.removeEventListener("musa:suporte-encerrado", encerrou);
      clearInterval(t);
    };
  }, []);

  if (!modo) return null;

  const ate = modo.expiraEm ? new Date(modo.expiraEm).toLocaleString("pt-BR") : "";

  return (
    <div className="sticky top-0 z-[60] bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-between gap-3 text-[11px] font-semibold">
      <span className="flex items-center gap-2">
        <Eye className="w-3.5 h-3.5 flex-shrink-0" />
        Modo suporte da Mulino em <strong>{modo.clinica}</strong> — somente leitura, sem ficha de
        paciente nem documento clínico{ate ? `, até ${ate}` : ""}.
      </span>
      <button
        onClick={() => { sairDoSuporte(); setModo(null); window.location.href = "/plataforma"; }}
        className="flex items-center gap-1 bg-amber-950/10 hover:bg-amber-950/20 rounded px-2 py-1 cursor-pointer"
      >
        <X className="w-3 h-3" /> Sair do modo suporte
      </button>
    </div>
  );
}

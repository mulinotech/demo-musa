/**
 * Faixa de contraindicações clínicas (T4.3).
 *
 * É o pedaço deste módulo que muda desfecho, não papelada. Uma anamnese
 * guardada num arquivo que ninguém abre não impede aplicação de toxina em
 * gestante; um aviso vermelho no topo da ficha e no compromisso da agenda, sim.
 *
 * Três estados, e os três precisam ser distintos:
 *
 * - **Tem contraindicação** → vermelho, impossível de não ver.
 * - **Anamnese respondida, nada marcado** → verde discreto, porque "alguém
 *   checou e está tudo bem" é informação diferente de silêncio.
 * - **Sem anamnese, ou só o texto antigo** → âmbar, dizendo que ninguém
 *   avaliou. Mostrar "nenhum alerta" aqui seria mentira por omissão: sugere
 *   que houve verificação onde não houve.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ShieldCheck, HelpCircle } from "lucide-react";
import { RespostaAlertas } from "./comum";

export default function AlertasClinicos(p: { clientId: string; compacto?: boolean }) {
  const [d, setD] = useState<RespostaAlertas | null>(null);

  const carregar = useCallback(async () => {
    if (!p.clientId) return;
    try {
      const r = await fetch("/api/clients/" + p.clientId + "/alerts");
      const j = await r.json();
      if (r.ok) setD(j);
    } catch {
      /* a ficha funciona sem a faixa */
    }
  }, [p.clientId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  if (!d) return null;

  if (d.alertas.length > 0) {
    return (
      <div className="rounded-2xl border-2 border-red-300 bg-red-50 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs font-bold text-red-800 uppercase tracking-wider">
              Contraindicação relatada · {d.alertas.length}
            </p>
            <ul className="mt-1.5 space-y-1">
              {d.alertas.map((a) => (
                <li key={a.campo} className="text-[12px] text-red-800 leading-snug">
                  <strong>{a.rotulo}</strong> {a.valor}
                  {a.detalhe && <span className="font-semibold"> — {a.detalhe}</span>}
                </li>
              ))}
            </ul>
            {d.origem && (
              <p className="text-[10px] text-red-700/70 mt-1.5">
                Da anamnese "{d.origem.titulo}", de {d.origem.quando}
                {d.origem.status === "RASCUNHO" && " · ainda em rascunho"}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (d.semAnamnese || d.apenasTextoLivre) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 flex items-start gap-2">
        <HelpCircle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
        <p className="text-[11px] text-amber-800 leading-snug">
          {d.semAnamnese
            ? "Sem anamnese preenchida. Ninguém avaliou contraindicações deste paciente."
            : "A anamnese deste paciente é o texto livre do cadastro antigo, sem perguntas estruturadas — não há como o sistema avaliar contraindicação. Vale preencher a anamnese nova."}
        </p>
      </div>
    );
  }

  if (p.compacto) {
    return (
      <p className="text-[10px] text-emerald-700 flex items-center gap-1">
        <ShieldCheck className="h-3 w-3" />
        Anamnese sem contraindicação relatada
      </p>
    );
  }

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 flex items-start gap-2">
      <ShieldCheck className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
      <p className="text-[11px] text-emerald-800 leading-snug">
        Anamnese respondida, nenhuma contraindicação relatada
        {d.origem ? " (" + d.origem.quando + ")" : ""}.
      </p>
    </div>
  );
}

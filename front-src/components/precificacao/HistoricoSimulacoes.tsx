/**
 * Histórico de simulações (T2.3).
 *
 * Serve para comparar decisões no tempo: qual margem foi usada quando o preço
 * mudou, e quanto se assumiu de insumo. Sem isso, "por que este serviço custa
 * isso?" só tem resposta na memória de alguém.
 */
import { useEffect, useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { reais, pct, Simulacao } from "./comum";

export default function HistoricoSimulacoes({ recarregar }: { recarregar: number }) {
  const [itens, setItens] = useState<Simulacao[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/pricing/simulations");
      if (r.ok) setItens(await r.json());
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, [recarregar]);

  const quando = (v: string) => {
    const d = new Date(v);
    return isNaN(d.getTime())
      ? "—"
      : d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="bg-white border border-brand-gold/15 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-brand-beige/60">
        <h3 className="text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold flex items-center gap-1.5">
          <History className="h-3.5 w-3.5" />
          Histórico de simulações
        </h3>
        <button onClick={carregar} className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-brown/70 hover:text-brand-brown cursor-pointer">
          <RefreshCw className="h-3.5 w-3.5" />
          Atualizar
        </button>
      </div>

      {carregando ? (
        <p className="p-8 text-center text-[11px] font-mono uppercase tracking-widest text-brand-brown/60">Carregando...</p>
      ) : itens.length === 0 ? (
        <p className="p-8 text-center text-xs text-brand-brown/60">
          Nenhuma simulação guardada ainda.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap">
            <thead className="bg-brand-beige/30">
              <tr className="text-[10px] uppercase tracking-widest text-brand-brown/55">
                <th className="px-4 py-2.5 font-bold">Serviço</th>
                <th className="px-4 py-2.5 font-bold">Quando</th>
                <th className="px-4 py-2.5 font-bold text-right">Duração</th>
                <th className="px-4 py-2.5 font-bold text-right">Insumo</th>
                <th className="px-4 py-2.5 font-bold text-right">Margem</th>
                <th className="px-4 py-2.5 font-bold text-right">De</th>
                <th className="px-4 py-2.5 font-bold text-right">Para</th>
                <th className="px-4 py-2.5 font-bold text-right">R$/hora</th>
                <th className="px-4 py-2.5 font-bold"></th>
              </tr>
            </thead>
            <tbody>
              {itens.map((s) => (
                <tr key={s.id} className="border-t border-brand-gold/10 text-xs text-brand-brown">
                  <td className="px-4 py-2.5 font-semibold">{s.serviceName}</td>
                  <td className="px-4 py-2.5 text-brand-brown/60">{quando(s.createdAt)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{s.durationMin} min</td>
                  <td className="px-4 py-2.5 text-right font-mono">{reais(s.variableCost)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{pct(s.marginPct)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-brand-brown/60">{s.priceBefore === null ? "—" : reais(s.priceBefore)}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold">{reais(s.suggestedPrice)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{reais(s.hourlyValue)}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={
                        "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider " +
                        (s.applied
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-neutral-100 text-neutral-500 border border-neutral-200")
                      }
                    >
                      {s.applied ? "aplicada" : "só simulada"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

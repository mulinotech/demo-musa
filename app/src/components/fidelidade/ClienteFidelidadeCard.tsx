/**
 * Saldo e extrato de pontos do paciente (T5.2).
 *
 * O saldo aparece grande, **com o valor em reais ao lado**. "1.240 pontos" não
 * significa nada para a paciente; "1.240 pontos, R$ 124,00 em desconto"
 * significa. É a diferença entre um número no sistema e uma conversa na
 * recepção.
 *
 * Logo abaixo, quanto vence nos próximos 30 dias — que é o gancho de
 * reengajamento que justifica o programa existir. Ponto que vira pó sem a
 * paciente saber é uma promessa quebrada em silêncio.
 */
import { useCallback, useEffect, useState } from "react";
import { Award, Clock, AlertTriangle, Plus, Minus } from "lucide-react";
import { SaldoCliente, reais, pts, dataBR, dataHoraBR, ESTILO_PONTOS } from "./comum";

export default function ClienteFidelidadeCard(p: {
  clientId: string;
  nomeDoPaciente?: string;
  podeAjustar: boolean;
  compacto?: boolean;
}) {
  const [d, setD] = useState<SaldoCliente | null>(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    if (!p.clientId) return;
    const r = await fetch("/api/clients/" + p.clientId + "/loyalty");
    const j = await r.json();
    if (!r.ok) return setErro(j.error || "Não foi possível ler o saldo.");
    setD(j);
    setErro("");
  }, [p.clientId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const ajustar = async (sinal: number) => {
    const qtd = window.prompt(
      (sinal > 0 ? "Creditar" : "Retirar") + " quantos pontos?" +
      (sinal > 0 ? "\n\nO ajuste manual segue a validade configurada." : ""),
    );
    const n = Math.abs(Math.round(Number(qtd)));
    if (!n) return;
    const motivo = window.prompt("Motivo do ajuste (obrigatório):");
    if (!motivo || !motivo.trim()) return;
    const r = await fetch("/api/clients/" + p.clientId + "/loyalty/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: sinal * n, description: motivo }),
    });
    const j = await r.json();
    if (!r.ok) return setErro(j.error || "Não foi possível ajustar.");
    setErro("");
    carregar();
  };

  if (erro) {
    return (
      <div className="rounded-2xl px-4 py-3 text-xs border bg-red-50 border-red-200 text-red-700 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <p>{erro}</p>
      </div>
    );
  }
  if (!d) return <p className="text-[11px] text-brand-brown/50">Carregando saldo…</p>;

  const rotulo = "block text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold mb-1";

  return (
    <div className="space-y-3">
      <div className="bg-white border border-brand-gold/15 rounded-2xl p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="bg-brand-beige p-2.5 rounded-xl">
              <Award className="h-5 w-5 text-brand-gold" />
            </div>
            <div>
              <p className={rotulo}>Saldo de pontos</p>
              <p className="text-2xl font-serif font-semibold text-brand-brown leading-none">
                {pts(d.saldo)}
                <span className="text-sm font-sans font-normal text-brand-brown/60 ml-2">
                  = {reais(d.vale)} em desconto
                </span>
              </p>
              {d.saldo < d.minimoParaResgate && (
                <p className="text-[10px] text-brand-brown/55 mt-1">
                  Faltam {pts(d.minimoParaResgate - d.saldo)} pontos para o mínimo de resgate
                  ({pts(d.minimoParaResgate)}).
                </p>
              )}
              {!d.ativo && (
                <p className="text-[10px] text-amber-700 mt-1">
                  Programa desativado: o saldo vale para resgate, mas nada novo acumula.
                </p>
              )}
            </div>
          </div>

          {p.podeAjustar && (
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => ajustar(1)} title="Creditar pontos"
                className="p-1.5 rounded-lg text-emerald-700 hover:bg-emerald-50 cursor-pointer border border-emerald-200">
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => ajustar(-1)} title="Retirar pontos"
                className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 cursor-pointer border border-red-200">
                <Minus className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {d.aExpirar30Dias > 0 && (
          <div className="mt-3 pt-3 border-t border-brand-gold/15 flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-amber-700 shrink-0" />
            <p className="text-[11px] text-amber-800">
              <strong>{pts(d.aExpirar30Dias)} pontos</strong> ({reais(Math.round(d.aExpirar30Dias * (d.vale / (d.saldo || 1)) * 100) / 100)})
              vencem nos próximos 30 dias — motivo para chamar
              {p.nomeDoPaciente ? " " + p.nomeDoPaciente.split(" ")[0] : " o paciente"} de volta.
            </p>
          </div>
        )}
      </div>

      {!p.compacto && (
        <div className="bg-white border border-brand-gold/15 rounded-2xl overflow-hidden">
          <p className="px-4 py-2.5 text-[10px] uppercase tracking-widest font-bold text-brand-brown/60 border-b border-brand-gold/15 bg-brand-beige/40">
            Extrato
          </p>
          <div className="divide-y divide-brand-gold/10 max-h-80 overflow-y-auto">
            {d.extrato.map((l) => (
              <div key={l.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-brand-brown truncate">{l.descricao}</p>
                  <p className="text-[10px] text-brand-brown/55">
                    {dataHoraBR(l.quando)}
                    {l.expiraEm && !l.expirado && " · vence " + dataBR(l.expiraEm)}
                    {l.expirado && " · expirado"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={"text-[9px] uppercase tracking-wider border rounded px-1.5 py-0.5 " + ESTILO_PONTOS[l.tipo].classe}>
                    {ESTILO_PONTOS[l.tipo].rotulo}
                  </span>
                  <span className={"text-xs font-mono w-16 text-right " + (l.pontos < 0 ? "text-red-700" : "text-emerald-700")}>
                    {l.pontos > 0 ? "+" : ""}{pts(l.pontos)}
                  </span>
                </div>
              </div>
            ))}
            {d.extrato.length === 0 && (
              <p className="px-4 py-8 text-center text-[11px] text-brand-brown/50">
                Nenhum lançamento de pontos ainda.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

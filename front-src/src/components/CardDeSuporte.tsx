/**
 * O acesso de suporte da Mulino, visto pela clínica (M3.1b).
 *
 * Quem concede é o dono do dado. A tela diz, em palavras, exatamente o que o
 * acesso permite e o que ele não permite — porque "liberar suporte" sem essa
 * frase é a pessoa autorizando no escuro.
 */
import { useState, useEffect } from "react";
import { LifeBuoy, ShieldOff, Clock } from "lucide-react";

interface Concessao {
  id: string;
  concedido_por: string;
  motivo: string | null;
  concedido_em: string;
  expira_em: string;
}

export default function CardDeSuporte() {
  const [liberado, setLiberado] = useState(false);
  const [concessao, setConcessao] = useState<Concessao | null>(null);
  const [horas, setHoras] = useState("4");
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  async function ler() {
    try {
      const r = await fetch("/api/suporte");
      if (!r.ok) return;
      const d = await r.json();
      setLiberado(!!d.liberado);
      setConcessao(d.concessao || null);
    } catch { /* a tela não quebra por causa disto */ }
  }

  useEffect(() => { ler(); }, []);

  async function liberar() {
    setErro("");
    setOcupado(true);
    try {
      const r = await fetch("/api/suporte", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ horas: Number(horas), motivo })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Falha ao liberar.");
      setMotivo("");
      await ler();
    } catch (e: any) {
      setErro(e.message || "Falha ao liberar.");
    } finally {
      setOcupado(false);
    }
  }

  async function revogar() {
    setErro("");
    setOcupado(true);
    try {
      await fetch("/api/suporte", { method: "DELETE" });
      await ler();
    } catch (e: any) {
      setErro(e.message || "Falha ao revogar.");
    } finally {
      setOcupado(false);
    }
  }

  const ate = concessao ? new Date(concessao.expira_em).toLocaleString("pt-BR") : "";

  return (
    <div className="bg-white border border-brand-gold/15 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <LifeBuoy className="w-3.5 h-3.5 text-brand-gold" />
        <p className="text-xs font-serif font-bold text-brand-brown uppercase tracking-wider">
          Acesso de suporte da Mulino
        </p>
      </div>

      <p className="text-[10px] text-brand-brown/65 leading-relaxed">
        A Mulino <strong>não</strong> tem acesso aos dados desta clínica. Se precisar investigar
        algo, você libera por um prazo — e o acesso é de <strong>leitura</strong>:{" "}
        <strong>ficha de paciente, anamnese e documentos clínicos ficam fora mesmo assim</strong>.
        Cada entrada fica registrada na sua trilha de auditoria, e você pode revogar a qualquer
        momento.
      </p>

      {erro && <p className="text-[10px] text-red-600 font-semibold">{erro}</p>}

      {liberado ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 space-y-2">
          <p className="flex items-center gap-1.5 text-[11px] text-amber-900">
            <Clock className="w-3 h-3" /> Liberado até <strong>{ate}</strong>
            {concessao?.motivo ? ` — ${concessao.motivo}` : ""}
          </p>
          <button onClick={revogar} disabled={ocupado}
            className="flex items-center gap-1.5 bg-brand-brown hover:bg-brand-brown/90 disabled:opacity-60 text-brand-beige text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded cursor-pointer">
            <ShieldOff className="w-3 h-3" /> Revogar agora
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[10px] text-brand-brown/65">
            <span className="block uppercase tracking-widest font-bold mb-1">Por quantas horas</span>
            <input type="number" min={1} max={72} value={horas}
              onChange={(e) => setHoras(e.target.value)}
              className="w-24 bg-white border border-brand-gold/30 rounded px-3 py-2 text-xs text-brand-brown focus:outline-none focus:border-brand-brown" />
          </label>
          <label className="text-[10px] text-brand-brown/65 flex-1 min-w-[180px]">
            <span className="block uppercase tracking-widest font-bold mb-1">Motivo (opcional)</span>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex: agenda nao esta enviando lembrete"
              className="w-full bg-white border border-brand-gold/30 rounded px-3 py-2 text-xs text-brand-brown focus:outline-none focus:border-brand-brown" />
          </label>
          <button onClick={liberar} disabled={ocupado}
            className="bg-brand-brown hover:bg-brand-brown/90 disabled:opacity-60 text-brand-beige text-[10px] font-bold uppercase tracking-wider px-4 py-2 rounded cursor-pointer">
            Liberar
          </button>
        </div>
      )}
    </div>
  );
}

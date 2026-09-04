/**
 * Catálogo de recompensas (T5.4).
 *
 * Cada prêmio mostra o que ele custa em pontos **e quanto vale em reais**, com
 * a taxa de retorno ao lado. Um prêmio de "400 pontos = 20% de desconto" parece
 * inofensivo até alguém aplicá-lo num procedimento de R$ 1.800 e descobrir que
 * devolveu R$ 360 por 400 pontos, quando a tabela dizia R$ 40.
 *
 * Por isso o percentual aparece marcado: prêmio percentual não tem custo fixo,
 * ele custa proporcionalmente ao procedimento em que for usado. Ver isso na
 * hora de cadastrar evita a surpresa no relatório.
 */
import { useEffect, useState } from "react";
import { Plus, AlertTriangle, Check, Percent } from "lucide-react";
import { Recompensa, ConfigFidelidade, reais, pts, descreverPremio } from "./comum";

const TIPOS: { valor: Recompensa["type"]; label: string }[] = [
  { valor: "DESCONTO_VALOR", label: "Desconto em reais" },
  { valor: "DESCONTO_PCT", label: "Desconto percentual" },
  { valor: "SERVICO", label: "Serviço cortesia" },
];

export default function RecompensasPanel(p: { podeEditar: boolean; config: ConfigFidelidade | null }) {
  const [lista, setLista] = useState<Recompensa[]>([]);
  const [servicos, setServicos] = useState<{ id: string; name: string; price: number }[]>([]);
  const [erro, setErro] = useState("");
  const [recado, setRecado] = useState("");
  const [criando, setCriando] = useState(false);
  const [f, setF] = useState({ name: "", description: "", pointsCost: "", type: "DESCONTO_VALOR" as Recompensa["type"], value: "", catalogId: "" });

  const carregar = async () => {
    const r = await fetch("/api/loyalty/rewards");
    const d = await r.json();
    if (!r.ok) return setErro(d.error || "Não foi possível listar as recompensas.");
    setLista(d);
    setErro("");
  };

  useEffect(() => {
    carregar();
    fetch("/api/treatment-catalog")
      .then((r) => r.json())
      .then((d) => setServicos(Array.isArray(d) ? d : []))
      .catch(() => setServicos([]));
  }, []);

  const criar = async () => {
    const custo = Number(f.pointsCost);
    if (!f.name.trim() || !(custo > 0)) return setErro("Informe o nome e o custo em pontos.");
    const r = await fetch("/api/loyalty/rewards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: f.name, description: f.description || null, pointsCost: custo, type: f.type,
        value: f.type === "SERVICO" ? null : Number(String(f.value).replace(",", ".")) || null,
        catalogId: f.type === "SERVICO" ? f.catalogId || null : null,
      }),
    });
    const d = await r.json();
    if (!r.ok) return setErro(d.error || "Não foi possível criar.");
    setF({ name: "", description: "", pointsCost: "", type: "DESCONTO_VALOR", value: "", catalogId: "" });
    setCriando(false);
    setRecado("Recompensa criada.");
    setErro("");
    carregar();
  };

  const alternar = async (r: Recompensa) => {
    await fetch("/api/loyalty/rewards/" + r.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !r.active }),
    });
    carregar();
  };

  const campo =
    "w-full bg-white border border-brand-gold/30 rounded px-3 py-2 text-xs text-brand-brown focus:outline-none focus:border-brand-brown transition-colors";
  const rotulo = "block text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold mb-1";

  return (
    <div className="space-y-4">
      {recado && (
        <div className="rounded-2xl px-4 py-3 text-xs border bg-emerald-50 border-emerald-200 text-emerald-800 flex items-start gap-2">
          <Check className="h-4 w-4 shrink-0 mt-0.5" />
          <p>{recado}</p>
        </div>
      )}
      {erro && (
        <div className="rounded-2xl px-4 py-3 text-xs border bg-red-50 border-red-200 text-red-700 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <p>{erro}</p>
        </div>
      )}

      <div className="bg-white border border-brand-gold/15 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-brand-gold/15 flex items-center justify-between">
          <p className="text-xs font-bold text-brand-brown">Recompensas · {lista.length}</p>
          {p.podeEditar && (
            <button
              onClick={() => setCriando(!criando)}
              className="flex items-center gap-1.5 bg-brand-brown hover:bg-brand-brown/95 text-brand-beige px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider cursor-pointer"
            >
              <Plus className="h-3 w-3 text-brand-gold" />
              Nova
            </button>
          )}
        </div>

        {criando && (
          <div className="px-4 py-3 bg-brand-beige/40 border-b border-brand-gold/15 grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label className={rotulo}>Nome</label>
              <input className={campo} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </div>
            <div>
              <label className={rotulo}>Custo em pontos</label>
              <input className={campo} value={f.pointsCost} onChange={(e) => setF({ ...f, pointsCost: e.target.value })} />
            </div>
            <div>
              <label className={rotulo}>Tipo</label>
              <select className={campo} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Recompensa["type"] })}>
                {TIPOS.map((t) => <option key={t.valor} value={t.valor}>{t.label}</option>)}
              </select>
            </div>
            {f.type !== "SERVICO" && (
              <div>
                <label className={rotulo}>{f.type === "DESCONTO_PCT" ? "Percentual" : "Valor (R$)"}</label>
                <input className={campo} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
              </div>
            )}
            {f.type === "SERVICO" && (
              <div className="md:col-span-2">
                <label className={rotulo}>Serviço</label>
                <select className={campo} value={f.catalogId} onChange={(e) => setF({ ...f, catalogId: e.target.value })}>
                  <option value="">Qualquer serviço…</option>
                  {servicos.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            <div className="md:col-span-4 flex justify-end">
              <button
                onClick={criar}
                className="bg-brand-brown hover:bg-brand-brown/95 text-brand-beige px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest cursor-pointer"
              >
                Criar recompensa
              </button>
            </div>
          </div>
        )}

        <div className="divide-y divide-brand-gold/10">
          {lista.map((r) => {
            const valeTabela = p.config ? r.pointsCost * p.config.redemptionValue : null;
            const proporcional = r.type === "DESCONTO_PCT";
            return (
              <div key={r.id} className={"px-4 py-3 flex items-center justify-between gap-3 " + (r.active ? "" : "opacity-50")}>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-brand-brown truncate">
                    {r.name}
                    {proporcional && (
                      <span className="ml-2 text-[9px] uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                        proporcional
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-brand-brown/55">
                    {descreverPremio(r)}
                    {r.description ? " · " + r.description : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-mono font-bold text-brand-brown">{pts(r.pointsCost)} pts</p>
                  {valeTabela !== null && (
                    <p className="text-[9px] text-brand-brown/50">
                      {proporcional ? "tabela: " : ""}{reais(Math.round(valeTabela * 100) / 100)}
                    </p>
                  )}
                </div>
                {p.podeEditar && (
                  <button
                    onClick={() => alternar(r)}
                    className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-brand-brown/70 border border-brand-gold/30 rounded-lg px-2 py-1 hover:border-brand-brown cursor-pointer"
                  >
                    {r.active ? "Desativar" : "Ativar"}
                  </button>
                )}
              </div>
            );
          })}
          {lista.length === 0 && (
            <p className="px-4 py-8 text-center text-[11px] text-brand-brown/50">
              Nenhuma recompensa cadastrada.
            </p>
          )}
        </div>
      </div>

      {lista.some((r) => r.type === "DESCONTO_PCT" && r.active) && (
        <p className="text-[10px] text-brand-brown/55 leading-relaxed flex items-start gap-1.5">
          <Percent className="h-3 w-3 shrink-0 mt-0.5" />
          Recompensa percentual não tem custo fixo: ela custa proporcionalmente ao procedimento em que
          for usada. O valor da tabela ao lado é só o equivalente em pontos — o custo real aparece no
          relatório, que soma os reais efetivamente descontados.
        </p>
      )}
    </div>
  );
}

/**
 * Despesas recorrentes (T2.4).
 *
 * O que se cadastra aqui é um *modelo*, não um lançamento: aluguel todo dia 10,
 * software todo dia 5. O botão "Gerar" transforma os modelos em lançamentos no
 * razão, um por mês, em aberto.
 *
 * Gerar duas vezes não duplica: a chave é `<id da recorrência>:<AAAA-MM>` na
 * chave única do banco. É a mesma idempotência que o worker diário vai usar
 * quando o `node-cron` entrar com a agenda.
 */
import { useEffect, useState } from "react";
import { Plus, Power, Play } from "lucide-react";
import { reais, dataBR, Categoria } from "./comum";

interface Recorrente {
  id: string;
  description: string;
  amount: number;
  dayOfMonth: number;
  categoryId: string | null;
  categoria: string | null;
  startDate: string;
  endDate: string | null;
  active: boolean;
}

export default function Recorrentes({ categorias, aoMudar }: { categorias: Categoria[]; aoMudar: () => void }) {
  const [itens, setItens] = useState<Recorrente[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [abrirNovo, setAbrirNovo] = useState(false);
  const [gerando, setGerando] = useState(false);

  const vazio = { description: "", amount: "", dayOfMonth: "5", categoryId: "", startDate: new Date().toISOString().slice(0, 10) };
  const [novo, setNovo] = useState(vazio);

  const mostrar = (tipo: "ok" | "erro", texto: string) => {
    setAviso({ tipo, texto });
    window.setTimeout(() => setAviso(null), 7000);
  };

  const carregar = async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/recurring-expenses");
      if (r.ok) setItens(await r.json());
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const criar = async () => {
    const valor = Number(String(novo.amount).replace(",", "."));
    if (!novo.description.trim()) return mostrar("erro", "Descreva a despesa.");
    if (!isFinite(valor) || valor <= 0) return mostrar("erro", "O valor precisa ser maior que zero.");
    const r = await fetch("/api/recurring-expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: novo.description.trim(),
        amount: valor,
        dayOfMonth: Number(novo.dayOfMonth),
        categoryId: novo.categoryId || null,
        startDate: novo.startDate,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return mostrar("erro", d.error || "Não foi possível cadastrar.");
    setNovo(vazio);
    setAbrirNovo(false);
    carregar();
  };

  const alternar = async (r: Recorrente) => {
    await fetch("/api/recurring-expenses/" + r.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !r.active }),
    });
    carregar();
  };

  const gerar = async () => {
    setGerando(true);
    try {
      const r = await fetch("/api/finance/recurring/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return mostrar("erro", d.error || "Não foi possível gerar.");
      mostrar(
        "ok",
        d.criados === 0
          ? "Nada novo a gerar — os " + d.jaExistiam + " lançamentos deste período já existem."
          : d.criados + " lançamento(s) criado(s) em aberto." + (d.jaExistiam ? " Outros " + d.jaExistiam + " já existiam." : ""),
      );
      aoMudar();
    } finally {
      setGerando(false);
    }
  };

  const campo =
    "bg-white border border-brand-gold/30 rounded px-3 py-2 text-xs text-brand-brown focus:outline-none focus:border-brand-brown transition-colors";
  const rotulo = "block text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold mb-1";
  const despesas = categorias.filter((c) => c.type === "DESPESA");

  return (
    <div className="space-y-4">
      {aviso && (
        <div
          className={
            "rounded-xl px-4 py-3 text-xs border " +
            (aviso.tipo === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-700")
          }
        >
          {aviso.texto}
        </div>
      )}

      <div className="bg-white border border-brand-gold/15 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h3 className="text-xs font-serif font-bold text-brand-brown uppercase tracking-wider">Despesas recorrentes</h3>
          <p className="text-[10px] text-brand-brown/65 max-w-lg leading-relaxed">
            Modelos que viram lançamento todo mês. Gerar duas vezes não duplica — cada recorrência tem
            um lançamento por mês, e o banco recusa o segundo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={gerar}
            disabled={gerando || itens.filter((i) => i.active).length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold text-brand-brown/80 hover:bg-brand-beige disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <Play className="h-3.5 w-3.5" />
            {gerando ? "Gerando..." : "Gerar até hoje"}
          </button>
          <button
            onClick={() => setAbrirNovo((v) => !v)}
            className="flex items-center gap-1.5 bg-brand-brown hover:bg-brand-brown/95 text-brand-beige px-4 py-2 rounded-xl text-[11px] font-bold transition-all shadow-sm border border-brand-gold/20 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 text-brand-gold" />
            {abrirNovo ? "Cancelar" : "Nova recorrente"}
          </button>
        </div>
      </div>

      {abrirNovo && (
        <div className="bg-white border border-brand-gold/15 rounded-2xl p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className={rotulo}>Despesa</label>
              <input className={campo + " w-full"} value={novo.description} onChange={(e) => setNovo({ ...novo, description: e.target.value })} placeholder="Aluguel da sala" />
            </div>
            <div>
              <label className={rotulo}>Valor</label>
              <input className={campo + " w-full"} inputMode="decimal" value={novo.amount} onChange={(e) => setNovo({ ...novo, amount: e.target.value })} placeholder="0,00" />
            </div>
            <div>
              <label className={rotulo}>Dia do mês</label>
              <input className={campo + " w-full"} inputMode="numeric" value={novo.dayOfMonth} onChange={(e) => setNovo({ ...novo, dayOfMonth: e.target.value })} />
              <p className="text-[10px] text-brand-brown/50 mt-1">31 vira o último dia nos meses curtos</p>
            </div>
            <div className="md:col-span-2">
              <label className={rotulo}>Categoria</label>
              <select className={campo + " w-full"} value={novo.categoryId} onChange={(e) => setNovo({ ...novo, categoryId: e.target.value })}>
                <option value="">Sem categoria</option>
                {despesas.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={rotulo}>A partir de</label>
              <input type="date" className={campo + " w-full"} value={novo.startDate} onChange={(e) => setNovo({ ...novo, startDate: e.target.value })} />
            </div>
          </div>
          <button
            onClick={criar}
            className="bg-brand-brown hover:bg-brand-brown/95 text-brand-beige px-5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest cursor-pointer transition-colors"
          >
            Cadastrar
          </button>
        </div>
      )}

      <div className="bg-white border border-brand-gold/15 rounded-2xl overflow-hidden">
        {carregando ? (
          <p className="p-8 text-center text-[11px] font-mono uppercase tracking-widest text-brand-brown/60">Carregando...</p>
        ) : itens.length === 0 ? (
          <p className="p-8 text-center text-xs text-brand-brown/60">Nenhuma despesa recorrente cadastrada.</p>
        ) : (
          <table className="w-full text-left">
            <tbody>
              {itens.map((r) => (
                <tr key={r.id} className={"border-t border-brand-gold/10 text-xs " + (r.active ? "" : "opacity-50")}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-brand-brown">{r.description}</p>
                    <p className="text-[10px] text-brand-brown/50">
                      todo dia {r.dayOfMonth} · {r.categoria || "sem categoria"} · desde {dataBR(r.startDate)}
                      {r.active ? "" : " · inativa"}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-brand-brown whitespace-nowrap">{reais(r.amount)}</td>
                  <td className="px-4 py-3 w-px">
                    <button
                      onClick={() => alternar(r)}
                      title={r.active ? "Parar de gerar" : "Voltar a gerar"}
                      className="p-1.5 rounded-lg text-brand-brown/60 hover:bg-brand-beige cursor-pointer"
                    >
                      <Power className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

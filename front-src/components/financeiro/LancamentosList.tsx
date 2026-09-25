/**
 * Lançamentos (T2.4).
 *
 * Uma lista só para receita e despesa, porque o razão é único. O valor é sempre
 * digitado positivo — o sinal vem do tipo escolhido. Pedir "-300" para despesa
 * parece prático e vira erro de soma na primeira vez que alguém esquece o sinal.
 */
import { useEffect, useState } from "react";
import { Plus, Check, Undo2, Trash2, RefreshCw } from "lucide-react";
import { reais, dataBR, Base, Categoria, Lancamento } from "./comum";

interface Props {
  de: string;
  ate: string;
  base: Base;
  categorias: Categoria[];
  aoMudar: () => void;
  versao: number;
}

const PAGAMENTOS = ["DINHEIRO", "PIX", "DEBITO", "CREDITO", "TRANSFERENCIA", "OUTRO"];

export default function LancamentosList({ de, ate, base, categorias, aoMudar, versao }: Props) {
  const [itens, setItens] = useState<Lancamento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("");
  const [abrirNovo, setAbrirNovo] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const vazio = {
    type: "DESPESA" as "RECEITA" | "DESPESA",
    description: "",
    amount: "",
    categoryId: "",
    entryDate: new Date().toISOString().slice(0, 10),
    dueDate: "",
    paidAt: "",
    paymentMethod: "",
    supplier: "",
  };
  const [novo, setNovo] = useState(vazio);

  const carregar = async () => {
    setCarregando(true);
    try {
      const q = new URLSearchParams({ from: de, to: ate, basis: base });
      if (filtroTipo) q.set("type", filtroTipo);
      if (filtroStatus) q.set("status", filtroStatus);
      const r = await fetch("/api/finance/entries?" + q.toString());
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        setErro(e.error || "Não foi possível carregar os lançamentos.");
        return;
      }
      setErro("");
      setItens((await r.json()).itens || []);
    } catch {
      setErro("Erro de conexão.");
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [de, ate, base, filtroTipo, filtroStatus, versao]);

  const criar = async () => {
    const valor = Number(String(novo.amount).replace(",", "."));
    if (!novo.description.trim()) return setErro("Descreva o lançamento.");
    if (!isFinite(valor) || valor <= 0) return setErro("O valor precisa ser maior que zero.");
    setSalvando(true);
    try {
      const r = await fetch("/api/finance/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: novo.type,
          description: novo.description.trim(),
          amount: valor,
          categoryId: novo.categoryId || null,
          entryDate: novo.entryDate,
          dueDate: novo.dueDate || null,
          paidAt: novo.paidAt || null,
          paymentMethod: novo.paymentMethod || null,
          supplier: novo.supplier || null,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setErro(d.error || "Não foi possível gravar.");
      setErro("");
      setNovo(vazio);
      setAbrirNovo(false);
      carregar();
      aoMudar();
    } finally {
      setSalvando(false);
    }
  };

  const baixar = async (l: Lancamento) => {
    const r = await fetch("/api/finance/entries/" + l.id + "/pay", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(l.paidAt ? { paidAt: null } : { paidAt: new Date().toISOString().slice(0, 10) }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      return setErro(e.error || "Não foi possível registrar a baixa.");
    }
    carregar();
    aoMudar();
  };

  const remover = async (l: Lancamento) => {
    if (!window.confirm('Remover "' + l.description + '" do razão?')) return;
    const r = await fetch("/api/finance/entries/" + l.id, { method: "DELETE" });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      return setErro(e.error || "Não foi possível remover.");
    }
    carregar();
    aoMudar();
  };

  const campo =
    "bg-white border border-brand-gold/30 rounded px-3 py-2 text-xs text-brand-brown focus:outline-none focus:border-brand-brown transition-colors";
  const rotulo = "block text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold mb-1";
  const categoriasDoTipo = categorias.filter((c) => c.type === novo.type);

  return (
    <div className="space-y-4">
      {erro && <div className="rounded-xl px-4 py-3 text-xs border bg-red-50 border-red-200 text-red-700">{erro}</div>}

      <div className="bg-white border border-brand-gold/15 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <select className={campo} value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
            <option value="">Receitas e despesas</option>
            <option value="RECEITA">Só receitas</option>
            <option value="DESPESA">Só despesas</option>
          </select>
          <select className={campo} value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
            <option value="">Pagos e em aberto</option>
            <option value="aberto">Só em aberto</option>
            <option value="pago">Só pagos</option>
          </select>
          <button onClick={carregar} className="p-2 rounded-lg text-brand-brown/60 hover:bg-brand-beige cursor-pointer">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          onClick={() => setAbrirNovo((v) => !v)}
          className="flex items-center gap-1.5 bg-brand-brown hover:bg-brand-brown/95 text-brand-beige px-4 py-2 rounded-xl text-[11px] font-bold transition-all shadow-sm border border-brand-gold/20 cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5 text-brand-gold" />
          {abrirNovo ? "Cancelar" : "Novo lançamento"}
        </button>
      </div>

      {abrirNovo && (
        <div className="bg-white border border-brand-gold/15 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-1 bg-brand-beige/60 p-1 rounded-xl w-fit">
            {(["DESPESA", "RECEITA"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setNovo({ ...novo, type: t, categoryId: "" })}
                className={
                  "px-4 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer " +
                  (novo.type === t ? "bg-brand-brown text-brand-beige shadow-sm" : "text-brand-brown/70 hover:bg-white")
                }
              >
                {t === "DESPESA" ? "Despesa" : "Receita"}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className={rotulo}>Descrição</label>
              <input className={campo + " w-full"} value={novo.description} onChange={(e) => setNovo({ ...novo, description: e.target.value })} placeholder="Compra de ácido hialurônico" />
            </div>
            <div>
              <label className={rotulo}>Valor (sempre positivo)</label>
              <input className={campo + " w-full"} inputMode="decimal" value={novo.amount} onChange={(e) => setNovo({ ...novo, amount: e.target.value })} placeholder="0,00" />
            </div>
            <div>
              <label className={rotulo}>Categoria</label>
              <select className={campo + " w-full"} value={novo.categoryId} onChange={(e) => setNovo({ ...novo, categoryId: e.target.value })}>
                <option value="">Sem categoria</option>
                {categoriasDoTipo.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={rotulo}>Competência</label>
              <input type="date" className={campo + " w-full"} value={novo.entryDate} onChange={(e) => setNovo({ ...novo, entryDate: e.target.value })} />
              <p className="text-[10px] text-brand-brown/50 mt-1">quando o fato aconteceu</p>
            </div>
            <div>
              <label className={rotulo}>Vencimento</label>
              <input type="date" className={campo + " w-full"} value={novo.dueDate} onChange={(e) => setNovo({ ...novo, dueDate: e.target.value })} />
              <p className="text-[10px] text-brand-brown/50 mt-1">opcional</p>
            </div>
            <div>
              <label className={rotulo}>Pago em</label>
              <input type="date" className={campo + " w-full"} value={novo.paidAt} onChange={(e) => setNovo({ ...novo, paidAt: e.target.value })} />
              <p className="text-[10px] text-brand-brown/50 mt-1">em branco = conta a pagar</p>
            </div>
            <div>
              <label className={rotulo}>Forma de pagamento</label>
              <select className={campo + " w-full"} value={novo.paymentMethod} onChange={(e) => setNovo({ ...novo, paymentMethod: e.target.value })}>
                <option value="">—</option>
                {PAGAMENTOS.map((p) => (
                  <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={rotulo}>Fornecedor</label>
              <input className={campo + " w-full"} value={novo.supplier} onChange={(e) => setNovo({ ...novo, supplier: e.target.value })} />
            </div>
          </div>

          <button
            onClick={criar}
            disabled={salvando}
            className="bg-brand-brown hover:bg-brand-brown/95 disabled:opacity-60 text-brand-beige px-5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest cursor-pointer transition-colors"
          >
            {salvando ? "Gravando..." : "Gravar lançamento"}
          </button>
        </div>
      )}

      <div className="bg-white border border-brand-gold/15 rounded-2xl overflow-hidden">
        {carregando ? (
          <p className="p-8 text-center text-[11px] font-mono uppercase tracking-widest text-brand-brown/60">Carregando...</p>
        ) : itens.length === 0 ? (
          <p className="p-8 text-center text-xs text-brand-brown/60">Nenhum lançamento no período com esses filtros.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left whitespace-nowrap">
              <thead className="bg-brand-beige/60">
                <tr className="text-[10px] uppercase tracking-widest text-brand-brown/55">
                  <th className="px-4 py-2.5 font-bold">Lançamento</th>
                  <th className="px-4 py-2.5 font-bold">Competência</th>
                  <th className="px-4 py-2.5 font-bold">Vencimento</th>
                  <th className="px-4 py-2.5 font-bold">Situação</th>
                  <th className="px-4 py-2.5 font-bold text-right">Valor</th>
                  <th className="px-4 py-2.5 font-bold"></th>
                </tr>
              </thead>
              <tbody>
                {itens.map((l) => {
                  const receita = l.type === "RECEITA";
                  const automatico = l.source !== "MANUAL";
                  return (
                    <tr key={l.id} className="border-t border-brand-gold/10 text-xs text-brand-brown">
                      <td className="px-4 py-2.5">
                        <p className="font-semibold">{l.description}</p>
                        <p className="text-[10px] text-brand-brown/50">
                          {l.categoria || "Sem categoria"}
                          {l.supplier ? " · " + l.supplier : ""}
                          {automatico ? " · automático" : ""}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-brand-brown/70">{dataBR(l.entryDate)}</td>
                      <td className="px-4 py-2.5 text-brand-brown/70">{dataBR(l.dueDate)}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={
                            "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider " +
                            (l.paidAt
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-amber-50 text-amber-700 border border-amber-200")
                          }
                        >
                          {l.paidAt ? "pago " + dataBR(l.paidAt) : "em aberto"}
                        </span>
                      </td>
                      <td className={"px-4 py-2.5 text-right font-mono font-semibold " + (receita ? "text-emerald-700" : "text-red-700")}>
                        {receita ? "+" : "−"} {reais(l.amount)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => baixar(l)}
                            title={l.paidAt ? "Desfazer a baixa" : "Marcar como pago hoje"}
                            className="p-1.5 rounded-lg text-brand-brown/60 hover:bg-brand-beige cursor-pointer"
                          >
                            {l.paidAt ? <Undo2 className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                          </button>
                          {!automatico && (
                            <button
                              onClick={() => remover(l)}
                              title="Remover"
                              className="p-1.5 rounded-lg text-red-600/70 hover:bg-red-50 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

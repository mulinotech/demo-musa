/**
 * Entrada de estoque e ajuste (T3.3).
 *
 * Duas coisas que a tela faz de propósito:
 *
 * 1. **Mostra o custo médio antes e depois.** Dar entrada muda o custo do
 *    produto, e esse número vai direto para a precificação. Fazer isso calado
 *    significa que um dia o preço sugerido muda e ninguém sabe por quê.
 *
 * 2. **Produto controlado exige lote e validade**, e o formulário diz isso
 *    antes de a pessoa clicar em salvar. O servidor recusa de qualquer forma;
 *    a tela avisa para não desperdiçar o preenchimento.
 */
import { useState } from "react";
import { X, AlertTriangle, PackagePlus } from "lucide-react";
import { motion } from "motion/react";
import { Produto, reais, qtd } from "./comum";

export default function EntradaModal(p: {
  produto: Produto;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [f, setF] = useState({
    quantity: "",
    unitCost: String(p.produto.unitCost),
    batchNumber: "",
    expiryDate: "",
    supplier: p.produto.supplier || "",
  });
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [feito, setFeito] = useState<{ custoAnterior: number; custoMedio: number; saldoDepois: number } | null>(null);

  const q = Number(String(f.quantity).replace(",", ".")) || 0;
  const custo = Number(String(f.unitCost).replace(",", ".")) || 0;

  /** A mesma média ponderada do servidor, só para prévia. O número que vale é
   *  o que o servidor devolve — aqui é para a pessoa ver a consequência antes
   *  de confirmar, não para virar segunda fonte de verdade. */
  const previa =
    q > 0
      ? p.produto.saldoTotal + q > 0
        ? (p.produto.saldoTotal * p.produto.unitCost + q * custo) / (p.produto.saldoTotal + q)
        : custo
      : p.produto.unitCost;

  const salvar = async () => {
    if (q <= 0) return setErro("Informe a quantidade recebida.");
    if (p.produto.controlled && (!f.batchNumber.trim() || !f.expiryDate)) {
      return setErro("Produto controlado exige número de lote e validade.");
    }
    setOcupado(true);
    try {
      const r = await fetch("/api/stock/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: p.produto.id,
          quantity: q,
          unitCost: custo,
          batchNumber: f.batchNumber.trim() || null,
          expiryDate: f.expiryDate || null,
          supplier: f.supplier.trim() || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) return setErro(d.error || "Não foi possível dar entrada.");
      setErro("");
      setFeito(d);
      p.aoSalvar();
    } finally {
      setOcupado(false);
    }
  };

  const campo =
    "w-full bg-white border border-brand-gold/30 rounded px-3 py-2 text-xs text-brand-brown focus:outline-none focus:border-brand-brown transition-colors";
  const rotulo = "block text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold mb-1";

  return (
    <div className="fixed inset-0 z-[70] bg-brand-brown/40 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-lg bg-brand-beige rounded-2xl shadow-2xl border border-brand-gold/20 my-4"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-gold/20">
          <div>
            <h3 className="text-sm font-serif font-bold text-brand-brown uppercase tracking-wider">
              Entrada de estoque
            </h3>
            <p className="text-[10px] text-brand-brown/60 mt-0.5">
              {p.produto.name} · saldo atual {qtd(p.produto.saldoTotal)} {p.produto.unit}
              {p.produto.controlled && " · controlado"}
            </p>
          </div>
          <button onClick={p.aoFechar} className="p-2 rounded-full text-brand-brown/60 hover:bg-white cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {erro && (
            <div className="rounded-xl px-4 py-3 text-xs border bg-red-50 border-red-200 text-red-700 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>{erro}</p>
            </div>
          )}

          {feito ? (
            <div className="rounded-xl px-4 py-3 text-xs border bg-emerald-50 border-emerald-200 text-emerald-800 space-y-1">
              <p className="font-bold">Entrada registrada.</p>
              <p>
                Saldo agora: {qtd(feito.saldoDepois)} {p.produto.unit}.
              </p>
              <p>
                Custo médio: {reais(feito.custoAnterior)} → <strong>{reais(feito.custoMedio)}</strong>
                {feito.custoMedio !== feito.custoAnterior && " — a precificação usa este número."}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={rotulo}>Quantidade ({p.produto.unit})</label>
                  <input
                    autoFocus
                    className={campo}
                    value={f.quantity}
                    onChange={(e) => setF({ ...f, quantity: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className={rotulo}>Custo unitário (R$)</label>
                  <input
                    className={campo}
                    value={f.unitCost}
                    onChange={(e) => setF({ ...f, unitCost: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={rotulo}>
                    Nº do lote {p.produto.controlled && <span className="text-red-600">*</span>}
                  </label>
                  <input
                    className={campo}
                    value={f.batchNumber}
                    onChange={(e) => setF({ ...f, batchNumber: e.target.value })}
                  />
                </div>
                <div>
                  <label className={rotulo}>
                    Validade {p.produto.controlled && <span className="text-red-600">*</span>}
                  </label>
                  <input
                    type="date"
                    className={campo}
                    value={f.expiryDate}
                    onChange={(e) => setF({ ...f, expiryDate: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className={rotulo}>Fornecedor</label>
                <input
                  className={campo}
                  value={f.supplier}
                  onChange={(e) => setF({ ...f, supplier: e.target.value })}
                />
              </div>

              {p.produto.controlled && (
                <p className="text-[10px] text-brand-brown/60 leading-relaxed bg-white/70 border border-brand-gold/20 rounded px-3 py-2">
                  Produto controlado: lote e validade são obrigatórios. Se um lote for recolhido, é
                  por esse número que a clínica descobre em quem foi aplicado.
                </p>
              )}

              {q > 0 && (
                <div className="bg-white/80 border border-brand-gold/20 rounded-xl px-3 py-2.5 flex items-center justify-between">
                  <div>
                    <p className={rotulo}>Custo médio depois desta entrada</p>
                    <p className="text-[10px] text-brand-brown/60">
                      Média ponderada — não o último preço pago.
                    </p>
                  </div>
                  <p className="text-sm font-mono font-bold text-brand-brown">
                    {reais(Math.round(previa * 100) / 100)}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-brand-gold/20">
          <button onClick={p.aoFechar} className="px-4 py-2 rounded-xl text-[11px] font-semibold text-brand-brown/70 hover:bg-white cursor-pointer">
            {feito ? "Fechar" : "Cancelar"}
          </button>
          {!feito && (
            <button
              onClick={salvar}
              disabled={ocupado}
              className="flex items-center gap-1.5 bg-brand-brown hover:bg-brand-brown/95 disabled:opacity-50 text-brand-beige px-5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest cursor-pointer transition-colors"
            >
              <PackagePlus className="h-3.5 w-3.5" />
              {ocupado ? "Salvando..." : "Dar entrada"}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

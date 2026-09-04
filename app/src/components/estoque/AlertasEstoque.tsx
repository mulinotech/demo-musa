/**
 * Faixa de alertas (T3.3, regra R5).
 *
 * A ordem não é estética: **vencido com saldo vem primeiro**, porque é o único
 * dos três que representa risco sanitário e não apenas risco de faltar. Depois
 * o que está vencendo, que ainda dá tempo de usar. Por último a reposição, que
 * é dinheiro e não segurança.
 *
 * Cada alerta crítico tem a ação ao lado — dar baixa como perda. Alerta que
 * informa e não oferece o que fazer treina a pessoa a ignorar a faixa.
 */
import { AlertTriangle, Clock, PackageMinus, Check } from "lucide-react";
import { Alertas, qtd, dataBR } from "./comum";

export default function AlertasEstoque(p: {
  alertas: Alertas | null;
  aoDarPerda: (batchId: string, produto: string, quantidade: number) => void;
}) {
  const a = p.alertas;
  if (!a) return null;

  if (a.total === 0) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 flex items-center gap-2">
        <Check className="h-4 w-4 text-emerald-700 shrink-0" />
        <p className="text-xs text-emerald-800">
          Nenhum alerta: nada vencido, nada vencendo nos próximos 30 dias e nada abaixo do mínimo.
        </p>
      </div>
    );
  }

  const cartao = "rounded-2xl border p-4 space-y-2";
  const titulo = "text-[10px] uppercase tracking-widest font-bold flex items-center gap-1.5";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      {a.criticos.length > 0 && (
        <div className={cartao + " bg-red-50 border-red-200"}>
          <p className={titulo + " text-red-700"}>
            <AlertTriangle className="h-3.5 w-3.5" />
            Vencido com saldo · {a.criticos.length}
          </p>
          <p className="text-[10px] text-red-700/80 leading-relaxed">
            Não pode ser aplicado em ninguém e o sistema não vai consumir automaticamente.
          </p>
          <div className="space-y-1.5 pt-1">
            {a.criticos.slice(0, 4).map((i) => (
              <div key={i.batchId} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-red-800 truncate">{i.produto}</p>
                  <p className="text-[10px] text-red-700/70">
                    {qtd(i.quantidade)} un · lote {i.lote || "—"} · venceu {dataBR(i.validade)} ({i.diasVencido}d)
                  </p>
                </div>
                <button
                  onClick={() => p.aoDarPerda(i.batchId, i.produto, i.quantidade)}
                  className="shrink-0 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-red-700 border border-red-300 rounded-lg px-2 py-1 hover:bg-red-100 cursor-pointer"
                >
                  <PackageMinus className="h-3 w-3" />
                  Dar perda
                </button>
              </div>
            ))}
            {a.criticos.length > 4 && (
              <p className="text-[10px] text-red-700/60">e mais {a.criticos.length - 4}</p>
            )}
          </div>
        </div>
      )}

      {a.validade.length > 0 && (
        <div className={cartao + " bg-amber-50 border-amber-200"}>
          <p className={titulo + " text-amber-800"}>
            <Clock className="h-3.5 w-3.5" />
            Vencendo em 30 dias · {a.validade.length}
          </p>
          <p className="text-[10px] text-amber-800/80 leading-relaxed">
            Ainda dá tempo de usar — a saída automática já consome estes primeiro.
          </p>
          <div className="space-y-1.5 pt-1">
            {a.validade.slice(0, 5).map((i) => (
              <div key={i.batchId} className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold text-amber-900 truncate">{i.produto}</p>
                <span className="text-[10px] font-mono text-amber-800/80 shrink-0">
                  {i.diasRestantes}d · {dataBR(i.validade)}
                </span>
              </div>
            ))}
            {a.validade.length > 5 && (
              <p className="text-[10px] text-amber-800/60">e mais {a.validade.length - 5}</p>
            )}
          </div>
        </div>
      )}

      {a.reposicao.length > 0 && (
        <div className={cartao + " bg-white border-brand-gold/25"}>
          <p className={titulo + " text-brand-brown"}>
            <PackageMinus className="h-3.5 w-3.5" />
            Abaixo do mínimo · {a.reposicao.length}
          </p>
          <p className="text-[10px] text-brand-brown/60 leading-relaxed">
            Compara com o saldo utilizável — lote vencido não conta como estoque.
          </p>
          <div className="space-y-1.5 pt-1">
            {a.reposicao.slice(0, 5).map((i) => (
              <div key={i.productId} className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold text-brand-brown truncate">{i.produto}</p>
                <span className="text-[10px] font-mono text-brand-brown/70 shrink-0">
                  {qtd(i.saldo)} de {qtd(i.minimo)}
                </span>
              </div>
            ))}
            {a.reposicao.length > 5 && (
              <p className="text-[10px] text-brand-brown/50">e mais {a.reposicao.length - 5}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

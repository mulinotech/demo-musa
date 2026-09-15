/**
 * Estoque — rota /crm/estoque (T3.3).
 *
 * Os alertas ficam no topo, sempre, antes da lista. É a inversão deliberada da
 * ordem óbvia: uma tela de estoque que abre mostrando a tabela completa faz a
 * pessoa procurar o problema; abrindo pelos alertas, o problema procura ela.
 *
 * A lista mostra dois saldos quando eles divergem — total e utilizável. A
 * diferença é lote vencido, e é justamente o número que engana quem confia só
 * no total.
 */
import { useCallback, useEffect, useState } from "react";
import { Boxes, RefreshCw, PackagePlus, AlertTriangle, ClipboardList, Layers, Plus, Pencil } from "lucide-react";
import AlertasEstoque from "../../components/estoque/AlertasEstoque";
import EntradaModal from "../../components/estoque/EntradaModal";
import FichaTecnicaPanel from "../../components/estoque/FichaTecnicaPanel";
import ProdutoModal from "../../components/estoque/ProdutoModal";
import { Produto, Movimento, Alertas, reais, qtd, dataBR, dataHoraBR, ESTILO_MOV } from "../../components/estoque/comum";

type Aba = "saldo" | "movimentos" | "fichas";

export default function Estoque() {
  const [aba, setAba] = useState<Aba>("saldo");
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [alertas, setAlertas] = useState<Alertas | null>(null);
  const [movimentos, setMovimentos] = useState<Movimento[]>([]);
  const [servicos, setServicos] = useState<{ id: string; name: string }[]>([]);
  const [entrada, setEntrada] = useState<Produto | null>(null);
  /* `null` = fechado; `{ produto: null }` = cadastrando; `{ produto }` = editando.
   * Um estado só, e não dois booleanos: dois booleanos permitem o estado
   * impossível "cadastrando E editando". */
  const [editor, setEditor] = useState<{ produto: Produto | null } | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [valorTotal, setValorTotal] = useState(0);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [b, a] = await Promise.all([
        fetch("/api/stock/balance").then((r) => r.json()),
        fetch("/api/stock/alerts").then((r) => r.json()),
      ]);
      if (b.error || a.error) {
        setErro(b.error || a.error);
        return;
      }
      setProdutos(b.itens || []);
      setValorTotal(b.valorTotal || 0);
      setAlertas(a);
      setErro("");
    } catch {
      setErro("Erro de conexão ao carregar o estoque.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    if (aba !== "movimentos") return;
    fetch("/api/stock/movements")
      .then((r) => r.json())
      .then((d) => setMovimentos(Array.isArray(d) ? d : []))
      .catch(() => setMovimentos([]));
  }, [aba, produtos]);

  useEffect(() => {
    if (aba !== "fichas" || servicos.length) return;
    fetch("/api/treatment-catalog")
      .then((r) => r.json())
      .then((d) => setServicos(Array.isArray(d) ? d : []))
      .catch(() => setServicos([]));
  }, [aba, servicos.length]);

  /** Perda pede motivo e não tem desfazer — mas é lançamento novo, então o
   *  histórico continua mostrando que o produto existiu e como saiu. */
  const darPerda = async (batchId: string, produto: string, quantidade: number) => {
    const motivo = window.prompt(
      'Dar baixa de perda em "' + produto + '" (' + qtd(quantidade) + ")?\n\nMotivo:",
      "Lote vencido",
    );
    if (!motivo || !motivo.trim()) return;
    const r = await fetch("/api/stock/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchId, quantity: quantidade, type: "PERDA", reason: motivo }),
    });
    const d = await r.json();
    if (!r.ok) return setErro(d.error || "Não foi possível dar baixa.");
    carregar();
  };

  const botao = "px-3 py-2 rounded-xl text-[11px] font-semibold transition-all cursor-pointer";
  const porCategoria = produtos.reduce((m: Record<string, Produto[]>, p) => {
    const c = p.category || "Sem categoria";
    (m[c] = m[c] || []).push(p);
    return m;
  }, {});

  return (
    <div className="space-y-4">
      <div className="bg-white border border-brand-gold/15 rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-brand-beige p-2.5 rounded-xl">
            <Boxes className="h-5 w-5 text-brand-brown" />
          </div>
          <div>
            <h3 className="text-sm font-serif font-bold text-brand-brown">Estoque</h3>
            <p className="text-[10px] text-brand-brown/60">
              {produtos.length} produto{produtos.length === 1 ? "" : "s"} · {reais(valorTotal)} em estoque
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-brand-beige/60 p-1 rounded-xl">
            {([
              ["saldo", "Saldo", Layers],
              ["movimentos", "Movimentações", ClipboardList],
              ["fichas", "Fichas técnicas", ClipboardList],
            ] as [Aba, string, typeof Layers][]).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setAba(v)}
                className={botao + " " + (aba === v ? "bg-brand-brown text-brand-beige shadow-sm" : "text-brand-brown/70 hover:bg-white")}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setEditor({ produto: null })}
            className="flex items-center gap-1.5 bg-brand-brown hover:bg-brand-brown/95 text-brand-beige px-3 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 text-brand-gold" />
            Novo produto
          </button>
          <button
            onClick={carregar}
            className="p-2 rounded-lg text-brand-brown/60 hover:bg-brand-beige cursor-pointer"
            title="Recarregar"
          >
            <RefreshCw className={"h-4 w-4 " + (carregando ? "animate-spin" : "")} />
          </button>
        </div>
      </div>

      {erro && (
        <div className="rounded-2xl px-4 py-3 text-xs border bg-red-50 border-red-200 text-red-700 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <p>{erro}</p>
        </div>
      )}

      {aba !== "fichas" && <AlertasEstoque alertas={alertas} aoDarPerda={darPerda} />}

      {aba === "saldo" && (
        <div className="space-y-4">
          {Object.keys(porCategoria).sort().map((cat) => (
            <div key={cat} className="bg-white border border-brand-gold/15 rounded-2xl overflow-hidden">
              <p className="px-4 py-2.5 text-[10px] uppercase tracking-widest font-bold text-brand-brown/60 border-b border-brand-gold/15 bg-brand-beige/40">
                {cat}
              </p>
              <div className="divide-y divide-brand-gold/10">
                {porCategoria[cat].map((p) => {
                  const abaixo = p.minStock > 0 && p.saldo < p.minStock;
                  const temVencido = p.saldoTotal !== p.saldo;
                  return (
                    <div key={p.id}>
                      <div className="px-4 py-3 flex items-center justify-between gap-3">
                        <button
                          onClick={() => setAberto(aberto === p.id ? null : p.id)}
                          className="flex-1 min-w-0 text-left cursor-pointer"
                        >
                          <p className="text-xs font-semibold text-brand-brown truncate">
                            {p.name}
                            {p.controlled && (
                              <span className="ml-2 text-[9px] uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                                controlado
                              </span>
                            )}
                          </p>
                          <p className="text-[10px] text-brand-brown/55">
                            {reais(p.unitCost)}/{p.unit} · {p.lotes.length} lote{p.lotes.length === 1 ? "" : "s"}
                            {p.minStock > 0 && " · mínimo " + qtd(p.minStock)}
                          </p>
                        </button>

                        <div className="text-right shrink-0">
                          <p className={"text-sm font-mono font-bold " + (abaixo ? "text-red-700" : "text-brand-brown")}>
                            {qtd(p.saldo)} <span className="text-[10px] font-normal text-brand-brown/50">{p.unit}</span>
                          </p>
                          {temVencido && (
                            <p className="text-[9px] text-red-600">
                              {qtd(p.saldoTotal)} no total · {qtd(p.saldoTotal - p.saldo)} vencido
                            </p>
                          )}
                        </div>

                        {/* Os dois com rótulo, e não só ícone: em 10/09 um lápis
                          * de 14px sem palavra fez alguém concluir que editar
                          * não existia. Ver a regra 22. */}
                        <button
                          onClick={() => setEditor({ produto: p })}
                          title={"Editar o cadastro de " + p.name}
                          className="shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-wider text-brand-brown/70 hover:bg-brand-beige cursor-pointer"
                        >
                          <Pencil className="h-3 w-3" />
                          Editar
                        </button>
                        <button
                          onClick={() => setEntrada(p)}
                          title={"Dar entrada em " + p.name}
                          className="shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-wider text-brand-brown/70 hover:bg-brand-beige cursor-pointer"
                        >
                          <PackagePlus className="h-3.5 w-3.5" />
                          Entrada
                        </button>
                      </div>

                      {aberto === p.id && (
                        <div className="px-4 pb-3 space-y-1">
                          {p.lotes.length === 0 && (
                            <p className="text-[11px] text-brand-brown/50">Sem lote com saldo.</p>
                          )}
                          {p.lotes.map((l) => (
                            <div
                              key={l.id}
                              className={
                                "flex items-center justify-between gap-2 text-[11px] rounded-lg px-2.5 py-1.5 border " +
                                (l.vencido ? "bg-red-50 border-red-200 text-red-700" : "bg-brand-beige/50 border-brand-gold/15 text-brand-brown/75")
                              }
                            >
                              <span className="truncate">
                                lote {l.lote || "—"} · validade {dataBR(l.validade)}
                                {l.vencido && " · VENCIDO"}
                              </span>
                              <span className="font-mono shrink-0">
                                {qtd(l.quantidade)} × {reais(l.custoUnitario)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {!carregando && produtos.length === 0 && (
            <p className="text-center text-[11px] text-brand-brown/50 py-8">Nenhum produto cadastrado.</p>
          )}
        </div>
      )}

      {aba === "movimentos" && (
        <div className="bg-white border border-brand-gold/15 rounded-2xl overflow-hidden">
          <div className="divide-y divide-brand-gold/10">
            {movimentos.map((m) => (
              <div key={m.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-brand-brown truncate">
                    {m.produto}
                    {m.lote && <span className="text-brand-brown/50"> · lote {m.lote}</span>}
                  </p>
                  <p className="text-[10px] text-brand-brown/55 truncate">
                    {m.origem || "—"}
                    {m.autor && " · " + m.autor}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={"text-[9px] uppercase tracking-wider border rounded px-1.5 py-0.5 " + ESTILO_MOV[m.tipo].classe}>
                    {ESTILO_MOV[m.tipo].rotulo}
                  </span>
                  <span className="text-xs font-mono text-brand-brown/80 w-20 text-right">
                    {m.sinal < 0 ? "−" : "+"}{qtd(m.quantidade)} {m.unidade}
                  </span>
                  <span className="text-[10px] font-mono text-brand-brown/50 w-20 text-right">
                    {dataHoraBR(m.quando)}
                  </span>
                </div>
              </div>
            ))}
            {movimentos.length === 0 && (
              <p className="px-4 py-8 text-center text-[11px] text-brand-brown/50">
                Nenhuma movimentação registrada.
              </p>
            )}
          </div>
        </div>
      )}

      {aba === "fichas" && <FichaTecnicaPanel produtos={produtos} servicos={servicos} />}

      {entrada && (
        <EntradaModal
          produto={entrada}
          aoFechar={() => setEntrada(null)}
          aoSalvar={carregar}
        />
      )}

      {editor && (
        <ProdutoModal
          produto={editor.produto}
          /* As categorias que JÁ existem, para o formulário sugerir em vez de
            * deixar cada cadastro inventar uma grafia. "Sem categoria" é rótulo
            * de tela, não categoria de verdade, então fica de fora. */
          categorias={Object.keys(porCategoria).filter((c) => c !== "Sem categoria").sort()}
          aoFechar={() => setEditor(null)}
          aoSalvar={carregar}
        />
      )}
    </div>
  );
}

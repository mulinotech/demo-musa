/**
 * Ficha técnica do serviço (T3.3 + T3.4).
 *
 * É a tabela que liga um procedimento aos insumos que ele consome. Duas coisas
 * dependem dela: a baixa automática quando o atendimento é concluído, e o
 * custo variável que a precificação usa.
 *
 * Por isso o custo aparece somado ao vivo, item a item — quem monta a ficha
 * está, sem perceber, definindo o piso do preço do procedimento. Ver o número
 * crescer enquanto adiciona agulha e anestésico é o que torna essa relação
 * óbvia.
 *
 * Serviço sem ficha continua funcionando: a precificação cai no valor digitado
 * e a conclusão do atendimento não baixa nada. O que não pode é a tela deixar
 * isso ambíguo.
 */
import { useEffect, useState } from "react";
import { Plus, Trash2, Check, AlertTriangle } from "lucide-react";
import { Produto, reais, qtd } from "./comum";

interface Servico {
  id: string;
  name: string;
}

interface ItemFicha {
  productId: string;
  produto: string;
  unidade: string;
  quantidade: number;
  custoUnitario: number;
  parcial: number;
}

export default function FichaTecnicaPanel(p: { produtos: Produto[]; servicos: Servico[] }) {
  const [servicoId, setServicoId] = useState("");
  const [itens, setItens] = useState<ItemFicha[]>([]);
  const [origem, setOrigem] = useState<"FICHA_TECNICA" | "MANUAL">("MANUAL");
  const [custo, setCusto] = useState(0);
  const [novo, setNovo] = useState({ productId: "", quantity: "" });
  const [recado, setRecado] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!servicoId) return setItens([]);
    (async () => {
      const r = await fetch("/api/services/" + servicoId + "/supplies");
      const d = await r.json();
      if (!r.ok) return setErro(d.error || "Não foi possível ler a ficha.");
      setItens(d.itens || []);
      setCusto(d.custoVariavel || 0);
      setOrigem(d.origem);
      setErro("");
      setRecado("");
    })();
  }, [servicoId]);

  const total = itens.reduce((s, i) => s + i.parcial, 0);

  const salvar = async (lista: ItemFicha[]) => {
    setOcupado(true);
    try {
      const r = await fetch("/api/services/" + servicoId + "/supplies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itens: lista.map((i) => ({ productId: i.productId, quantity: i.quantidade })) }),
      });
      const d = await r.json();
      if (!r.ok) return setErro(d.error || "Não foi possível salvar.");
      setItens(lista);
      setCusto(d.valor || 0);
      setOrigem(lista.length ? "FICHA_TECNICA" : "MANUAL");
      setErro("");
      setRecado(
        lista.length
          ? "Ficha salva. O custo variável da precificação passa a sair daqui: " +
            reais(d.valor) + "."
          : "Ficha esvaziada. A precificação volta a usar o custo digitado no serviço.",
      );
    } finally {
      setOcupado(false);
    }
  };

  const adicionar = () => {
    const prod = p.produtos.find((x) => x.id === novo.productId);
    const q = Number(String(novo.quantity).replace(",", ".")) || 0;
    if (!prod || q <= 0) return setErro("Escolha o produto e a quantidade.");
    if (itens.some((i) => i.productId === prod.id)) return setErro("Este produto já está na ficha.");
    const item: ItemFicha = {
      productId: prod.id, produto: prod.name, unidade: prod.unit,
      quantidade: q, custoUnitario: prod.unitCost, parcial: Math.round(q * prod.unitCost * 100) / 100,
    };
    setNovo({ productId: "", quantity: "" });
    salvar(itens.concat([item]));
  };

  const campo =
    "w-full bg-white border border-brand-gold/30 rounded px-3 py-2 text-xs text-brand-brown focus:outline-none focus:border-brand-brown transition-colors";
  const rotulo = "block text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold mb-1";

  return (
    <div className="space-y-4">
      <div className="bg-white border border-brand-gold/15 rounded-2xl p-4 space-y-3">
        <div>
          <label className={rotulo}>Serviço do catálogo</label>
          <select className={campo} value={servicoId} onChange={(e) => setServicoId(e.target.value)}>
            <option value="">Escolha um serviço…</option>
            {p.servicos.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {erro && (
          <div className="rounded-xl px-4 py-3 text-xs border bg-red-50 border-red-200 text-red-700 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <p>{erro}</p>
          </div>
        )}
        {recado && (
          <div className="rounded-xl px-4 py-3 text-xs border bg-emerald-50 border-emerald-200 text-emerald-800 flex items-start gap-2">
            <Check className="h-4 w-4 shrink-0 mt-0.5" />
            <p>{recado}</p>
          </div>
        )}
      </div>

      {servicoId && (
        <div className="bg-white border border-brand-gold/15 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-brand-gold/15 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-brand-brown">Insumos consumidos por atendimento</p>
              <p className="text-[10px] text-brand-brown/60">
                {itens.length === 0
                  ? "Sem ficha: a conclusão do atendimento não baixa nada e a precificação usa o custo digitado."
                  : "A conclusão do atendimento baixa estes itens automaticamente, por validade mais próxima."}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className={rotulo}>Custo variável</p>
              <p className="text-base font-mono font-bold text-brand-brown">{reais(itens.length ? total : custo)}</p>
              <p className="text-[9px] uppercase tracking-wider text-brand-brown/50">
                {origem === "FICHA_TECNICA" ? "calculado pela ficha" : "informado manualmente"}
              </p>
            </div>
          </div>

          <div className="divide-y divide-brand-gold/10">
            {itens.map((i) => (
              <div key={i.productId} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-brand-brown truncate">{i.produto}</p>
                  <p className="text-[10px] text-brand-brown/55">
                    {qtd(i.quantidade)} {i.unidade} × {reais(i.custoUnitario)}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs font-mono text-brand-brown/80">{reais(i.parcial)}</span>
                  <button
                    onClick={() => salvar(itens.filter((x) => x.productId !== i.productId))}
                    disabled={ocupado}
                    className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {itens.length === 0 && (
              <p className="px-4 py-6 text-center text-[11px] text-brand-brown/50">
                Nenhum insumo nesta ficha ainda.
              </p>
            )}
          </div>

          <div className="px-4 py-3 border-t border-brand-gold/15 bg-brand-beige/40 flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[12rem]">
              <label className={rotulo}>Produto</label>
              <select className={campo} value={novo.productId} onChange={(e) => setNovo({ ...novo, productId: e.target.value })}>
                <option value="">Escolha…</option>
                {p.produtos.filter((x) => x.active).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({reais(x.unitCost)}/{x.unit})
                  </option>
                ))}
              </select>
            </div>
            <div className="w-28">
              <label className={rotulo}>Quantidade</label>
              <input className={campo} value={novo.quantity} onChange={(e) => setNovo({ ...novo, quantity: e.target.value })} placeholder="0" />
            </div>
            <button
              onClick={adicionar}
              disabled={ocupado}
              className="flex items-center gap-1.5 bg-brand-brown hover:bg-brand-brown/95 disabled:opacity-50 text-brand-beige px-4 py-2 rounded-xl text-[11px] font-bold cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 text-brand-gold" />
              Adicionar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

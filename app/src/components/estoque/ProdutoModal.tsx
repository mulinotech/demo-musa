/**
 * Cadastro e edição de produto do estoque.
 *
 * ============================================== POR QUE ISTO FALTAVA ATÉ 11/09
 *
 * `POST /api/products` e `PATCH /api/products/:id` existiam completos no
 * servidor desde sempre — e **nenhuma tela do sistema os chamava**. Os produtos
 * que existiam vieram do script que semeou a demonstração. Quer dizer: uma
 * clínica nova abria o Estoque vazio, sem nada a fazer ali.
 *
 * Foi achado em 10/09, na conferência de gravações da M1.7, e era o único dos
 * oito itens em que o relato ("não tem onde acrescentar produto") descrevia uma
 * tela que **de fato não existia** — os outros dois eram botão escondido e tela
 * errada.
 *
 * ==================================== A CATEGORIA É TEXTO LIVRE, E ISSO MORDE
 *
 * `products.category` é uma coluna de texto, e a aba Saldo agrupa por ela. Um
 * formulário com campo livre faz cada cadastro inventar uma grafia —
 * "Descartável", "descartaveis", "Descartáveis" — e o agrupamento se parte em
 * três seções com o mesmo significado, sem nenhum erro em lugar nenhum.
 *
 * Daí o `datalist`: o campo **sugere as categorias que já existem** e ainda
 * aceita uma nova. É a diferença entre um campo que convida à consistência e um
 * que convida à divergência.
 */
import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { Produto, UNIDADES } from "./comum";

interface Props {
  /** `null` = cadastrar; um produto = editar aquele. */
  produto: Produto | null;
  /** As categorias já usadas, para o campo sugerir em vez de deixar inventar. */
  categorias: string[];
  aoFechar: () => void;
  aoSalvar: () => void;
}

export default function ProdutoModal({ produto, categorias, aoFechar, aoSalvar }: Props) {
  const editando = !!produto;
  const [form, setForm] = useState({
    name: produto?.name || "",
    category: produto?.category || "",
    unit: produto?.unit || "UN",
    minStock: produto ? String(produto.minStock) : "",
    unitCost: produto ? String(produto.unitCost) : "",
    salePrice: produto?.salePrice != null ? String(produto.salePrice) : "",
    sku: produto?.sku || "",
    supplier: produto?.supplier || "",
    controlled: produto?.controlled || false,
  });
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const campo =
    "w-full px-3 py-2 rounded-xl border border-brand-gold/25 bg-white text-xs text-brand-brown focus:outline-none focus:border-brand-brown";
  const rotulo =
    "block text-[10px] font-bold uppercase tracking-wider text-brand-brown/60 mb-1";

  const salvar = async () => {
    const nome = form.name.trim();
    if (!nome) return setErro("O produto precisa de um nome.");
    setOcupado(true);
    setErro("");
    try {
      const corpo = {
        name: nome,
        category: form.category.trim() || null,
        unit: form.unit,
        minStock: form.minStock === "" ? 0 : Number(form.minStock),
        unitCost: form.unitCost === "" ? 0 : Number(form.unitCost),
        // Vazio vira `null`, e não zero: "não tem preço de venda" e "vende por
        // R$ 0,00" são coisas diferentes, e o servidor distingue as duas.
        salePrice: form.salePrice === "" ? null : Number(form.salePrice),
        sku: form.sku.trim() || null,
        supplier: form.supplier.trim() || null,
        controlled: form.controlled,
      };
      const r = await fetch(
        editando ? "/api/products/" + produto!.id : "/api/products",
        {
          method: editando ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        },
      );
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error || "Não foi possível salvar o produto.");
        return;
      }
      aoSalvar();
      aoFechar();
    } catch {
      setErro("Erro de conexão ao salvar o produto.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-brand-brown/30 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl border border-brand-gold/20 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-brand-gold/15 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-serif font-bold text-brand-brown">
              {editando ? "Editar produto" : "Novo produto"}
            </h3>
            <p className="text-[10px] text-brand-brown/60">
              {editando
                ? "Mudar o cadastro não mexe no saldo nem nos lotes."
                : "O produto nasce sem saldo — a quantidade entra depois, por “dar entrada”."}
            </p>
          </div>
          <button
            onClick={aoFechar}
            className="p-1.5 rounded-lg text-brand-brown/50 hover:bg-brand-beige cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {erro && (
            <div className="text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 py-2 px-3 rounded-xl">
              {erro}
            </div>
          )}

          <div>
            <label className={rotulo}>Nome *</label>
            <input
              className={campo}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex.: Luva de procedimento (par)"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={rotulo}>Categoria</label>
              <input
                className={campo}
                list="categorias-de-produto"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="Ex.: Descartáveis"
              />
              {/* Sugere as que já existem e ainda aceita uma nova. Sem isto, a
                * mesma categoria vira três grafias e a aba Saldo se parte. */}
              <datalist id="categorias-de-produto">
                {categorias.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={rotulo}>Unidade</label>
              <select
                className={campo + " cursor-pointer"}
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value as Produto["unit"] })}
              >
                {UNIDADES.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={rotulo}>Estoque mínimo</label>
              <input
                className={campo}
                type="number"
                min={0}
                value={form.minStock}
                onChange={(e) => setForm({ ...form, minStock: e.target.value })}
                placeholder="0"
              />
            </div>
            <div>
              <label className={rotulo}>Custo (R$)</label>
              <input
                className={campo}
                type="number"
                min={0}
                step="0.01"
                value={form.unitCost}
                onChange={(e) => setForm({ ...form, unitCost: e.target.value })}
                placeholder="0,00"
              />
            </div>
            <div>
              <label className={rotulo}>Venda (R$)</label>
              <input
                className={campo}
                type="number"
                min={0}
                step="0.01"
                value={form.salePrice}
                onChange={(e) => setForm({ ...form, salePrice: e.target.value })}
                placeholder="opcional"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={rotulo}>Código / SKU</label>
              <input
                className={campo}
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                placeholder="opcional"
              />
            </div>
            <div>
              <label className={rotulo}>Fornecedor</label>
              <input
                className={campo}
                value={form.supplier}
                onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                placeholder="opcional"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-[11px] text-brand-brown/80 cursor-pointer">
            <input
              type="checkbox"
              checked={form.controlled}
              onChange={(e) => setForm({ ...form, controlled: e.target.checked })}
              className="cursor-pointer"
            />
            Produto controlado (aparece marcado na lista)
          </label>
        </div>

        <div className="px-5 py-4 border-t border-brand-gold/15 flex items-center justify-end gap-2">
          <button
            onClick={aoFechar}
            className="px-4 py-2 rounded-xl text-[11px] font-semibold text-brand-brown/70 hover:bg-brand-beige cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={ocupado}
            className="flex items-center gap-1.5 bg-brand-brown hover:bg-brand-brown/95 disabled:opacity-50 text-brand-beige px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider cursor-pointer"
          >
            {ocupado && <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-gold" />}
            {editando ? "Salvar" : "Cadastrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

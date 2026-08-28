/**
 * Painel de custos fixos (T2.1).
 *
 * O numero que justifica esta tela e o **custo por hora**: aluguel, energia,
 * software, contador e pro-labore divididos pelas horas produtivas do mes. E a
 * informacao que a dona da clinica normalmente nunca viu, e sem ela nao existe
 * preco - existe chute.
 */
import { useEffect, useState } from "react";
import { Plus, Trash2, Power, RefreshCw } from "lucide-react";
import { reais } from "./comum";

interface CustoFixo {
  id: string;
  name: string;
  monthlyAmount: number;
  category: string | null;
  active: boolean;
}

interface Resposta {
  itens: CustoFixo[];
  totalMensal: number;
  horasProdutivas: number;
  custoPorHora: number | null;
}

const CATEGORIAS = ["Estrutura", "Pessoal", "Equipamentos", "Software", "Impostos e taxas", "Outros"];

export default function CustosFixosPanel({ aoMudar }: { aoMudar?: () => void }) {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [novo, setNovo] = useState({ name: "", monthlyAmount: "", category: "Estrutura" });
  const [salvando, setSalvando] = useState(false);

  const carregar = async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/fixed-costs");
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        setErro(e.error || "Não foi possível carregar os custos fixos.");
        return;
      }
      setErro("");
      setDados(await r.json());
    } catch {
      setErro("Erro de conexão ao carregar os custos fixos.");
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const avisar = () => {
    carregar();
    if (aoMudar) aoMudar();
  };

  const criar = async () => {
    const valor = Number(String(novo.monthlyAmount).replace(",", "."));
    if (!novo.name.trim()) return setErro("Dê um nome ao custo.");
    if (!isFinite(valor) || valor < 0) return setErro("Informe um valor mensal válido.");
    setSalvando(true);
    try {
      const r = await fetch("/api/fixed-costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: novo.name.trim(), monthlyAmount: valor, category: novo.category }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        return setErro(e.error || "Não foi possível cadastrar.");
      }
      setNovo({ name: "", monthlyAmount: "", category: "Estrutura" });
      setErro("");
      avisar();
    } finally {
      setSalvando(false);
    }
  };

  const alternar = async (c: CustoFixo) => {
    await fetch("/api/fixed-costs/" + c.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !c.active }),
    });
    avisar();
  };

  const remover = async (c: CustoFixo) => {
    if (!window.confirm('Remover "' + c.name + '" dos custos fixos?')) return;
    await fetch("/api/fixed-costs/" + c.id, { method: "DELETE" });
    avisar();
  };

  const campo =
    "bg-white border border-brand-gold/30 rounded px-3 py-2 text-xs text-brand-brown focus:outline-none focus:border-brand-brown transition-colors";

  return (
    <div className="space-y-5">
      {erro && (
        <div className="rounded-xl px-4 py-3 text-xs border bg-red-50 border-red-200 text-red-700">{erro}</div>
      )}

      {/* O par de números que dá sentido ao resto */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-brand-gold/15 border border-brand-gold/15 rounded-2xl overflow-hidden">
        <div className="bg-white p-4">
          <p className="text-[10px] uppercase tracking-widest text-brand-brown/55 font-bold mb-1">Custo fixo mensal</p>
          <p className="text-2xl font-serif font-semibold text-brand-brown">{reais(dados?.totalMensal ?? 0)}</p>
        </div>
        <div className="bg-white p-4">
          <p className="text-[10px] uppercase tracking-widest text-brand-brown/55 font-bold mb-1">Horas produtivas/mês</p>
          <p className="text-2xl font-serif font-semibold text-brand-brown">
            {dados ? dados.horasProdutivas.toLocaleString("pt-BR") : "—"}
          </p>
        </div>
        <div className="bg-brand-beige/70 p-4">
          <p className="text-[10px] uppercase tracking-widest text-brand-gold font-bold mb-1">Custo por hora</p>
          <p className="text-2xl font-serif font-semibold text-brand-brown">{reais(dados?.custoPorHora ?? null)}</p>
          <p className="text-[10px] text-brand-brown/60 mt-1 leading-relaxed">
            É o que a clínica gasta por hora aberta, antes de qualquer insumo.
          </p>
        </div>
      </div>

      {/* Cadastro */}
      <div className="bg-white border border-brand-gold/15 rounded-2xl p-4">
        <div className="flex flex-col md:flex-row gap-3 md:items-end">
          <div className="flex-1">
            <label className="block text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold mb-1">Custo</label>
            <input
              className={campo + " w-full"}
              value={novo.name}
              onChange={(e) => setNovo({ ...novo, name: e.target.value })}
              placeholder="Aluguel, energia, contador, pró-labore..."
            />
          </div>
          <div className="w-full md:w-40">
            <label className="block text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold mb-1">Valor mensal</label>
            <input
              className={campo + " w-full"}
              inputMode="decimal"
              value={novo.monthlyAmount}
              onChange={(e) => setNovo({ ...novo, monthlyAmount: e.target.value })}
              placeholder="0,00"
            />
          </div>
          <div className="w-full md:w-44">
            <label className="block text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold mb-1">Categoria</label>
            <select className={campo + " w-full"} value={novo.category} onChange={(e) => setNovo({ ...novo, category: e.target.value })}>
              {CATEGORIAS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <button
            onClick={criar}
            disabled={salvando}
            className="flex items-center justify-center gap-1.5 bg-brand-brown hover:bg-brand-brown/95 disabled:opacity-60 text-brand-beige px-4 py-2 rounded-xl text-[11px] font-bold transition-all shadow-sm border border-brand-gold/20 cursor-pointer whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5 text-brand-gold" />
            Adicionar
          </button>
        </div>
      </div>

      {/* Lista */}
      <div className="bg-white border border-brand-gold/15 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-brand-beige/60">
          <h3 className="text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold">
            {dados ? dados.itens.length : 0} custo{dados && dados.itens.length === 1 ? "" : "s"} cadastrado
            {dados && dados.itens.length === 1 ? "" : "s"}
          </h3>
          <button onClick={carregar} className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-brown/70 hover:text-brand-brown cursor-pointer">
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar
          </button>
        </div>

        {carregando ? (
          <p className="p-8 text-center text-[11px] font-mono uppercase tracking-widest text-brand-brown/60">Carregando...</p>
        ) : !dados || dados.itens.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <p className="text-xs text-brand-brown/70">Nenhum custo fixo cadastrado ainda.</p>
            <p className="text-[11px] text-brand-brown/50 max-w-md mx-auto leading-relaxed">
              Sem eles a calculadora só enxerga o insumo do procedimento — e o preço sai barato demais,
              porque a estrutura da clínica não entra na conta.
            </p>
          </div>
        ) : (
          <table className="w-full text-left">
            <tbody>
              {dados.itens.map((c) => (
                <tr key={c.id} className={"border-t border-brand-gold/10 " + (c.active ? "" : "opacity-50")}>
                  <td className="px-4 py-3">
                    <p className="text-xs font-semibold text-brand-brown">{c.name}</p>
                    <p className="text-[10px] text-brand-brown/50">{c.category || "sem categoria"}{c.active ? "" : " · inativo"}</p>
                  </td>
                  <td className="px-4 py-3 text-right text-xs font-mono text-brand-brown whitespace-nowrap">
                    {reais(c.monthlyAmount)}
                  </td>
                  <td className="px-4 py-3 w-px">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => alternar(c)}
                        title={c.active ? "Tirar da conta sem apagar" : "Voltar para a conta"}
                        className="p-1.5 rounded-lg text-brand-brown/60 hover:bg-brand-beige cursor-pointer"
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => remover(c)}
                        title="Remover"
                        className="p-1.5 rounded-lg text-red-600/70 hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
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

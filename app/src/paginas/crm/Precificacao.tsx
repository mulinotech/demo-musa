/**
 * Precificação — rota /crm/precificacao (T2.3).
 *
 * Três seções na mesma tela porque elas se explicam em sequência: custos fixos
 * dão o custo por hora, o custo por hora entra na calculadora, e o histórico
 * guarda a decisão. Separar em rotas diferentes faria a pessoa navegar para
 * entender uma conta só.
 *
 * Só admin e gerente chegam aqui — a rota e a API concordam, e quem manda é a
 * API (REGRAS_DE_PAPEL).
 */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Calculator, Building2, Settings2 } from "lucide-react";
import CustosFixosPanel from "../../components/precificacao/CustosFixosPanel";
import CalculadoraPreco from "../../components/precificacao/CalculadoraPreco";
import HistoricoSimulacoes from "../../components/precificacao/HistoricoSimulacoes";
import { Parametros, ServicoCatalogo } from "../../components/precificacao/comum";

type Aba = "calculadora" | "custos" | "parametros";

export default function Precificacao() {
  const [params] = useSearchParams();
  const [aba, setAba] = useState<Aba>("calculadora");
  const [parametros, setParametros] = useState<Parametros | null>(null);
  const [servicos, setServicos] = useState<ServicoCatalogo[]>([]);
  const [versao, setVersao] = useState(0);
  const [erro, setErro] = useState("");

  const carregarParametros = useCallback(async () => {
    try {
      const r = await fetch("/api/pricing/settings");
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        setErro(e.error || "Não foi possível carregar os parâmetros.");
        return;
      }
      setErro("");
      setParametros(await r.json());
    } catch {
      setErro("Erro de conexão ao carregar os parâmetros.");
    }
  }, []);

  const carregarServicos = useCallback(async () => {
    try {
      const r = await fetch("/api/treatment-catalog");
      if (r.ok) setServicos(await r.json());
    } catch {
      /* catálogo vazio não impede simular avulso */
    }
  }, []);

  useEffect(() => {
    carregarParametros();
    carregarServicos();
  }, [carregarParametros, carregarServicos]);

  const aposAplicar = () => {
    setVersao((v) => v + 1);
    carregarServicos();
  };

  const abas: { id: Aba; rotulo: string; icone: typeof Calculator }[] = [
    { id: "calculadora", rotulo: "Calculadora", icone: Calculator },
    { id: "custos", rotulo: "Custos fixos", icone: Building2 },
    { id: "parametros", rotulo: "Parâmetros", icone: Settings2 },
  ];

  return (
    <div className="space-y-5">
      <div className="bg-white border border-brand-gold/15 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h3 className="text-xs font-serif font-bold text-brand-brown uppercase tracking-wider">Precificação</h3>
          <p className="text-[10px] text-brand-brown/65">
            Quanto cobrar para a estrutura da clínica caber no preço, e não no prejuízo.
          </p>
        </div>
        <nav className="flex items-center gap-2">
          {abas.map((a) => {
            const Icone = a.icone;
            const ativa = aba === a.id;
            return (
              <button
                key={a.id}
                onClick={() => setAba(a.id)}
                className={
                  "flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold transition-all cursor-pointer " +
                  (ativa
                    ? "bg-brand-brown text-brand-beige shadow-sm"
                    : "bg-brand-brown/5 text-brand-brown/80 hover:bg-brand-beige")
                }
              >
                <Icone className="h-3.5 w-3.5 text-brand-gold" />
                {a.rotulo}
              </button>
            );
          })}
        </nav>
      </div>

      {erro && <div className="rounded-xl px-4 py-3 text-xs border bg-red-50 border-red-200 text-red-700">{erro}</div>}

      {aba === "calculadora" && (
        <div className="space-y-5">
          <CalculadoraPreco
            parametros={parametros}
            servicos={servicos}
            servicoInicial={params.get("servico") || undefined}
            aoAplicar={aposAplicar}
          />
          <HistoricoSimulacoes recarregar={versao} />
        </div>
      )}

      {aba === "custos" && <CustosFixosPanel aoMudar={carregarParametros} />}

      {aba === "parametros" && <PainelParametros parametros={parametros} aoSalvar={carregarParametros} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function PainelParametros({ parametros, aoSalvar }: { parametros: Parametros | null; aoSalvar: () => void }) {
  const [form, setForm] = useState({
    monthlyWorkingHours: "",
    targetMarginPct: "",
    cardFeePct: "",
    taxPct: "",
    defaultCommissionPct: "",
  });
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  useEffect(() => {
    if (!parametros) return;
    setForm({
      monthlyWorkingHours: String(parametros.monthlyWorkingHours),
      targetMarginPct: String(parametros.targetMarginPct),
      cardFeePct: String(parametros.cardFeePct),
      taxPct: String(parametros.taxPct),
      defaultCommissionPct: String(parametros.defaultCommissionPct),
    });
  }, [parametros]);

  const salvar = async () => {
    setSalvando(true);
    try {
      const corpo: Record<string, number> = {};
      for (const [k, v] of Object.entries(form)) corpo[k] = Number(String(v).replace(",", "."));
      const r = await fetch("/api/pricing/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const d = await r.json().catch(() => ({}));
      setAviso(r.ok ? { tipo: "ok", texto: "Parâmetros salvos." } : { tipo: "erro", texto: d.error || "Não foi possível salvar." });
      if (r.ok) aoSalvar();
    } finally {
      setSalvando(false);
      window.setTimeout(() => setAviso(null), 5000);
    }
  };

  const campo =
    "w-full bg-white border border-brand-gold/30 rounded px-3 py-2 text-xs text-brand-brown focus:outline-none focus:border-brand-brown transition-colors";
  const rotulo = "block text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold mb-1";

  const campos: { chave: keyof typeof form; label: string; ajuda: string }[] = [
    {
      chave: "monthlyWorkingHours",
      label: "Horas produtivas por mês",
      ajuda: "Só as horas em que se atende de fato. Contar as horas abertas infla o denominador e barateia tudo.",
    },
    { chave: "targetMarginPct", label: "Margem desejada (%)", ajuda: "O lucro que sobra depois de tudo, sobre o preço de venda." },
    { chave: "defaultCommissionPct", label: "Comissão padrão (%)", ajuda: "Usada como sugestão inicial na calculadora." },
    { chave: "cardFeePct", label: "Taxa de cartão (%)", ajuda: "Média ponderada entre débito, crédito à vista e parcelado." },
    { chave: "taxPct", label: "Imposto (%)", ajuda: "Alíquota efetiva sobre o serviço." },
  ];

  return (
    <div className="space-y-4">
      {aviso && (
        <div
          className={
            "rounded-xl px-4 py-3 text-xs border " +
            (aviso.tipo === "ok"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-700")
          }
        >
          {aviso.texto}
        </div>
      )}

      <div className="bg-white border border-brand-gold/15 rounded-2xl p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {campos.map((c) => (
            <div key={c.chave}>
              <label className={rotulo}>{c.label}</label>
              <input
                className={campo}
                inputMode="decimal"
                value={form[c.chave]}
                onChange={(ev) => setForm({ ...form, [c.chave]: ev.target.value })}
              />
              <p className="text-[10px] text-brand-brown/50 mt-1 leading-relaxed">{c.ajuda}</p>
            </div>
          ))}
        </div>

        <button
          onClick={salvar}
          disabled={salvando}
          className="bg-brand-brown hover:bg-brand-brown/95 disabled:opacity-60 text-brand-beige px-5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest cursor-pointer transition-colors"
        >
          {salvando ? "Salvando..." : "Salvar parâmetros"}
        </button>
      </div>
    </div>
  );
}

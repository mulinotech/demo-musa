/**
 * Calculadora de preço (T2.3).
 *
 * Recalcula sozinha a cada mudança, sem botão "calcular" — o valor da tela está
 * em ver o preço se mexer enquanto se mexe na margem.
 *
 * A conta NÃO é feita aqui. Ela vive em server/services/precificacao.js, com
 * teste de referência centavo a centavo. Duplicar a fórmula no front seria
 * garantir que um dos dois lados ficasse errado sem ninguém perceber — por isso
 * a tela chama /api/pricing/simulate, com um respiro de 450 ms para não disparar
 * uma requisição por tecla.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Calculator, TrendingUp, AlertTriangle, Check } from "lucide-react";
import { reais, pct, Parametros, ResultadoCalculo, Comparacao, ServicoCatalogo } from "./comum";

interface Props {
  parametros: Parametros | null;
  servicos: ServicoCatalogo[];
  servicoInicial?: string;
  aoAplicar: () => void;
}

interface Entradas {
  catalogId: string;
  serviceName: string;
  durationMin: string;
  variableCost: string;
  marginPct: string;
  commissionPct: string;
  cardFeePct: string;
  taxPct: string;
  currentPrice: string;
}

const numero = (v: string) => {
  const n = Number(String(v).replace(",", "."));
  return isFinite(n) ? n : NaN;
};

export default function CalculadoraPreco({ parametros, servicos, servicoInicial, aoAplicar }: Props) {
  const [e, setE] = useState<Entradas>({
    catalogId: "",
    serviceName: "",
    durationMin: "60",
    variableCost: "0",
    marginPct: "",
    commissionPct: "",
    cardFeePct: "",
    taxPct: "",
    currentPrice: "",
  });
  const [resultado, setResultado] = useState<ResultadoCalculo | null>(null);
  /* De onde vem o custo de insumo: da ficha tecnica do servico (soma real dos
     produtos, com o custo medio de hoje) ou digitado a mao. Um custo de R$ 120
     pode ser qualquer um dos dois, e os dois levam a decisoes diferentes -- sem
     dizer qual e, o sistema faz um chute antigo parecer calculo. */
  const [custoInfo, setCustoInfo] = useState<{ origem: string; daFicha: number | null; itensDaFicha: number } | null>(null);
  const [comparacao, setComparacao] = useState<Comparacao | null>(null);
  const [erro, setErro] = useState("");
  const [calculando, setCalculando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [aplicado, setAplicado] = useState("");
  const [preenchido, setPreenchido] = useState(false);

  // Preenche os percentuais com os parâmetros globais, uma vez só.
  useEffect(() => {
    if (!parametros || preenchido) return;
    setE((a) => ({
      ...a,
      marginPct: a.marginPct || String(parametros.targetMarginPct),
      commissionPct: a.commissionPct || String(parametros.defaultCommissionPct),
      cardFeePct: a.cardFeePct || String(parametros.cardFeePct),
      taxPct: a.taxPct || String(parametros.taxPct),
    }));
    setPreenchido(true);
  }, [parametros, preenchido]);

  const escolherServico = (id: string) => {
    const s = servicos.find((x) => x.id === id);
    if (!s) {
      setE((a) => ({ ...a, catalogId: "", serviceName: "", currentPrice: "" }));
      return;
    }
    setAplicado("");
    setE((a) => ({
      ...a,
      catalogId: s.id,
      serviceName: s.name,
      durationMin: s.duration_min ? String(s.duration_min) : "",
      variableCost: s.variable_cost !== null ? String(s.variable_cost) : a.variableCost,
      commissionPct: s.commission_pct !== null ? String(s.commission_pct) : a.commissionPct,
      currentPrice: String(s.price),
    }));
  };

  useEffect(() => {
    if (servicoInicial && servicos.length) escolherServico(servicoInicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicoInicial, servicos.length]);

  const servicoEscolhido = servicos.find((s) => s.id === e.catalogId) || null;
  const duracaoIndefinida = !!servicoEscolhido && !servicoEscolhido.duration_min && !e.durationMin;

  const carga = useMemo(
    () => ({
      catalogId: e.catalogId || undefined,
      serviceName: e.serviceName || undefined,
      durationMin: numero(e.durationMin),
      variableCost: numero(e.variableCost),
      marginPct: numero(e.marginPct),
      commissionPct: numero(e.commissionPct),
      cardFeePct: numero(e.cardFeePct),
      taxPct: numero(e.taxPct),
      currentPrice: e.currentPrice === "" ? undefined : numero(e.currentPrice),
    }),
    [e],
  );

  const ultimaCarga = useRef("");

  useEffect(() => {
    if (!parametros || !preenchido) return;
    const assinatura = JSON.stringify(carga);
    if (assinatura === ultimaCarga.current) return;

    const t = window.setTimeout(async () => {
      ultimaCarga.current = assinatura;
      setCalculando(true);
      try {
        const r = await fetch("/api/pricing/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(carga),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          setErro(d.error || "Não foi possível calcular.");
          setResultado(null);
          setComparacao(null);
          return;
        }
        setErro("");
        setResultado(d.resultado);
        setComparacao(d.comparacao);
        setCustoInfo(d.custoVariavel || null);
      } catch {
        setErro("Erro de conexão ao calcular.");
      } finally {
        setCalculando(false);
      }
    }, 450);

    return () => window.clearTimeout(t);
  }, [carga, parametros, preenchido]);

  const aplicar = async () => {
    if (!resultado) return;
    const alvo = servicoEscolhido ? servicoEscolhido.name : e.serviceName || "esta simulação";
    const texto = servicoEscolhido
      ? 'Alterar o preço de "' + alvo + '" de ' + reais(Number(e.currentPrice)) + " para " + reais(resultado.precoSugerido) + "?"
      : "Guardar esta simulação no histórico?";
    if (!window.confirm(texto)) return;

    setAplicando(true);
    try {
      const r = await fetch("/api/pricing/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...carga, aplicar: !!e.catalogId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error || "Não foi possível aplicar.");
        return;
      }
      setAplicado(
        d.aplicado
          ? alvo + " agora custa " + reais(resultado.precoSugerido) + "."
          : "Simulação guardada no histórico.",
      );
      if (d.aplicado) setE((a) => ({ ...a, currentPrice: String(resultado.precoSugerido) }));
      aoAplicar();
    } finally {
      setAplicando(false);
    }
  };

  const campo =
    "w-full bg-white border border-brand-gold/30 rounded px-3 py-2 text-xs text-brand-brown focus:outline-none focus:border-brand-brown transition-colors";
  const rotulo = "block text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold mb-1";

  const somaPct =
    (numero(e.marginPct) || 0) + (numero(e.commissionPct) || 0) + (numero(e.cardFeePct) || 0) + (numero(e.taxPct) || 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
      {/* ---------------- entradas ---------------- */}
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-white border border-brand-gold/15 rounded-2xl p-5 space-y-4">
          <div>
            <label className={rotulo}>Serviço</label>
            <select className={campo} value={e.catalogId} onChange={(ev) => escolherServico(ev.target.value)}>
              <option value="">Simulação avulsa</option>
              {servicos.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {!e.catalogId && (
            <div>
              <label className={rotulo}>Nome da simulação</label>
              <input
                className={campo}
                value={e.serviceName}
                onChange={(ev) => setE({ ...e, serviceName: ev.target.value })}
                placeholder="Ex.: Protocolo novo de skinbooster"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={rotulo}>Duração (min)</label>
              <input
                className={campo + (duracaoIndefinida ? " border-amber-400" : "")}
                inputMode="numeric"
                value={e.durationMin}
                onChange={(ev) => setE({ ...e, durationMin: ev.target.value })}
                placeholder="60"
              />
            </div>
            <div>
              <label className={rotulo}>Insumos (R$)</label>
              <input
                className={campo}
                inputMode="decimal"
                value={e.variableCost}
                onChange={(ev) => setE({ ...e, variableCost: ev.target.value })}
                placeholder="0,00"
              />
              {custoInfo && custoInfo.daFicha !== null && (
                Math.abs(custoInfo.daFicha - (numero(e.variableCost) || 0)) < 0.01 ? (
                  <p className="text-[9px] uppercase tracking-wider text-emerald-700 mt-1">
                    calculado pela ficha técnica ({custoInfo.itensDaFicha} insumos)
                  </p>
                ) : (
                  <button
                    onClick={() => setE({ ...e, variableCost: String(custoInfo.daFicha) })}
                    className="text-[9px] uppercase tracking-wider text-brand-brown/70 hover:text-brand-brown mt-1 underline decoration-dotted cursor-pointer text-left"
                  >
                    ficha técnica soma {reais(custoInfo.daFicha)} · usar
                  </button>
                )
              )}
              {custoInfo && custoInfo.daFicha === null && (
                <p className="text-[9px] uppercase tracking-wider text-brand-brown/45 mt-1">
                  informado manualmente · sem ficha técnica
                </p>
              )}
            </div>
          </div>

          {duracaoIndefinida && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 leading-relaxed">
              A duração deste serviço está cadastrada como texto
              {servicoEscolhido?.duration ? ' ("' + servicoEscolhido.duration + '")' : ""} e não dá para
              deduzir os minutos com segurança. Digite a duração real — precificar em cima de um palpite
              erra o valor por hora, que é justamente o número que interessa aqui.
            </p>
          )}

          <div className="pt-1 border-t border-brand-gold/10">
            <p className="text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold mb-3 mt-3">
              Percentuais sobre a venda
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={rotulo}>Margem (%)</label>
                <input className={campo} inputMode="decimal" value={e.marginPct} onChange={(ev) => setE({ ...e, marginPct: ev.target.value })} />
              </div>
              <div>
                <label className={rotulo}>Comissão (%)</label>
                <input className={campo} inputMode="decimal" value={e.commissionPct} onChange={(ev) => setE({ ...e, commissionPct: ev.target.value })} />
              </div>
              <div>
                <label className={rotulo}>Cartão (%)</label>
                <input className={campo} inputMode="decimal" value={e.cardFeePct} onChange={(ev) => setE({ ...e, cardFeePct: ev.target.value })} />
              </div>
              <div>
                <label className={rotulo}>Imposto (%)</label>
                <input className={campo} inputMode="decimal" value={e.taxPct} onChange={(ev) => setE({ ...e, taxPct: ev.target.value })} />
              </div>
            </div>
            <p className={"text-[11px] mt-2 " + (somaPct >= 100 ? "text-red-600 font-semibold" : "text-brand-brown/55")}>
              Somam {pct(somaPct)} do preço de venda.
              {somaPct >= 100 ? " Precisa ficar abaixo de 100%." : " Sobram " + pct(100 - somaPct) + " para custo."}
            </p>
          </div>
        </div>

        <div className="bg-brand-beige/50 border border-brand-gold/15 rounded-2xl p-4">
          <p className="text-[10px] uppercase tracking-widest text-brand-brown/55 font-bold mb-1">Base da conta</p>
          <p className="text-[11px] text-brand-brown/70 leading-relaxed">
            Custo fixo de {reais(parametros?.totalFixedMonthly ?? 0)} por mês ÷{" "}
            {parametros ? parametros.monthlyWorkingHours.toLocaleString("pt-BR") : "—"} horas produtivas ={" "}
            <strong className="text-brand-brown">{reais(parametros?.fixedCostHour ?? null)} por hora</strong>.
          </p>
        </div>
      </div>

      {/* ---------------- resultado ---------------- */}
      <div className="lg:col-span-3 space-y-4">
        {erro && (
          <div className="rounded-xl px-4 py-3 text-xs border bg-red-50 border-red-200 text-red-700 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{erro}</span>
          </div>
        )}

        {aplicado && (
          <div className="rounded-xl px-4 py-3 text-xs border bg-emerald-50 border-emerald-200 text-emerald-800 flex items-start gap-2">
            <Check className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{aplicado}</span>
          </div>
        )}

        <div className={"grid grid-cols-2 gap-px bg-brand-gold/15 border border-brand-gold/15 rounded-2xl overflow-hidden transition-opacity " + (calculando ? "opacity-60" : "")}>
          <div className="bg-brand-brown text-brand-beige p-5 col-span-2 sm:col-span-1">
            <p className="text-[10px] uppercase tracking-widest text-brand-gold font-bold mb-1">Preço sugerido</p>
            <p className="text-3xl font-serif font-semibold">{reais(resultado?.precoSugerido)}</p>
          </div>
          <div className="bg-white p-5 col-span-2 sm:col-span-1">
            <p className="text-[10px] uppercase tracking-widest text-brand-brown/55 font-bold mb-1">Valor por hora</p>
            <p className="text-3xl font-serif font-semibold text-brand-brown">{reais(resultado?.valorHora)}</p>
          </div>
          <div className="bg-white p-5">
            <p className="text-[10px] uppercase tracking-widest text-brand-brown/55 font-bold mb-1">Lucro líquido</p>
            <p className="text-xl font-serif font-semibold text-brand-brown">{reais(resultado?.lucroLiquido)}</p>
            <p className="text-[10px] text-brand-brown/50 mt-1">por atendimento, já fora comissão, cartão e imposto</p>
          </div>
          <div className="bg-white p-5">
            <p className="text-[10px] uppercase tracking-widest text-brand-brown/55 font-bold mb-1">Custo direto</p>
            <p className="text-xl font-serif font-semibold text-brand-brown">{reais(resultado?.custoDireto)}</p>
            <p className="text-[10px] text-brand-brown/50 mt-1">
              {reais(resultado?.custoFixoServico)} de estrutura + {reais(numero(e.variableCost) || 0)} de insumo
            </p>
          </div>
        </div>

        {/* O momento de valor da tela */}
        {comparacao && resultado && (
          <div
            className={
              "rounded-2xl p-5 border " +
              (comparacao.deixandoNaMesa > 0
                ? "bg-amber-50 border-amber-200"
                : "bg-emerald-50 border-emerald-200")
            }
          >
            <div className="flex items-start gap-3">
              <TrendingUp className={"h-5 w-5 shrink-0 mt-0.5 " + (comparacao.deixandoNaMesa > 0 ? "text-amber-700" : "text-emerald-700")} />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-brand-brown">
                  Preço atual {reais(comparacao.precoAtual)} · Sugerido {reais(resultado.precoSugerido)}
                </p>
                {comparacao.deixandoNaMesa > 0 ? (
                  <p className="text-xs text-amber-900 leading-relaxed">
                    Você está deixando <strong>{reais(comparacao.deixandoNaMesa)} por atendimento</strong> na mesa —
                    {" "}{pct(Math.abs(comparacao.variacaoPct))} abaixo do que a conta pede. Em 20 atendimentos no mês,
                    são {reais(comparacao.deixandoNaMesa * 20)}.
                  </p>
                ) : (
                  <p className="text-xs text-emerald-900 leading-relaxed">
                    O preço praticado está <strong>{reais(Math.abs(comparacao.diferenca))} acima</strong> do mínimo que
                    a conta pede. A margem real é maior que a pedida — nada a corrigir aqui.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-brand-gold/15 rounded-2xl p-4">
          <p className="text-[11px] text-brand-brown/60 leading-relaxed max-w-sm">
            {e.catalogId
              ? "Aplicar grava o preço no catálogo e registra a mudança nos logs do sistema."
              : "Sem serviço escolhido, a simulação só vai para o histórico — nada é alterado no catálogo."}
          </p>
          <button
            onClick={aplicar}
            disabled={!resultado || aplicando || !!erro}
            className="flex items-center justify-center gap-1.5 bg-brand-brown hover:bg-brand-brown/95 disabled:opacity-40 disabled:cursor-not-allowed text-brand-beige px-5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest transition-all shadow-sm border border-brand-gold/20 cursor-pointer whitespace-nowrap"
          >
            <Calculator className="h-3.5 w-3.5 text-brand-gold" />
            {aplicando ? "Aplicando..." : e.catalogId ? "Aplicar ao catálogo" : "Guardar simulação"}
          </button>
        </div>
      </div>
    </div>
  );
}

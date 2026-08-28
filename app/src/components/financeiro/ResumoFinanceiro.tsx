/**
 * Resumo financeiro (T2.6).
 *
 * A decisão de desenho mais importante desta tela é o alternador
 * **Competência / Caixa** no topo, e o rótulo que repete a base escolhida
 * embaixo de cada número.
 *
 * Os dois critérios dão resultados diferentes e os dois estão certos:
 * competência conta o que aconteceu, caixa conta o dinheiro que andou. Um
 * relatório que não diz qual dos dois está mostrando é a causa número um de
 * alguém olhar dois números, ver que não batem, e parar de confiar no sistema
 * inteiro. Por isso a base nunca é implícita aqui.
 */
import { useEffect, useState } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { ArrowUpRight, ArrowDownRight, Minus, AlertTriangle, RefreshCw } from "lucide-react";
import { reais, reaisCurto, rotuloPeriodo, Base, Resumo, PontoFluxo } from "./comum";

interface Props {
  de: string;
  ate: string;
  base: Base;
  aoTrocarBase: (b: Base) => void;
  aoTrocarPeriodo: (de: string, ate: string) => void;
  versao: number;
}

const CORES = { receita: "#3E6B4F", despesa: "#9E3B28", saldo: "#9A7C22" };

function Variacao({ pct, invertido }: { pct: number | null; invertido?: boolean }) {
  if (pct === null) return <span className="text-[10px] text-brand-brown/40">sem base de comparação</span>;
  if (pct === 0)
    return (
      <span className="text-[10px] text-brand-brown/50 flex items-center gap-0.5">
        <Minus className="h-3 w-3" /> igual ao período anterior
      </span>
    );
  const subiu = pct > 0;
  const bom = invertido ? !subiu : subiu;
  const Icone = subiu ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={"text-[10px] flex items-center gap-0.5 font-semibold " + (bom ? "text-emerald-700" : "text-red-600")}>
      <Icone className="h-3 w-3" />
      {Math.abs(pct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. período anterior
    </span>
  );
}

export default function ResumoFinanceiro({ de, ate, base, aoTrocarBase, aoTrocarPeriodo, versao }: Props) {
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [serie, setSerie] = useState<PontoFluxo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const dias = Math.round((new Date(ate).getTime() - new Date(de).getTime()) / 86400000) + 1;
  const agruparPor = dias > 62 ? "month" : "day";

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCarregando(true);
      try {
        const q = `from=${de}&to=${ate}&basis=${base}`;
        const [r1, r2] = await Promise.all([
          fetch("/api/finance/summary?" + q),
          fetch(`/api/finance/cashflow?${q}&groupBy=${agruparPor}`),
        ]);
        if (!vivo) return;
        if (!r1.ok) {
          const e = await r1.json().catch(() => ({}));
          setErro(e.error || "Não foi possível carregar o resultado.");
          return;
        }
        setErro("");
        setResumo(await r1.json());
        if (r2.ok) setSerie((await r2.json()).serie || []);
      } catch {
        if (vivo) setErro("Erro de conexão ao carregar o financeiro.");
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [de, ate, base, versao, agruparPor]);

  const c = resumo?.comparativoPeriodoAnterior || null;
  const campo =
    "bg-white border border-brand-gold/30 rounded px-2.5 py-1.5 text-xs text-brand-brown focus:outline-none focus:border-brand-brown";

  const dadosGrafico = serie.map((p) => ({ ...p, rotulo: rotuloPeriodo(p.periodo) }));

  return (
    <div className="space-y-5">
      {erro && (
        <div className="rounded-xl px-4 py-3 text-xs border bg-red-50 border-red-200 text-red-700">{erro}</div>
      )}

      {/* Base e período */}
      <div className="bg-white border border-brand-gold/15 rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-brand-brown/55 font-bold">Como contar</p>
          <div className="flex items-center gap-1 bg-brand-beige/60 p-1 rounded-xl w-fit">
            {(
              [
                ["competencia", "Competência", "quando o fato aconteceu"],
                ["caixa", "Caixa", "quando o dinheiro andou"],
              ] as [Base, string, string][]
            ).map(([id, rotulo, ajuda]) => (
              <button
                key={id}
                onClick={() => aoTrocarBase(id)}
                title={ajuda}
                className={
                  "px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer " +
                  (base === id ? "bg-brand-brown text-brand-beige shadow-sm" : "text-brand-brown/70 hover:bg-white")
                }
              >
                {rotulo}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-brand-brown/55 max-w-md leading-relaxed">
            {base === "competencia"
              ? "Conta tudo o que aconteceu no período, pago ou não. É o resultado do negócio."
              : "Conta só o dinheiro que entrou e saiu de fato no período. É o que tem em caixa."}
          </p>
        </div>

        <div className="flex items-end gap-2">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-brand-brown/55 font-bold mb-1">De</label>
            <input type="date" className={campo} value={de} onChange={(e) => aoTrocarPeriodo(e.target.value, ate)} />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-brand-brown/55 font-bold mb-1">Até</label>
            <input type="date" className={campo} value={ate} onChange={(e) => aoTrocarPeriodo(de, e.target.value)} />
          </div>
          {carregando && <RefreshCw className="h-4 w-4 text-brand-gold animate-spin mb-2" />}
        </div>
      </div>

      {/* Os quatro números */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-brand-gold/15 border border-brand-gold/15 rounded-2xl overflow-hidden">
        <div className="bg-white p-5">
          <p className="text-[10px] uppercase tracking-widest text-brand-brown/55 font-bold mb-1">Receita</p>
          <p className="text-2xl font-serif font-semibold text-brand-brown">{reais(resumo?.receitaTotal)}</p>
          <div className="mt-1.5">
            <Variacao pct={c ? c.receitaPct : null} />
          </div>
        </div>
        <div className="bg-white p-5">
          <p className="text-[10px] uppercase tracking-widest text-brand-brown/55 font-bold mb-1">Despesa</p>
          <p className="text-2xl font-serif font-semibold text-brand-brown">{reais(resumo?.despesaTotal)}</p>
          <div className="mt-1.5">
            <Variacao pct={c ? c.despesaPct : null} invertido />
          </div>
        </div>
        <div className={"p-5 " + ((resumo?.resultado ?? 0) < 0 ? "bg-red-50" : "bg-brand-brown text-brand-beige")}>
          <p
            className={
              "text-[10px] uppercase tracking-widest font-bold mb-1 " +
              ((resumo?.resultado ?? 0) < 0 ? "text-red-700" : "text-brand-gold")
            }
          >
            Resultado
          </p>
          <p className={"text-2xl font-serif font-semibold " + ((resumo?.resultado ?? 0) < 0 ? "text-red-700" : "")}>
            {reais(resumo?.resultado)}
          </p>
          <p className={"text-[10px] mt-1.5 " + ((resumo?.resultado ?? 0) < 0 ? "text-red-700/70" : "text-brand-beige/60")}>
            por {base === "caixa" ? "caixa" : "competência"}
          </p>
        </div>
        <div className="bg-white p-5">
          <p className="text-[10px] uppercase tracking-widest text-brand-brown/55 font-bold mb-1">Margem</p>
          <p className="text-2xl font-serif font-semibold text-brand-brown">
            {resumo ? resumo.margemPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%" : "—"}
          </p>
          <p className="text-[10px] text-brand-brown/50 mt-1.5">sobre a receita do período</p>
        </div>
      </div>

      {/* Contas a pagar */}
      {resumo && resumo.aPagar.total > 0 && (
        <div
          className={
            "rounded-2xl p-4 border " +
            (resumo.aPagar.vencido > 0 ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200")
          }
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className={"h-5 w-5 shrink-0 mt-0.5 " + (resumo.aPagar.vencido > 0 ? "text-red-600" : "text-amber-700")} />
            <div className="space-y-1">
              <p className="text-xs font-semibold text-brand-brown">
                {reais(resumo.aPagar.total)} em contas a pagar em aberto
              </p>
              <p className="text-[11px] text-brand-brown/75 leading-relaxed">
                {resumo.aPagar.vencido > 0 && (
                  <>
                    <strong className="text-red-700">{reais(resumo.aPagar.vencido)} já vencido</strong>
                    {" · "}
                  </>
                )}
                {reais(resumo.aPagar.aVencer7Dias)} vence nos próximos 7 dias
                {resumo.aPagar.semVencimento > 0 && <> · {reais(resumo.aPagar.semVencimento)} sem data de vencimento</>}
              </p>
              <p className="text-[10px] text-brand-brown/50">
                Isto não depende do período escolhido — é o que está em aberto agora.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Fluxo */}
      <div className="bg-white border border-brand-gold/15 rounded-2xl p-5 space-y-4">
        <div>
          <h3 className="text-xs font-serif font-bold text-brand-brown uppercase tracking-wider">
            Entradas e saídas por {agruparPor === "month" ? "mês" : "dia"}
          </h3>
          <p className="text-[10px] text-brand-brown/60 mt-0.5">
            Base {base === "caixa" ? "caixa" : "competência"} · {dadosGrafico.length}{" "}
            {agruparPor === "month" ? "meses" : "dias"}
          </p>
        </div>

        {dadosGrafico.length === 0 ? (
          <p className="py-10 text-center text-xs text-brand-brown/55">Nenhum lançamento no período.</p>
        ) : (
          <>
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={dadosGrafico} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E0D5C2" vertical={false} />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 10, fill: "#8E7B69" }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: "#8E7B69" }} tickFormatter={reaisCurto} />
                  <Tooltip
                    formatter={(v: number, n: string) => [reais(v), n === "receita" ? "Receita" : "Despesa"]}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E0D5C2" }}
                  />
                  <Legend formatter={(v) => (v === "receita" ? "Receita" : "Despesa")} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="receita" fill={CORES.receita} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="despesa" fill={CORES.despesa} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ width: "100%", height: 150 }}>
              <p className="text-[10px] uppercase tracking-widest text-brand-brown/55 font-bold mb-1">Saldo acumulado</p>
              <ResponsiveContainer>
                <LineChart data={dadosGrafico} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E0D5C2" vertical={false} />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 10, fill: "#8E7B69" }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: "#8E7B69" }} tickFormatter={reaisCurto} />
                  <Tooltip
                    formatter={(v: number) => [reais(v), "Acumulado"]}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E0D5C2" }}
                  />
                  {/* Degrau, nao curva: o saldo nao muda aos poucos entre um lancamento e
                      outro - ele fica parado e pula no dia do fato. Curva suave aqui
                      desenha um movimento de dinheiro que nao aconteceu. */}
                  <Line type="stepAfter" dataKey="acumulado" stroke={CORES.saldo} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>

      {/* Categorias */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {(
          [
            ["Receita por categoria", resumo?.receitaPorCategoria || [], resumo?.receitaTotal || 0, CORES.receita],
            ["Despesa por categoria", resumo?.despesaPorCategoria || [], resumo?.despesaTotal || 0, CORES.despesa],
          ] as [string, typeof resumo.receitaPorCategoria, number, string][]
        ).map(([titulo, itens, total, cor]) => (
          <div key={titulo} className="bg-white border border-brand-gold/15 rounded-2xl p-5">
            <h3 className="text-xs font-serif font-bold text-brand-brown uppercase tracking-wider mb-3">{titulo}</h3>
            {itens.length === 0 ? (
              <p className="text-xs text-brand-brown/50 py-4">Nada no período.</p>
            ) : (
              <div className="space-y-2.5">
                {itens.map((cat) => (
                  <div key={cat.categoryId || cat.categoria} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-brand-brown">{cat.categoria}</span>
                      <span className="font-mono text-brand-brown/80">{reais(cat.total)}</span>
                    </div>
                    <div className="h-1.5 bg-brand-beige rounded-full overflow-hidden">
                      <div
                        style={{ width: total > 0 ? (cat.total / total) * 100 + "%" : "0%", background: cor }}
                        className="h-full"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

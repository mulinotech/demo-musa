/** Tipos e formatação do módulo financeiro (T2.4 / T2.6). */

export const reais = (v: number | null | undefined) =>
  v === null || v === undefined || !isFinite(v)
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const reaisCurto = (v: number) =>
  Math.abs(v) >= 1000
    ? "R$ " + (v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "k"
    : "R$ " + v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

export const dataBR = (iso: string | null) => {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return d ? `${d}/${m}/${a}` : iso;
};

/** "2026-03" -> "mar/26"; "2026-03-15" -> "15/03" */
export const rotuloPeriodo = (p: string) => {
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const partes = p.split("-");
  if (partes.length === 2) return meses[Number(partes[1]) - 1] + "/" + partes[0].slice(2);
  return partes[2] + "/" + partes[1];
};

export type Base = "competencia" | "caixa";

export interface Categoria {
  id: string;
  name: string;
  type: "RECEITA" | "DESPESA";
}

export interface Lancamento {
  id: string;
  type: "RECEITA" | "DESPESA";
  categoryId: string | null;
  categoria: string | null;
  description: string;
  amount: number;
  entryDate: string;
  dueDate: string | null;
  paidAt: string | null;
  paymentMethod: string | null;
  source: string;
  supplier: string | null;
  notes: string | null;
}

export interface PorCategoria {
  categoryId: string | null;
  categoria: string;
  total: number;
  quantidade: number;
}

export interface Resumo {
  periodo: { inicio: string; fim: string; base: Base };
  receitaTotal: number;
  despesaTotal: number;
  resultado: number;
  margemPct: number;
  lancamentos: number;
  receitaPorCategoria: PorCategoria[];
  despesaPorCategoria: PorCategoria[];
  aPagar: { total: number; vencido: number; aVencer7Dias: number; semVencimento: number };
  comparativoPeriodoAnterior: {
    receitaPct: number | null;
    despesaPct: number | null;
    resultadoPct: number | null;
    anterior: { receitaTotal: number; despesaTotal: number; resultado: number };
  } | null;
  periodoAnterior: { de: string; ate: string };
}

export interface PontoFluxo {
  periodo: string;
  receita: number;
  despesa: number;
  saldo: number;
  acumulado: number;
}

/** Primeiro dia do mês corrente e hoje, em ISO. */
export function mesCorrente() {
  const h = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const hoje = h.getFullYear() + "-" + p(h.getMonth() + 1) + "-" + p(h.getDate());
  return { de: hoje.slice(0, 8) + "01", ate: hoje };
}

/** Formatacao e tipos compartilhados das telas de precificacao (T2.3). */

export const reais = (v: number | null | undefined) =>
  v === null || v === undefined || !isFinite(v)
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const pct = (v: number | null | undefined) =>
  v === null || v === undefined || !isFinite(v) ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%";

export interface Parametros {
  monthlyWorkingHours: number;
  targetMarginPct: number;
  cardFeePct: number;
  taxPct: number;
  defaultCommissionPct: number;
  totalFixedMonthly: number;
  fixedCostHour: number | null;
}

export interface ResultadoCalculo {
  custoFixoHora: number;
  custoFixoServico: number;
  custoDireto: number;
  percentuaisSobreVenda: number;
  precoSugerido: number;
  valorHora: number;
  lucroLiquido: number;
}

export interface Comparacao {
  precoAtual: number;
  diferenca: number;
  deixandoNaMesa: number;
  variacaoPct: number;
}

export interface ServicoCatalogo {
  id: string;
  name: string;
  price: number;
  duration: string | null;
  duration_min: number | null;
  variable_cost: number | null;
  commission_pct: number | null;
  suggested_price: number | null;
  price_updated_at: string | null;
}

export interface Simulacao {
  id: string;
  catalogId: string | null;
  serviceName: string;
  durationMin: number;
  variableCost: number;
  marginPct: number;
  commissionPct: number;
  cardFeePct: number;
  taxPct: number;
  suggestedPrice: number;
  hourlyValue: number;
  netProfit: number;
  priceBefore: number | null;
  applied: boolean;
  createdAt: string;
}

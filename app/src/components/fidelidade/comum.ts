/** Tipos e formatação da fidelização (Fase 5). */

export interface ConfigFidelidade {
  active: boolean;
  pointsPerReal: number;
  redemptionValue: number;
  expiryDays: number;
  minPointsToRedeem: number;
}

export interface ExemploFidelidade {
  preco: number;
  pontos: number;
  vale: number;
  percentualDeVolta: number;
  expiraEm: string;
}

export interface Recompensa {
  id: string;
  name: string;
  description: string | null;
  pointsCost: number;
  type: "DESCONTO_VALOR" | "DESCONTO_PCT" | "SERVICO" | "PRODUTO";
  value: number | null;
  catalogId: string | null;
  catalogName: string | null;
  active: boolean;
}

export interface LancamentoPontos {
  id: string;
  tipo: "ACUMULO" | "RESGATE" | "EXPIRACAO" | "AJUSTE" | "ESTORNO";
  pontos: number;
  descricao: string;
  fonte: string;
  recompensa: string | null;
  expiraEm: string | null;
  expirado: boolean;
  quando: string;
}

export interface SaldoCliente {
  clientId: string;
  ativo: boolean;
  saldo: number;
  vale: number;
  aExpirar30Dias: number;
  minimoParaResgate: number;
  extrato: LancamentoPontos[];
}

export const reais = (v: number | null) =>
  v === null || v === undefined ? "" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const pts = (v: number) => Number(v).toLocaleString("pt-BR");

export const dataBR = (v: string | null) => {
  if (!v) return "—";
  const [a, m, d] = String(v).slice(0, 10).split("-");
  return d + "/" + m + "/" + a;
};

export const dataHoraBR = (v: string | null) => {
  if (!v) return "—";
  const s = String(v);
  return s.slice(8, 10) + "/" + s.slice(5, 7) + " " + s.slice(11, 16);
};

/** O rótulo do prêmio em português, com o efeito visível. "DESCONTO_PCT / 20"
 *  não diz nada a quem está na recepção; "20% de desconto" diz. */
export const descreverPremio = (r: Recompensa) => {
  if (r.type === "DESCONTO_VALOR") return reais(r.value) + " de desconto";
  if (r.type === "DESCONTO_PCT") return r.value + "% de desconto";
  if (r.type === "SERVICO") return (r.catalogName || "Serviço") + " cortesia";
  return "Produto";
};

export const ESTILO_PONTOS: Record<LancamentoPontos["tipo"], { rotulo: string; classe: string }> = {
  ACUMULO: { rotulo: "Acúmulo", classe: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  RESGATE: { rotulo: "Resgate", classe: "text-brand-brown bg-brand-beige border-brand-gold/30" },
  EXPIRACAO: { rotulo: "Expirou", classe: "text-red-700 bg-red-50 border-red-200" },
  AJUSTE: { rotulo: "Ajuste", classe: "text-amber-700 bg-amber-50 border-amber-200" },
  ESTORNO: { rotulo: "Estorno", classe: "text-sky-700 bg-sky-50 border-sky-200" },
};

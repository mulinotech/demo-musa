/**
 * Tipos e formatação do estoque (T3.3).
 *
 * `saldo` e `saldoTotal` são dois números diferentes e a tela mostra os dois:
 * total é o que está na prateleira, saldo é o que pode ser aplicado em alguém.
 * Quando divergem, existe lote vencido — e é exatamente o caso que interessa.
 */

export interface Lote {
  id: string;
  lote: string | null;
  validade: string | null;
  quantidade: number;
  custoUnitario: number;
  recebidoEm: string;
  vencido: boolean;
}

export interface Produto {
  id: string;
  sku: string | null;
  name: string;
  category: string | null;
  unit: "UN" | "ML" | "G" | "APLICACAO";
  unitCost: number;
  salePrice: number | null;
  minStock: number;
  controlled: boolean;
  supplier: string | null;
  active: boolean;
  saldo: number;
  saldoTotal: number;
  valorEmEstoque: number;
  lotes: Lote[];
}

export interface Movimento {
  id: string;
  tipo: "ENTRADA" | "SAIDA" | "AJUSTE" | "PERDA" | "ESTORNO";
  produto: string;
  unidade: string;
  lote: string | null;
  quantidade: number;
  custoUnitario: number;
  sinal: number;
  origem: string | null;
  fonte: "MANUAL" | "APPOINTMENT" | "INVENTORY";
  quando: string;
  autor: string | null;
}

export interface Alertas {
  criticos: {
    tipo: string; productId: string; produto: string; batchId: string;
    lote: string | null; validade: string; quantidade: number; diasVencido: number;
  }[];
  validade: {
    tipo: string; productId: string; produto: string; batchId: string;
    lote: string | null; validade: string; quantidade: number; diasRestantes: number;
  }[];
  reposicao: {
    tipo: string; productId: string; produto: string;
    saldo: number; saldoTotal: number; minimo: number; faltando: number;
  }[];
  total: number;
}

export const UNIDADES: Produto["unit"][] = ["UN", "ML", "G", "APLICACAO"];

export const reais = (v: number | null) =>
  v === null || v === undefined ? "" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Quantidade sem zeros à direita inúteis: 4 em vez de 4,000, mas 0,2 quando
 *  for 0,2 — anestésico se mede em fração de bisnaga. */
export const qtd = (v: number) =>
  Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });

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

export const ESTILO_MOV: Record<Movimento["tipo"], { rotulo: string; classe: string }> = {
  ENTRADA: { rotulo: "Entrada", classe: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  SAIDA: { rotulo: "Saída", classe: "text-brand-brown bg-brand-beige border-brand-gold/30" },
  AJUSTE: { rotulo: "Ajuste", classe: "text-amber-700 bg-amber-50 border-amber-200" },
  PERDA: { rotulo: "Perda", classe: "text-red-700 bg-red-50 border-red-200" },
  ESTORNO: { rotulo: "Estorno", classe: "text-sky-700 bg-sky-50 border-sky-200" },
};

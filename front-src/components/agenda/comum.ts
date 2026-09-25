/** Tipos e utilitários da agenda (T1.3). */

export type StatusAgenda = "AGENDADO" | "CONFIRMADO" | "REALIZADO" | "FALTOU" | "CANCELADO";

export interface Compromisso {
  id: string;
  clientId: string | null;
  clientName: string | null;
  professionalId: string;
  professionalName: string | null;
  catalogId: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  status: StatusAgenda;
  kind: "ATENDIMENTO" | "BLOQUEIO";
  room: string | null;
  price: number | null;
  notes: string | null;
  completedAt: string | null;
  rescheduledFrom: string | null;
}

export interface Profissional {
  id: string;
  name: string;
  role: string;
}

/** Cores por status, dentro da paleta da marca. CANCELADO fica riscado — ver um
 *  horário cancelado na grade é informação; ele só não pode parecer ativo. */
export const ESTILO_STATUS: Record<StatusAgenda, { caixa: string; texto: string; rotulo: string }> = {
  AGENDADO: { caixa: "bg-brand-beige border-brand-gold/60", texto: "text-brand-brown", rotulo: "Agendado" },
  CONFIRMADO: { caixa: "bg-emerald-50 border-emerald-400", texto: "text-emerald-900", rotulo: "Confirmado" },
  REALIZADO: { caixa: "bg-brand-brown border-brand-brown", texto: "text-brand-beige", rotulo: "Realizado" },
  FALTOU: { caixa: "bg-amber-50 border-amber-400", texto: "text-amber-900", rotulo: "Faltou" },
  CANCELADO: { caixa: "bg-neutral-100 border-neutral-300", texto: "text-neutral-500 line-through", rotulo: "Cancelado" },
};

export const SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export const SEMANA_CURTA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const dois = (n: number) => String(n).padStart(2, "0");

export const iso = (d: Date) => d.getFullYear() + "-" + dois(d.getMonth() + 1) + "-" + dois(d.getDate());

/** Sem fuso: o DATETIME que vem do servidor é horário local da clínica.
 *  `new Date("2026-09-01 09:00:00")` já interpreta como local — mas o formato
 *  com espaço quebra no Safari, então normalizamos para "T". */
export const paraData = (v: string) => new Date(String(v).replace(" ", "T"));

export const hora = (v: string) => {
  const d = paraData(v);
  return dois(d.getHours()) + ":" + dois(d.getMinutes());
};

export const dataBR = (v: string) => {
  const d = paraData(v);
  return dois(d.getDate()) + "/" + dois(d.getMonth() + 1) + "/" + d.getFullYear();
};

/** Minutos desde a meia-noite, para posicionar o bloco na régua. */
export const minutoDoDia = (v: string) => {
  const d = paraData(v);
  return d.getHours() * 60 + d.getMinutes();
};

export const somarDias = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export const inicioDaSemana = (d: Date) => somarDias(d, -d.getDay());

export const reais = (v: number | null) =>
  v === null || v === undefined ? "" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Régua do dia. 07:00 às 21:00 cobre a clínica inteira sem obrigar a rolar
 *  por horas mortas da madrugada. */
export const HORA_INICIO = 7;
export const HORA_FIM = 21;
export const PIXEL_POR_MINUTO = 1.1;
export const ALTURA_GRADE = (HORA_FIM - HORA_INICIO) * 60 * PIXEL_POR_MINUTO;

export const topoDoBloco = (inicio: string) =>
  (minutoDoDia(inicio) - HORA_INICIO * 60) * PIXEL_POR_MINUTO;

export const alturaDoBloco = (inicio: string, fim: string) =>
  Math.max(22, (minutoDoDia(fim) - minutoDoDia(inicio)) * PIXEL_POR_MINUTO);

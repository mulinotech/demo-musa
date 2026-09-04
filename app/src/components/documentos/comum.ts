/** Tipos e formatação dos documentos clínicos (Fase 4). */

export type TipoDocumento = "ANAMNESE" | "TERMO_CONSENTIMENTO" | "ORIENTACAO" | "OUTRO";
export type StatusDocumento = "RASCUNHO" | "AGUARDANDO_ASSINATURA" | "ASSINADO" | "CANCELADO";
export type TipoCampo = "text" | "textarea" | "boolean" | "select" | "multiselect" | "date" | "number" | "scale";

export interface CampoModelo {
  key: string;
  label: string;
  type: TipoCampo;
  required?: boolean;
  alert?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  showIf?: { field: string; equals?: any; in?: any[] };
}

export interface SecaoModelo {
  title: string;
  fields: CampoModelo[];
}

export interface Modelo {
  id: string;
  name: string;
  type: TipoDocumento;
  catalogId: string | null;
  version: number;
  fields: { sections: SecaoModelo[] };
  bodyMarkdown: string | null;
  active: boolean;
}

export interface Documento {
  id: string;
  clientId: string;
  clientName: string | null;
  templateId: string | null;
  templateVersion: number | null;
  appointmentId: string | null;
  type: TipoDocumento;
  title: string;
  answers: Record<string, any>;
  status: StatusDocumento;
  contentHash: string | null;
  signerName: string | null;
  signerDocument: string | null;
  signedAt: string | null;
  cancelledReason: string | null;
  createdAt: string;
}

export interface AlertaClinico {
  campo: string;
  rotulo: string;
  valor: string;
  detalhe: string | null;
}

export interface RespostaAlertas {
  clientId: string;
  alertas: AlertaClinico[];
  origem: { documentId: string; titulo: string; quando: string; status: string } | null;
  semAnamnese: boolean;
  apenasTextoLivre: boolean;
}

export const ESTILO_STATUS_DOC: Record<StatusDocumento, { rotulo: string; classe: string }> = {
  RASCUNHO: { rotulo: "Rascunho", classe: "text-brand-brown/70 bg-brand-beige border-brand-gold/30" },
  AGUARDANDO_ASSINATURA: { rotulo: "Aguardando assinatura", classe: "text-amber-800 bg-amber-50 border-amber-200" },
  ASSINADO: { rotulo: "Assinado", classe: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  CANCELADO: { rotulo: "Cancelado", classe: "text-red-700 bg-red-50 border-red-200" },
};

export const ROTULO_TIPO: Record<TipoDocumento, string> = {
  ANAMNESE: "Anamnese",
  TERMO_CONSENTIMENTO: "Termo de consentimento",
  ORIENTACAO: "Orientação",
  OUTRO: "Outro",
};

export const dataHoraBR = (v: string | null) => {
  if (!v) return "—";
  const s = String(v);
  return s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) + " " + s.slice(11, 16);
};

/** Uma pergunta condicional só existe quando a condição vale. A mesma regra do
 *  servidor — se as duas divergirem, o formulário mostra campo que a validação
 *  não conhece, ou esconde campo que ela exige. */
export const campoVisivel = (c: CampoModelo, respostas: Record<string, any>) => {
  if (!c.showIf) return true;
  const alvo = respostas[c.showIf.field];
  if ("equals" in c.showIf) return alvo === c.showIf.equals;
  if (c.showIf.in) return c.showIf.in.indexOf(alvo) !== -1;
  return true;
};

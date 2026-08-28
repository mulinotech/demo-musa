/**
 * Contexto compartilhado das telas do CRM (T0.5).
 *
 * O CrmDashboard continua sendo o dono dos dados: ele carrega tudo uma vez em
 * fetchCrmData e entrega aqui. Cada tela do CRM e uma rota filha que le este
 * contexto com useCrm(), em vez de virar mais um `activeTab === 'x' &&` dentro
 * de um arquivo de 55 KB.
 *
 * Tela nova de modulo (agenda, precificacao, estoque...) entra como rota filha
 * em App.tsx e um arquivo nesta pasta. Nao volte a inchar o CrmDashboard.
 */
import { useOutletContext } from "react-router-dom";
import type {
  Client,
  Lead,
  Interaction,
  Treatment,
  TreatmentCatalog,
  TreatmentPlan,
  TreatmentSession,
} from "../../types";

export interface ContextoCrm {
  /* dados */
  clients: Client[];
  treatments: Treatment[];
  treatmentPlans: TreatmentPlan[];
  interactions: Interaction[];
  leads: Lead[];
  treatmentCatalog: TreatmentCatalog[];
  isAiConfigured: boolean;

  /* recarga */
  atualizar: (silencioso?: boolean) => Promise<void> | void;

  /* pacientes e tratamentos */
  onAddClient: (dados: Omit<Client, "id" | "createdAt" | "updatedAt">) => Promise<any>;
  onUpdateClient: (id: string, dados: Partial<Client>) => Promise<any>;
  onDeleteClient: (id: string) => Promise<any>;
  onAddTreatment: (dados: Omit<Treatment, "id">) => Promise<any>;
  onUpdateTreatment: (id: string, dados: Partial<Treatment>) => Promise<any>;

  /* planos de tratamento */
  onAddTreatmentPlan: (dados: Omit<TreatmentPlan, "id" | "createdAt">) => Promise<any>;
  onUpdateTreatmentPlan: (id: string, dados: Partial<TreatmentPlan>) => Promise<any>;
  onDeleteTreatmentPlan: (id: string) => Promise<any>;
  onUpdateTreatmentSession: (id: string, dados: Partial<TreatmentSession>) => Promise<any>;

  /* leads */
  onAddLead: (dados: any) => Promise<void>;
  onUpdateLeadStatus: (
    id: string,
    status: Lead["status"],
    phone?: string,
    email?: string,
    salesNotes?: string,
    qualified?: boolean,
    interest?: string,
  ) => Promise<boolean>;
  onDeleteLead: (id: string) => Promise<any>;
  onSelectLead: (lead: Lead | null) => void;

  /* atendimento */
  onSendMessage: (clientId: string, content: string) => Promise<any>;
}

export function useCrm(): ContextoCrm {
  return useOutletContext<ContextoCrm>();
}

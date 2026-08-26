/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  salespersonId?: string;
  createdAt: string;
  updatedAt: string;
  anamnese?: string;
  imageBase64?: string;
  laudo?: string;
}

export interface Interaction {
  id: string;
  clientId: string; // references Client or Lead
  type: 'whatsapp' | 'form' | 'system';
  content: string; // The message text
  direction: 'in' | 'out';
  createdAt: string;
}

export interface Treatment {
  id: string;
  clientId: string;
  procedure: string;
  sessionDate: string;
  notes: string;
  nextSessionDate: string;
  price?: number;
  totalSessions?: number;
  completedSessions?: number;
}

export interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string;
  interest: string; // e.g., 'Ultraformer MPT', 'Lavien BB Laser'
  status: 'novo' | 'contatado' | 'agendado' | 'arquivado' | 'perdido';
  source: 'site' | 'instagram' | 'google' | 'indicação';
  salespersonId?: string;
  lastEditedBy?: string;
  salesNotes?: string;
  qualified?: boolean;
  createdAt: string;
}

export interface EvolutionInstance {
  name: string;
  status: 'open' | 'close' | 'connecting';
  qrcode?: string;
  number?: string;
}

export interface Salesperson {
  id: string;
  name: string;
  email: string;
  whatsapp: string;
  avatar?: string;
  role: 'vendedor' | 'gerente';
}

export interface TreatmentCatalog {
  id: string;
  name: string;
  price: number;
  packagePrice?: number;
  duration?: number; // in minutes
  description?: string;
  indicatedRegions?: string;
  restrictions?: string;
}

export interface TreatmentSession {
  id: string;
  planId: string;
  sessionNumber: number;
  sessionType: 'AVALIACAO_INICIAL' | 'SESSAO_TRATAMENTO' | 'RETORNO_AVALIATIVO';
  status: 'REALIZADA' | 'AGENDADA' | 'PENDENTE' | 'FALTOU' | 'REAGENDADA' | 'CANCELADA';
  equipmentsUsed?: string;
  suppliesApplied?: string;
  professionalInCharge?: string;
  clinicalEvolution?: string;
  mediaUrls?: string;
  sessionDate?: string;
  nextSessionDate?: string;
  price?: number;
  createdAt: string;
}

export interface TreatmentPlan {
  id: string;
  clientId: string;
  title: string;
  clinicalObjective?: string;
  totalSessions: number;
  periodicity?: string;
  status: 'ATIVO' | 'CONCLUIDO' | 'PAUSADO' | 'CANCELADO';
  startDate?: string;
  estimatedEndDate?: string;
  createdAt: string;
  sessions?: TreatmentSession[];
  sessionPrice?: number;
}

export interface SystemLog {
  id: string;
  actionType: string;
  description: string;
  author: string;
  ipAddress?: string;
  createdAt: string;
}


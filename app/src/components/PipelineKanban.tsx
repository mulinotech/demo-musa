/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Lead } from '../types';
import { 
  Plus, 
  MapPin, 
  Phone, 
  Mail, 
  Send, 
  ArrowRight, 
  CheckCircle, 
  Instagram, 
  Globe, 
  Search,
  User,
  Sparkles
} from 'lucide-react';
import { motion } from 'motion/react';

interface PipelineKanbanProps {
  leads: Lead[];
  onAddLead: (lead: Omit<Lead, 'id' | 'createdAt'>) => void;
  onUpdateLeadStatus: (id: string, status: Lead['status']) => void;
  onSelectLead: (lead: Lead) => void;
}

const COLUMNS: { id: Lead['status']; title: string; color: string; desc: string }[] = [
  { id: 'novo', title: 'Lead Novo', color: 'border-brand-gold bg-brand-cream', desc: 'Aguardando primeiro contato' },
  { id: 'contatado', title: 'Pré-Agendamento', color: 'border-amber-400/50 bg-amber-50/20', desc: 'Em conversa / agendamento' },
  { id: 'agendado', title: 'Proposta Enviada', color: 'border-indigo-400/50 bg-indigo-50/20', desc: 'Orçamento/protocolo enviado' },
  { id: 'arquivado', title: 'Venda Fechada', color: 'border-emerald-500/50 bg-emerald-50/10', desc: 'Convertido em cliente' },
  { id: 'perdido', title: 'Perdidos', color: 'border-red-400/50 bg-red-50/10', desc: 'Não convertido' },
];

export default function PipelineKanban({ leads, onAddLead, onUpdateLeadStatus, onSelectLead }: PipelineKanbanProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // New Lead Form State
  const [newLeadName, setNewLeadName] = useState('');
  const [newLeadPhone, setNewLeadPhone] = useState('');
  const [newLeadEmail, setNewLeadEmail] = useState('');
  const [newLeadInterest, setNewLeadInterest] = useState('Ultraformer MPT');
  const [newLeadSource, setNewLeadSource] = useState<'site' | 'instagram' | 'google' | 'indicação'>('site');
  const [newLeadSalespersonId, setNewLeadSalespersonId] = useState('');
  const [salespeople, setSalespeople] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/salespeople')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setSalespeople(data);
        }
      })
      .catch(console.error);
  }, []);

  const handleSubmitLead = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLeadName || !newLeadPhone) return;

    onAddLead({
      name: newLeadName,
      phone: newLeadPhone,
      email: newLeadEmail,
      interest: newLeadInterest,
      status: 'novo',
      source: newLeadSource,
      salespersonId: newLeadSalespersonId || undefined,
    });

    // Reset fields
    setNewLeadName('');
    setNewLeadPhone('');
    setNewLeadEmail('');
    setNewLeadInterest('Ultraformer MPT');
    setNewLeadSource('site');
    setNewLeadSalespersonId('');
    setShowAddModal(false);
  };

  const getSourceIcon = (source: Lead['source']) => {
    switch (source) {
      case 'instagram':
        return <Instagram className="h-3.5 w-3.5 text-pink-600" />;
      case 'site':
        return <Globe className="h-3.5 w-3.5 text-blue-600" />;
      case 'google':
        return <Search className="h-3.5 w-3.5 text-emerald-600" />;
      default:
        return <User className="h-3.5 w-3.5 text-brand-gold" />;
    }
  };

  const filteredLeads = leads.filter(l => 
    (l.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (l.interest || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (l.phone || '').includes(searchTerm)
  );

  return (
    <div className="space-y-6">
      {/* Search and Quick Add */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl border border-brand-gold/20 shadow-xs">
        <div>
          <h2 className="text-xl font-serif font-semibold text-brand-brown">Funil de Vendas Concierge</h2>
          <p className="text-sm text-brand-brown/70">Acompanhe a jornada de agendamento e conversão de cada paciente de luxo</p>
        </div>
        <div className="flex w-full md:w-auto items-center space-x-3">
          <div className="relative flex-1 md:flex-initial">
            <input
              type="text"
              placeholder="Buscar por lead ou procedimento..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full md:w-80 pl-10 pr-4 py-2.5 rounded-xl border border-brand-gold/30 bg-brand-beige/20 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
            />
            <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-brand-gold" />
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center space-x-2 bg-brand-brown hover:bg-brand-brown/90 text-brand-beige px-4 py-2.5 rounded-xl text-sm font-medium transition-all shadow-md"
          >
            <Plus className="h-4 w-4 text-brand-gold" />
            <span>Novo Lead</span>
          </button>
        </div>
      </div>

      {/* Kanban Board Columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        {COLUMNS.map((col) => {
          const colLeads = filteredLeads.filter(l => l.status === col.id);
          return (
            <div key={col.id} className="flex flex-col h-[calc(100vh-280px)] min-h-[500px] bg-white rounded-2xl border border-brand-gold/15 p-4 shadow-xs">
              {/* Header */}
              <div className="flex justify-between items-center pb-3 mb-4 border-b border-brand-beige">
                <div>
                  <h3 className="font-serif font-semibold text-brand-brown flex items-center space-x-2">
                    <span>{col.title}</span>
                    <span className="text-xs bg-brand-beige text-brand-brown font-mono px-2 py-0.5 rounded-full font-bold">
                      {colLeads.length}
                    </span>
                  </h3>
                  <p className="text-xxs text-brand-brown/60 leading-tight">{col.desc}</p>
                </div>
              </div>

              {/* Cards Container */}
              <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                {colLeads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 border border-dashed border-brand-gold/20 rounded-xl p-4 text-center">
                    <p className="text-xs text-brand-brown/40">Nenhum paciente nesta etapa</p>
                  </div>
                ) : (
                  colLeads.map((lead) => (
                    <motion.div
                      layoutId={`lead-card-${lead.id}`}
                      key={lead.id}
                      onClick={() => onSelectLead(lead)}
                      className="bg-brand-cream/40 hover:bg-white border border-brand-gold/20 hover:border-brand-gold rounded-xl p-4 shadow-xs hover:shadow-md transition-all duration-300 cursor-pointer group relative overflow-hidden"
                    >
                      {/* Accent Strip */}
                      <div className="absolute top-0 left-0 w-1 h-full bg-brand-gold group-hover:bg-brand-brown transition-colors" />

                      {/* Header details */}
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-xs font-semibold text-brand-brown group-hover:text-brand-gold transition-colors font-serif">
                          {lead.name}
                        </span>
                        <div className="flex items-center space-x-1 bg-white px-2 py-0.5 rounded-full border border-brand-gold/10 shadow-xxs">
                          {getSourceIcon(lead.source)}
                          <span className="text-xxs capitalize font-medium text-brand-brown/70 font-mono">
                            {lead.source}
                          </span>
                        </div>
                      </div>

                      {/* Interest Procedure */}
                      <div className="mb-3 flex flex-wrap gap-2 items-center">
                        <span className="inline-block bg-brand-brown/5 text-brand-brown text-xxs px-2.5 py-1 rounded-md font-medium tracking-wide">
                          ✨ {lead.interest}
                        </span>
                        {lead.qualified && (
                          <span className="inline-flex items-center gap-1 bg-emerald-600 text-white text-[9px] px-2 py-1 rounded-md font-bold tracking-wide uppercase shadow-xs">
                            <CheckCircle className="h-2.5 w-2.5" />
                            Qualificado
                          </span>
                        )}
                        {lead.salespersonId && (
                           <span className="inline-block bg-emerald-50 border border-emerald-100 text-emerald-700 text-[9px] px-2 py-1 rounded-md font-medium tracking-wide uppercase">
                             Vendedor Atribuído
                           </span>
                        )}
                      </div>

                      {/* Phone & Date details */}
                      <div className="flex justify-between items-center w-full text-xxs text-brand-brown/60 font-mono mt-4 pt-3 border-t border-brand-gold/10 gap-4">
                        <span className="flex items-center space-x-1 shrink-0">
                          <Phone className="h-3 w-3 text-brand-gold/70" />
                          <span>{lead.phone}</span>
                        </span>
                        <span className="font-bold text-brand-brown tracking-wide shrink-0">
                          {new Date(lead.createdAt).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}
                        </span>
                      </div>

                      {/* Quick Move Trigger Buttons */}
                      <div className="flex justify-end space-x-1.5 mt-3 pt-2 border-t border-brand-gold/10 opacity-0 group-hover:opacity-100 transition-opacity">
                        {col.id === 'novo' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateLeadStatus(lead.id, 'contatado');
                            }}
                            className="flex items-center space-x-1 bg-brand-gold/10 hover:bg-brand-gold hover:text-white text-brand-brown text-xxs px-2 py-1 rounded-md transition-all font-medium"
                          >
                            <span>Contatar</span>
                            <ArrowRight className="h-3 w-3" />
                          </button>
                        )}
                        {col.id === 'contatado' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateLeadStatus(lead.id, 'agendado');
                            }}
                            className="flex items-center space-x-1 bg-brand-gold/10 hover:bg-brand-gold hover:text-white text-brand-brown text-xxs px-2 py-1 rounded-md transition-all font-medium"
                          >
                            <span>Enviar Proposta</span>
                            <ArrowRight className="h-3 w-3" />
                          </button>
                        )}
                        {col.id === 'agendado' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateLeadStatus(lead.id, 'arquivado');
                            }}
                            className="flex items-center space-x-1 bg-emerald-50 hover:bg-emerald-600 hover:text-white text-emerald-700 text-xxs px-2 py-1 rounded-md transition-all font-medium border border-emerald-200"
                          >
                            <CheckCircle className="h-3 w-3" />
                            <span>Fechar Venda</span>
                          </button>
                        )}
                        {col.id === 'arquivado' && (
                          <span className="text-emerald-600 text-xxs font-mono font-medium flex items-center space-x-1">
                            <CheckCircle className="h-3.5 w-3.5" />
                            <span>PACIENTE PREMIUM</span>
                          </span>
                        )}
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* New Lead Capture Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-brand-brown/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-brand-beige border border-brand-gold max-w-md w-full rounded-2xl p-6 shadow-2xl relative"
          >
            <h3 className="text-xl font-serif font-semibold text-brand-brown mb-2">Captar Paciente Concierge</h3>
            <p className="text-xs text-brand-brown/70 mb-5">
              Insira os dados de interesse para criar um lead. Um disparo automático de boas-vindas será realizado via Evolution API.
            </p>

            <form onSubmit={handleSubmitLead} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-brand-brown uppercase tracking-wider mb-1">Nome Completo</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Camila Oliveira"
                  value={newLeadName}
                  onChange={(e) => setNewLeadName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-brand-brown uppercase tracking-wider mb-1">WhatsApp (com DDI/DDD)</label>
                <input
                  type="tel"
                  required
                  placeholder="Ex: 5511977776666"
                  value={newLeadPhone}
                  onChange={(e) => setNewLeadPhone(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-brand-brown uppercase tracking-wider mb-1">E-mail</label>
                <input
                  type="email"
                  placeholder="Ex: camila@exemplo.com"
                  value={newLeadEmail}
                  onChange={(e) => setNewLeadEmail(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-brand-brown uppercase tracking-wider mb-1">Procedimento</label>
                  <select
                    value={newLeadInterest}
                    onChange={(e) => setNewLeadInterest(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
                  >
                    <option value="Ultraformer MPT">Ultraformer MPT</option>
                    <option value="Lavien BB Laser">Lavien BB Laser</option>
                    <option value="Toxina Botulínica">Toxina Botulínica</option>
                    <option value="Bioestimulador Elleva">Bioestimulador Elleva</option>
                    <option value="Lifting Integrativo">Lifting Integrativo</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-brand-brown uppercase tracking-wider mb-1">Origem</label>
                  <select
                    value={newLeadSource}
                    onChange={(e) => setNewLeadSource(e.target.value as any)}
                    className="w-full px-4 py-2.5 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
                  >
                    <option value="site">Website / Formulário</option>
                    <option value="instagram">Instagram Direct</option>
                    <option value="google">Google Search</option>
                    <option value="indicação">Indicação</option>
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-brand-brown uppercase tracking-wider mb-1">Vendedor / Atendente</label>
                  <select
                    value={newLeadSalespersonId}
                    onChange={(e) => setNewLeadSalespersonId(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
                  >
                    <option value="">Sem Vendedor Específico (Fila)</option>
                    {salespeople.map(sp => (
                      <option key={sp.id} value={sp.id}>{sp.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2.5 text-sm font-medium text-brand-brown/70 hover:bg-brand-brown/5 rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex items-center space-x-2 bg-brand-brown hover:bg-brand-brown/90 text-brand-beige px-5 py-2.5 rounded-xl text-sm font-medium transition-all shadow-md"
                >
                  <Sparkles className="h-4 w-4 text-brand-gold" />
                  <span>Captar & Disparar</span>
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}

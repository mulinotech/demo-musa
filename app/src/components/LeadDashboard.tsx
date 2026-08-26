import { useState, useMemo, FormEvent } from "react";
import { Lead } from "../data";
import { X, Lock, Users, Calendar, Trash2, Check, Download, ShieldCheck } from "lucide-react";

interface LeadDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  leads: Lead[];
  onUpdateLeadStatus: (leadId: string, newStatus: Lead["status"]) => void;
  onDeleteLead: (leadId: string) => void;
  onClearLeads: () => void;
}

export default function LeadDashboard({
  isOpen,
  onClose,
  leads,
  onUpdateLeadStatus,
  onDeleteLead,
  onClearLeads
}: LeadDashboardProps) {
  const [password, setPassword] = useState<string>("");
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("todos");

  const handleLogin = (e: FormEvent) => {
    e.preventDefault();
    const adminPassword = import.meta.env.VITE_ADMIN_PASSWORD || "MusaElite2026!Vx7Q";
    if (password === adminPassword) {
      setIsAuthenticated(true);
      setAuthError("");
    } else {
      setAuthError("Senha incorreta. Por favor, tente novamente.");
    }
  };

  const filteredLeads = useMemo(() => {
    if (statusFilter === "todos") return leads;
    return leads.filter(l => l.status === statusFilter);
  }, [leads, statusFilter]);

  const stats = useMemo(() => {
    return {
      total: leads.length,
      novos: leads.filter(l => l.status === "novo").length,
      contatados: leads.filter(l => l.status === "contatado").length,
      agendados: leads.filter(l => l.status === "agendado").length,
      arquivados: leads.filter(l => l.status === "arquivado").length,
    };
  }, [leads]);

  const handleExportJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(leads, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `leads_dra_musa_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleSendWhatsAppReach = (lead: Lead) => {
    let clean = lead.whatsapp.replace(/\D/g, "");
    if (clean.length > 0 && !clean.startsWith("55")) {
      clean = `55${clean}`;
    }
    const defaultTemplate = `Olá ${lead.name}! Meu nome é Amanda e sou a concierge na clínica Dra. Musa Estética de Elite. Recebemos seu interesse em nosso protocolo de ${lead.treatment} e gostaria de agendar uma avaliação vip com a Dra. Musa Valentina. Qual o melhor dia e horário para você?`;
    window.open(`https://wa.me/${clean}?text=${encodeURIComponent(defaultTemplate)}`, "_blank");
  };

  const formatPhoneNumber = (num: string) => {
    let clean = num.replace(/\D/g, "");
    if (clean.startsWith("55") && (clean.length === 13 || clean.length === 12)) {
      clean = clean.substring(2);
    }
    if (clean.length === 11) {
      return `(${clean.substring(0, 2)}) ${clean.substring(2, 7)}-${clean.substring(7)}`;
    }
    if (clean.length === 10) {
      return `(${clean.substring(0, 2)}) ${clean.substring(2, 6)}-${clean.substring(6)}`;
    }
    if (clean.length === 9) {
      return `(15) ${clean.substring(0, 5)}-${clean.substring(5)}`;
    }
    if (clean.length === 8) {
      return `(15) ${clean.substring(0, 4)}-${clean.substring(4)}`;
    }
    return num;
  };

  if (!isOpen) return null;

  return (
    <div id="leads-crm-dashboard" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1a1411]/50 backdrop-blur-md animate-fade-in">
      <div className="relative bg-white border border-primary/20 max-w-5xl w-full max-h-[90vh] overflow-hidden rounded-lg shadow-2xl flex flex-col justify-between">
        
        {/* Header Title */}
        <div className="bg-bg-luxe border-b border-primary/10 p-6 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-primary/10 p-2 rounded-full">
              <ShieldCheck className="w-6 h-6 text-primary" />
            </div>
            <div className="text-left">
              <h3 className="text-lg md:text-xl font-serif text-neutral tracking-wider uppercase font-bold">
                Painel Interno de Controle VIP (CRM Leads)
              </h3>
              <p className="text-[10px] text-neutral-muted font-light mt-0.5">
                Central administrativa para gerenciamento estético, acompanhamento médico e conversão de pacientes nascidos online.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-neutral-muted hover:text-neutral hover:bg-neutral/5 rounded-full cursor-pointer pointer-events-auto"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Auth Barrier Screen */}
        {!isAuthenticated ? (
          <div className="p-10 flex flex-col items-center justify-center space-y-6 text-center flex-1 my-12">
            <Lock className="w-12 h-12 text-primary animate-pulse" />
            <div className="space-y-2 max-w-md">
              <h4 className="text-base font-bold text-neutral uppercase tracking-widest">Acesso Restrito do Administrador</h4>
              <p className="text-xs text-neutral-muted font-light leading-relaxed">
                Para proteger os dados confidenciais e avaliações diagnósticas de pele das pacientes em conformidade com a LGPD, insira a chave de acesso comercial abaixo.
              </p>
            </div>

            <form onSubmit={handleLogin} className="w-full max-w-xs space-y-3.5">
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Insira a Senha de Acesso"
                className="w-full bg-bg-luxe border border-primary/15 focus:border-primary rounded px-4 py-3 text-center text-sm text-neutral focus:outline-none transition-colors"
                autoFocus
              />
              {authError && <p className="text-[11px] text-red-650 font-semibold">{authError}</p>}
              <button
                type="submit"
                className="w-full bg-primary hover:bg-primary-light text-white font-extrabold uppercase text-xs tracking-widest py-3 rounded cursor-pointer transition-colors"
              >
                Desbloquear Acesso
              </button>
            </form>
          </div>
        ) : (
          /* Real administrative Screen panel after Password bypass */
          <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 flex flex-col justify-between">
            
            {/* Lead Stats board row */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-bg-luxe border border-primary/10 p-4 rounded text-center">
                <p className="text-[10px] text-neutral-muted uppercase tracking-widest font-bold">Total de Leads</p>
                <p className="text-2xl font-serif text-neutral font-bold mt-1.5">{stats.total}</p>
              </div>
              <div className="bg-bg-luxe border border-primary/25 p-4 rounded text-center">
                <p className="text-[10px] text-primary uppercase tracking-widest font-bold">Novos</p>
                <p className="text-2xl font-serif text-primary font-bold mt-1.5">{stats.novos}</p>
              </div>
              <div className="bg-bg-luxe border border-primary/10 p-4 rounded text-center">
                <p className="text-[10px] text-blue-600 uppercase tracking-widest font-bold">Contatados</p>
                <p className="text-2xl font-serif text-blue-600 font-bold mt-1.5">{stats.contatados}</p>
              </div>
              <div className="bg-bg-luxe border border-emerald-500/25 p-4 rounded text-center">
                <p className="text-[10px] text-emerald-600 uppercase tracking-widest font-bold">Agendados</p>
                <p className="text-2xl font-serif text-emerald-600 font-bold mt-1.5">{stats.agendados}</p>
              </div>
              <div className="bg-bg-luxe border border-primary/5 p-4 rounded text-center col-span-2 md:col-span-1">
                <p className="text-[10px] text-neutral-muted/80 uppercase tracking-widest font-bold">Arquivados</p>
                <p className="text-2xl font-serif text-neutral-muted font-bold mt-1.5">{stats.arquivados}</p>
              </div>
            </div>

            {/* Leads controls bar */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-primary/10 pb-5">
              
              {/* Filters toggle */}
              <div className="flex flex-wrap gap-2 text-xs">
                {["todos", "novo", "contatado", "agendado", "arquivado"].map((status) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={`px-3.5 py-1.5 rounded uppercase tracking-wider text-[10px] font-bold transition-colors cursor-pointer ${
                      statusFilter === status
                        ? "bg-primary text-white font-extrabold"
                        : "bg-bg-luxe border border-primary/10 hover:border-primary/25 text-neutral-muted hover:text-neutral"
                    }`}
                  >
                    {status === "todos" ? "Todos os Leads" : status}
                  </button>
                ))}
              </div>

              {/* Action buttons */}
              <div className="flex items-center space-x-3 text-xs">
                <button
                  onClick={handleExportJSON}
                  disabled={leads.length === 0}
                  className="flex items-center space-x-1 text-[10px] uppercase font-bold text-primary hover:text-primary-light bg-white border border-primary/20 px-3.5 py-2 rounded transition-colors cursor-pointer disabled:opacity-40"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Exportar Leads (.JSON)</span>
                </button>
                <button
                  onClick={onClearLeads}
                  disabled={leads.length === 0}
                  className="flex items-center space-x-1 text-[10px] uppercase font-bold text-red-650 hover:text-red-700 bg-red-500/5 border border-red-200 px-3.5 py-2 rounded transition-colors cursor-pointer disabled:opacity-40"
                  title="Reseta banco local administrativo"
                >
                  <span>Mudar Base</span>
                </button>
              </div>

            </div>

            {/* Leads Log Table list */}
            <div className="flex-1 overflow-x-auto min-h-[220px]">
              {filteredLeads.length === 0 ? (
                <div className="text-center py-12 space-y-2">
                  <Users className="w-8 h-8 text-neutral-muted mx-auto" />
                  <p className="text-xs text-neutral-muted font-light">Nenhum lead encontrado neste filtro.</p>
                </div>
              ) : (
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-primary/10 text-neutral-muted uppercase tracking-wider text-[9px] font-bold">
                      <th className="py-3 px-2">Data / Ateliê</th>
                      <th className="py-3 px-2">Nome Completo</th>
                      <th className="py-3 px-2">WhatsApp / Canal</th>
                      <th className="py-3 px-2">Procedimento Alvo</th>
                      <th className="py-3 px-2">Status Processual</th>
                      <th className="py-3 px-2 text-right">Ação Concierge</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-primary/10">
                    {filteredLeads.map((lead) => {
                      return (
                        <tr key={lead.id} className="hover:bg-bg-luxe/80 text-neutral-muted transition-colors">
                          {/* Date */}
                          <td className="py-3 px-2 text-[10px] text-neutral-muted font-mono">
                            {new Date(lead.date).toLocaleDateString("pt-BR")} at{" "}
                            {new Date(lead.date).toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          {/* Name */}
                          <td className="py-3 px-2 font-semibold text-neutral max-w-[120px] truncate" title={lead.name}>
                            {lead.name}
                          </td>
                          {/* Phone */}
                          <td className="py-3 px-2 text-[11px] font-mono whitespace-nowrap">
                            {formatPhoneNumber(lead.whatsapp)}
                          </td>
                          {/* Treatment */}
                          <td className="py-3 px-2 font-semibold text-primary">
                            {lead.treatment}
                          </td>
                          {/* Status */}
                          <td className="py-3 px-2">
                            <select
                              value={lead.status}
                              onChange={(e) => onUpdateLeadStatus(lead.id, e.target.value as Lead["status"])}
                              className={`text-[9px] uppercase tracking-wider px-2 py-1.5 rounded font-black cursor-pointer bg-white border border-primary/15 focus:outline-none focus:border-primary ${
                                lead.status === "novo" ? "text-amber-600 font-semibold" : lead.status === "contatado" ? "text-blue-600 font-semibold" : lead.status === "agendado" ? "text-emerald-600 font-semibold" : "text-neutral-muted"
                              }`}
                            >
                              <option value="novo">Novo Lead</option>
                              <option value="contatado">Contatado</option>
                              <option value="agendado">Agendado</option>
                              <option value="arquivado">Arquivado</option>
                            </select>
                          </td>
                          {/* Actions */}
                          <td className="py-3 px-2 text-right">
                            <div className="flex items-center justify-end space-x-2">
                              <button
                                onClick={() => handleSendWhatsAppReach(lead)}
                                className="p-1 px-2.5 bg-emerald-50 hover:bg-emerald-600 border border-emerald-200 text-emerald-700 hover:text-white rounded text-[10px] uppercase font-bold tracking-wider transition-all cursor-pointer"
                                title="Enviar mensagem concierge diretamente via WhatsApp"
                              >
                                Conversar
                              </button>
                              <button
                                onClick={() => onDeleteLead(lead.id)}
                                className="p-1.5 bg-red-50 hover:bg-red-600 text-red-600 hover:text-white rounded transition-colors cursor-pointer border border-red-200"
                                title="Excluir lead"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

          </div>
        )}

      </div>
    </div>
  );
}

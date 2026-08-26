import React, { useState, useEffect } from 'react';
import { TreatmentPlan, TreatmentSession, TreatmentCatalog, Treatment } from '../types';
import { 
  Calendar, 
  CheckCircle, 
  Clock, 
  Plus, 
  FileText, 
  AlertCircle, 
  Sparkles, 
  Play, 
  Pause, 
  Check, 
  User, 
  Edit3,
  Coins,
  Clipboard,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface TreatmentJourneyProps {
  plans: TreatmentPlan[];
  clientId: string;
  treatmentCatalog: TreatmentCatalog[];
  onAddPlan: (plan: Omit<TreatmentPlan, 'id' | 'createdAt'>) => Promise<void>;
  onUpdatePlan: (id: string, planData: Partial<TreatmentPlan>) => Promise<void>;
  onDeletePlan: (id: string) => Promise<void>;
  onUpdateSession: (id: string, sessionData: Partial<TreatmentSession>) => Promise<void>;
  flatTreatments?: Treatment[];
}

export default function TreatmentJourney({
  plans,
  clientId,
  treatmentCatalog,
  onAddPlan,
  onUpdatePlan,
  onDeletePlan,
  onUpdateSession,
  flatTreatments = []
}: TreatmentJourneyProps) {
  const clientPlans = plans.filter(p => p.clientId === clientId);
  const clientFlatTreatments = flatTreatments.filter(t => t.clientId === clientId);
  
  const [showAddPlan, setShowAddPlan] = useState(false);
  const [newPlanTitle, setNewPlanTitle] = useState('');
  const [newPlanObjective, setNewPlanObjective] = useState('');
  const [newPlanSessions, setNewPlanSessions] = useState('3');
  const [newPlanPeriodicity, setNewPlanPeriodicity] = useState('Quinzenal');
  const [newPlanStartDate, setNewPlanStartDate] = useState(new Date().toISOString().split('T')[0]);

  const [selectedCatalogItem, setSelectedCatalogItem] = useState('');
  const [sessionPrice, setSessionPrice] = useState('');
  const [isTitleManual, setIsTitleManual] = useState(false);

  useEffect(() => {
    if (!selectedCatalogItem) {
      if (!isTitleManual) {
        setNewPlanTitle('');
      }
      setSessionPrice('');
      return;
    }
    const catalogItem = treatmentCatalog.find(item => item.id === selectedCatalogItem || item.name === selectedCatalogItem);
    if (catalogItem) {
      if (!isTitleManual) {
        setNewPlanTitle(`Protocolo ${catalogItem.name}`);
      }
      setSessionPrice(catalogItem.price.toString());
      if (!newPlanObjective && catalogItem.description) {
        setNewPlanObjective(catalogItem.description);
      }
    }
  }, [selectedCatalogItem, treatmentCatalog, isTitleManual, newPlanObjective]);

  // Modals for editing sessions
  const [editingSession, setEditingSession] = useState<TreatmentSession | null>(null);
  const [evolutionNotes, setEvolutionNotes] = useState('');
  const [sessionStatus, setSessionStatus] = useState<TreatmentSession['status']>('PENDENTE');
  const [sessionDate, setSessionDate] = useState('');
  const [sessionType, setSessionType] = useState<TreatmentSession['sessionType']>('SESSAO_TRATAMENTO');
  const [equipments, setEquipments] = useState('');
  const [supplies, setSupplies] = useState('');
  const [professional, setProfessional] = useState('Dra. Musa');
  const [price, setPrice] = useState('');

  // Maintenance follow-up modal
  const [maintenancePlan, setMaintenancePlan] = useState<TreatmentPlan | null>(null);
  const [maintenanceDate, setMaintenanceDate] = useState('');

  const handleCreatePlanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlanTitle || !newPlanSessions) return;
    
    const parsedPrice = sessionPrice ? Number(sessionPrice.replace(',', '.')) : undefined;

    await onAddPlan({
      clientId,
      title: newPlanTitle,
      clinicalObjective: newPlanObjective,
      totalSessions: parseInt(newPlanSessions) || 1,
      periodicity: newPlanPeriodicity,
      status: 'ATIVO',
      startDate: newPlanStartDate,
      estimatedEndDate: undefined,
      sessionPrice: isNaN(parsedPrice as number) ? undefined : parsedPrice
    });
    setNewPlanTitle('');
    setNewPlanObjective('');
    setNewPlanSessions('3');
    setSelectedCatalogItem('');
    setSessionPrice('');
    setIsTitleManual(false);
    setShowAddPlan(false);
  };

  const handleSessionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSession) return;

    const parentPlan = clientPlans.find(p => p.id === editingSession.planId);
    if (!parentPlan) return;

    const parsedPrice = price ? Number(price.replace(',', '.')) : undefined;

    await onUpdateSession(editingSession.id, {
      status: sessionStatus,
      clinicalEvolution: evolutionNotes,
      sessionDate: sessionDate || undefined,
      sessionType,
      equipmentsUsed: equipments,
      suppliesApplied: supplies,
      professionalInCharge: professional,
      price: isNaN(parsedPrice as number) ? undefined : parsedPrice
    });

    // Check if this was the last session in the plan, and is being marked as REALIZADA
    const sortedSessions = [...(parentPlan.sessions || [])].sort((a,b) => a.sessionNumber - b.sessionNumber);
    const isLastSession = editingSession.sessionNumber === parentPlan.totalSessions;
    
    setEditingSession(null);

    if (isLastSession && sessionStatus === 'REALIZADA') {
      setTimeout(() => {
        setMaintenancePlan(parentPlan);
        const defaultDate = new Date();
        defaultDate.setMonth(defaultDate.getMonth() + 6); // default to 6 months return
        setMaintenanceDate(defaultDate.toISOString().split('T')[0]);
      }, 500);
    }
  };

  const handleConfirmMaintenance = async () => {
    if (!maintenancePlan) return;
    // 1. Mark current plan as CONCLUIDO
    await onUpdatePlan(maintenancePlan.id, { status: 'CONCLUIDO' });
    
    // 2. Alert the user that follow-up is scheduled
    alert(`✅ Plano "${maintenancePlan.title}" Concluído! \nRetorno de manutenção agendado para o dia ${new Date(maintenanceDate).toLocaleDateString('pt-BR')}.`);
    
    setMaintenancePlan(null);
  };

  const getStatusBadgeClass = (status: TreatmentPlan['status']) => {
    switch (status) {
      case 'ATIVO': return 'bg-emerald-50 text-emerald-700 border-emerald-250/30';
      case 'CONCLUIDO': return 'bg-gray-150 text-gray-650 border-gray-200/50';
      case 'PAUSADO': return 'bg-amber-50 text-amber-700 border-amber-200/50';
      case 'CANCELADO': return 'bg-red-50 text-red-700 border-red-200/50';
      default: return 'bg-brand-cream/40 text-brand-brown/70';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header and Add Plan */}
      <div className="flex justify-between items-center pb-3 border-b border-brand-beige">
        <div className="flex items-center space-x-2">
          <Sparkles className="h-5 w-5 text-brand-gold" />
          <h3 className="font-serif font-bold text-brand-brown text-base">Planos de Tratamento Ativos</h3>
        </div>
        <button
          onClick={() => {
            setShowAddPlan(true);
            setNewPlanTitle('');
            setNewPlanObjective('');
            setNewPlanSessions('3');
            setSelectedCatalogItem('');
            setSessionPrice('');
            setIsTitleManual(false);
          }}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-brand-brown hover:bg-brand-brown/90 text-brand-beige rounded-xl text-xxs font-bold tracking-wider uppercase transition-all shadow-md"
        >
          <Plus className="h-3.5 w-3.5 text-brand-gold" />
          <span>Novo Plano</span>
        </button>
      </div>

      {clientPlans.length === 0 ? (
        <div className="bg-white rounded-2xl border border-brand-gold/15 p-8 text-center">
          <AlertCircle className="h-8 w-8 text-brand-gold/50 mx-auto mb-2" />
          <h4 className="font-serif text-sm font-semibold text-brand-brown">Nenhum plano desenhado</h4>
          <p className="text-xxs text-brand-brown/60 max-w-xs mx-auto mt-1">Crie um plano de tratamento personalizado para esta paciente gerenciar sessões, insumos e evolução.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {clientPlans.map((plan) => {
            const sessions = plan.sessions || [];
            const doneSessionsCount = sessions.filter(s => s.status === 'REALIZADA').length;
            const progressPercent = Math.round((doneSessionsCount / (plan.totalSessions || 1)) * 100);
            
            // Check for pending/warning conditions
            const hasDoneUnscheduled = sessions.some((s, idx) => s.status === 'REALIZADA' && idx < plan.totalSessions - 1 && sessions[idx+1]?.status === 'PENDENTE');

            return (
              <div key={plan.id} className="bg-white rounded-2xl border border-brand-gold/15 p-5 shadow-xs space-y-4 hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                      <h4 className="font-serif font-bold text-brand-brown text-sm leading-tight">{plan.title}</h4>
                      <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border ${getStatusBadgeClass(plan.status)}`}>
                        {plan.status === 'ATIVO' ? 'Ativo / Em Andamento' : plan.status}
                      </span>
                    </div>
                    {plan.clinicalObjective && (
                      <p className="text-xxs text-brand-brown/70 mt-1 italic font-light">Objetivo: {plan.clinicalObjective}</p>
                    )}
                  </div>

                  <div className="flex items-center space-x-2">
                    {plan.status === 'ATIVO' && (
                      <button
                        onClick={async () => await onUpdatePlan(plan.id, { status: 'PAUSADO' })}
                        className="p-1.5 hover:bg-amber-50 text-amber-600 rounded-lg transition-colors border border-amber-100"
                        title="Pausar Plano"
                      >
                        <Pause className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {plan.status === 'PAUSADO' && (
                      <button
                        onClick={async () => await onUpdatePlan(plan.id, { status: 'ATIVO' })}
                        className="p-1.5 hover:bg-emerald-50 text-emerald-600 rounded-lg transition-colors border border-emerald-100"
                        title="Retomar Plano"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        if (confirm('Deseja excluir permanentemente este plano e todas as suas sessões?')) {
                          await onDeletePlan(plan.id);
                        }
                      }}
                      className="p-1.5 hover:bg-red-50 text-red-650 rounded-lg transition-colors border border-red-100"
                      title="Excluir Plano"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </button>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xxs font-medium text-brand-brown/70">
                    <span>Progresso do Tratamento</span>
                    <span>{progressPercent}% Concluído ({doneSessionsCount} de {plan.totalSessions} sessões)</span>
                  </div>
                  <div className="w-full bg-brand-cream/45 h-2 rounded-full overflow-hidden border border-brand-gold/10">
                    <div 
                      className="bg-brand-brown h-full transition-all duration-500"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>

                {/* Alert Warning for Next Session Schedule */}
                {plan.status === 'ATIVO' && hasDoneUnscheduled && (
                  <div className="flex items-center space-x-2 bg-amber-50 border border-amber-200/50 p-2.5 rounded-xl text-xxs text-amber-800 font-medium">
                    <AlertCircle className="h-4 w-4 text-amber-600 animate-pulse flex-shrink-0" />
                    <span>⚠️ <strong>Pendência:</strong> Próxima sessão aguardando agendamento clínico.</span>
                  </div>
                )}

                {/* Sessions Timeline */}
                <div className="pt-2 pl-2 border-l border-brand-gold/15 space-y-4">
                  {sessions.sort((a,b) => a.sessionNumber - b.sessionNumber).map((sess) => {
                    return (
                      <div key={sess.id} className="relative pl-6 space-y-1.5">
                        {/* Dot Indicator */}
                        <div className={`absolute left-[-5px] top-1.5 w-2.5 h-2.5 rounded-full border border-white shadow-xs ${
                          sess.status === 'REALIZADA' ? 'bg-emerald-500' :
                          sess.status === 'AGENDADA' ? 'bg-sky-500' :
                          sess.status === 'FALTOU' ? 'bg-red-500' : 'bg-amber-400'
                        }`} />

                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center space-x-2">
                            <span className="font-serif font-bold text-xs text-brand-brown">Sessão {sess.sessionNumber}</span>
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-md uppercase text-[10px] tracking-wider text-white bg-opacity-90 font-mono shadow-xs" style={{ backgroundColor: sess.status === 'REALIZADA' ? '#10B981' : sess.status === 'AGENDADA' ? '#0EA5E9' : sess.status === 'FALTOU' ? '#EF4444' : '#F59E0B' }}>
                              {sess.status}
                            </span>
                            <span className="text-[10px] bg-brand-cream/50 text-brand-brown/70 px-2 py-0.5 rounded-md uppercase font-mono">{sess.sessionType.replace('_', ' ')}</span>
                          </div>

                          <div className="flex items-center space-x-2">
                            {sess.price !== undefined && sess.price !== null && (
                              <span className="text-xxs font-mono font-semibold bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-md flex items-center space-x-1">
                                <Coins className="h-3 w-3" />
                                <span>R$ {sess.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                              </span>
                            )}
                            <button
                              onClick={() => {
                                setEditingSession(sess);
                                setEvolutionNotes(sess.clinicalEvolution || '');
                                setSessionStatus(sess.status);
                                setSessionDate(sess.sessionDate ? sess.sessionDate.split('T')[0] : '');
                                setSessionType(sess.sessionType);
                                setEquipments(sess.equipmentsUsed || '');
                                setSupplies(sess.suppliesApplied || '');
                                setProfessional(sess.professionalInCharge || 'Dra. Musa');
                                setPrice(sess.price ? sess.price.toString() : '');
                              }}
                              className="flex items-center space-x-1 px-2.5 py-1 bg-white hover:bg-brand-cream/30 border border-brand-gold/20 text-brand-brown rounded-lg text-xxs font-semibold transition-colors"
                            >
                              <Edit3 className="h-3 w-3 text-brand-gold" />
                              <span>Evolução / Status</span>
                            </button>
                          </div>
                        </div>

                        {/* Date and Clinical evolution note if present */}
                        <div className="text-xxs text-brand-brown/65 space-y-1 pl-1">
                          {sess.sessionDate && (
                            <div className="flex items-center space-x-1 font-mono text-[10px]">
                              <Calendar className="h-3 w-3 text-brand-gold/60" />
                              <span>Data: {new Date(sess.sessionDate).toLocaleDateString('pt-BR')}</span>
                              {sess.nextSessionDate && (
                                <span className="ml-2 text-sky-600">Retorno: {new Date(sess.nextSessionDate).toLocaleDateString('pt-BR')}</span>
                              )}
                            </div>
                          )}
                          {sess.clinicalEvolution ? (
                            <p className="bg-brand-cream/15 p-2 rounded-lg border border-brand-gold/5 italic whitespace-pre-wrap font-sans text-brand-brown/90">📝 Evolução: {sess.clinicalEvolution}</p>
                          ) : (
                            <p className="text-[10px] text-brand-brown/40 italic">Nenhuma anotação de evolução clínica nesta sessão.</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sessões Avulsas & Outros Procedimentos */}
      {clientFlatTreatments.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-brand-gold/15">
          <div className="flex items-center space-x-2">
            <Clipboard className="h-5 w-5 text-brand-gold" />
            <h3 className="font-serif font-bold text-brand-brown text-base">Sessões Avulsas & Procedimentos</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {clientFlatTreatments.map((t) => (
              <div key={t.id} className="bg-brand-cream/15 rounded-xl border border-brand-gold/10 p-4 space-y-2 relative group hover:shadow-xs transition-shadow">
                <div className="flex justify-between items-start">
                  <div>
                    <h5 className="font-serif font-bold text-brand-brown text-xs">{t.procedure}</h5>
                    <div className="flex items-center space-x-1 font-mono text-[9px] text-brand-brown/65 mt-0.5">
                      <Calendar className="h-3 w-3 text-brand-gold/70" />
                      <span>{new Date(t.sessionDate).toLocaleDateString('pt-BR')}</span>
                    </div>
                  </div>
                  {t.price !== undefined && t.price !== null && (
                    <span className="text-xxs font-mono font-semibold bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-md flex items-center space-x-1">
                      <Coins className="h-3 w-3" />
                      <span>R$ {Number(t.price).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                    </span>
                  )}
                </div>
                {t.notes ? (
                  <p className="text-xxs text-brand-brown/80 bg-white/50 p-2 rounded-lg border border-brand-gold/5 whitespace-pre-wrap font-sans italic">
                    {t.notes}
                  </p>
                ) : (
                  <p className="text-[10px] text-brand-brown/40 italic">Sem notas registradas.</p>
                )}
                {t.nextSessionDate && (
                  <div className="text-[9px] font-mono bg-sky-50 text-sky-700 inline-block px-2 py-0.5 rounded">
                    🔄 Retorno Recomendado: {new Date(t.nextSessionDate).toLocaleDateString('pt-BR')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Plan Modal */}
      {showAddPlan && (
        <div className="fixed inset-0 bg-brand-brown/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-brand-beige border border-brand-gold max-w-md w-full rounded-2xl p-6 shadow-2xl space-y-4"
          >
            <h3 className="text-base font-serif font-bold text-brand-brown">Criar Novo Plano de Tratamento</h3>
            <form onSubmit={handleCreatePlanSubmit} className="space-y-4">
              <div>
                <label className="block text-xxs font-bold text-brand-brown uppercase mb-1">Procedimento / Tratamento Vinculado</label>
                <select
                  value={selectedCatalogItem}
                  onChange={(e) => setSelectedCatalogItem(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
                >
                  <option value="">Personalizado (Sem vínculo / Outro)</option>
                  {treatmentCatalog && treatmentCatalog.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} (R$ {Number(t.price).toLocaleString('pt-BR', { minimumFractionDigits: 2 })})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xxs font-bold text-brand-brown uppercase mb-1">Título do Protocolo</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Protocolo Rejuvenescimento Facial 3D"
                  value={newPlanTitle}
                  onChange={(e) => {
                    setNewPlanTitle(e.target.value);
                    setIsTitleManual(true);
                  }}
                  className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
                />
              </div>

              <div>
                <label className="block text-xxs font-bold text-brand-brown uppercase mb-1">Objetivo Clínico / Análise</label>
                <textarea
                  rows={2}
                  placeholder="Ex: Tratar flacidez mandibular e melasmas faciais"
                  value={newPlanObjective}
                  onChange={(e) => setNewPlanObjective(e.target.value)}
                  className="w-full p-3 rounded-xl border border-brand-gold/30 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xxs font-bold text-brand-brown uppercase mb-1">Total de Sessões</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    required
                    value={newPlanSessions}
                    onChange={(e) => setNewPlanSessions(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
                  />
                </div>
                <div>
                  <label className="block text-xxs font-bold text-brand-brown uppercase mb-1">Periodicidade</label>
                  <select
                    value={newPlanPeriodicity}
                    onChange={(e) => setNewPlanPeriodicity(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
                  >
                    <option value="Semanal">Semanal</option>
                    <option value="Quinzenal">Quinzenal</option>
                    <option value="Mensal">Mensal</option>
                    <option value="Customizado">Customizado</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xxs font-bold text-brand-brown uppercase mb-1">Valor por Sessão (R$)</label>
                  <input
                    type="text"
                    placeholder="Ex: 500,00"
                    value={sessionPrice}
                    onChange={(e) => setSessionPrice(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown font-mono"
                  />
                </div>
                <div className="flex flex-col justify-end pb-2 pl-2">
                  <span className="text-[10px] text-brand-brown/50 font-bold uppercase tracking-wider">Total Estimado</span>
                  <span className="text-xs font-mono font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-1.5 mt-0.5 inline-block text-center">
                    R$ {((parseInt(newPlanSessions) || 0) * (Number(sessionPrice.replace(',', '.')) || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xxs font-bold text-brand-brown uppercase mb-1">Data de Início</label>
                <input
                  type="date"
                  required
                  value={newPlanStartDate}
                  onChange={(e) => setNewPlanStartDate(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown font-mono"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddPlan(false)}
                  className="px-4 py-2 text-xs font-medium text-brand-brown/70"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="bg-brand-brown text-brand-beige px-4 py-2 rounded-xl text-xs font-semibold hover:bg-brand-brown/90 shadow-md"
                >
                  Gerar Plano
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Edit Session Status & Evolution Modal */}
      {editingSession && (
        <div className="fixed inset-0 bg-brand-brown/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-brand-beige border border-brand-gold max-w-md w-full rounded-2xl p-6 shadow-2xl space-y-4"
          >
            <h3 className="text-base font-serif font-bold text-brand-brown">Lançar Evolução Estética - Sessão {editingSession.sessionNumber}</h3>
            <form onSubmit={handleSessionSubmit} className="space-y-4">
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xxs font-bold text-brand-brown uppercase mb-1">Status da Sessão</label>
                  <select
                    value={sessionStatus}
                    onChange={(e) => setSessionStatus(e.target.value as any)}
                    className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
                  >
                    <option value="PENDENTE">Pendente</option>
                    <option value="AGENDADA">Agendada</option>
                    <option value="REALIZADA">Realizada / Concluída</option>
                    <option value="FALTOU">Faltou</option>
                    <option value="REAGENDADA">Reagendada</option>
                    <option value="CANCELADA">Cancelada</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xxs font-bold text-brand-brown uppercase mb-1">Tipo de Consulta</label>
                  <select
                    value={sessionType}
                    onChange={(e) => setSessionType(e.target.value as any)}
                    className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
                  >
                    <option value="SESSAO_TRATAMENTO">Sessão Tratamento</option>
                    <option value="AVALIACAO_INICIAL">Avaliação Inicial</option>
                    <option value="RETORNO_AVALIATIVO">Retorno Avaliativo</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xxs font-bold text-brand-brown uppercase mb-1">Data da Sessão</label>
                  <input
                    type="date"
                    value={sessionDate}
                    onChange={(e) => setSessionDate(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xxs font-bold text-brand-brown uppercase mb-1">Valor da Sessão (R$)</label>
                  <input
                    type="text"
                    placeholder="Ex: 1500,00"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xxs font-bold text-brand-brown uppercase mb-1">Profissional Responsável</label>
                <input
                  type="text"
                  value={professional}
                  onChange={(e) => setProfessional(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xxs font-bold text-brand-brown uppercase mb-1">Equipamentos Utilizados</label>
                  <input
                    type="text"
                    placeholder="Ex: Ultraformer MPT, Lavien"
                    value={equipments}
                    onChange={(e) => setEquipments(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
                  />
                </div>
                <div>
                  <label className="block text-xxs font-bold text-brand-brown uppercase mb-1">Insumos Aplicados</label>
                  <input
                    type="text"
                    placeholder="Ex: Ácido Hialurônico, Bioestimulador Y"
                    value={supplies}
                    onChange={(e) => setSupplies(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xxs font-bold text-brand-brown uppercase mb-1">Evolução Clínica / Detalhes Visuais</label>
                <textarea
                  rows={3}
                  placeholder="Descreva o resultado parcial obtido, reações da pele, etc."
                  value={evolutionNotes}
                  onChange={(e) => setEvolutionNotes(e.target.value)}
                  className="w-full p-3 rounded-xl border border-brand-gold/30 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingSession(null)}
                  className="px-4 py-2 text-xs font-medium text-brand-brown/70"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="bg-brand-brown text-brand-beige px-4 py-2 rounded-xl text-xs font-semibold hover:bg-brand-brown/90 shadow-md"
                >
                  Salvar Evolução
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Maintenance Return / Follow-up Dialog */}
      {maintenancePlan && (
        <div className="fixed inset-0 bg-brand-brown/40 backdrop-blur-xs flex items-center justify-center z-[110] p-4">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-brand-beige border border-brand-gold max-w-sm w-full rounded-2xl p-6 shadow-2xl space-y-4 text-center"
          >
            <CheckCircle className="h-12 w-12 text-emerald-600 mx-auto" />
            <div className="space-y-2">
              <h3 className="text-base font-serif font-bold text-brand-brown">🎉 Plano de Tratamento Finalizado!</h3>
              <p className="text-xxs text-brand-brown/70 leading-relaxed">
                Você concluiu a última sessão do plano <strong>{maintenancePlan.title}</strong>. Deseja marcar o plano como <strong>CONCLUÍDO</strong> e planejar a data de manutenção/follow-up?
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <div className="text-left">
                <label className="block text-xxs font-bold text-brand-brown uppercase mb-1">Prazo de Retorno Recomendado</label>
                <input
                  type="date"
                  value={maintenanceDate}
                  onChange={(e) => setMaintenanceDate(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown font-mono"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setMaintenancePlan(null)}
                  className="px-4 py-2 text-xs font-medium text-brand-brown/70"
                >
                  Agora Não
                </button>
                <button
                  onClick={handleConfirmMaintenance}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md transition-colors"
                >
                  Confirmar Conclusão
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

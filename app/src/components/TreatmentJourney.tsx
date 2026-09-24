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
  Trash2,
  CalendarClock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SeletorUnico, SeletorMultiplo } from './CamposDeSelecao';

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
  /* O padrao era a string 'Dra. Musa', escrita no codigo. Num sistema de 50
     clinicas isso poe o nome de UMA clinica como responsavel padrao de todas --
     e no prontuario, onde "quem aplicou" e' a informacao que responde por
     aquele atendimento. Agora nasce vazio e alguem escolhe. */
  const [professional, setProfessional] = useState('');

  /* AS TRES LISTAS QUE SUBSTITUIRAM O TEXTO LIVRE (M5.11).
   *
   * Cada uma cai para lista vazia em silencio se a rota recusar -- um vendedor
   * nao le /api/products, por exemplo. Lista vazia faz o campo voltar a ser
   * texto digitado, que e' pior do que a lista e melhor do que travar o
   * lancamento da sessao. */
  const [equipamentosCadastrados, setEquipamentosCadastrados] = useState<string[]>([]);
  const [insumosCadastrados, setInsumosCadastrados] = useState<string[]>([]);
  const [quemAtende, setQuemAtende] = useState<string[]>([]);

  useEffect(() => {
    const nomes = async (caminho: string) => {
      try {
        const r = await fetch(caminho);
        if (!r.ok) return [];
        const d = await r.json();
        return Array.isArray(d) ? d.map((x: any) => String(x.name || '').trim()).filter(Boolean) : [];
      } catch { return []; }
    };
    let vivo = true;
    Promise.all([nomes('/api/equipments'), nomes('/api/products'), nomes('/api/profissionais')])
      .then(([eq, ins, pro]) => {
        if (!vivo) return;
        setEquipamentosCadastrados(eq);
        setInsumosCadastrados(ins);
        setQuemAtende(pro);
      });
    return () => { vivo = false; };
  }, []);
  const [price, setPrice] = useState('');

  /* PROGRAMAR AS DATAS DO PLANO (M5.12).
   *
   * O plano JA guardava data de inicio e periodicidade e criava as sessoes sem
   * data nenhuma -- dez janelas e dez datas digitadas a mao. Este modal e a
   * porta para os planos que nasceram antes disso, e para quando o tratamento
   * muda de ritmo no meio. */
  const [programando, setProgramando] = useState<TreatmentPlan | null>(null);
  const [progInicio, setProgInicio] = useState('');
  const [progPeriodo, setProgPeriodo] = useState('Quinzenal');
  const [progIntervalo, setProgIntervalo] = useState('21');
  const [progResposta, setProgResposta] = useState<{ ok: boolean; texto: string } | null>(null);
  const [progPrecisaRecarregar, setProgPrecisaRecarregar] = useState(false);

  /* ================== LEVAR AS SESSÕES PARA A AGENDA (M6.3)
   *
   * Programar é escrever a data na ficha; agendar é ocupar o horário da
   * clínica. Até aqui só existia o primeiro, e a recepção remarcava as dez
   * sessões à mão lendo da outra tela.
   *
   * Hora e profissional são perguntados UMA vez e valem para a série -- que é
   * o que a clínica faz de verdade ao vender um protocolo de dez sessões. */
  const [profissionais, setProfissionais] = useState<{ id: string; name: string; funcao?: string }[]>([]);
  const [ageHora, setAgeHora] = useState('09:00');
  const [ageProf, setAgeProf] = useState('');
  const [ageDuracao, setAgeDuracao] = useState('60');
  const [ageOcupado, setAgeOcupado] = useState(false);
  const [ageResposta, setAgeResposta] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    if (!programando || profissionais.length) return;
    fetch('/api/profissionais')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        const lista = Array.isArray(d) ? d : [];
        setProfissionais(lista);
        if (lista.length === 1) setAgeProf(lista[0].id);
      })
      .catch(() => setProfissionais([]));
  }, [programando, profissionais.length]);

  const levarParaAgenda = async () => {
    if (!programando) return;
    if (!ageProf) return setAgeResposta({ ok: false, texto: 'Escolha o profissional que vai atender.' });
    setAgeOcupado(true);
    setAgeResposta(null);
    try {
      const r = await fetch(`/api/treatment-plans/${programando.id}/agendar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hora: ageHora,
          professionalId: ageProf,
          duracaoMin: Number(String(ageDuracao).replace(',', '.')) || undefined
        })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setAgeResposta({ ok: false, texto: d.error || 'Nao foi possivel levar para a agenda.' }); return; }

      /* A resposta conta TUDO: quantas entraram, quais bateram com horario
         ocupado, e quais foram puladas e por que. "7 de 10 agendadas" sem dizer
         quais e' a mesma coisa que nao dizer nada. */
      const partes = [d.criados + (d.criados === 1 ? ' sessao entrou na agenda' : ' sessoes entraram na agenda')];
      if (d.conflitos && d.conflitos.length) {
        partes.push(d.conflitos.length + (d.conflitos.length === 1 ? ' nao entrou' : ' nao entraram') +
          ' porque o horario ja estava ocupado: ' +
          d.conflitos.map((c: { n: number; dia: string }) => 'sessao ' + c.n + ' em ' + c.dia).join(', '));
      }
      if (d.pulados && d.pulados.length) {
        partes.push(d.pulados.map((x: { n: number; porque: string }) => 'sessao ' + x.n + ' ' + x.porque).join('; '));
      }
      setAgeResposta({ ok: d.criados > 0, texto: partes.join('. ') + '.' });
      setProgPrecisaRecarregar(true);
    } catch {
      setAgeResposta({ ok: false, texto: 'Falha de rede ao levar as sessoes para a agenda.' });
    } finally {
      setAgeOcupado(false);
    }
  };

  const fecharProgramacao = async () => {
    const recarregar = progPrecisaRecarregar;
    const id = programando?.id;
    setProgramando(null);
    setProgPrecisaRecarregar(false);
    if (recarregar && id) await onUpdatePlan(id, {});
  };

  const abrirProgramacao = (plan: TreatmentPlan) => {
    setProgramando(plan);
    setAgeResposta(null);
    setProgInicio(plan.startDate ? String(plan.startDate).split('T')[0]
      : new Date().toISOString().split('T')[0]);
    const conhecida = ['Semanal', 'Quinzenal', 'Mensal'].includes(plan.periodicity || '');
    setProgPeriodo(conhecida ? (plan.periodicity as string) : 'Customizado');
    setProgResposta(null);
  };

  const programar = async () => {
    if (!programando) return;
    setProgResposta(null);
    try {
      const r = await fetch(`/api/treatment-plans/${programando.id}/programar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inicio: progInicio,
          periodicidade: progPeriodo,
          intervaloDias: progPeriodo === 'Customizado' ? Number(progIntervalo) : undefined
        })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setProgResposta({ ok: false, texto: d.error || 'Nao foi possivel programar.' }); return; }

      /* A resposta conta o que NAO mudou, e nao so o que mudou: sessao ja
         realizada nao e reprogramada, e quem programou precisa saber disso
         antes de olhar a lista e achar que deu errado. */
      const partes = [d.programadas + (d.programadas === 1 ? ' sessao programada' : ' sessoes programadas')];
      if (d.preservadas) {
        partes.push(d.preservadas + (d.preservadas === 1 ? ' ja realizada nao foi tocada'
          : ' ja realizadas nao foram tocadas'));
      }
      if (d.avisos && d.avisos.length) partes.push(d.avisos.join(' '));
      setProgResposta({ ok: true, texto: partes.join('. ') + '.' });
      /* NAO recarrega aqui, e isso e' correcao de 21/09: a recarga remontava a
         arvore, o modal sumia junto, e a pessoa nunca lia quantas sessoes
         entraram nem quantas foram preservadas. Clicar e a tela fechar sem
         dizer nada e' o silencio de sempre, em outro lugar. A recarga acontece
         ao FECHAR o modal. */
      setProgPrecisaRecarregar(true);
    } catch {
      setProgResposta({ ok: false, texto: 'Falha de rede ao programar as datas.' });
    }
  };

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
                      onClick={() => abrirProgramacao(plan)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-brand-brown/80 hover:bg-brand-beige rounded-lg border border-brand-gold/25"
                      title="Preenche a data prevista de todas as sessões que ainda não aconteceram"
                    >
                      <CalendarClock className="h-3.5 w-3.5 text-brand-gold" />
                      <span>Programar datas</span>
                    </button>
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
                                setProfessional(sess.professionalInCharge || '');
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

              <SeletorUnico
                rotulo="Profissional Responsável"
                valor={professional}
                aoMudar={setProfessional}
                cadastrados={quemAtende}
                placeholder="Nome de quem aplicou"
                ondeCadastrar="A lista vem dos acessos da clínica, em Usuários."
              />

              <div className="grid grid-cols-2 gap-4">
                <SeletorUnico
                  rotulo="Equipamento Utilizado"
                  valor={equipments}
                  aoMudar={setEquipments}
                  cadastrados={equipamentosCadastrados}
                  placeholder="Ex: Ultraformer MPT"
                  ondeCadastrar="Cadastre os aparelhos em Cadastros → Equipamentos para escolher da lista."
                />
                <SeletorMultiplo
                  rotulo="Insumos Aplicados"
                  valor={supplies}
                  aoMudar={setSupplies}
                  cadastrados={insumosCadastrados}
                  placeholder="Ex: Ácido Hialurônico, Bioestimulador Y"
                  ondeCadastrar="A lista vem do Estoque."
                />
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

      {/* PROGRAMAR AS DATAS DO PLANO (M5.12) */}
      {programando && (
        /* ============================== A JANELA CRESCEU E PRECISA CABER (M6.3b)
           `items-center` com altura livre centraliza uma caixa MAIOR que a tela,
           e aí as duas pontas ficam fora dela: o botão de fechar some embaixo e
           não há o que rolar, porque quem rola é o fundo, não o modal. Com o
           bloco da agenda a janela passou de sete para treze campos e o defeito
           apareceu em produção.

           `items-start` + `overflow-y-auto` no fundo e `max-h` na caixa: a
           janela rola por dentro, e a caixa nunca passa da altura da tela.

           A caixa também alargou (`max-w-md`): a mesma quantidade de texto numa
           coluna mais larga ocupa menos linhas, e era a estreiteza que fazia a
           fonte parecer grande. */
        <div className="fixed inset-0 bg-brand-brown/40 backdrop-blur-xs flex items-start justify-center z-[110] p-4 overflow-y-auto">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-brand-beige border border-brand-gold max-w-md w-full rounded-2xl p-5 my-6 shadow-2xl space-y-3.5 max-h-[calc(100vh-3rem)] overflow-y-auto"
          >
            <div>
              <h3 className="text-sm font-serif font-bold text-brand-brown">Programar as datas</h3>
              <p className="text-[10px] text-brand-brown/70 leading-relaxed mt-1">
                Preenche a data prevista de cada sessão de <strong>{programando.title}</strong>.
                Sessões já realizadas, canceladas ou com falta <strong>não são tocadas</strong> —
                a data delas é o dia em que a paciente esteve aqui.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-brand-brown uppercase mb-1">Primeira sessão</label>
                <input
                  type="date"
                  value={progInicio}
                  onChange={(e) => setProgInicio(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-brand-gold/30 bg-white text-[11px] text-brand-brown font-mono focus:outline-none focus:ring-2 focus:ring-brand-gold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-brand-brown uppercase mb-1">De quanto em quanto</label>
                <select
                  value={progPeriodo}
                  onChange={(e) => setProgPeriodo(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-brand-gold/30 bg-white text-[11px] text-brand-brown focus:outline-none focus:ring-2 focus:ring-brand-gold"
                >
                  <option value="Semanal">Semanal</option>
                  <option value="Quinzenal">Quinzenal</option>
                  <option value="Mensal">Mensal</option>
                  <option value="Customizado">Outro intervalo</option>
                </select>
              </div>
            </div>

            {progPeriodo === 'Customizado' && (
              <div>
                <label className="block text-[10px] font-bold text-brand-brown uppercase mb-1">A cada quantos dias</label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={progIntervalo}
                  onChange={(e) => setProgIntervalo(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-brand-gold/30 bg-white text-[11px] text-brand-brown font-mono focus:outline-none focus:ring-2 focus:ring-brand-gold"
                />
              </div>
            )}

            {progResposta && (
              <p className={`text-xxs font-medium leading-relaxed py-2 px-3 rounded-lg border ${
                progResposta.ok
                  ? 'text-emerald-700 bg-emerald-50 border-emerald-150'
                  : 'text-red-600 bg-red-50 border-red-150'
              }`}>
                {progResposta.texto}
              </p>
            )}

            {/* ============================ E AGORA, PARA A AGENDA (M6.3)
                Separado por uma linha de propósito: programar a data e ocupar o
                horário da clínica são duas decisões, e a segunda precisa de
                hora e profissional que a primeira não sabe. */}
            <div className="pt-3 border-t border-brand-gold/20 space-y-3">
              <div>
                <p className="text-[10px] font-bold text-brand-brown uppercase">Levar para a agenda</p>
                <p className="text-[10px] text-brand-brown/60 leading-relaxed mt-0.5">
                  Cria o horário de cada sessão programada. Sessão já realizada, data que já
                  passou e sessão que já está na agenda ficam de fora — e a tela diz quais.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-brand-brown uppercase mb-1">Hora</label>
                  <input
                    type="time"
                    value={ageHora}
                    onChange={(e) => setAgeHora(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-brand-gold/30 bg-white text-[11px] text-brand-brown font-mono focus:outline-none focus:ring-2 focus:ring-brand-gold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-brand-brown uppercase mb-1">Duração (min)</label>
                  <input
                    type="number"
                    min="5"
                    max="600"
                    value={ageDuracao}
                    onChange={(e) => setAgeDuracao(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-brand-gold/30 bg-white text-[11px] text-brand-brown font-mono focus:outline-none focus:ring-2 focus:ring-brand-gold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-brand-brown uppercase mb-1">Profissional</label>
                  <select
                    value={ageProf}
                    onChange={(e) => setAgeProf(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-brand-gold/30 bg-white text-[11px] text-brand-brown focus:outline-none focus:ring-2 focus:ring-brand-gold"
                  >
                    <option value="">Escolha…</option>
                    {profissionais.map((pr) => (
                      <option key={pr.id} value={pr.id}>{pr.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {ageResposta && (
                <p className={`text-xxs font-medium leading-relaxed py-2 px-3 rounded-lg border ${
                  ageResposta.ok
                    ? 'text-emerald-700 bg-emerald-50 border-emerald-150'
                    : 'text-amber-800 bg-amber-50 border-amber-200'
                }`}>
                  {ageResposta.texto}
                </p>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={fecharProgramacao}
                className="px-4 py-2 text-[11px] font-medium text-brand-brown/70"
              >
                {progResposta && progResposta.ok ? 'Fechar' : 'Cancelar'}
              </button>
              <button
                onClick={levarParaAgenda}
                disabled={ageOcupado}
                className="bg-white border border-brand-gold/40 text-brand-brown px-4 py-2 rounded-xl text-[11px] font-semibold hover:bg-brand-beige disabled:opacity-60 cursor-pointer"
              >
                {ageOcupado ? 'Levando...' : 'Levar para a agenda'}
              </button>
              <button
                onClick={programar}
                className="bg-brand-brown text-brand-beige px-4 py-2 rounded-xl text-[11px] font-semibold hover:bg-brand-brown/90 shadow-md"
              >
                Programar
              </button>
            </div>
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

import React, { useState, useEffect } from 'react';
import { Client, Treatment, TreatmentCatalog, TreatmentPlan, TreatmentSession } from '../types';
import TreatmentJourney from './TreatmentJourney';
import { 
  User, 
  Phone, 
  Mail, 
  Plus, 
  FileText, 
  Sparkles, 
  Calendar, 
  Clipboard, 
  ArrowRight,
  ChevronRight,
  Camera,
  Heart,
  Loader2,
  Pencil,
  Check,
  Save,
  Trash2
} from 'lucide-react';
import { motion } from 'motion/react';

const WhatsAppIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M12.012 2c-5.506 0-9.989 4.478-9.99 9.984a9.96 9.96 0 001.37 5.054L2 22l5.132-1.347a9.937 9.937 0 004.875 1.28h.005c5.505 0 9.99-4.478 9.99-9.985 0-2.67-1.04-5.18-2.93-7.07A9.916 9.916 0 0012.012 2zm5.72 14.195c-.247.697-1.238 1.37-1.706 1.464-.468.093-1.077.165-3.088-.667-2.57-1.064-4.22-3.684-4.348-3.856-.128-.17-1.037-1.382-1.037-2.637 0-1.254.66-1.872.894-2.115.234-.243.51-.304.68-.304.17 0 .34.002.488.01.15.006.353-.056.553.428.204.496.697 1.704.757 1.826.06.12.1.26.02.42-.08.16-.18.26-.26.36-.08.1-.17.2-.24.28-.08.08-.162.169-.069.33.093.16.413.683.89 1.108.614.547 1.13.717 1.29.797.16.08.253.067.347-.04.093-.108.404-.472.51-.634.107-.162.213-.135.36-.08.147.054.935.44 1.096.52.16.08.267.12.307.19.04.07.04.407-.207 1.104z"/>
  </svg>
);

interface ClientDirectoryProps {
  clients: Client[];
  treatments: Treatment[];
  onAddClient: (client: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onAddTreatment: (treatment: Omit<Treatment, 'id'>) => Promise<void>;
  isAiConfigured: boolean;
  onUpdateClientData?: () => void;
  treatmentCatalog: TreatmentCatalog[];
  onUpdateClient?: (id: string, clientData: Partial<Client>) => Promise<void>;
  onDeleteClient?: (id: string) => Promise<void>;
  treatmentPlans?: TreatmentPlan[];
  onAddTreatmentPlan?: (plan: Omit<TreatmentPlan, 'id' | 'createdAt'>) => Promise<void>;
  onUpdateTreatmentPlan?: (id: string, planData: Partial<TreatmentPlan>) => Promise<void>;
  onDeleteTreatmentPlan?: (id: string) => Promise<void>;
  onUpdateTreatmentSession?: (id: string, sessionData: Partial<TreatmentSession>) => Promise<void>;
}

export default function ClientDirectory({ 
  clients, 
  treatments, 
  onAddClient, 
  onAddTreatment,
  isAiConfigured,
  onUpdateClientData,
  treatmentCatalog,
  onUpdateClient,
  onDeleteClient,
  treatmentPlans,
  onAddTreatmentPlan,
  onUpdateTreatmentPlan,
  onDeleteTreatmentPlan,
  onUpdateTreatmentSession
}: ClientDirectoryProps) {
  const [selectedClient, setSelectedClient] = useState<Client | null>(clients[0] || null);
  const [showAddClient, setShowAddClient] = useState(false);
  const [showAddTreatment, setShowAddTreatment] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEditingLaudo, setIsEditingLaudo] = useState(false);
  const [editingTreatmentId, setEditingTreatmentId] = useState<string | null>(null);
  const [editTreatmentData, setEditTreatmentData] = useState<{procedure: string, sessionDate: string, notes: string, price?: number | string}>({procedure: '', sessionDate: '', notes: '', price: ''});

  // Edit Client Modal State
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editClientName, setEditClientName] = useState('');
  const [editClientPhone, setEditClientPhone] = useState('');
  const [editClientEmail, setEditClientEmail] = useState('');

  useEffect(() => {
    if (editingClient) {
      setEditClientName(editingClient.name);
      setEditClientPhone(editingClient.phone);
      setEditClientEmail(editingClient.email || '');
    }
  }, [editingClient]);

  // Sync selectedClient when clients prop changes (e.g. after database refetch)
  useEffect(() => {
    if (selectedClient) {
      const updated = clients.find(c => c.id === selectedClient.id);
      if (updated && (updated.name !== selectedClient.name || updated.phone !== selectedClient.phone || updated.email !== selectedClient.email || updated.anamnese !== selectedClient.anamnese || updated.imageBase64 !== selectedClient.imageBase64 || updated.laudo !== selectedClient.laudo)) {
        setSelectedClient(updated);
      }
    } else if (clients.length > 0) {
      setSelectedClient(clients[0]);
    }
  }, [clients]);

  const handleEditClientSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClient || !editClientName || !editClientPhone) return;
    if (onUpdateClient) {
      await onUpdateClient(editingClient.id, {
        name: editClientName,
        phone: editClientPhone,
        email: editClientEmail
      });
      // Also update selectedClient if it is the one being edited
      if (selectedClient && selectedClient.id === editingClient.id) {
        setSelectedClient({
          ...selectedClient,
          name: editClientName,
          phone: editClientPhone,
          email: editClientEmail
        });
      }
      setEditingClient(null);
    }
  };

  const handleDeleteClientClick = async (id: string, name: string) => {
    if (confirm(`Tem certeza que deseja excluir permanentemente a paciente ${name}? Todos os prontuários e históricos de sessões serão excluídos.`)) {
      if (onDeleteClient) {
        await onDeleteClient(id);
        if (selectedClient && selectedClient.id === id) {
          setSelectedClient(null);
        }
      }
    }
  };

  // New Client Form
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');

  // New Treatment Form
  const [procedure, setProcedure] = useState('Ultraformer MPT - Facial Completo');
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [nextSessionDate, setNextSessionDate] = useState('');
  const [price, setPrice] = useState('');
  const [totalSessions, setTotalSessions] = useState('1');

  // Auto-fill price based on selected procedure from catalog
  useEffect(() => {
    const catalogItem = treatmentCatalog.find(t => t.name === procedure);
    if (catalogItem) {
      setPrice(catalogItem.price.toString());
    }
  }, [procedure, treatmentCatalog]);

  // Set first catalog item as default procedure if available
  useEffect(() => {
    if (treatmentCatalog.length > 0) {
      setProcedure(treatmentCatalog[0].name);
      setPrice(treatmentCatalog[0].price.toString());
    }
  }, [treatmentCatalog]);

  // Skin Analysis Form State
  const [anamneseText, setAnamneseText] = useState('');
  const [analyzingSkin, setAnalyzingSkin] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [analysisImage, setAnalysisImage] = useState<string | null>(null);

  // Removed the useEffect that auto-updated selectedClient when clients changed,
  // because it was overwriting the user's current edits in the form during fetch cycles.

  useEffect(() => {
    // Reset AI form when changing selected client
    if (selectedClient) {
      setAnamneseText(selectedClient.anamnese || '');
      setAnalysisImage(selectedClient.imageBase64 || null);
      setAnalysisResult(selectedClient.laudo || null);
      setIsEditingLaudo(false);
      setEditingTreatmentId(null);
    } else {
      setAnamneseText('');
      setAnalysisImage(null);
      setAnalysisResult(null);
    }
  }, [selectedClient]);

  const handleSendWhatsAppClient = (client: Client) => {
    let clean = client.phone.replace(/\D/g, "");
    if (clean.length > 0 && !clean.startsWith("55")) {
      clean = `55${clean}`;
    }
    const defaultTemplate = `Olá ${client.name}! Passando para acompanhar seus tratamentos e agendamentos na Dra. Musa Estética de Elite. Como você está se sentindo após as últimas sessões?`;
    window.open(`https://wa.me/${clean}?text=${encodeURIComponent(defaultTemplate)}`, "_blank");
  };

  const handleCreateClient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName || !clientPhone) return;
    onAddClient({ name: clientName, phone: clientPhone, email: clientEmail });
    setClientName('');
    setClientPhone('');
    setClientEmail('');
    setShowAddClient(false);
  };

  const handleCreateTreatment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient || !procedure || !sessionDate) {
      alert('Por favor, preencha o procedimento e a data.');
      return;
    }
    
    // Create treatment via prop callback
    setIsSubmitting(true);
    try {
      const parsedPrice = price ? Number(price.replace(',', '.')) : undefined;
      await onAddTreatment({
        clientId: selectedClient.id,
        procedure,
        sessionDate,
        notes,
        nextSessionDate,
        price: isNaN(parsedPrice as number) ? undefined : parsedPrice,
        totalSessions: parseInt(totalSessions) || 1,
        completedSessions: 1,
      });

      const defaultProc = treatmentCatalog.length > 0 ? treatmentCatalog[0].name : 'Ultraformer MPT - Facial Completo';
      const defaultPrice = treatmentCatalog.length > 0 ? treatmentCatalog[0].price.toString() : '';
      setProcedure(defaultProc);
      setPrice(defaultPrice);
      setTotalSessions('1');
      setNotes('');
      setNextSessionDate('');
      setShowAddTreatment(false);

      // Provide visual feedback
      alert('✅ Sessão registrada com sucesso no Prontuário!');
    } catch (e) {
      alert('❌ Erro ao registrar sessão: ' + (e as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkinImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // Max dimensions
        const MAX_SIZE = 800;
        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
          setAnalysisImage(compressedBase64);
        }
      };
      if (event.target?.result) {
        img.src = event.target.result as string;
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAnalyzeSkin = async () => {
    if (!selectedClient) return;
    const clientIdAtStart = selectedClient.id;
    setAnalyzingSkin(true);

    try {
      // Auto-save anamnese text and image to the client first
      await fetch(`/api/clients/${clientIdAtStart}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          anamnese: anamneseText,
          image_base64: analysisImage
        })
      });
      // Optionally update local client state if needed, but fetchCrmData will sync it eventually
      if (onUpdateClientData) onUpdateClientData();

      // Request AI generation
      const response = await fetch('/api/gemini/analyze-skin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anamneseText,
          imageBase64: analysisImage,
          clientName: selectedClient.name
        })
      });

      const data = await response.json();
      if (response.ok) {
        if (selectedClient && selectedClient.id === clientIdAtStart) {
          setAnalysisResult(data.report);
          setIsEditingLaudo(true); // Open edit mode immediately after generation
        }
        
        // Auto-save generated report
        await fetch(`/api/clients/${clientIdAtStart}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ laudo: data.report })
        });
        
        if (onUpdateClientData) onUpdateClientData();
        
        // Refresh local treatment history trigger or simply inform
        if (data.treatment) {
          treatments.push(data.treatment);
        }
      } else {
        alert(data.error + (data.details ? '\nDetalhes: ' + data.details : ''));
      }
    } catch (error) {
      console.error(error);
      alert('Erro ao se conectar ao servidor.');
    } finally {
      setAnalyzingSkin(false);
    }
  };

  const clientTreatments = treatments.filter(t => t.clientId === selectedClient?.id);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Client List Index */}
      <div className="lg:col-span-4 bg-white rounded-2xl border border-brand-gold/15 p-5 shadow-xs flex flex-col h-[calc(100vh-180px)]">
        <div className="flex justify-between items-center pb-4 mb-4 border-b border-brand-beige">
          <div>
            <h3 className="text-lg font-serif font-bold text-brand-brown">Pacientes Premium</h3>
            <p className="text-xs text-brand-brown/60">Controle completo de prontuários</p>
          </div>
          <button
            onClick={() => setShowAddClient(true)}
            className="p-2 bg-brand-brown hover:bg-brand-brown/90 text-brand-beige rounded-xl transition-all shadow-md"
            title="Adicionar Novo Paciente"
          >
            <Plus className="h-4 w-4 text-brand-gold" />
          </button>
        </div>

        {/* List Directory */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {clients.map((c) => {
            const isSelected = selectedClient?.id === c.id;
            const lastSession = treatments.filter(t => t.clientId === c.id).sort((a,b) => new Date(b.sessionDate).getTime() - new Date(a.sessionDate).getTime())[0];
            
            const hasFinishedPackage = treatments.some(t => t.clientId === c.id && (t.completedSessions || 1) >= (t.totalSessions || 1));
            
            return (
              <div
                key={c.id}
                className="w-full relative group"
              >
                <button
                  onClick={() => {
                    setSelectedClient(c);
                  }}
                  className={`w-full text-left p-4 pr-16 rounded-xl border transition-all duration-300 flex items-center justify-between ${
                    isSelected
                      ? 'bg-brand-brown border-brand-brown text-brand-beige shadow-md'
                      : 'bg-brand-cream/35 border-brand-gold/10 hover:border-brand-gold text-brand-brown'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="font-serif font-semibold text-sm group-hover:text-brand-gold transition-colors flex items-center space-x-1.5">
                      <User className={`h-3.5 w-3.5 ${isSelected ? 'text-brand-gold' : 'text-brand-brown/60'}`} />
                      <span className="truncate max-w-[130px]">{c.name}</span>
                      {hasFinishedPackage && <div className="w-2 h-2 rounded-full bg-red-500 shadow-sm animate-pulse ml-1" title="Pacote Finalizado - Ofertando Novo"></div>}
                    </div>
                    <div className={`text-xxs font-mono flex items-center space-x-1 ${isSelected ? 'text-brand-beige/70' : 'text-brand-brown/60'}`}>
                      <Phone className="h-2.5 w-2.5" />
                      <span>{c.phone}</span>
                    </div>
                    {lastSession && (
                      <div className={`text-xxs mt-1.5 flex items-center space-x-1 ${isSelected ? 'text-brand-gold/90' : 'text-brand-brown/70'}`}>
                        <Heart className="h-2.5 w-2.5 fill-current" />
                        <span>Último: {lastSession.procedure.split('-')[0]}</span>
                      </div>
                    )}
                  </div>
                  <ChevronRight className={`h-4 w-4 transition-transform group-hover:translate-x-1 ${isSelected ? 'text-brand-gold' : 'text-brand-brown/40'}`} />
                </button>

                {/* Edit/Delete/WhatsApp Float Panel on Hover */}
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSendWhatsAppClient(c);
                    }}
                    className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-500 hover:text-white border border-emerald-200 hover:border-emerald-500 text-emerald-600 transition-colors shadow-xs"
                    title="Chamar no WhatsApp"
                  >
                    <WhatsAppIcon className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingClient(c);
                    }}
                    className={`p-1.5 rounded-lg bg-white hover:bg-brand-gold/20 border border-brand-gold/30 text-brand-brown transition-colors shadow-xs`}
                    title="Editar Paciente"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteClientClick(c.id, c.name);
                    }}
                    className="p-1.5 rounded-lg bg-red-50 hover:bg-red-500 hover:text-white border border-red-200 hover:border-red-500 text-red-500 transition-colors shadow-xs"
                    title="Excluir Paciente"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Digital Chart View */}
      <div className="lg:col-span-8 space-y-6">
        {selectedClient ? (
          <>
            {/* Chart Banner */}
            <div className="bg-white rounded-2xl border border-brand-gold/15 p-6 shadow-xs relative overflow-hidden">
              <div className="absolute top-0 right-0 p-8 opacity-5">
                <Clipboard className="h-32 w-32 text-brand-brown" />
              </div>
              <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                <div className="space-y-1.5">
                  <span className="text-xxs tracking-widest uppercase font-semibold text-brand-gold">Prontuário Digital Concierge</span>
                  <h2 className="text-2xl font-serif font-bold text-brand-brown">{selectedClient.name}</h2>
                  <div className="flex flex-wrap gap-4 text-xs font-mono text-brand-brown/70 pt-2">
                    <span className="flex items-center space-x-1.5">
                      <Phone className="h-3.5 w-3.5 text-brand-gold" />
                      <span>{selectedClient.phone}</span>
                    </span>
                    {selectedClient.email && (
                      <span className="flex items-center space-x-1.5">
                        <Mail className="h-3.5 w-3.5 text-brand-gold" />
                        <span>{selectedClient.email}</span>
                      </span>
                    )}
                  </div>
                </div>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowAddTreatment(true)}
                  className="relative group overflow-hidden flex items-center space-x-2 bg-gradient-to-r from-brand-brown to-brand-brown/80 text-brand-beige px-6 py-3 rounded-2xl text-xs font-bold transition-all shadow-[0_8px_20px_-6px_rgba(74,60,49,0.4)] self-start md:self-auto border border-brand-gold/30 hover:border-brand-gold"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-brand-gold/20 to-transparent -translate-x-[150%] group-hover:animate-[shimmer_2s_infinite]"></div>
                  <Plus className="h-4 w-4 text-brand-gold relative z-10" />
                  <span className="relative z-10 uppercase tracking-wider">Nova Sessão</span>
                </motion.button>
              </div>
            </div>

            {/* Smart Skin Analysis Portal (Análises de Pele Inteligente) */}
            <div className="bg-white rounded-2xl border border-brand-gold/20 p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-brand-beige">
                <div className="flex items-center space-x-2">
                  <Sparkles className="h-5 w-5 text-brand-gold animate-pulse" />
                  <h3 className="font-serif font-bold text-brand-brown text-base">Análise de Pele Inteligente (Skin AI)</h3>
                </div>
                <span className="text-xxs font-semibold bg-brand-gold/10 text-brand-brown px-2.5 py-1 rounded-full uppercase font-mono">
                  Powered by Gemini 3.6
                </span>
              </div>

              {!isAiConfigured && (
                <div className="p-3.5 bg-amber-50 border border-amber-200/60 rounded-xl text-xxs text-amber-800">
                  ⚠️ <strong>Aviso:</strong> A chave do Gemini API não está configurada nos Secrets. O recurso de inteligência artificial gerará um diagnóstico simulado padrão de alta fidelidade. Para obter diagnósticos gerados sob demanda com IA real, configure <strong>GEMINI_API_KEY</strong> em cadastros.
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                <div className="md:col-span-8 space-y-3">
                  <label className="block text-xs font-semibold text-brand-brown uppercase tracking-wider">Notas de Anamnese & Queixas Principais</label>
                  <textarea
                    rows={3}
                    value={anamneseText}
                    onChange={(e) => setAnamneseText(e.target.value)}
                    className="w-full p-3.5 rounded-xl border border-brand-gold/30 bg-brand-cream/20 text-xs focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown leading-relaxed"
                    placeholder="Descreva as queixas, tipo de pele, flacidez, manchas ou manchas do paciente..."
                  />
                </div>

                {/* Skin Photo Upload Zone */}
                <div className="md:col-span-4 flex flex-col items-center justify-center border border-dashed border-brand-gold/30 rounded-xl bg-brand-cream/10 p-4 hover:bg-brand-cream/20 transition-all relative group cursor-pointer h-full">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleSkinImageChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                  />
                  {analysisImage ? (
                    <div className="relative w-full h-24 rounded-lg overflow-hidden">
                      <img src={analysisImage} alt="Skin Target" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Camera className="h-5 w-5 text-white" />
                      </div>
                    </div>
                  ) : (
                    <div className="text-center space-y-1">
                      <Camera className="h-6 w-6 text-brand-gold mx-auto group-hover:scale-110 transition-transform" />
                      <span className="block text-xxs font-medium text-brand-brown/70">Foto 3D Facial</span>
                      <span className="block text-[10px] text-brand-brown/50">(Opcional para IA)</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={async () => {
                    if (!selectedClient) return;
                    await fetch(`/api/clients/${selectedClient.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ anamnese: anamneseText, image_base64: analysisImage, laudo: analysisResult })
                    });
                    selectedClient.anamnese = anamneseText;
                    selectedClient.imageBase64 = analysisImage || undefined;
                    if (analysisResult) selectedClient.laudo = analysisResult;
                    if (onUpdateClientData) onUpdateClientData();
                    alert('Dados do prontuário salvos com sucesso no histórico!');
                  }}
                  className="flex items-center space-x-2 bg-brand-gold/10 hover:bg-brand-gold/20 border border-brand-gold/30 text-brand-brown px-5 py-3 rounded-xl text-xs font-semibold transition-all shadow-sm font-serif"
                >
                  <Save className="h-4 w-4 text-brand-gold" />
                  <span>Salvar Histórico</span>
                </button>
                <button
                  onClick={() => {
                    if (!selectedClient) return;
                    setAnalysisResult(`## LAUDO DE AVALIAÇÃO CLÍNICA\n\n**Paciente:** ${selectedClient.name}\n**Data:** ${new Date().toLocaleDateString('pt-BR')}\n\n1. ANÁLISE DERMATOLÓGICA TÉCNICA:\n\n\n2. PLANO DE TRATAMENTO SUGERIDO:\n\n\n3. RECOMENDAÇÕES HOME CARE:\n`);
                    setIsEditingLaudo(true);
                  }}
                  className="flex items-center space-x-2 bg-white border border-brand-gold/30 hover:border-brand-gold text-brand-brown px-5 py-3 rounded-xl text-xs font-semibold transition-all shadow-sm font-serif"
                >
                  <Pencil className="h-4 w-4" />
                  <span>Escrever Laudo Manualmente</span>
                </button>
                <button
                  onClick={handleAnalyzeSkin}
                  disabled={analyzingSkin}
                  className="flex items-center space-x-2 bg-brand-brown hover:bg-brand-brown/90 disabled:bg-brand-brown/40 text-brand-beige px-5 py-3 rounded-xl text-xs font-semibold transition-all shadow-md font-serif"
                >
                  {analyzingSkin ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-brand-gold" />
                      <span>Analisando Pele na IA...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 text-brand-gold" />
                      <span>Gerar Laudo Clínico IA</span>
                    </>
                  )}
                </button>
              </div>

              {/* Analysis Result Drawer */}
              {analysisResult && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-5 border border-brand-gold/30 rounded-xl bg-brand-cream/50 space-y-3"
                >
                  <div className="flex items-center justify-between border-b border-brand-gold/15 pb-2">
                    <span className="text-xs font-serif font-bold text-brand-brown flex items-center space-x-1">
                      <FileText className="h-3.5 w-3.5 text-brand-gold" />
                      <span>Laudo de Estética Integrativa Premium</span>
                    </span>
                    <div className="flex items-center space-x-3">
                      <span className="text-xxs font-mono text-brand-brown/60">
                        Emitido em {new Date().toLocaleDateString('pt-BR')}
                      </span>
                      {isEditingLaudo ? (
                        <button
                          onClick={async () => {
                            setIsEditingLaudo(false);
                            await fetch(`/api/clients/${selectedClient.id}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ laudo: analysisResult, anamnese: anamneseText, image_base64: analysisImage })
                            });
                            selectedClient.laudo = analysisResult || undefined;
                            selectedClient.anamnese = anamneseText;
                            selectedClient.imageBase64 = analysisImage || undefined;
                            if (onUpdateClientData) onUpdateClientData();
                          }}
                          className="text-brand-brown hover:text-brand-gold bg-brand-gold/20 p-1.5 rounded transition-colors flex items-center space-x-1 text-xs"
                          title="Salvar Laudo"
                        >
                          <Save className="h-3 w-3" />
                          <span>Salvar</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => setIsEditingLaudo(true)}
                          className="text-brand-brown hover:text-brand-gold transition-colors"
                          title="Editar Laudo"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {isEditingLaudo ? (
                    <textarea
                      value={analysisResult}
                      onChange={(e) => setAnalysisResult(e.target.value)}
                      className="w-full min-h-[300px] p-3 rounded-lg border border-brand-gold/30 bg-white text-xs font-sans text-brand-brown focus:outline-none focus:ring-2 focus:ring-brand-gold leading-relaxed"
                    />
                  ) : (
                    <div className="text-xs text-brand-brown leading-relaxed space-y-2 whitespace-pre-wrap font-sans max-h-96 overflow-y-auto pr-1">
                      {analysisResult}
                    </div>
                  )}
                </motion.div>
              )}
            </div>

            {/* Treatment Plans Journey (Hierarchical) */}
            {treatmentPlans && onAddTreatmentPlan && onUpdateTreatmentPlan && onDeleteTreatmentPlan && onUpdateTreatmentSession && (
              <TreatmentJourney 
                plans={treatmentPlans}
                clientId={selectedClient.id}
                treatmentCatalog={treatmentCatalog}
                onAddPlan={onAddTreatmentPlan}
                onUpdatePlan={onUpdateTreatmentPlan}
                onDeletePlan={onDeleteTreatmentPlan}
                onUpdateSession={onUpdateTreatmentSession}
                flatTreatments={treatments}
              />
            )}
          </>
        ) : (
          <div className="bg-white rounded-2xl border border-brand-gold/10 p-12 text-center">
            <User className="h-12 w-12 text-brand-gold/45 mx-auto mb-3" />
            <h3 className="font-serif font-semibold text-brand-brown">Nenhum Paciente Selecionado</h3>
            <p className="text-xs text-brand-brown/60">Selecione um paciente na barra lateral para ver seu histórico clínico.</p>
          </div>
        )}
      </div>

      {/* Add Client Modal */}
      {showAddClient && (
        <div className="fixed inset-0 bg-brand-brown/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-brand-beige border border-brand-gold max-w-sm w-full rounded-2xl p-6 shadow-2xl"
          >
            <h3 className="text-lg font-serif font-bold text-brand-brown mb-4">Adicionar Novo Paciente</h3>
            <form onSubmit={handleCreateClient} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-brand-brown uppercase mb-1">Nome Completo</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Luciana Gontijo"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-brand-brown uppercase mb-1">WhatsApp (com DDD)</label>
                <input
                  type="tel"
                  required
                  placeholder="Ex: 5511988887777"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-brand-brown uppercase mb-1">E-mail</label>
                <input
                  type="email"
                  placeholder="Ex: luciana@uol.com"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddClient(false)}
                  className="px-4 py-2 text-xs font-medium text-brand-brown/70"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="bg-brand-brown text-brand-beige px-4 py-2 rounded-xl text-xs font-semibold hover:bg-brand-brown/90"
                >
                  Salvar Paciente
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Edit Client Modal */}
      {editingClient && (
        <div className="fixed inset-0 bg-brand-brown/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-brand-beige border border-brand-gold max-w-sm w-full rounded-2xl p-6 shadow-2xl"
          >
            <h3 className="text-lg font-serif font-bold text-brand-brown mb-4">Editar Dados do Paciente</h3>
            <form onSubmit={handleEditClientSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-brand-brown uppercase mb-1">Nome Completo</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Luciana Gontijo"
                  value={editClientName}
                  onChange={(e) => setEditClientName(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-brand-brown uppercase mb-1">WhatsApp (com DDD)</label>
                <input
                  type="tel"
                  required
                  placeholder="Ex: 5511988887777"
                  value={editClientPhone}
                  onChange={(e) => setEditClientPhone(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-brand-brown uppercase mb-1">E-mail</label>
                <input
                  type="email"
                  placeholder="Ex: luciana@uol.com"
                  value={editClientEmail}
                  onChange={(e) => setEditClientEmail(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingClient(null)}
                  className="px-4 py-2 text-xs font-medium text-brand-brown/70"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="bg-brand-brown text-brand-beige px-4 py-2 rounded-xl text-xs font-semibold hover:bg-brand-brown/90"
                >
                  Atualizar Dados
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Premium Drawer for Add Treatment */}
      {showAddTreatment && (
        <div className="fixed inset-0 z-[100] flex justify-end">
          {/* Backdrop */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !isSubmitting && setShowAddTreatment(false)}
            className="absolute inset-0 bg-brand-brown/60 backdrop-blur-sm"
          />

          {/* Drawer Panel */}
          <motion.div 
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="relative w-full max-w-md bg-[#faf8f5] h-full shadow-2xl flex flex-col border-l border-brand-gold/20"
          >
            {/* Header */}
            <div className="p-6 border-b border-brand-gold/15 bg-white relative overflow-hidden shrink-0">
               <div className="absolute top-0 right-0 p-4 opacity-5">
                 <Clipboard className="w-32 h-32 text-brand-brown" />
               </div>
               <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-brand-gold mb-1 block">Prontuário Digital</span>
               <h3 className="text-2xl font-serif font-bold text-brand-brown relative z-10">Registrar Sessão</h3>
               <p className="text-xs text-brand-brown/60 mt-1">Adicione os detalhes clínicos para {selectedClient?.name}</p>
            </div>

            {/* Scrollable Form Body */}
            <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
              <form id="treatment-form" onSubmit={handleCreateTreatment} className="space-y-5">
                <div className="bg-white p-4 rounded-2xl border border-brand-gold/10 shadow-xs space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold text-brand-brown/70 uppercase tracking-wider mb-2 flex items-center space-x-1.5">
                       <Sparkles className="w-3 h-3 text-brand-gold" />
                       <span>Procedimento Realizado</span>
                    </label>
                    <select
                      value={procedure}
                      onChange={(e) => setProcedure(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-brand-gold/30 bg-[#faf8f5] text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown font-medium"
                    >
                      {treatmentCatalog.length > 0 ? (
                        treatmentCatalog.map((t) => (
                          <option key={t.id} value={t.name}>{t.name}</option>
                        ))
                      ) : (
                        <>
                          <option value="Ultraformer MPT - Facial Completo">Ultraformer MPT - Facial Completo</option>
                          <option value="Lavien BB Laser - Efeito Porcelana">Lavien BB Laser - Efeito Porcelana</option>
                          <option value="Toxina Botulínica (Dysport)">Toxina Botulínica (Dysport)</option>
                          <option value="Bioestimulador Elleva (L-Polilático)">Bioestimulador Elleva (L-Polilático)</option>
                          <option value="Peeling Premium Clareador">Peeling Premium Clareador</option>
                          <option value="Preenchimento Labial Elegance">Preenchimento Labial Elegance</option>
                        </>
                      )}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-bold text-brand-brown/70 uppercase tracking-wider mb-2">Valor Cobrado (R$)</label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-brown/40 font-mono text-sm">R$</span>
                        <input
                          type="text"
                          placeholder="Ex: 1200.00"
                          value={price}
                          onChange={(e) => setPrice(e.target.value)}
                          className="w-full pl-10 pr-4 py-3 rounded-xl border border-brand-gold/30 bg-[#faf8f5] text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown font-mono font-medium"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-brand-brown/70 uppercase tracking-wider mb-2">Qtd de Sessões</label>
                      <input
                        type="number"
                        min="1"
                        value={totalSessions}
                        onChange={(e) => setTotalSessions(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-brand-gold/30 bg-[#faf8f5] text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown font-mono"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-brand-gold/10 shadow-xs grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-brand-brown/70 uppercase tracking-wider mb-2">Data da Sessão</label>
                    <input
                      type="date"
                      required
                      value={sessionDate}
                      onChange={(e) => setSessionDate(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-brand-gold/30 bg-[#faf8f5] text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-brand-brown/70 uppercase tracking-wider mb-2">Próxima Sugerida</label>
                    <input
                      type="date"
                      value={nextSessionDate}
                      onChange={(e) => setNextSessionDate(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-brand-gold/30 bg-[#faf8f5] text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown font-mono"
                    />
                  </div>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-brand-gold/10 shadow-xs">
                  <label className="block text-[11px] font-bold text-brand-brown/70 uppercase tracking-wider mb-2">Anotações Clínicas</label>
                  <textarea
                    rows={5}
                    placeholder="Descreva detalhes do tratamento, parâmetros da máquina, número de ampolas ou reações..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full p-4 rounded-xl border border-brand-gold/30 bg-[#faf8f5] text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown resize-none"
                  />
                </div>
              </form>
            </div>

            {/* Footer with Actions */}
            <div className="p-6 border-t border-brand-gold/15 bg-white flex flex-col space-y-3 shrink-0">
              <button
                type="submit"
                form="treatment-form"
                disabled={isSubmitting}
                className="w-full relative group overflow-hidden flex items-center justify-center space-x-2 bg-gradient-to-r from-brand-brown to-brand-brown/90 text-brand-beige px-6 py-4 rounded-xl text-sm font-bold transition-all shadow-[0_8px_20px_-6px_rgba(74,60,49,0.3)] disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 text-brand-gold animate-spin" />
                    <span>Salvando...</span>
                  </>
                ) : (
                  <>
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-brand-gold/20 to-transparent -translate-x-[150%] group-hover:animate-[shimmer_2s_infinite]"></div>
                    <Check className="w-5 h-5 text-brand-gold relative z-10" />
                    <span className="relative z-10 uppercase tracking-wider">Confirmar Sessão</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowAddTreatment(false)}
                disabled={isSubmitting}
                className="w-full py-3 text-xs font-bold text-brand-brown/50 uppercase tracking-wider hover:text-brand-brown transition-colors"
              >
                Cancelar
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

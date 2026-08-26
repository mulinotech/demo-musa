import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Settings, Users, Plus, Edit2, Trash2, Tag, X } from 'lucide-react';
import { Salesperson, TreatmentCatalog } from '../types';
import { TREATMENTS } from '../data';

export default function CrmSettings() {
  const [activeTab, setActiveTab] = useState<'salespersons' | 'treatments'>('treatments');

  // Data states
  const [salespersons, setSalespersons] = useState<Salesperson[]>([]);
  const [treatments, setTreatments] = useState<TreatmentCatalog[]>([]);

  // Load from API
  const loadSettingsData = async () => {
    try {
      const [resS, resT] = await Promise.all([
        fetch('/api/salespeople'),
        fetch('/api/treatment-catalog')
      ]);
      if (resS.ok) setSalespersons(await resS.json());
      if (resT.ok) {
        const rawT = await resT.json();
        setTreatments(rawT.map((item: any) => ({
          id: item.id,
          name: item.name,
          price: Number(item.price),
          packagePrice: item.package_price ? Number(item.package_price) : undefined,
          duration: item.duration ? Number(item.duration) : undefined,
          description: item.description || "",
          indicatedRegions: item.target_regions || "",
          restrictions: item.restrictions || ""
        })));
      }
    } catch (e) {
      console.error('Error loading settings', e);
    }
  };

  React.useEffect(() => {
    loadSettingsData();
  }, []);

  // Form States
  const [isAddingSalesperson, setIsAddingSalesperson] = useState(false);
  const [isAddingTreatment, setIsAddingTreatment] = useState(false);
  const [editingTreatmentId, setEditingTreatmentId] = useState<string | null>(null);

  // Salesperson Form
  const [sName, setSName] = useState('');
  const [sEmail, setSEmail] = useState('');
  const [sWhatsapp, setSWhatsapp] = useState('');
  const [sRole, setSRole] = useState<'vendedor'|'gerente'>('vendedor');
  const [sPassword, setSPassword] = useState('');
  const [editingSalespersonId, setEditingSalespersonId] = useState<string | null>(null);

  // Treatment Form
  const [tName, setTName] = useState('');
  const [tPrice, setTPrice] = useState('');
  const [tPackagePrice, setTPackagePrice] = useState('');
  const [tDuration, setTDuration] = useState('');
  const [tDesc, setTDesc] = useState('');
  const [tRegions, setTRegions] = useState('');
  const [tRestrictions, setTRestrictions] = useState('');

  const [spError, setSpError] = useState<string | null>(null);

  const handleAddSalesperson = async (e: React.FormEvent) => {
    e.preventDefault();
    setSpError(null);
    if (!sName || !sWhatsapp) {
      setSpError('Nome e WhatsApp são obrigatórios.');
      return;
    }
    try {
      const isEditing = !!editingSalespersonId;
      const url = isEditing ? `/api/salespeople/${editingSalespersonId}` : '/api/salespeople';
      const method = isEditing ? 'PATCH' : 'POST';

      const authHeaders = {
        'Content-Type': 'application/json',
        'x-user-role': localStorage.getItem('userRole') || '',
        'x-salesperson-id': localStorage.getItem('salespersonId') || '',
        'x-salesperson-name': localStorage.getItem('salespersonName') || (localStorage.getItem('userRole') === 'admin' ? 'Proprietária (Master)' : 'Usuário')
      };

      const res = await fetch(url, {
        method: method,
        headers: authHeaders,
        body: JSON.stringify({ 
          name: sName, 
          email: sEmail || '', 
          whatsapp: sWhatsapp, 
          role: sRole, 
          password: sPassword || undefined, 
          status: 'active' 
        })
      });

      const data = await res.json();

      if (res.ok) {
        await loadSettingsData();
        setIsAddingSalesperson(false);
        setEditingSalespersonId(null);
        setSName(''); setSEmail(''); setSWhatsapp(''); setSRole('vendedor'); setSPassword('');
        setSpError(null);
      } else {
        setSpError(data.error || data.details || 'Erro ao salvar vendedor.');
      }
    } catch(e: any) {
      setSpError('Erro de conexão ao salvar vendedor.');
    }
  };

  const handleAddTreatment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tName || !tPrice) return;
    try {
      const isEditing = !!editingTreatmentId;
      const url = isEditing ? `/api/treatment-catalog/${editingTreatmentId}` : '/api/treatment-catalog';
      const method = isEditing ? 'PATCH' : 'POST';

      const authHeaders = {
        'Content-Type': 'application/json',
        'x-user-role': localStorage.getItem('userRole') || '',
        'x-salesperson-id': localStorage.getItem('salespersonId') || '',
        'x-salesperson-name': localStorage.getItem('salespersonName') || (localStorage.getItem('userRole') === 'admin' ? 'Proprietária (Master)' : 'Usuário')
      };

      const res = await fetch(url, {
        method: method,
        headers: authHeaders,
        body: JSON.stringify({
          name: tName,
          price: Number(tPrice),
          packagePrice: tPackagePrice ? Number(tPackagePrice) : null,
          duration: tDuration,
          description: tDesc,
          targetRegions: tRegions,
          restrictions: tRestrictions
        })
      });
      if (res.ok) {
        await loadSettingsData();
        setIsAddingTreatment(false);
        setEditingTreatmentId(null);
        setTName(''); setTPrice(''); setTPackagePrice(''); setTDuration(''); setTDesc(''); setTRegions(''); setTRestrictions('');
      }
    } catch(e) {}
  };

  const handleDeleteSalesperson = async (id: string) => {
    if(!window.confirm('Excluir vendedor?')) return;
    try {
      const authHeaders = {
        'x-user-role': localStorage.getItem('userRole') || '',
        'x-salesperson-id': localStorage.getItem('salespersonId') || '',
        'x-salesperson-name': localStorage.getItem('salespersonName') || (localStorage.getItem('userRole') === 'admin' ? 'Proprietária (Master)' : 'Usuário')
      };
      await fetch(`/api/salespeople/${id}`, { method: 'DELETE', headers: authHeaders });
      await loadSettingsData();
    } catch(e) {}
  };

  const handleDeleteTreatment = async (id: string) => {
    if(!window.confirm('Excluir tratamento?')) return;
    try {
      await fetch(`/api/treatment-catalog/${id}`, { method: 'DELETE' });
      await loadSettingsData();
    } catch(e) {}
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-serif font-bold text-brand-brown">Cadastros</h2>
          <p className="text-sm text-brand-brown/70 mt-1">Gerencie tratamentos, valores e equipe comercial.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-brand-gold/20 shadow-sm overflow-hidden flex flex-col md:flex-row min-h-[60vh]">
        {/* Settings Sidebar */}
        <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-brand-gold/20 bg-brand-beige/20 p-4">
          <nav className="space-y-2">
            <button
              onClick={() => setActiveTab('treatments')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                activeTab === 'treatments' ? 'bg-brand-brown text-brand-beige' : 'text-brand-brown/70 hover:bg-brand-beige'
              }`}
            >
              <Tag className="w-4 h-4" />
              Catálogo e Valores
            </button>
            <button
              onClick={() => setActiveTab('salespersons')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                activeTab === 'salespersons' ? 'bg-brand-brown text-brand-beige' : 'text-brand-brown/70 hover:bg-brand-beige'
              }`}
            >
              <Users className="w-4 h-4" />
              Equipe de Vendas
            </button>
          </nav>
        </div>

        {/* Settings Content */}
        <div className="flex-1 p-6 md:p-8">
          {activeTab === 'treatments' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-serif font-bold text-brand-brown">Tratamentos</h3>
                  <p className="text-xs text-brand-brown/70">Defina os procedimentos e valores base.</p>
                </div>
                <button 
                  onClick={() => {
                    setEditingTreatmentId(null);
                    setTName(''); setTPrice(''); setTPackagePrice(''); setTDuration(''); setTDesc(''); setTRegions(''); setTRestrictions('');
                    setIsAddingTreatment(true);
                  }}
                  className="flex items-center gap-2 bg-brand-brown text-brand-beige px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer hover:bg-brand-brown/90"
                >
                  <Plus className="w-4 h-4" />
                  Novo Tratamento
                </button>
              </div>

              <div className="border border-brand-gold/20 rounded-lg overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap min-w-max">
                  <thead className="bg-brand-beige/50 text-brand-brown/80 font-mono text-[10px] uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Procedimento</th>
                      <th className="px-4 py-3">Descrição / Regiões</th>
                      <th className="px-4 py-3">Valor do Pacote</th>
                      <th className="px-4 py-3">Valor da Sessão</th>
                      <th className="px-4 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-gold/10">
                    {treatments.map((t) => (
                      <tr key={t.id} className="hover:bg-brand-beige/20">
                        <td className="px-4 py-4">
                          <div className="text-brand-brown font-medium">{t.name}</div>
                          <div className="text-xs text-brand-brown/60 mt-0.5">{t.duration ? `${t.duration} min` : ''}</div>
                        </td>
                        <td className="px-4 py-4">
                           <div className="text-xs text-brand-brown truncate max-w-xs">{t.description || '-'}</div>
                           <div className="text-[10px] text-brand-brown/60 mt-0.5">{t.indicatedRegions}</div>
                        </td>
                        <td className="px-4 py-4 text-brand-brown">
                          {t.packagePrice ? `R$ ${t.packagePrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-'}
                        </td>
                        <td className="px-4 py-4 text-brand-brown">R$ {t.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                        <td className="px-4 py-4 text-right">
                          <div className="flex justify-end gap-2">
                            <button 
                              onClick={() => {
                                setEditingTreatmentId(t.id);
                                setTName(t.name);
                                setTPrice(t.price.toString());
                                setTPackagePrice(t.packagePrice?.toString() || '');
                                setTDuration(t.duration?.toString() || '');
                                setTDesc(t.description || '');
                                setTRegions((t as any).targetRegions || (t as any).indicatedRegions || '');
                                setTRestrictions(t.restrictions || '');
                                setIsAddingTreatment(true);
                              }}
                              className="p-1.5 text-brand-brown/50 hover:text-brand-brown hover:bg-brand-beige rounded-md cursor-pointer"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDeleteTreatment(t.id)} className="p-1.5 text-red-500/70 hover:text-red-600 hover:bg-red-50 rounded-md cursor-pointer">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {activeTab === 'salespersons' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-serif font-bold text-brand-brown">Equipe Comercial</h3>
                  <p className="text-xs text-brand-brown/70">Gerencie atendentes e vendedores.</p>
                </div>
                <button 
                  onClick={() => setIsAddingSalesperson(true)}
                  className="flex items-center gap-2 bg-brand-brown text-brand-beige px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer hover:bg-brand-brown/90"
                >
                  <Plus className="w-4 h-4" />
                  Novo Membro
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {salespersons.map((s) => (
                  <div key={s.id} className="border border-brand-gold/20 rounded-xl p-4 flex flex-col justify-between bg-white hover:border-brand-brown/30 transition-colors">
                    <div className="flex items-start gap-4 mb-3">
                      <div className="w-10 h-10 rounded-full bg-brand-beige flex items-center justify-center text-brand-brown font-serif font-bold text-lg shrink-0">
                        {s.name.charAt(0)}
                      </div>
                      <div className="overflow-hidden">
                        <h4 className="text-sm font-bold text-brand-brown truncate">{s.name}</h4>
                        <p className="text-xs text-brand-brown/60 truncate">{s.email}</p>
                        <p className="text-xs text-brand-brown/60 truncate mt-1">WA: {s.whatsapp || '-'}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-auto">
                      <span className="text-[9px] uppercase tracking-wider font-mono font-bold bg-brand-beige px-2 py-0.5 rounded text-brand-brown">
                        {s.role}
                      </span>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => {
                            setEditingSalespersonId(s.id);
                            setSName(s.name);
                            setSEmail(s.email);
                            setSWhatsapp(s.whatsapp || '');
                            setSRole(s.role as any);
                            setSPassword('');
                            setIsAddingSalesperson(true);
                          }}
                          className="p-1 text-brand-brown/50 hover:text-brand-brown rounded cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDeleteSalesperson(s.id)} className="text-[10px] uppercase text-red-500/80 hover:text-red-600 font-semibold cursor-pointer">Excluir</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* MODALS */}
      <AnimatePresence>
        {isAddingSalesperson && (
          <div className="fixed inset-0 z-[60] bg-brand-brown/50 backdrop-blur-sm flex items-center justify-center p-4">
             <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-brand-beige border border-brand-gold max-w-md w-full rounded-2xl p-6 shadow-2xl relative">
              <button 
                onClick={() => {
                  setIsAddingSalesperson(false);
                  setEditingSalespersonId(null);
                  setSName(''); setSEmail(''); setSWhatsapp(''); setSRole('vendedor'); setSPassword('');
                }} 
                className="absolute top-4 right-4 text-brand-brown/60 hover:text-brand-brown cursor-pointer"
              >
                <X className="w-5 h-5"/>
              </button>
              <h3 className="text-xl font-serif font-bold text-brand-brown mb-4">
                {editingSalespersonId ? 'Editar Vendedor' : 'Adicionar Vendedor'}
              </h3>
              {spError && (
                <div className="mb-4 p-3 bg-red-100 border border-red-300 text-red-700 text-xs rounded-xl font-medium">
                  {spError}
                </div>
              )}
              <form onSubmit={handleAddSalesperson} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-brand-brown uppercase tracking-wider mb-1">Nome</label>
                  <input type="text" required value={sName} onChange={e=>setSName(e.target.value)} className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-brand-brown uppercase tracking-wider mb-1">Email (Opcional)</label>
                  <input type="email" value={sEmail} onChange={e=>setSEmail(e.target.value)} className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-brand-brown uppercase tracking-wider mb-1">WhatsApp</label>
                  <input type="tel" value={sWhatsapp} onChange={e=>setSWhatsapp(e.target.value)} placeholder="Ex: 11999999999" className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-brand-brown uppercase tracking-wider mb-1">Cargo</label>
                  <select value={sRole} onChange={e=>setSRole(e.target.value as any)} className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown">
                    <option value="vendedor">Vendedor</option>
                    <option value="gerente">Gerente</option>
                  </select>
                </div>
                 <div>
                  <label className="block text-xs font-semibold text-brand-brown uppercase tracking-wider mb-1">Senha de Acesso</label>
                  <input type="password" required={!editingSalespersonId} value={sPassword} onChange={e=>setSPassword(e.target.value)} placeholder={editingSalespersonId ? "Preencha apenas se quiser alterar" : "Senha para o vendedor"} className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown" />
                </div>
                <button type="submit" className="w-full mt-2 bg-brand-brown hover:bg-brand-brown/90 text-brand-beige py-2.5 rounded-xl text-sm font-medium transition-all shadow-md cursor-pointer">Salvar Vendedor</button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isAddingTreatment && (
          <div className="fixed inset-0 z-[60] bg-brand-brown/50 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-brand-beige border border-brand-gold max-w-lg w-full rounded-2xl p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
              <button onClick={() => setIsAddingTreatment(false)} className="absolute top-4 right-4 text-brand-brown/60 hover:text-brand-brown cursor-pointer"><X className="w-5 h-5"/></button>
              <h3 className="text-xl font-serif font-bold text-brand-brown mb-4">{editingTreatmentId ? 'Editar Tratamento' : 'Cadastrar Tratamento'}</h3>
              <form onSubmit={handleAddTreatment} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-brand-brown uppercase tracking-wider mb-1">Nome do Procedimento</label>
                  <input 
                    type="text" 
                    required 
                    list="treatment-options"
                    value={tName} 
                    onChange={e => setTName(e.target.value)} 
                    placeholder="Selecione ou digite um novo procedimento..."
                    className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
                  />
                  <datalist id="treatment-options">
                    {TREATMENTS.map(t => (
                      <option key={`static-${t.id}`} value={t.name} />
                    ))}
                    {treatments.map(t => (
                      <option key={`catalog-${t.id}`} value={t.name} />
                    ))}
                  </datalist>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[9px] font-bold text-brand-brown uppercase tracking-tight mb-1 whitespace-nowrap">Valor Pacote (R$)</label>
                    <input type="number" step="0.01" value={tPackagePrice} onChange={e=>setTPackagePrice(e.target.value)} className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown" />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-brand-brown uppercase tracking-tight mb-1 whitespace-nowrap">Valor da Sessão (R$)</label>
                    <input type="number" step="0.01" required value={tPrice} onChange={e=>setTPrice(e.target.value)} className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown" />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-brand-brown uppercase tracking-tight mb-1 whitespace-nowrap">Duração (Minutos)</label>
                    <input type="number" value={tDuration} onChange={e=>setTDuration(e.target.value)} className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-brand-brown uppercase tracking-wider mb-1">Descrição</label>
                  <textarea value={tDesc} onChange={e=>setTDesc(e.target.value)} rows={2} className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"></textarea>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-brand-brown uppercase tracking-wider mb-1">Regiões Indicadas</label>
                  <input type="text" value={tRegions} onChange={e=>setTRegions(e.target.value)} placeholder="Ex: Face, Pescoço, Corpo" className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-brand-brown uppercase tracking-wider mb-1">Restrições / Observações</label>
                  <textarea value={tRestrictions} onChange={e=>setTRestrictions(e.target.value)} rows={2} placeholder="Ex: Gestantes, uso de roacutan" className="w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"></textarea>
                </div>
                <button type="submit" className="w-full mt-4 bg-brand-brown hover:bg-brand-brown/90 text-brand-beige py-2.5 rounded-xl text-sm font-medium transition-all shadow-md cursor-pointer">Salvar Tratamento</button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

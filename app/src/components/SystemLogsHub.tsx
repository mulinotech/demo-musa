import { papelDoToken } from '../lib/api';
import React, { useState, useEffect } from 'react';
import { SystemLog } from '../types';
import { 
  ShieldCheck, 
  Lock, 
  Search, 
  RefreshCw, 
  AlertCircle, 
  FileText, 
  Calendar, 
  User, 
  Clock, 
  Filter,
  CheckCircle2,
  Trash2
} from 'lucide-react';
import { motion } from 'motion/react';

export default function SystemLogsHub() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return ['admin', 'gerente'].includes(papelDoToken()) || sessionStorage.getItem('logs_admin_auth') === 'true';
  });
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<string>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const handleVerifyPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (['admin', 'gerente'].includes(papelDoToken())) {
      setIsAuthenticated(true);
      sessionStorage.setItem('logs_admin_auth', 'true');
      setErrorMsg('');
    } else {
      setErrorMsg('Senha incorreta! Acesso negado.');
      setPassword('');
    }
  };

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/logs');
      if (response.ok) {
        const data = await response.json();
        setLogs(data);
      }
    } catch (e) {
      console.error('Erro ao buscar logs do sistema:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchLogs();
    }
  }, [isAuthenticated]);

  const filteredLogs = logs.filter(log => {
    const matchesSearch = 
      log.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.author.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.actionType.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = selectedFilter === 'ALL' || log.actionType.startsWith(selectedFilter);

    let matchesDate = true;
    if (startDate || endDate) {
      const logDateStr = new Date(log.createdAt).toISOString().split('T')[0];
      if (startDate && logDateStr < startDate) matchesDate = false;
      if (endDate && logDateStr > endDate) matchesDate = false;
    }

    return matchesSearch && matchesCategory && matchesDate;
  });

  if (!isAuthenticated) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-8 rounded-2xl border border-brand-gold/30 shadow-xl max-w-md w-full text-center space-y-6"
        >
          <div className="w-16 h-16 bg-brand-brown/10 text-brand-brown rounded-full flex items-center justify-center mx-auto mb-2 border border-brand-gold/30">
            <ShieldCheck className="w-8 h-8 text-brand-gold" />
          </div>

          <div>
            <h2 className="text-2xl font-serif font-bold text-brand-brown">Área Restrita de Auditoria</h2>
            <p className="text-xs text-brand-brown/70 mt-2">
              Digite a senha master da proprietária para acessar a consulta imutável de logs do sistema.
            </p>
          </div>

          <form onSubmit={handleVerifyPassword} className="space-y-4">
            <div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Senha Master (MusaElite...)"
                  className="w-full px-4 py-3 rounded-xl border border-brand-gold/40 focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown text-sm bg-brand-beige/10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-brand-brown/60 hover:text-brand-brown cursor-pointer"
                >
                  {showPassword ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
              {errorMsg && (
                <p className="text-red-500 text-xs mt-2 font-medium flex items-center justify-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {errorMsg}
                </p>
              )}
            </div>

            <button
              type="submit"
              className="w-full bg-brand-brown text-brand-beige py-3 rounded-xl font-medium text-sm hover:bg-brand-brown/90 transition-all shadow-md cursor-pointer flex items-center justify-center gap-2"
            >
              <Lock className="w-4 h-4 text-brand-gold" />
              Acessar Logs de Auditoria
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl border border-brand-gold/20 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-brand-gold" />
            <h2 className="text-2xl font-serif font-bold text-brand-brown">Logs & Auditoria do Sistema</h2>
          </div>
          <p className="text-xs text-brand-brown/70 mt-1">
            Registro imutável de todas as ações executadas no CRM. Consulta restrita e protegida.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-3 py-2 rounded-xl font-medium">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            Modo Somente Leitura (Read-Only)
          </div>
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="flex items-center gap-2 bg-brand-brown text-brand-beige px-4 py-2 rounded-xl text-xs font-semibold hover:bg-brand-brown/90 transition-all cursor-pointer shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-brand-gold ${loading ? 'animate-spin' : ''}`} />
            Atualizar Logs
          </button>
        </div>
      </div>

      {/* Filters, Date Range & Search */}
      <div className="flex flex-col space-y-4 bg-white p-4 rounded-xl border border-brand-gold/20 shadow-xs">
        <div className="flex flex-col md:flex-row gap-4 justify-between items-center w-full">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-brown/40" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por responsável, evento ou detalhes..."
              className="w-full pl-10 pr-4 py-2 bg-brand-beige/20 border border-brand-gold/30 rounded-xl text-xs text-brand-brown focus:outline-none focus:ring-2 focus:ring-brand-gold"
            />
          </div>

          {/* Date Selector */}
          <div className="flex items-center gap-2 w-full md:w-auto">
            <Calendar className="w-4 h-4 text-brand-brown/50 shrink-0" />
            <div className="flex items-center gap-1.5 text-xs text-brand-brown">
              <span className="text-[10px] font-semibold uppercase text-brand-brown/60">De:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-2 py-1.5 bg-brand-beige/20 border border-brand-gold/30 rounded-lg text-xs text-brand-brown focus:outline-none focus:ring-2 focus:ring-brand-gold"
              />
              <span className="text-[10px] font-semibold uppercase text-brand-brown/60">Até:</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-2 py-1.5 bg-brand-beige/20 border border-brand-gold/30 rounded-lg text-xs text-brand-brown focus:outline-none focus:ring-2 focus:ring-brand-gold"
              />
              {(startDate || endDate) && (
                <button
                  onClick={() => { setStartDate(''); setEndDate(''); }}
                  className="text-[10px] text-red-500 underline font-medium hover:text-red-700 ml-1 cursor-pointer"
                >
                  Limpar Datas
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Categories */}
        <div className="flex items-center gap-2 w-full overflow-x-auto pb-1 pt-2 border-t border-brand-gold/10">
          <Filter className="w-4 h-4 text-brand-brown/50 shrink-0" />
          {[
            { id: 'ALL', label: 'Todos os Registros' },
            { id: 'LEAD', label: 'Leads & Funil' },
            { id: 'CLIENT', label: 'Pacientes' },
            { id: 'TREATMENT', label: 'Tratamentos' },
            { id: 'SALESPERSON', label: 'Equipe Vendas' },
            { id: 'AUTH', label: 'Autenticação' },
          ].map((filter) => (
            <button
              key={filter.id}
              onClick={() => setSelectedFilter(filter.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                selectedFilter === filter.id
                  ? 'bg-brand-brown text-brand-beige shadow-xs'
                  : 'bg-brand-beige/40 text-brand-brown/70 hover:bg-brand-beige hover:text-brand-brown'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-2xl border border-brand-gold/20 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-brand-beige/40 text-brand-brown/80 text-[11px] font-mono uppercase tracking-wider border-b border-brand-gold/20">
                <th className="py-3 px-4 font-semibold">Data & Hora</th>
                <th className="py-3 px-4 font-semibold">Usuário Responsável</th>
                <th className="py-3 px-4 font-semibold">Tipo de Ação</th>
                <th className="py-3 px-4 font-semibold">Descrição do Evento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-gold/10 text-xs text-brand-brown">
              {loading ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-brand-brown/60 font-mono">
                    Carregando registros de auditoria...
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-brand-brown/60 font-mono">
                    Nenhum log encontrado para a busca ou filtro selecionado.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const dateObj = new Date(log.createdAt);
                  const formattedDate = dateObj.toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric'
                  });
                  const formattedTime = dateObj.toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  });

                  return (
                    <tr key={log.id} className="hover:bg-brand-beige/20 transition-colors">
                      {/* Data e Hora */}
                      <td className="py-3 px-4 font-mono text-[11px] text-brand-brown/90 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 font-bold">
                          <Calendar className="w-3.5 h-3.5 text-brand-gold" />
                          {formattedDate}
                        </div>
                        <div className="flex items-center gap-1 text-brand-brown/60 text-[10px] mt-0.5">
                          <Clock className="w-3 h-3 text-brand-brown/40" />
                          {formattedTime}
                        </div>
                      </td>

                      {/* Usuário / Autor */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 bg-brand-brown/10 text-brand-brown rounded-full flex items-center justify-center text-[10px] font-bold">
                            <User className="w-3 h-3 text-brand-brown" />
                          </div>
                          <div>
                            <span className="font-semibold text-brand-brown block">{log.author}</span>
                          </div>
                        </div>
                      </td>

                      {/* Tipo de Ação */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="inline-block px-2.5 py-1 rounded-md text-[10px] font-mono font-bold bg-brand-brown/5 text-brand-brown border border-brand-gold/30">
                          {log.actionType}
                        </span>
                      </td>

                      {/* Descrição */}
                      <td className="py-3 px-4 leading-relaxed font-sans text-brand-brown/90 max-w-xl">
                        {log.description}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

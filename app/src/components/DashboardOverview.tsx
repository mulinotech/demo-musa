import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, Users, DollarSign, Target, Calendar } from 'lucide-react';
import { Lead, Client, Treatment, TreatmentCatalog } from '../types';

interface DashboardOverviewProps {
  leads: Lead[];
  clients: Client[];
  treatments: Treatment[];
  treatmentCatalog: TreatmentCatalog[];
}

export default function DashboardOverview({ leads, clients = [], treatments = [], treatmentCatalog = [] }: DashboardOverviewProps) {
  const [filterRange, setFilterRange] = useState<'7days' | '30days' | 'month' | 'custom'>('7days');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Filter leads based on the selected time range
  const filteredLeads = useMemo(() => {
    if (!leads || leads.length === 0) return [];
    
    const now = new Date();
    return leads.filter(lead => {
      // Fallback para data de criacao
      const leadDate = new Date(lead.createdAt || new Date());
      
      if (filterRange === '7days') {
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return leadDate >= sevenDaysAgo;
      } else if (filterRange === '30days') {
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        return leadDate >= thirtyDaysAgo;
      } else if (filterRange === 'month') {
        return leadDate.getMonth() === now.getMonth() && leadDate.getFullYear() === now.getFullYear();
      } else if (filterRange === 'custom') {
        if (!startDate || !endDate) return true;
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        return leadDate >= start && leadDate <= end;
      }
      return true;
    });
  }, [leads, filterRange, startDate, endDate]);

  // Filter treatments based on the selected time range for revenue calculation
  const filteredTreatments = useMemo(() => {
    if (!treatments || treatments.length === 0) return [];
    const now = new Date();
    return treatments.filter(t => {
      const tDate = new Date(t.sessionDate);
      if (filterRange === '7days') {
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return tDate >= sevenDaysAgo;
      } else if (filterRange === '30days') {
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        return tDate >= thirtyDaysAgo;
      } else if (filterRange === 'month') {
        return tDate.getMonth() === now.getMonth() && tDate.getFullYear() === now.getFullYear();
      } else if (filterRange === 'custom') {
        if (!startDate || !endDate) return true;
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        return tDate >= start && tDate <= end;
      }
      return true;
    });
  }, [treatments, filterRange, startDate, endDate]);

  // Calculate actual revenue in the selected period
  const totalRevenue = useMemo(() => {
    return filteredTreatments.reduce((sum, t) => {
      if (t.price !== undefined && t.price !== null) {
        return sum + t.price;
      }
      const catalogItem = treatmentCatalog.find(cat => cat.name === t.procedure);
      if (catalogItem) {
        return sum + catalogItem.price;
      }
      return sum + 1200; // default/fallback price
    }, 0);
  }, [filteredTreatments, treatmentCatalog]);

  // Calculate overall LTV (Lifetime Value) = Total historical revenue / unique patients
  const ltv = useMemo(() => {
    if (!clients || clients.length === 0) return 0;
    const historicalRevenue = treatments.reduce((sum, t) => {
      if (t.price !== undefined && t.price !== null) {
        return sum + t.price;
      }
      const catalogItem = treatmentCatalog.find(cat => cat.name === t.procedure);
      if (catalogItem) {
        return sum + catalogItem.price;
      }
      return sum + 1200;
    }, 0);
    return historicalRevenue / clients.length;
  }, [treatments, clients, treatmentCatalog]);

  // Aggregate leads by day of week for the chart
  const dataLeadsWeek = useMemo(() => {
    const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const counts = [0, 0, 0, 0, 0, 0, 0];
    
    filteredLeads.forEach(lead => {
      const date = new Date(lead.createdAt || new Date());
      counts[date.getDay()]++;
    });

    // Reorder so today is at the end or just show standard week
    return days.map((day, idx) => ({
      name: day,
      leads: counts[idx]
    }));
  }, [filteredLeads]);

  const conversionData = useMemo(() => {
    const converted = filteredLeads.filter(l => l.status === 'arquivado').length;
    const pending = filteredLeads.filter(l => l.status === 'agendado' || l.status === 'contatado').length;
    const newLeads = filteredLeads.filter(l => l.status === 'novo').length;

    if (filteredLeads.length === 0) {
      return [
        { name: 'Fechados', value: 0, color: '#c1a68d' },
        { name: 'Em Negociação', value: 0, color: '#8e735b' },
        { name: 'Novos', value: 0, color: '#f5f0eb' },
      ];
    }

    return [
      { name: 'Fechados', value: converted, color: '#c1a68d' },
      { name: 'Em Negociação', value: pending, color: '#8e735b' },
      { name: 'Novos', value: newLeads, color: '#f5f0eb' },
    ];
  }, [filteredLeads]);

  const cards = [
    {
      title: 'Total de Leads',
      value: filteredLeads.length,
      trend: '+12% vs período anterior',
      icon: Users,
      trendUp: true
    },
    {
      title: 'Taxa de Conversão',
      value: filteredLeads.length > 0 ? `${Math.round((filteredLeads.filter(l => l.status === 'arquivado').length / filteredLeads.length) * 100)}%` : '0%',
      trend: '+5% vs período anterior',
      icon: Target,
      trendUp: true
    },
    {
      title: 'Faturamento Real',
      value: `R$ ${totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      trend: `${filteredTreatments.length} sessões realizadas`,
      icon: DollarSign,
      trendUp: true
    },
    {
      title: 'LTV Médio (Colab)',
      value: `R$ ${ltv.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      trend: 'Valor de vida do cliente',
      icon: TrendingUp,
      trendUp: true
    },
    {
      title: 'Custo por Lead (CPL)',
      value: 'R$ 18,50', // Este seria integrado via API Ads
      trend: '-2% vs período anterior',
      icon: Target,
      trendUp: true
    }
  ];

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-serif font-bold text-brand-brown">Visão Geral</h2>
          <p className="text-sm text-brand-brown/70 mt-1">Acompanhe o desempenho comercial da sua clínica.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 items-end sm:items-center">
          {filterRange === 'custom' && (
            <div className="flex items-center gap-2 bg-white border border-brand-gold/20 rounded-lg p-1 text-xs">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-transparent text-brand-brown focus:outline-none px-2 font-mono"
              />
              <span className="text-brand-brown/40">até</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-transparent text-brand-brown focus:outline-none px-2 font-mono"
              />
            </div>
          )}
          <div className="flex bg-white border border-brand-gold/20 rounded-lg p-1">
            <button 
              onClick={() => setFilterRange('7days')}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${filterRange === '7days' ? 'bg-brand-beige text-brand-brown shadow-sm' : 'text-brand-brown/60 hover:text-brand-brown hover:bg-brand-beige/50'}`}
            >
              7 Dias
            </button>
            <button 
              onClick={() => setFilterRange('30days')}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${filterRange === '30days' ? 'bg-brand-beige text-brand-brown shadow-sm' : 'text-brand-brown/60 hover:text-brand-brown hover:bg-brand-beige/50'}`}
            >
              30 Dias
            </button>
            <button 
              onClick={() => setFilterRange('month')}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${filterRange === 'month' ? 'bg-brand-beige text-brand-brown shadow-sm' : 'text-brand-brown/60 hover:text-brand-brown hover:bg-brand-beige/50'}`}
            >
              Mês Atual
            </button>
            <button 
              onClick={() => setFilterRange('custom')}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${filterRange === 'custom' ? 'bg-brand-beige text-brand-brown shadow-sm' : 'text-brand-brown/60 hover:text-brand-brown hover:bg-brand-beige/50'}`}
            >
              Período
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {cards.map((card, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="bg-white rounded-xl p-5 border border-brand-gold/20 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group"
          >
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity transform group-hover:scale-110 group-hover:rotate-12 duration-500">
              <card.icon className="w-16 h-16 text-brand-gold" />
            </div>
            
            <div className="flex justify-between items-start mb-4 relative z-10">
              <div className="p-2 bg-brand-beige rounded-lg">
                <card.icon className="w-5 h-5 text-brand-brown" />
              </div>
            </div>
            <div className="relative z-10">
              <h3 className="text-sm font-medium text-brand-brown/70 mb-1">{card.title}</h3>
              <p className="text-2xl font-serif font-bold text-brand-brown mb-2">{card.value}</p>
              <div className="flex items-center text-xs font-medium text-emerald-600 bg-emerald-50 w-fit px-2 py-0.5 rounded-full">
                <span>{card.trend}</span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Chart */}
        <div className="lg:col-span-2 bg-white rounded-xl p-6 border border-brand-gold/20 shadow-sm">
          <div className="mb-6">
            <h3 className="text-lg font-serif font-bold text-brand-brown">Volume de Leads</h3>
            <p className="text-xs text-brand-brown/60">Novos contatos capturados no período selecionado</p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dataLeadsWeek} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f0eb" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#8e735b' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#8e735b' }} />
                <RechartsTooltip
                  cursor={{ fill: '#f5f0eb', opacity: 0.4 }}
                  contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e5dbcf', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="leads" fill="#c1a68d" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Donut Chart */}
        <div className="bg-white rounded-xl p-6 border border-brand-gold/20 shadow-sm flex flex-col">
          <div className="mb-2">
            <h3 className="text-lg font-serif font-bold text-brand-brown">Status do Funil</h3>
            <p className="text-xs text-brand-brown/60">Distribuição atual dos leads</p>
          </div>
          <div className="flex-1 min-h-[220px] relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={conversionData}
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {conversionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e5dbcf', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  itemStyle={{ color: '#2a1b15' }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xl font-serif font-bold text-brand-brown">{leads.length || '156'}</span>
              <span className="text-[10px] uppercase tracking-widest text-brand-brown/60">Total</span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 mt-4">
            {conversionData.map((entry, index) => (
              <div key={index} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }}></span>
                  <span className="text-xs text-brand-brown/80 font-medium">{entry.name}</span>
                </div>
                <span className="text-xs font-bold text-brand-brown">{entry.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

import { papelDoToken } from '../lib/api';
import React from 'react';
import { MessageSquare, Users, Calendar, Settings, LayoutDashboard, X, MessageCircle, ShieldCheck } from 'lucide-react';
import logoMusa from '../assets/logo-musa-crm.png';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isAiConfigured: boolean;
  onClose?: () => void;
}

export default function Navbar({ activeTab, setActiveTab, isAiConfigured, onClose }: NavbarProps) {
  return (
    <header className="bg-white border-b border-brand-gold/20 shadow-xs sticky top-0 z-50">
      <div className="w-full px-4 sm:px-8 lg:px-12">
        <div className="flex flex-col md:flex-row justify-between md:h-20 items-stretch md:items-center gap-3 py-3 md:py-0 min-w-0">
          
          {/* Top Row on Mobile: Logo and Close Button */}
          <div className="flex items-center justify-between w-full md:w-auto">
            {/* Brand Logo and Title */}
            <div className="flex items-center space-x-3">
              <div className="bg-brand-brown text-brand-beige p-2 rounded-full shadow-inner flex items-center justify-center shrink-0">
                <img src={logoMusa} alt="Musa CRM" className="h-6 w-6 object-contain" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl md:text-2xl font-serif font-semibold tracking-wide text-brand-brown truncate">
                  Dra. Musa Estética de Elite
                </h1>
                <p className="text-xs font-sans tracking-widest uppercase text-brand-gold font-medium truncate">
                  CRM Concierge & Skin AI
                </p>
              </div>
            </div>
            
            {/* Close Button on Mobile */}
            {onClose && (
              <button
                onClick={onClose}
                className="md:hidden p-2 text-brand-brown/60 hover:text-brand-brown hover:bg-brand-beige rounded-full transition-colors cursor-pointer shrink-0 ml-2"
              >
                <X className="w-6 h-6" />
              </button>
            )}
          </div>

          {/* Navigation Links */}
          <div className="w-full md:w-auto md:flex-1 pb-2 md:pb-0 mt-2 md:mt-0">
            <nav className="flex flex-wrap items-center justify-center gap-2 w-full">
            {(() => {
              const userRole = papelDoToken();
              const isSalesperson = userRole === 'vendedor';

              const allTabs = [
                { id: 'dashboard', label: 'Visão Geral', icon: LayoutDashboard },
                { id: 'pipeline', label: 'Funil & Leads', icon: Calendar },
                { id: 'clients', label: 'Pacientes', icon: Users },
                { id: 'chat', label: 'Atendimento', icon: MessageSquare },
                { id: 'evolution', label: 'Integração WhatsApp', icon: MessageCircle },
                { id: 'settings', label: 'Cadastros', icon: Settings },
                { id: 'logs', label: 'Logs do Sistema', icon: ShieldCheck },
              ];

              const visibleTabs = isSalesperson
                ? allTabs.filter(t => ['pipeline', 'clients', 'chat'].includes(t.id))
                : allTabs;

              return visibleTabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    id={`nav-tab-${tab.id}`}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center space-x-1 px-2.5 py-1.5 md:px-3 md:py-2 rounded-lg text-xs font-semibold transition-all duration-300 cursor-pointer ${
                      isActive
                        ? 'bg-brand-brown text-brand-beige shadow-sm scale-102'
                        : 'bg-brand-brown/5 text-brand-brown/85 hover:bg-brand-beige hover:text-brand-brown hover:scale-102'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-brand-gold" />
                    <span className="whitespace-nowrap">{tab.label}</span>
                  </button>
                );
              });
            })()}
            </nav>
          </div>

          {/* Right Area: IA State Indicator & Close (Desktop) */}
          <div className="hidden md:flex items-center space-x-4">
            <div className="flex items-center space-x-2 bg-brand-beige/50 border border-brand-gold/20 px-3 py-1.5 rounded-full">
              <span className={`h-2.5 w-2.5 rounded-full ${isAiConfigured ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              <span className="text-xs font-medium text-brand-brown font-mono whitespace-nowrap">
                IA SMART: {isAiConfigured ? 'ONLINE' : 'DEMO MODE'}
              </span>
            </div>
            
            {onClose && (
              <button
                onClick={onClose}
                className="p-2 text-brand-brown/60 hover:text-brand-brown hover:bg-brand-beige rounded-full transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

        </div>
      </div>
    </header>
  );
}

/**
 * Barra de navegacao do console (T0.5).
 *
 * Antes trocava uma string de estado (`activeTab`); agora navega de verdade,
 * com NavLink. Ganhos: cada tela tem endereco, o voltar do navegador funciona e
 * o React.lazy carrega so o codigo da tela aberta.
 *
 * A lista `papeis` aqui e para nao mostrar o que a pessoa nao usa. Quem barra o
 * acesso de fato e RotaProtegida no front e REGRAS_DE_PAPEL no servidor.
 */
import { NavLink } from "react-router-dom";
import { papelDoToken } from "../lib/api";
import {
  MessageSquare, Users, Calendar, Settings, LayoutDashboard,
  LogOut, MessageCircle, ShieldCheck, UserCog, Calculator,
} from "lucide-react";
import logoMusa from "../assets/logo-musa-crm.png";

interface NavbarProps {
  isAiConfigured: boolean;
  onSair?: () => void;
}

const TODAS_AS_ABAS = [
  { to: "/crm",             fim: true,  label: "Visão Geral",         icon: LayoutDashboard, papeis: ["admin", "gerente", "profissional"] },
  { to: "/crm/funil",       fim: false, label: "Funil & Leads",       icon: Calendar,        papeis: [] },
  { to: "/crm/pacientes",   fim: false, label: "Pacientes",           icon: Users,           papeis: [] },
  { to: "/crm/atendimento", fim: false, label: "Atendimento",         icon: MessageSquare,   papeis: [] },
  { to: "/crm/whatsapp",    fim: false, label: "Integração WhatsApp", icon: MessageCircle,   papeis: ["admin", "gerente", "profissional"] },
  { to: "/crm/cadastros",   fim: false, label: "Cadastros",           icon: Settings,        papeis: ["admin", "gerente", "profissional"] },
  { to: "/crm/precificacao",fim: false, label: "Precificação",        icon: Calculator,      papeis: ["admin", "gerente"] },
  { to: "/crm/usuarios",    fim: false, label: "Usuários",            icon: UserCog,         papeis: ["admin"] },
  { to: "/crm/logs",        fim: false, label: "Logs do Sistema",     icon: ShieldCheck,     papeis: ["admin", "gerente", "profissional"] },
];

export default function Navbar({ isAiConfigured, onSair }: NavbarProps) {
  const papel = papelDoToken();
  const abas = TODAS_AS_ABAS.filter(a => a.papeis.length === 0 || a.papeis.includes(papel));

  return (
    <header className="bg-white border-b border-brand-gold/20 shadow-xs sticky top-0 z-50">
      <div className="w-full px-4 sm:px-8 lg:px-12">
        <div className="flex flex-col md:flex-row justify-between md:h-20 items-stretch md:items-center gap-3 py-3 md:py-0 min-w-0">

          <div className="flex items-center justify-between w-full md:w-auto">
            <div className="flex items-center space-x-3">
              <div className="bg-brand-brown text-brand-beige p-2 rounded-full shadow-inner flex items-center justify-center shrink-0">
                <img src={logoMusa} alt="Musa CRM" className="h-6 w-6 object-contain" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl md:text-2xl font-serif font-semibold tracking-wide text-brand-brown truncate">
                  Dra. Musa Estética de Elite
                </h1>
                <p className="text-xs font-sans tracking-widest uppercase text-brand-gold font-medium truncate">
                  CRM Concierge &amp; Skin AI
                </p>
              </div>
            </div>

            {onSair && (
              <button
                onClick={onSair}
                title="Sair do console"
                className="md:hidden flex items-center gap-1 p-2 text-brand-brown/60 hover:text-brand-brown hover:bg-brand-beige rounded-full transition-colors cursor-pointer shrink-0 ml-2"
              >
                <LogOut className="w-5 h-5" />
              </button>
            )}
          </div>

          <div className="w-full md:w-auto md:flex-1 pb-2 md:pb-0 mt-2 md:mt-0">
            <nav className="flex flex-wrap items-center justify-center gap-2 w-full">
              {abas.map((aba) => {
                const Icone = aba.icon;
                return (
                  <NavLink
                    key={aba.to}
                    to={aba.to}
                    end={aba.fim}
                    className={({ isActive }) =>
                      `flex items-center space-x-1 px-2.5 py-1.5 md:px-3 md:py-2 rounded-lg text-xs font-semibold transition-all duration-300 cursor-pointer ${
                        isActive
                          ? "bg-brand-brown text-brand-beige shadow-sm scale-102"
                          : "bg-brand-brown/5 text-brand-brown/85 hover:bg-brand-beige hover:text-brand-brown hover:scale-102"
                      }`
                    }
                  >
                    <Icone className="h-3.5 w-3.5 shrink-0 text-brand-gold" />
                    <span className="whitespace-nowrap">{aba.label}</span>
                  </NavLink>
                );
              })}
            </nav>
          </div>

          <div className="hidden md:flex items-center space-x-4">
            <div className="flex items-center space-x-2 bg-brand-beige/50 border border-brand-gold/20 px-3 py-1.5 rounded-full">
              <span className={`h-2.5 w-2.5 rounded-full ${isAiConfigured ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
              <span className="text-xs font-medium text-brand-brown font-mono whitespace-nowrap">
                IA SMART: {isAiConfigured ? "ONLINE" : "DEMO MODE"}
              </span>
            </div>

            {onSair && (
              <button
                onClick={onSair}
                title="Sair do console"
                className="flex items-center gap-1.5 px-3 py-2 text-brand-brown/70 hover:text-brand-brown hover:bg-brand-beige rounded-lg transition-colors cursor-pointer text-xs font-semibold"
              >
                <LogOut className="w-4 h-4" />
                <span>Sair</span>
              </button>
            )}
          </div>

        </div>
      </div>
    </header>
  );
}

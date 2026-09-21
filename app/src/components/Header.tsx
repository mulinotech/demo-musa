import { useState, useEffect } from "react";
import { Menu, X, Phone, Calendar, Heart, Shield } from "lucide-react";
import logoMusa from "../assets/logo-musa-crm.png";

interface HeaderProps {
  onNavigate: (sectionId: string) => void;
  activeSection: string;
  onOpenDashboard: () => void;
}

export default function Header({ onNavigate, activeSection, onOpenDashboard }: HeaderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 50) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navItems = [
    { id: "inicio", label: "Início" },
    { id: "tratamentos", label: "Procedimentos" },
    { id: "dra-musa", label: "Dra. Musa" },
    { id: "resultados", label: "Resultados" },
    { id: "quiz", label: "Avaliação 3D" },
    { id: "contato", label: "Contato" },
  ];

  const handleLinkClick = (id: string) => {
    setIsOpen(false);
    onNavigate(id);
  };

  return (
    <header
      id="main-header"
      className={`fixed top-0 left-0 w-full z-50 transition-all duration-300 ${
        isScrolled
          ? "bg-luxury-black/95 backdrop-blur-md py-4 border-b border-primary/10 shadow-sm"
          : "bg-gradient-to-b from-luxury-black/80 to-transparent py-6"
      }`}
    >
      <div className="max-w-[1680px] mx-auto px-4 sm:px-6 lg:px-10">
        <div className="flex items-center justify-between gap-x-4 lg:gap-x-8">
          {/* Logo Brand */}
          <div
            className="flex items-center gap-3 cursor-pointer group shrink-0"
            onClick={() => handleLinkClick("inicio")}
          >
            <img src={logoMusa} alt="Dra. Musa" className="h-8 sm:h-9 w-auto object-contain" />
            <div className="flex flex-col whitespace-nowrap">
              <span className="text-xl sm:text-2xl font-serif tracking-[0.2em] text-neutral font-semibold transition-colors duration-300 group-hover:text-primary">
                MUSA
              </span>
              <span className="text-[9px] tracking-[0.22em] text-primary uppercase font-medium mt-0.5">
                Estética de Elite
              </span>
            </div>
          </div>

          {/* ================= O MENU PAROU DE CABER COM A LETRA MAIOR (M5.1)
              Medido a 1440px: o bloco da direita passava 140px da borda, e o
              "AGENDAR AGORA" ficava cortado pela metade. `tracking-widest` sao
              0,1em -- espacejamento em `em` cresce junto com a fonte, entao
              texto 40% maior fica MAIS de 40% mais largo. Aqui o espacejamento
              desce para 0,05em e os intervalos encolhem um passo: a linha volta
              a caber e o ar entre os itens continua existindo.

              E OS TAMANHOS AQUI SAO EXPLICITOS de proposito: 13px e 12,5px nao
              estao na camada de leitura do `index.css`, entao esta linha nao
              anda junto quando a escala geral mudar. Menu de topo de site e o
              unico lugar do sistema onde a largura e um limite rigido -- oito
              itens numa linha so, sem quebra possivel --, e por isso ele
              precisa de numero proprio em vez de herdar a escala.

              ============================== E O MENU JA NAO CABIA ANTES (F5, 15/09)

              Medido com as duas versoes lado a lado: o menu de desktop aparecia
              a partir de 1024px, mas a linha inteira so cabe a partir de ~1359px.
              Entre 1024 e 1366 ela PASSAVA da borda, e o `overflow-x: hidden` do
              body transformava isso em corte silencioso -- num notebook de 1280,
              o botao "AGENDAR AGORA", que e o principal do site, ficava cortado.
              Isso era assim ANTES da M5.1; a letra maior piorou 19px de um
              problema que ja existia.

              O conserto tem duas partes, e a escolha entre elas foi da Silvia,
              olhando as duas renderizadas:
                1. o menu completo desce ate 1280 -- intervalos um passo menores e
                   o botao com rotulo curto ("AGENDAR") abaixo de 1440;
                2. abaixo de 1280 vale o menu sanduiche, que ja existia e agora
                   e usado na faixa onde ele e de fato necessario.

              Os limites sao `min-[1280px]` e `min-[1440px]`, e nao `lg`/`xl`,
              porque o que manda aqui e a largura em que a linha cabe -- medida --,
              e nao um degrau generico do Tailwind.

              Desktop Navigation */}
          <nav className="hidden min-[1280px]:flex items-center gap-4 min-[1440px]:gap-7 flex-1 justify-center">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleLinkClick(item.id)}
                className={`text-[13px] uppercase tracking-wider font-medium transition-all duration-300 hover:text-primary relative py-1 cursor-pointer whitespace-nowrap ${
                  activeSection === item.id
                    ? "text-primary"
                    : "text-neutral-muted"
                }`}
              >
                {item.label}
                {activeSection === item.id && (
                  <span className="absolute bottom-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-primary to-transparent" />
                )}
              </button>
            ))}
          </nav>

          {/* Call to Actions */}
          <div className="hidden min-[1280px]:flex items-center gap-2.5 min-[1440px]:gap-4 shrink-0">
            <button
              onClick={onOpenDashboard}
              className="text-[12.5px] uppercase tracking-wider font-medium text-neutral-muted hover:text-primary border border-secondary hover:border-primary/50 px-2.5 py-1.5 rounded transition-all duration-300 cursor-pointer whitespace-nowrap"
              title="Acessar Área Restrita do CRM"
            >
              Login CRM
            </button>
            <a
              href={`https://wa.me/5511900000000?text=${encodeURIComponent("Olá! Gostaria de agendar uma consulta de avaliação com a Dra. Musa.")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center space-x-2 text-[13px] uppercase tracking-wider font-semibold text-white bg-primary px-4 py-2.5 rounded-sm hover:bg-primary-light transition-all duration-300 shadow-sm transform hover:-translate-y-0.5 cursor-pointer whitespace-nowrap"
            >
              <Calendar className="w-4 h-4" />
              <span className="hidden min-[1440px]:inline">Agendar Agora</span>
              <span className="min-[1440px]:hidden">Agendar</span>
            </a>
          </div>

          {/* Mobile Menu Trigger */}
          <div className="flex items-center min-[1280px]:hidden space-x-3">
            <button
              onClick={onOpenDashboard}
              className="text-[9px] uppercase tracking-wider text-neutral-muted border border-secondary px-2 py-1 rounded cursor-pointer"
            >
              Login CRM
            </button>
            <button
              id="mobile-menu-btn"
              onClick={() => setIsOpen(!isOpen)}
              className="p-1 text-neutral hover:text-primary transition-colors cursor-pointer"
              aria-label="Toggle menu"
            >
              {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation Panel */}
      {isOpen && (
        <div className="min-[1280px]:hidden absolute top-full left-0 w-full bg-luxury-dark/95 backdrop-blur-lg border-b border-primary/10 py-6 px-4 animate-in fade-in slide-in-from-top-5 duration-200">
          <nav className="flex flex-col space-y-4">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleLinkClick(item.id)}
                className={`text-left text-sm uppercase tracking-widest font-medium py-2 border-b border-secondary/25 transition-all cursor-pointer ${
                  activeSection === item.id ? "text-primary pl-2" : "text-neutral-muted"
                }`}
              >
                {item.label}
              </button>
            ))}
            <a
              href={`https://wa.me/5511900000000?text=${encodeURIComponent("Olá! Gostaria de agendar uma consulta de avaliação com a Dra. Musa.")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center space-x-2 text-xs uppercase tracking-widest font-semibold text-white bg-primary py-3.5 rounded-sm shadow-sm mt-4 cursor-pointer"
            >
              <Calendar className="w-4.5 h-4.5" />
              <span>Agendar Avaliação</span>
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}

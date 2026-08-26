import { useState, useEffect } from "react";
import { Phone, X, MessageSquare, ArrowRight, CircleDot } from "lucide-react";

export default function FloatingWhatsApp() {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [showTooltip, setShowTooltip] = useState<boolean>(false);

  useEffect(() => {
    // Show a tooltip helper after a 4-second delay
    const timer = setTimeout(() => {
      setShowTooltip(true);
    }, 4500);

    return () => clearTimeout(timer);
  }, []);

  const options = [
    { text: "Agendar Avaliação de Pele", pref: "Olá! Gostaria de agendar uma consulta de avaliação com a Dra. Musa." },
    { text: "Dúvidas sobre o Ultraformer MPT", pref: "Olá! Gostaria de tirar algumas dúvidas sobre o tratamento do Ultraformer MPT." },
    { text: "Dúvidas sobre o Lavien BB Laser", pref: "Olá! Gostaria de falar com a concierge sobre as sessões do Lavien BB Laser." },
    { text: "Falar com recepção", pref: "Olá! Gostaria de falar com o atendimento da clínica sobre procedimentos estéticos." }
  ];

  return (
    <div id="whatsapp-widget" className="fixed bottom-6 right-6 z-45 flex flex-col items-end">
      
      {/* Expanded Chat Box */}
      {isOpen && (
        <div className="bg-white border border-primary/15 max-w-[340px] w-[85vw] sm:w-[320px] rounded-lg shadow-xl mb-4 overflow-hidden animate-in slide-in-from-bottom-5 duration-200 text-left">
          
          {/* Header */}
          <div className="bg-primary p-4 relative flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="relative">
                <img
                  src="https://images.unsplash.com/photo-1594824813573-246434e33963?auto=format&fit=crop&q=80&w=100"
                  alt="Dra. Musa Valentina"
                  className="w-10 h-10 object-cover rounded-full border border-white/55"
                />
                <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-primary rounded-full" />
              </div>
              <div className="text-left">
                <h5 className="text-xs font-bold text-white tracking-wide uppercase">Dra. Musa Valentina</h5>
                <span className="text-[9px] text-white/80 tracking-wider flex items-center">
                  <span className="h-1.5 w-1.5 bg-emerald-400 rounded-full animate-pulse mr-1" />
                  Online • Concierge Ativa
                </span>
              </div>
            </div>
            
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-white/10 text-white rounded-full cursor-pointer pointer-events-auto"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Chat Body */}
          <div className="p-4 bg-bg-luxe text-left space-y-3.5 max-h-[300px] overflow-y-auto">
            <div className="bg-white p-3 rounded border border-primary/10 text-xs text-neutral-muted leading-relaxed">
              Olá! Seja muito bem-vindo(a) à <strong className="text-primary font-semibold">Dra. Musa Estética de Elite</strong>. 
               Como podemos desenhar o seu protocolo ideal hoje? Selecione uma das opções abaixo:
            </div>

            {/* Structured quick topics */}
            <div className="space-y-2">
              {options.map((opt, idx) => (
                <a
                  key={idx}
                  href={`https://wa.me/5511900000000?text=${encodeURIComponent(opt.pref)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between w-full p-2.5 bg-white hover:bg-primary/5 text-[11px] text-neutral-muted hover:text-neutral font-semibold rounded border border-primary/10 hover:border-primary/20 transition-all cursor-pointer"
                >
                  <span>{opt.text}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-primary" />
                </a>
              ))}
            </div>
          </div>

          {/* Footer informational */}
          <div className="bg-white py-2.5 text-center text-[9px] text-neutral-muted border-t border-primary/10 font-light">
            Normalmente respondemos em menos de 10 minutos.
          </div>

        </div>
      )}

      {/* Floating Button Alert Tooltip */}
      {showTooltip && !isOpen && (
        <div className="absolute right-16 bottom-3 bg-white border border-primary/20 text-neutral p-3 rounded shadow-lg text-xs flex items-center justify-between space-x-3 w-[260px] animate-fade-in pointer-events-none">
          <div className="text-left pointer-events-auto cursor-pointer" onClick={() => setIsOpen(true)}>
            <p className="font-bold text-[10px] uppercase text-primary tracking-wider">Agende por WhatsApp</p>
            <p className="text-[10px] text-neutral-muted mt-0.5 leading-normal">Fale com nossa equipe sobre o Ultraformer MPT!</p>
          </div>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setShowTooltip(false);
            }} 
            className="text-neutral-muted hover:text-neutral cursor-pointer pointer-events-auto"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Primary Floating Button */}
      <button
        id="whatsapp-floating-btn"
        onClick={() => setIsOpen(!isOpen)}
        className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white p-4 rounded-full shadow-2xl transition-all duration-300 hover:scale-105 active:scale-95 cursor-pointer border border-emerald-400/35 relative animate-gold-glow flex items-center justify-center"
        aria-label="Falar conosco no WhatsApp"
      >
        {isOpen ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
        {!isOpen && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500 text-[9px] font-bold text-white items-center justify-center">1</span>
          </span>
        )}
      </button>

    </div>
  );
}

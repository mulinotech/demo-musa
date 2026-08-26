import { Calendar, ChevronRight, Play, ShieldCheck, Award, Star } from "lucide-react";
import clinicaLuxo from "../assets/clinica_luxo.png";

interface HeroProps {
  onStartQuiz: () => void;
  onNavigateToTreatments: () => void;
}

export default function Hero({ onStartQuiz, onNavigateToTreatments }: HeroProps) {
  return (
    <section
      id="inicio"
      className="relative min-h-[95vh] flex items-center justify-center pt-24 overflow-hidden bg-luxury-black"
    >
      {/* Background Decorative Circles / Gradients */}
      <div className="absolute top-1/4 left-1/3 w-96 h-96 rounded-full bg-gold-900/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/3 right-1/4 w-[500px] h-[500px] rounded-full bg-gold-600/5 blur-[160px] pointer-events-none" />

      {/* Hero Content Grid */}
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full py-12 md:py-20 z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          {/* Left Text Column: Sales and conversion-focused copy */}
          <div className="lg:col-span-7 flex flex-col space-y-6 text-left">
            
            {/* Tagline Badge */}
            <div className="inline-flex items-center space-x-2 bg-luxury-gray/80 border border-primary/15 px-3.5 py-1.5 rounded-full w-fit">
              <span className="flex h-2 w-2 rounded-full bg-primary animate-ping" />
              <span className="text-[10px] tracking-[0.2em] font-semibold uppercase text-primary">
                A Clínica que Fatura Horrores ✦ São Paulo
              </span>
            </div>

            {/* Main Serif Luxury Heading */}
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-serif tracking-tight text-neutral leading-[1.1]">
              A beleza que <br className="hidden md:inline" />
              vira <span className="text-gold-gradient font-medium italic">lenda</span>
            </h1>

            {/* Conversational marketing-heavy description referencing Lavien and Ultraformer MPT */}
            <p className="text-neutral-muted text-sm sm:text-base md:text-lg font-light leading-relaxed max-w-2xl">
              Clínica de estética de alto padrão que virou fenômeno na cidade com tecnologias extraordinárias como
              <strong className="text-primary font-medium"> Ultraformer MPT</strong> e{" "}
              <strong className="text-primary font-medium">Lavien BB Laser</strong>.
              Sob coordenação técnica da <span className="text-neutral font-medium">Dra. Musa Valentina</span>,
              entregamos recondicionamento facial e rejuvenescimento corporal com naturalidade, sofisticação e conforto absoluto — o tipo de resultado que enche a agenda e faz a clínica faturar horrores.
            </p>

            {/* Social Proof Stats Mini */}
            <div className="flex flex-wrap items-center gap-6 py-2 border-y border-primary/10">
              <div className="flex space-x-1 items-center">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-primary text-primary" />
                ))}
                <span className="text-xs text-neutral-muted ml-2 font-medium">
                  5.0 no Google (500+ avaliações)
                </span>
              </div>
              <div className="h-4 w-[1px] bg-secondary/35 hidden sm:inline" />
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-5 h-5 text-primary" />
                <span className="text-xs text-neutral-muted tracking-wider uppercase font-medium">
                  Tecnologia 100% Homologada pela Anvisa
                </span>
              </div>
            </div>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 pt-2">
              <a
                href={`https://wa.me/5511900000000?text=${encodeURIComponent("Olá! Gostaria de agendar uma consulta de avaliação com a Dra. Musa.")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center space-x-2 text-xs uppercase tracking-widest font-bold text-white bg-primary hover:bg-primary-light px-8 py-4 rounded-sm transition-all duration-300 shadow-sm transform hover:-translate-y-0.5 cursor-pointer text-center"
              >
                <Calendar className="w-4.5 h-4.5" />
                <span>Agendar por WhatsApp</span>
              </a>

              <button
                onClick={onStartQuiz}
                className="flex items-center justify-center space-x-2 text-xs uppercase tracking-widest font-semibold text-primary border border-primary/30 hover:border-primary hover:bg-primary/5 px-8 py-4 rounded-sm transition-all duration-300 cursor-pointer"
              >
                <span>Análise de Pele Inteligente</span>
                <ChevronRight className="w-4.5 h-4.5 text-primary" />
              </button>
            </div>
          </div>

          {/* Right Section: Luxury Visual Panel */}
          <div className="lg:col-span-5 relative flex justify-center lg:justify-end">
            
            {/* Ambient Backlight Aura */}
            <div className="absolute inset-0 bg-gradient-to-tr from-gold-500/20 to-transparent rounded-2xl blur-2xl filter pointer-events-none" />

            {/* Card Frame Image */}
            <div className="relative w-full max-w-[420px] aspect-[4/5] rounded-lg overflow-hidden border border-gold-500/20 shadow-2xl group">
              <img
                src={clinicaLuxo}
                alt="Clínica de Estética de Luxo"
                className="w-full h-full object-cover grayscale-[10%] group-hover:scale-105 transition-transform duration-700"
              />
              {/* Image Gradient Dark Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-luxury-black via-transparent to-transparent opacity-40" />

              {/* Float Card Info (Ultraformer MPT) */}
              <div className="absolute bottom-6 left-6 right-6 bg-white/95 backdrop-blur-md border border-primary/10 p-4 rounded-md shadow-lg">
                <p className="text-[9px] uppercase tracking-[0.2em] text-primary font-bold mb-1">
                  Equipamento Destaque
                </p>
                <p className="text-sm font-semibold tracking-wide text-neutral font-serif-lux">
                  Ultraformer MPT
                </p>
                <p className="text-xs text-neutral-muted mt-1 font-light">
                  Lifting facial avançado completo de efeito imediato sem cirurgias.
                </p>
                <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-primary/10">
                  <span className="text-[10px] text-neutral-muted">Tempo de sessão: 45 min</span>
                  <button 
                    onClick={onNavigateToTreatments}
                    className="text-[10px] text-primary font-semibold hover:text-primary-light transition-colors cursor-pointer"
                  >
                    Ver Mais →
                  </button>
                </div>
              </div>

              {/* Floating Award Emblem */}
              <div className="absolute top-4 right-4 bg-white/90 border border-primary/15 p-3 rounded-full flex items-center justify-center shadow-md">
                <Award className="w-5 h-5 text-primary" />
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}

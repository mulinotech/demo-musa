import { useState, useRef, MouseEvent, TouchEvent } from "react";
import { BEFORE_AFTERS, BeforeAfterItem } from "../data";
import { HelpCircle, Sparkles, Check, ArrowRight } from "lucide-react";

export default function BeforeAfter() {
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [sliderPosition, setSliderPosition] = useState<number>(50); // 0 to 100
  const isDragging = useRef<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeItem: BeforeAfterItem = BEFORE_AFTERS[activeIndex];

  const handleMove = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const position = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(position);
  };

  const handleMouseDown = () => {
    isDragging.current = true;
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging.current) return;
    handleMove(e.clientX);
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (e.touches.length === 0) return;
    handleMove(e.touches[0].clientX);
  };

  return (
    <section
      id="resultados"
      className="py-24 bg-luxury-dark relative border-t border-luxury-gray"
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div className="absolute top-1/4 left-0 w-84 h-84 rounded-full bg-gold-900/5 blur-[120px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Section Title */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="text-[10px] tracking-[0.3em] text-primary uppercase font-semibold block mb-3">
            Histórias de Transformação
          </span>
          <h2 className="text-3xl sm:text-4xl font-serif tracking-tight text-neutral leading-tight">
            Nossos Resultados & <span className="text-gold-gradient italic">Beleza Natural</span>
          </h2>
          <div className="w-16 h-[1.5px] bg-primary/30 mx-auto mt-6" />
          <p className="text-neutral-muted text-xs sm:text-sm font-light mt-5 leading-relaxed">
            Abaixo, explore casos representativos que refletem a filosofia da Dra. Musa Valentina:
            realçar os pontos fortes de cada pessoa preservando a autenticidade e simetria do perfil.
          </p>
        </div>

        {/* Dynamic Category Toggles */}
        <div className="flex flex-wrap justify-center gap-2 mb-12">
          {BEFORE_AFTERS.map((item, idx) => (
            <button
              key={item.id}
              onClick={() => {
                setActiveIndex(idx);
                setSliderPosition(50); // reset position
              }}
              className={`px-4 py-2.5 rounded-sm text-[10px] uppercase tracking-widest font-bold transition-all duration-300 cursor-pointer ${
                activeIndex === idx
                  ? "bg-primary text-white shadow-sm"
                  : "bg-luxury-gray text-neutral-muted hover:bg-secondary/20 hover:text-neutral"
              }`}
            >
              Transformação {idx + 1}: {item.title.split(" e ")[0]}
            </button>
          ))}
        </div>

        {/* Comparative Interactive Block */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          {/* Left Side: Interactive Slider Component */}
          <div className="lg:col-span-6 flex flex-col items-center">
            
            <p className="text-[10px] tracking-widest uppercase text-neutral-muted mb-4 font-semibold">
              Arraste o divisor para comparar o Antes e Depois
            </p>

            <div
              ref={containerRef}
              className="relative w-full aspect-square max-w-[450px] overflow-hidden rounded-md border border-primary/10 select-none shadow-xl cursor-ew-resize"
              onMouseMove={handleMouseMove}
              onTouchMove={handleTouchMove}
              onMouseDown={handleMouseDown}
              onTouchStart={handleMouseDown}
              onTouchEnd={handleMouseUp}
            >
              {/* After Image (Full width background) */}
              <img
                src={activeItem.afterImg}
                alt="Resultado Após Procedimento"
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              />
              <div className="absolute right-4 bottom-4 z-20 bg-white/90 backdrop-blur-sm border border-primary/20 px-3 py-1.5 rounded-sm">
                <span className="text-[10px] uppercase tracking-wider text-primary font-bold">Depois</span>
              </div>

              {/* Before Image (Cropped absolute container) */}
              <div
                className="absolute inset-y-0 left-0 overflow-hidden pointer-events-none"
                style={{ width: `${sliderPosition}%` }}
              >
                {/* Same aspect ratio image aligned matching exactly */}
                <div className="absolute inset-0 w-[450px] aspect-square max-w-[450px]">
                  <img
                    src={activeItem.beforeImg}
                    alt="Estado Antes do Tratamento"
                    className="w-full h-full object-cover pointer-events-none"
                  />
                </div>
              </div>
              <div className="absolute left-4 bottom-4 z-20 bg-white/90 backdrop-blur-sm border border-primary/20 px-3 py-1.5 rounded-sm pointer-events-none">
                <span className="text-[10px] uppercase tracking-wider text-neutral-muted font-semibold">Antes</span>
              </div>

              {/* Slider Dragging Handle Bar */}
              <div
                className="absolute inset-y-0 w-1 bg-primary/95 z-35 cursor-ew-resize flex items-center justify-center shadow-lg"
                style={{ left: `${sliderPosition}%` }}
              >
                <div className="w-8 h-8 rounded-full bg-white border border-primary flex items-center justify-center hover:scale-110 active:scale-95 transition-transform shadow-2xl">
                  <div className="flex space-x-1">
                    <span className="w-[1.5px] h-3.5 bg-primary" />
                    <span className="w-[1.5px] h-3.5 bg-primary" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Side: Analytical details describing clinical approach */}
          <div className="lg:col-span-6 space-y-6">
            <h3 className="text-2xl sm:text-3xl font-serif text-neutral tracking-tight">
              {activeItem.title}
            </h3>
            <div className="w-12 h-[1px] bg-primary/20" />

            {/* Case approach details */}
            <div className="space-y-4">
              
              {/* Concern/Symptom */}
              <div className="bg-white border border-primary/10 p-4 rounded-sm flex items-start space-x-3">
                <HelpCircle className="w-5 h-5 text-neutral-muted mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-neutral-muted font-bold">
                    Queixa Inicial da Paciente:
                  </p>
                  <p className="text-xs sm:text-sm text-neutral-muted font-light mt-1">
                    {activeItem.concern}
                  </p>
                </div>
              </div>

              {/* Applied clinical procedures */}
              <div className="bg-white border border-primary/15 p-4 rounded-sm flex items-start space-x-3">
                <Sparkles className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-primary font-bold">
                    Abordagem da Dra. Musa:
                  </p>
                  <p className="text-xs sm:text-sm text-neutral font-semibold mt-1">
                    {activeItem.procedure}
                  </p>
                </div>
              </div>

              {/* Observed long term clinical result */}
              <div className="bg-white border border-emerald-600/15 p-4 rounded-sm flex items-start space-x-3">
                <Check className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-emerald-600 font-bold">
                    Evolução Clínico-Estética:
                  </p>
                  <p className="text-xs sm:text-sm text-neutral-muted font-light mt-1">
                    {activeItem.result}
                  </p>
                </div>
              </div>

            </div>

            {/* Micro Conversion anchor link */}
            <div className="pt-2">
              <a
                href={`https://wa.me/5511900000000?text=${encodeURIComponent(`Olá! Gostaria de conversar sobre o tratamento de ${activeItem.title} com a Dra. Musa.`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-2 bg-primary hover:bg-primary-light text-white font-semibold text-xs tracking-widest uppercase px-6 py-3.5 rounded-sm w-fit shadow-sm transition-all duration-300 cursor-pointer"
              >
                <span>Desejo esse Resultado</span>
                <ArrowRight className="w-4.5 h-4.5" />
              </a>
            </div>

          </div>

        </div>
      </div>
    </section>
  );
}

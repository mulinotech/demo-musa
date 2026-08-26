import { useState, useMemo, useEffect } from "react";
import { TREATMENTS, Treatment } from "../data";
import { Calendar, Layers, Shield, Sparkles, Clock, RefreshCw, X } from "lucide-react";

interface TreatmentsProps {
  onSelectTreatment: (treatmentName: string) => void;
}

export default function Treatments({ onSelectTreatment }: TreatmentsProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("todos");
  const [activeModal, setActiveModal] = useState<Treatment | null>(null);
  const [catalogTreatments, setCatalogTreatments] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/treatment-catalog')
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('Failed to load catalog');
      })
      .then(data => {
        setCatalogTreatments(data);
      })
      .catch(err => {
        console.error('Error fetching treatment catalog:', err);
      });
  }, []);

  const inferCategory = (name: string): "facial" | "corporal" | "tecnologia" | "spa" => {
    const n = name.toLowerCase();
    if (n.includes("corpo") || n.includes("corporal") || n.includes("bumbum") || n.includes("glúteo") || n.includes("drenagem") || n.includes("linfatica") || n.includes("modeladora")) {
      return "corporal";
    }
    if (n.includes("massagem") || n.includes("relaxante") || n.includes("spa") || n.includes("limpeza de pele")) {
      return "spa";
    }
    if (n.includes("laser") || n.includes("tulium") || n.includes("ultraformer") || n.includes("tecnologia")) {
      return "tecnologia";
    }
    return "facial";
  };

  const allTreatments = useMemo(() => {
    const list: Treatment[] = [...TREATMENTS];
    catalogTreatments.forEach((ct: any) => {
      const nameLower = ct.name.trim().toLowerCase();
      const exists = list.some(t => t.name.trim().toLowerCase() === nameLower);
      if (!exists) {
        list.push({
          id: ct.id,
          name: ct.name,
          category: inferCategory(ct.name),
          tagline: ct.description ? (ct.description.substring(0, 60) + "...") : "Procedimento estético exclusivo",
          description: ct.description || "Agende uma avaliação personalizada para saber mais sobre os benefícios deste tratamento.",
          benefits: ct.restrictions ? ["Restrições: " + ct.restrictions] : ["Resultados duradouros e altamente naturais", "Estímulo de colágeno e rejuvenescimento"],
          duration: ct.duration ? `${ct.duration} minutos` : "Consultar duração",
          recovery: "Imediato (sem repouso)",
          highlights: false,
          image: "https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&q=80&w=800"
        });
      }
    });
    return list;
  }, [catalogTreatments]);

  const categories = [
    { id: "todos", label: "Todos" },
    { id: "tecnologia", label: "Tecnologias & Lasers" },
    { id: "facial", label: "Injetáveis Estéticos" },
    { id: "corporal", label: "Estética Corporal" },
    { id: "spa", label: "SPA & Bem-Estar" }
  ];

  const filteredTreatments = useMemo(() => {
    if (selectedCategory === "todos") {
      return allTreatments;
    }
    return allTreatments.filter(t => t.category === selectedCategory);
  }, [selectedCategory, allTreatments]);

  const handleOpenModal = (treatment: Treatment) => {
    setActiveModal(treatment);
  };

  const handleCloseModal = () => {
    setActiveModal(null);
  };

  return (
    <section
      id="tratamentos"
      className="py-24 bg-luxury-dark relative border-t border-luxury-gray"
    >
      {/* Background visual effect */}
      <div className="absolute top-0 right-0 w-80 h-80 rounded-full bg-gold-900/5 blur-[100px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
              {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="text-[10px] tracking-[0.3em] text-primary uppercase font-semibold block mb-3">
            Alta Performance e Sofisticação
          </span>
          <h2 className="text-3xl sm:text-4xl font-serif tracking-tight text-neutral leading-tight">
            Nossos Protocolos e <span className="text-gold-gradient italic">Tratamentos Exclusivos</span>
          </h2>
          <div className="w-16 h-[1.5px] bg-primary/30 mx-auto mt-6" />
          <p className="text-neutral-muted text-xs sm:text-sm font-light mt-5 leading-relaxed">
            Utilizamos apenas equipamentos padrão ouro mundiais e as mais refinadas técnicas injetáveis para
            esculpir e realçar cada traço seu de maneira integrativa e individualizada.
          </p>
        </div>

        {/* Filter Navigation */}
        <div className="flex flex-wrap justify-center gap-2 mb-12 border-b border-primary/10 pb-6">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-4 sm:px-6 py-2.5 text-[10px] sm:text-xs uppercase tracking-widest font-semibold rounded-sm transition-all duration-300 cursor-pointer ${
                selectedCategory === cat.id
                  ? "bg-primary text-white font-bold shadow-sm"
                  : "bg-luxury-gray text-neutral-muted hover:bg-secondary/20 hover:text-neutral"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Card Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredTreatments.map((treatment) => {
            return (
              <div
                key={treatment.id}
                className={`group relative rounded-md overflow-hidden bg-white border transition-all duration-500 flex flex-col justify-between ${
                  treatment.highlights
                    ? "border-primary/40 shadow-sm hover:border-primary"
                    : "border-primary/10 hover:border-primary/30"
                }`}
              >
                {/* Highlight Badge */}
                {treatment.highlights && (
                  <div className="absolute top-4 left-4 z-20 bg-primary text-white text-[9px] uppercase tracking-widest font-extrabold px-3 py-1 rounded-sm shadow-sm">
                    Destaque Clínico
                  </div>
                )}

                {/* Card Top: Image Element with hover zoom transition */}
                <div className="relative aspect-[16/10] overflow-hidden">
                  <img
                    src={treatment.image}
                    alt={treatment.name}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 filter brightness-95 group-hover:brightness-100"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent opacity-95" />
                </div>

                {/* Card Body content */}
                <div className="p-6 flex-1 flex flex-col justify-between">
                  <div>
                    <span className="text-[9px] tracking-widest text-primary uppercase font-bold">
                      {treatment.category === "tecnologia" ? "Laser & Tecnologia" : treatment.category === "facial" ? "Injetável Facial" : treatment.category === "corporal" ? "Estética Corporal" : "SPA & Massagem"}
                    </span>
                    <h3 className="text-xl font-serif text-neutral mt-1 group-hover:text-primary transition-colors">
                      {treatment.name}
                    </h3>
                    <p className="text-xs text-neutral-muted italic font-light mt-1.5 line-clamp-1">
                      {treatment.tagline}
                    </p>
                    <p className="text-xs text-neutral-muted font-light mt-3 leading-relaxed line-clamp-3">
                      {treatment.description}
                    </p>
                  </div>

                  {/* Core specs or direct trigger action */}
                  <div className="mt-6 pt-4 border-t border-primary/10 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-[11px] text-neutral-muted">
                    <span className="flex items-center space-x-1 min-w-0">
                      <Clock className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                      <span>{treatment.duration}</span>
                    </span>
                    <button
                      onClick={() => handleOpenModal(treatment)}
                      className="text-[11px] uppercase tracking-wider text-primary font-semibold group-hover:text-primary-light transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Ver Detalhes →
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Dynamic Detail Modal */}
      {activeModal && (
        <div id="treatment-detail-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral/60 backdrop-blur-sm animate-fade-in">
          <div className="relative bg-white border border-primary/10 max-w-3xl w-full max-h-[90vh] overflow-y-auto rounded-lg shadow-xl animate-in zoom-in-95 duration-200">
            {/* Close Button */}
            <button
              onClick={handleCloseModal}
              className="absolute top-4 right-4 p-2 text-neutral-muted hover:text-neutral hover:bg-neutral/5 rounded-full z-10 cursor-pointer"
            >
              <X className="w-6 h-6" />
            </button>

            {/* Modal Image Header */}
            <div className="relative aspect-[21/9] md:aspect-[21/8] overflow-hidden">
              <img
                src={activeModal.image}
                alt={activeModal.name}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-white via-white/50 to-transparent" />
              <div className="absolute bottom-6 left-6 md:left-8">
                <span className="text-[10px] tracking-widest text-primary uppercase font-bold bg-white/95 border border-primary/10 px-3 py-1 rounded w-fit block mb-2">
                  Protocolo Oficial
                </span>
                <h3 className="text-2xl md:text-3xl font-serif text-neutral font-semibold">
                  {activeModal.name}
                </h3>
              </div>
            </div>

            {/* Modal Detailed Body */}
            <div className="p-6 md:p-8 space-y-6">
              
              {/* Tagline */}
              <p className="text-sm md:text-base text-primary font-medium italic leading-relaxed border-l-2 border-primary pl-4">
                "{activeModal.tagline}"
              </p>

              {/* Description */}
              <div className="space-y-2">
                <h4 className="text-xs uppercase tracking-widest text-neutral font-bold">
                  Sobre o Procedimento:
                </h4>
                <p className="text-xs md:text-sm text-neutral-muted font-light leading-relaxed">
                  {activeModal.description}
                </p>
              </div>

              {/* Benefits */}
              <div className="space-y-3">
                <h4 className="text-xs uppercase tracking-widest text-neutral font-bold">
                  Benefícios Primários:
                </h4>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-neutral-muted">
                  {activeModal.benefits.map((benefit, i) => (
                    <li key={i} className="flex items-start space-x-2">
                      <span className="text-primary font-bold mt-0.5">✦</span>
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Recovery and Duration specs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-primary/10 text-xs">
                <div className="flex items-center space-x-3 bg-luxury-dark p-3 rounded border border-primary/10 animate-fade-in">
                  <Clock className="w-5 h-5 text-primary" />
                  <div>
                    <p className="text-neutral-muted text-[10px] uppercase font-bold">Duração Média</p>
                    <p className="text-neutral font-semibold">{activeModal.duration}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3 bg-luxury-dark p-3 rounded border border-primary/10 animate-fade-in">
                  <RefreshCw className="w-5 h-5 text-primary" />
                  <div>
                    <p className="text-neutral-muted text-[10px] uppercase font-bold">Pós-Procedimento</p>
                    <p className="text-neutral font-semibold">{activeModal.recovery}</p>
                  </div>
                </div>
              </div>

              {/* Call to Actions on Modal */}
              <div className="flex flex-col sm:flex-row items-center gap-4 pt-4 justify-between">
                <span className="text-neutral-muted text-[11px] max-w-sm text-center sm:text-left">
                  *Necessário passar por avaliação com a Dra. Musa para personalização definitiva.
                </span>
                <div className="flex space-x-3 w-full sm:w-auto">
                  <button
                    onClick={() => {
                      onSelectTreatment(activeModal.name);
                      handleCloseModal();
                    }}
                    className="flex-1 sm:flex-initial text-center text-xs uppercase tracking-widest font-semibold text-primary border border-primary/25 hover:border-primary hover:bg-primary/5 px-5 py-3 rounded-sm transition-all text-nowrap cursor-pointer"
                  >
                    Simular Orçamento
                  </button>
                  <a
                    href={`https://wa.me/5511900000000?text=${encodeURIComponent(`Olá! Gostaria de tirar dúvidas e saber valores para o tratamento de ${activeModal.name} com a Dra. Musa.`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 sm:flex-initial flex items-center justify-center space-x-2 text-xs uppercase tracking-widest font-bold text-white bg-primary hover:bg-primary-light px-6 py-3 rounded-sm transition-all text-nowrap cursor-pointer"
                  >
                    <Calendar className="w-4 h-4" />
                    <span>Marcar Agora</span>
                  </a>
                </div>
              </div>

            </div>

          </div>
        </div>
      )}
    </section>
  );
}

import { Mail, ShieldCheck, Award, Heart, CheckCircle2, ChevronRight } from "lucide-react";
import draMusa from "../assets/dra_musa.jpg";

export default function DrBio() {
  const pillars = [
    {
      title: "Individualidade Relevante",
      desc: "Nenhum rosto é idêntico. Desenvolvemos planejamentos matemáticos individualizados focando em reequilibrar proporções sem criar feições padronizadas."
    },
    {
      title: "Segurança de Alto Padrão",
      desc: "Utilizamos as tecnologias de ponta aprovadas pela ANVISA e FDA, além de insumos estéticos importados premium para máxima eficácia biológica."
    },
    {
      title: "Naturalidade em Primeiro Lugar",
      desc: "Nosso lema principal: harmonizar sem descaracterizar. A intenção é que as pessoas percebam sua pele radiante e jovial, mas sem notar intervenções grosseiras."
    }
  ];

  return (
    <section
      id="dra-musa"
      className="py-24 bg-luxury-black relative overflow-hidden"
    >
      {/* Background soft glow effects */}
      <div className="absolute bottom-0 left-1/4 w-80 h-80 rounded-full bg-gold-900/5 blur-[120px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">

          {/* Left Column: Premium Interactive Photo with Gold Trim */}
          <div className="lg:col-span-5 relative flex justify-center lg:justify-start">
            {/* Outer Decorative Gold Line Frame */}
            <div className="absolute -top-4 -left-4 w-12 h-12 border-t-2 border-l-2 border-primary" />
            <div className="absolute -bottom-4 -right-4 w-12 h-12 border-b-2 border-r-2 border-primary" />

            <div className="relative w-full max-w-[380px] aspect-[4/5] rounded bg-white p-2 border border-primary/10 shadow-lg">
              <div className="w-full h-full relative overflow-hidden rounded">
                <img
                  src={draMusa}
                  alt="Dra. Musa Valentina"
                  className="w-full h-full object-cover filter brightness-95 grayscale-[15%] hover:grayscale-0 transition-all duration-700 hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent opacity-50" />
              </div>

              {/* CRM / License Badge Overlay */}
              <div className="absolute bottom-6 left-6 right-6 bg-white/95 backdrop-blur-md border border-primary/10 px-4 py-3 rounded text-center shadow-lg">
                <p className="text-[10px] tracking-widest text-primary font-bold uppercase">
                  Dra. Musa Valentina
                </p>
                <p className="text-[9px] text-neutral-muted mt-0.5 tracking-wider font-light">
                  Aura em Harmonização Avançada • Registro Estético COFEN SP
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Narrative Copy & Pillars */}
          <div className="lg:col-span-7 space-y-6 flex flex-col justify-center">
            <span className="text-[10px] tracking-[0.3em] text-primary uppercase font-semibold">
              A Alma da Clínica
            </span>
            <h2 className="text-3xl sm:text-4xl font-serif text-neutral tracking-tight">
              Ciência, Tecnologia e <span className="text-gold-gradient italic">Sensibilidade Artística</span>
            </h2>
            <div className="w-12 h-[1px] bg-primary/30" />

            <div className="space-y-4 text-xs sm:text-sm text-neutral-muted font-light leading-relaxed">
              <p>
                À frente da Dra. Musa Estética de Elite, a{" "}
                <strong className="text-primary font-medium">Dra. Musa Valentina</strong> é
                especialista dedicada a redefinir os parâmetros de autocuidado em São Paulo/SP.
                Com sólida formação acadêmica em harmonia facial e cosmetologia avançada, ela idealizou uma
                clínica diferenciada onde cada paciente recebe atenção VIP e protocolos exclusivos baseados em tecnologias de última geração — a fórmula que transformou a Dra. Musa na clínica que fatura horrores.
              </p>
              <p>
                Acreditando que o autocuidado é a base do bem-estar, a Dra. Musa não trabalha com resultados caricatos
                ou padronizados. Seu foco é a <strong className="text-neutral font-semibold">Estética Integrativa Inteligente</strong>,
                desenvolvendo intervenções sutis e seguras que resgatam a sua melhor versão sem descaracterizar sua expressão original.
              </p>
            </div>

            {/* Pillars Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-6 border-t border-primary/10">
              {pillars.map((pillar, idx) => (
                <div key={idx} className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
                    <h4 className="text-xs font-bold text-neutral tracking-widest uppercase">
                      {pillar.title}
                    </h4>
                  </div>
                  <p className="text-[11px] leading-relaxed text-neutral-muted font-light">
                    {pillar.desc}
                  </p>
                </div>
              ))}
            </div>

            {/* Quote Action button */}
            <div className="pt-6">
              <a
                href={`https://wa.me/5511900000000?text=${encodeURIComponent("Olá! Gostaria de agendar uma consulta de avaliação especial com a Dra. Musa.")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center space-x-2 text-[10px] tracking-[0.2em] uppercase font-bold text-primary hover:text-primary-light border-b border-primary/30 hover:border-primary pb-1.5 transition-colors cursor-pointer"
              >
                <span>Falar Diretamente com Dra. Musa</span>
                <ChevronRight className="w-4 h-4" />
              </a>
            </div>

          </div>

        </div>
      </div>
    </section>
  );
}

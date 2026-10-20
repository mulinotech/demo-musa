import { useState, FormEvent } from "react";
import { Sparkles, Calendar, ChevronRight, CheckCircle2, User, Phone, ArrowRight, RotateCcw } from "lucide-react";
import { Lead } from "../data";
import { comDdi, temNumero, DDI_PADRAO } from "../lib/telefone.mjs";
import { useSite, linkWhatsApp, enviarLead, nomeDoCatalogo } from "../lib/site";

interface LeadQuizProps {
  onLeadCaptured: (newLead: Lead) => void;
  presetTreatmentName?: string;
  onClearPresetName?: () => void;
}

export default function LeadQuiz({ onLeadCaptured, presetTreatmentName, onClearPresetName }: LeadQuizProps) {
  const [step, setStep] = useState<number>(0);
  const [concern, setConcern] = useState<string>("");
  const [area, setArea] = useState<string>("");
  const [recovery, setRecovery] = useState<string>("");
  
  // Lead info
  const [name, setName] = useState<string>("");
  const [whatsapp, setWhatsapp] = useState<string>(DDI_PADRAO);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [showResult, setShowResult] = useState<boolean>(false);
  // O lead NAO chegou ao CRM: o resultado aparece, mas com o aviso (BUG-01).
  const [falhaEnvio, setFalhaEnvio] = useState<string>("");
  const [erroTelefone, setErroTelefone] = useState<string>("");
  const site = useSite();
  const [recommendedProtocol, setRecommendedProtocol] = useState<{
    title: string;
    description: string;
    tagline: string;
    benefits: string[];
  } | null>(null);

  // If a preset treatment was clicked, we can prefill choices or reset
  const handleStartPresetQuiz = () => {
    setConcern(presetTreatmentName || "");
    setStep(1);
  };

  const handleNextStep = (value: string, stage: "concern" | "area" | "recovery") => {
    if (stage === "concern") {
      setConcern(value);
      setStep(2);
    } else if (stage === "area") {
      setArea(value);
      setStep(3);
    } else if (stage === "recovery") {
      setRecovery(value);
      setStep(4);
    }
  };

  /* Relatório de QA de 15/10, BUG-15. Três defeitos aqui:
     - a comparação diferenciava maiúscula ("Bumbum" contra "bumbum"), então a
       queixa de bumbum NUNCA casava e caía no Ultraformer facial;
     - recomendava "Protocolo Pós-Mounjaro & Ozempic", que não existe no catálogo;
     - os nomes ("Ultraformer MPT - Lifting 3D", "Lavien BB Laser Premium") não
       eram os do catálogo, e o lead chegava ao funil com procedimento que a
       Agenda não reconhece.
     Os títulos agora são os do catálogo; o que muda é a explicação. */
  const calculateResult = () => {
    const q = concern.toLowerCase();
    const r = area.toLowerCase();
    const facial = r.includes("rosto");
    const corpoOuMaos = r.includes("pescoço") || r.includes("mãos") || r.includes("colo");

    if (q.includes("bumbum") || r.includes("glúte") || r.includes("bumbum")) {
      return {
        title: "Bumbum Max",
        tagline: "Harmonização glútea integral, sustentação e clareamento",
        description: "A melhor resposta estética para projetar, preencher depressões trocantéricas laterais e suavizar a celulite, combinando bioestimuladores com ácido hialurônico corporal de alta densidade.",
        benefits: ["Projeção glútea", "Suavização das ondulações da celulite", "Sustentação e elasticidade duradouras"]
      };
    }
    if (q.includes("mounjaro") || q.includes("emagrecimento")) {
      return {
        title: "Ultraformer MPT",
        tagline: facial ? "Firmeza do rosto depois do emagrecimento rápido" : "Firmeza da pele depois do emagrecimento rápido",
        description: "Ultrassom micro e macrofocado para a flacidez que aparece quando o peso cai rápido: estimula colágeno novo e devolve sustentação à pele" + (facial ? " do rosto e da papada." : " do abdômen, coxas e braços.") + " O plano completo é definido na avaliação presencial.",
        benefits: ["Pele mais firme", "Estímulo de colágeno", "Sem tempo de recuperação"]
      };
    }
    if (q.includes("manchas") || q.includes("melasma") || recovery.toLowerCase().includes("textura")) {
      return {
        title: "Lavien BB Laser",
        tagline: "Renovação da pele e controle de manchas",
        description: "Laser de Túlio que uniformiza o tom e a textura" + (corpoOuMaos ? " do pescoço, do colo e das mãos" : " do rosto") + ": trata poros abertos e hiperpigmentações, devolvendo um brilho constante e uniforme.",
        benefits: ["Manchas suavizadas", "Poros mais fechados", "Pele com aspecto uniforme"]
      };
    }
    // Flacidez facial (ou resposta que não casou com nenhuma queixa)
    return {
      title: "Ultraformer MPT",
      tagline: "Combate profundo à flacidez muscular e envelhecimento",
      description: "Ultrassom micro e macrofocado. Atua contra a gravidade promovendo o recolamento das fáscias musculares enfraquecidas e estimulando a regeneração das fibras de colágeno.",
      benefits: ["Contorno da mandíbula", "Melhora da papada", "Estímulo de colágeno natural"]
    };
  };

  /* Respostas que não combinam (queixa de bumbum, região rosto) não viram outro
     protocolo calado: a equipe fica sabendo no próprio lead. */
  const respostasDivergentes = () => {
    const q = concern.toLowerCase();
    const r = area.toLowerCase();
    if (q.includes("bumbum") && !(r.includes("glúte") || r.includes("bumbum") || r.includes("corporal"))) return true;
    if (q.includes("rosto") && (r.includes("glúte") || r.includes("corporal"))) return true;
    return false;
  };

  const handleFormSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErroTelefone("");
    setFalhaEnvio("");
    if (!name.trim()) return;
    // idem ContactForm: "+55 " sozinho nao e telefone -- e agora a tela diz isso.
    if (!temNumero(whatsapp)) {
      setErroTelefone("Informe um WhatsApp válido, com DDD — por exemplo (11) 98888-7777.");
      return;
    }

    setIsSubmitting(true);

    const recommendation = calculateResult();
    setRecommendedProtocol(recommendation);
    const treatment = nomeDoCatalogo(site, recommendation.title);

    const lead = {
      name: name.trim(),
      whatsapp: whatsapp.replace(/\D/g, ""), // only digits
      treatment,
      message: `Quiz do site: queixa de ${concern}, região ${area}, preferência ${recovery}.` +
        (respostasDivergentes() ? " ATENÇÃO: respostas divergentes entre queixa e região — confirmar na avaliação." : ""),
      scoreResult: `${treatment}: ${recommendation.tagline}`,
    };

    const r = await enviarLead(lead);
    setIsSubmitting(false);
    if (r.ok) {
      onLeadCaptured({ id: "", ...lead, date: new Date().toISOString(), status: "novo" } as Lead);
    } else {
      setFalhaEnvio(r.erro || "Não foi possível enviar agora.");
    }
    setShowResult(true);
    if (onClearPresetName) onClearPresetName();
  };

  const handleRestartQuiz = () => {
    setStep(0);
    setConcern("");
    setArea("");
    setRecovery("");
    setName("");
    setWhatsapp(DDI_PADRAO);
    setShowResult(false);
    setFalhaEnvio("");
    setErroTelefone("");
    setRecommendedProtocol(null);
  };

  // Pre-configured options
  const concernOptions = [
    "Flacidez no rosto e perda de contorno mandibular",
    "Manchas na pele, Melasma ou poros abertos",
    "Flacidez no bumbum, celulite ou bumbum plano",
    "Flacidez corporal pós-emagrecimento rápido (Ozempic/Mounjaro)"
  ];

  const areaOptions = [
    "Rosto Completo & Papada",
    "Pescoço, Colo, Mãos",
    "Região Glútea (Bumbum)",
    "Corporal (Abdômen, Coxas, Flancos)"
  ];

  const recoveryOptions = [
    "Desejo resultados sem repouso e sem tempo de recuperação",
    "Aceito microagulhas finas para regenerar colágeno intensamente",
    "Quero focar na textura e brilho, tolerando leve vermelhidão"
  ];

  return (
    <section
      id="quiz"
      className="py-24 bg-bg-luxe relative border-t border-primary/10"
    >
      <div className="absolute top-1/2 right-1/4 w-96 h-96 rounded-full bg-primary/5 blur-[130px] pointer-events-none" />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 relative z-10">
        
        {/* Main Header card */}
        <div className="bg-white border border-primary/15 rounded-lg p-6 md:p-10 shadow-lg overflow-hidden relative">
          
          <div className="absolute -top-[150px] -right-[150px] w-80 h-80 bg-primary/5 rounded-full blur-3xl pointer-events-none" />

          {/* Step 0: Welcome Screen */}
          {step === 0 && !presetTreatmentName && (
            <div className="text-center space-y-6 py-6 animate-fade-in">
              <div className="inline-flex items-center justify-center bg-primary/5 p-3.5 rounded-full mb-2">
                <Sparkles className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-2xl sm:text-3.5xl font-serif text-neutral tracking-wide">
                Diagnóstico de Beleza <span className="text-gold-gradient italic">Inteligente</span>
              </h3>
              <p className="text-neutral-muted font-light text-xs sm:text-sm max-w-xl mx-auto leading-relaxed">
                Descubra qual das nossas tecnologias padrão ouro mundiais (Ultraformer MPT, Lavien BB Laser, etc) 
                é a mais indicada para as características exclusivas dos seus tecidos corporais ou faciais. 
                Ao finalizar, receba uma recomendação detalhada.
              </p>
              
              <div className="flex flex-wrap justify-center gap-6 py-4 text-[11px] text-neutral-muted">
                <span className="flex items-center space-x-1">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  <span>Análise de Flacidez & Textura</span>
                </span>
                <span className="flex items-center space-x-1">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  <span>Resultado em 1 minuto</span>
                </span>
                <span className="flex items-center space-x-1">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  <span>Atendimento VIP</span>
                </span>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => setStep(1)}
                  className="bg-primary hover:bg-primary-light text-white font-extrabold uppercase text-xs tracking-widest px-8 py-4 rounded-sm shadow-md transition-all hover:scale-[1.02] cursor-pointer"
                >
                  Iniciar Avaliação Online
                </button>
              </div>
            </div>
          )}

          {/* Handle Preset Choice Transition */}
          {presetTreatmentName && step === 0 && (
            <div className="text-center space-y-6 py-6 animate-fade-in">
              <div className="inline-flex items-center justify-center bg-primary/5 p-3.5 rounded-full">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl sm:text-2xl font-serif text-neutral tracking-wide">
                Simulador de Planejamento Estético
              </h3>
              <p className="text-neutral-muted font-light text-sm max-w-md mx-auto">
                Você selecionou o protocolo <strong className="text-primary">{presetTreatmentName}</strong>. 
                Gostaria de complementar com 3 perguntas simples para receber um diagnóstico integrativo completo de pele?
              </p>
              <div className="flex justify-center space-x-4 pt-4">
                <button
                  onClick={onClearPresetName}
                  className="px-5 py-3 border border-primary/20 text-xs text-neutral-muted rounded-sm uppercase tracking-widest hover:text-neutral cursor-pointer"
                >
                  Limpar Seleção
                </button>
                <button
                  onClick={handleStartPresetQuiz}
                  className="px-6 py-3 bg-primary hover:bg-primary-light text-white text-xs font-black rounded-sm uppercase tracking-widest hover:scale-102 transition-transform cursor-pointer"
                >
                  Continuar Simulação
                </button>
              </div>
            </div>
          )}

          {/* Stepper indicator */}
          {step > 0 && !showResult && (
            <div className="mb-8">
              <div className="flex items-center justify-between text-[11px] text-neutral-muted mb-2.5 font-semibold">
                <span>Passo {step} de 4</span>
                <span className="text-primary uppercase tracking-wider">
                  {step === 1 ? "Queixa Principal" : step === 2 ? "Área Alvo" : step === 3 ? "Recuperação" : "Contato VIP"}
                </span>
              </div>
              <div className="w-full bg-luxury-gray h-1 lg:h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-primary h-full transition-all duration-300"
                  style={{ width: `${(step / 4) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Step 1: main concern */}
          {step === 1 && !showResult && (
            <div className="space-y-6 animate-slide-in-from-right">
              <h4 className="text-lg md:text-xl font-serif text-neutral tracking-wide text-center">
                Qual o seu principal desconforto estético hoje?
              </h4>
              <div className="flex flex-col space-y-3.5 pt-2">
                {concernOptions.map((option, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleNextStep(option, "concern")}
                    className="w-full text-left p-4 bg-bg-luxe hover:bg-luxury-gray/40 border border-primary/10 hover:border-primary/30 text-xs sm:text-sm text-neutral-muted font-light hover:text-neutral rounded-md transition-all duration-300 cursor-pointer flex items-center justify-between"
                  >
                    <span>{option}</span>
                    <ChevronRight className="w-4 h-4 text-primary flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: area */}
          {step === 2 && !showResult && (
            <div className="space-y-6 animate-slide-in-from-right">
              <h4 className="text-lg md:text-xl font-serif text-neutral tracking-wide text-center">
                Em qual região do corpo ou rosto gostaria de focar?
              </h4>
              <div className="flex flex-col space-y-3.5 pt-2">
                {areaOptions.map((option, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleNextStep(option, "area")}
                    className="w-full text-left p-4 bg-bg-luxe hover:bg-luxury-gray/40 border border-primary/10 hover:border-primary/30 text-xs sm:text-sm text-neutral-muted font-light hover:text-neutral rounded-md transition-all duration-300 cursor-pointer flex items-center justify-between"
                  >
                    <span>{option}</span>
                    <ChevronRight className="w-4 h-4 text-primary flex-shrink-0" />
                  </button>
                ))}
              </div>
              <button
                onClick={() => setStep(1)}
                className="text-xs text-neutral-muted hover:text-neutral cursor-pointer mx-auto block pt-2"
              >
                ← Voltar para o passo anterior
              </button>
            </div>
          )}

          {/* Step 3: recovery options */}
          {step === 3 && !showResult && (
            <div className="space-y-6 animate-slide-in-from-right">
              <h4 className="text-lg md:text-xl font-serif text-neutral tracking-wide text-center">
                Quanto tempo de recuperação (homecare) você tolera?
              </h4>
              <div className="flex flex-col space-y-3.5 pt-2">
                {recoveryOptions.map((option, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleNextStep(option, "recovery")}
                    className="w-full text-left p-4 bg-bg-luxe hover:bg-luxury-gray/40 border border-primary/10 hover:border-primary/30 text-xs sm:text-sm text-neutral-muted font-light hover:text-neutral rounded-md transition-all duration-300 cursor-pointer flex items-center justify-between"
                  >
                    <span>{option}</span>
                    <ChevronRight className="w-4 h-4 text-primary flex-shrink-0" />
                  </button>
                ))}
              </div>
              <button
                onClick={() => setStep(2)}
                className="text-xs text-neutral-muted hover:text-neutral cursor-pointer mx-auto block pt-2"
              >
                ← Voltar para o passo anterior
              </button>
            </div>
          )}

          {/* Step 4: Contact Form to Unlock Result */}
          {step === 4 && !showResult && (
            <div className="space-y-6 animate-slide-in-from-right">
              <div className="text-center">
                <h4 className="text-lg md:text-xl font-serif text-neutral tracking-wide">
                  Análise Concluída! Insira seus dados para revelar seu Diagnóstico
                </h4>
                <p className="text-xs text-neutral-muted font-light mt-1.5">
                  Falta pouco para desbloquear o tratamento perfeito mapeado pela Dra. Musa.
                </p>
              </div>

              <form onSubmit={handleFormSubmit} className="space-y-4 max-w-md mx-auto pt-2">
                
                {/* Input Name */}
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-widest text-neutral-muted font-bold block">
                    Seu Nome Completo
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-neutral-muted">
                      <User className="w-4 h-4" />
                    </span>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ex: Amanda Rezende"
                      className="w-full bg-bg-luxe border border-primary/15 focus:border-primary rounded px-4 py-3 pl-11 text-sm text-neutral font-light focus:outline-none transition-colors animate-fade-in"
                    />
                  </div>
                </div>

                {/* Input WhatsApp */}
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-widest text-neutral-muted font-bold block">
                    Seu WhatsApp (com DDD)
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-neutral-muted">
                      <Phone className="w-4 h-4" />
                    </span>
                    <input
                      type="tel"
                      required
                      value={whatsapp}
                      onChange={(e) => setWhatsapp(comDdi(e.target.value))}
                      placeholder="Ex: (15) 99999-9999"
                      className="w-full bg-bg-luxe border border-primary/15 focus:border-primary rounded px-4 py-3 pl-11 text-sm text-neutral font-light focus:outline-none transition-colors animate-fade-in"
                    />
                  </div>
                  {erroTelefone && (
                    <p role="alert" className="text-[11px] text-red-600 font-medium">{erroTelefone}</p>
                  )}
                </div>

                {/* Marketing check informational */}
                <p className="text-[10px] text-neutral-muted font-light leading-relaxed text-center py-1">
                  🔒 Seus dados estão 100% protegidos em conformidade com a LGPD e serão utilizados exclusivamente para o contato clínico na Dra. Musa Estética de Elite.
                </p>

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-primary hover:bg-primary-light text-white text-xs font-black uppercase tracking-widest py-4 rounded-sm shadow-md hover:scale-101 active:scale-99 transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <span>Processando Diagnóstico...</span>
                  ) : (
                    <>
                      <span>Revelar Meu Protocolo Ideal</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>

              <button
                onClick={() => setStep(3)}
                className="text-xs text-neutral-muted hover:text-neutral cursor-pointer mx-auto block mt-2"
              >
                ← Voltar para o passo anterior
              </button>
            </div>
          )}

          {/* Results Screen */}
          {showResult && recommendedProtocol && (
            <div className="space-y-6 md:space-y-8 animate-fade-in py-4">
              
              <div className="text-center space-y-2">
                <div className="inline-flex items-center justify-center bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-xs uppercase tracking-widest font-black px-4 py-1.5 rounded-full">
                  ★ Diagnóstico Concluído
                </div>
                {falhaEnvio && (
                  <div role="alert" className="max-w-xl mx-auto mt-3 bg-red-500/10 border border-red-500/20 text-red-600 p-3 rounded text-xs">
                    <strong>Seus dados não chegaram à clínica.</strong> {falhaEnvio} Use o botão do WhatsApp abaixo para garantir o seu benefício.
                  </div>
                )}
                <h3 className="text-2xl sm:text-3.5xl font-serif text-neutral tracking-wide">
                  Seu Protocolo Mapeado: <span className="text-gold-gradient block sm:inline">{recommendedProtocol.title}</span>
                </h3>
                <p className="text-primary text-xs md:text-sm font-light italic">
                  "{recommendedProtocol.tagline}"
                </p>
              </div>

              {/* Recommendation Box */}
              <div className="bg-bg-luxe border border-primary/10 p-5 md:p-6 rounded-md space-y-4">
                <p className="text-xs md:text-sm text-neutral-muted font-light leading-relaxed">
                  {recommendedProtocol.description}
                </p>
                
                {/* Benefits */}
                <div className="space-y-2.5 pt-2">
                  <p className="text-[10px] uppercase tracking-widest text-neutral font-bold">
                    Benefícios Identificados para Você:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    {recommendedProtocol.benefits.map((b, idx) => (
                      <div key={idx} className="flex items-center space-x-2 bg-white border border-primary/10 p-2.5 rounded">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                        <span className="text-neutral-muted">{b}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* VIP Welcome benefit alert box */}
              <div className="border border-primary/20 bg-primary/5 p-4 rounded text-center max-w-xl mx-auto space-y-1.5">
                <p className="text-primary font-serif text-base sm:text-lg font-semibold uppercase tracking-wider">
                  🎁 Benefício VIP Desbloqueado!
                </p>
                <p className="text-xs text-neutral-muted font-light leading-relaxed">
                  Por ter concluído nosso quiz, garantimos uma <strong className="text-neutral font-semibold">Condição Especial</strong> em sua primeira Consulta de Avaliação Facial/Corporal na clínica Física neste mês.
                </p>
              </div>

              {/* WhatsApp Redirection Action */}
              <div className="flex flex-col sm:flex-row items-center gap-4 justify-center pt-2">
                <button
                  onClick={handleRestartQuiz}
                  className="flex items-center space-x-1 text-xs text-neutral-muted hover:text-neutral uppercase tracking-widest font-semibold py-2 cursor-pointer order-2 sm:order-1"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Refazer Análise</span>
                </button>
                
                <a
                  href={linkWhatsApp(site, `Olá! Sou ${name} e completei o Quiz de Beleza da Dra. Musa Estética de Elite. Meu resultado recomendado foi o ${recommendedProtocol.title}. Gostaria de resgatar meu benefício VIP e marcar uma consulta com a Dra. Musa!`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto flex items-center justify-center space-x-2 bg-primary hover:bg-primary-light text-white font-extrabold uppercase text-xs tracking-widest px-8 py-4 rounded-sm shadow-md hover:scale-102 transition-all order-1 sm:order-2 cursor-pointer"
                >
                  <Calendar className="w-4.5 h-4.5" />
                  <span>Resgatar Cupom no WhatsApp</span>
                </a>
              </div>

            </div>
          )}

        </div>
      </div>
    </section>
  );
}

import { useState, useEffect } from "react";
import Header from "./components/Header";
import Hero from "./components/Hero";
import Treatments from "./components/Treatments";
import DrBio from "./components/DrBio";
import BeforeAfter from "./components/BeforeAfter";
import LeadQuiz from "./components/LeadQuiz";
import ContactForm from "./components/ContactForm";
import FloatingWhatsApp from "./components/FloatingWhatsApp";
import CrmDashboard from "./components/CrmDashboard";
import { Lead, REVIEWS } from "./data";
import { Award, ShieldCheck, Heart, Sparkles, MapPin, Star, Calendar, MessageSquare, Instagram, ExternalLink } from "lucide-react";

// Initial mock data to paint the CRM with vibrant, realistic data upon initialization
const PRESEEDED_LEADS: Lead[] = [
  {
    id: "l_pre_1",
    name: "Carolina de Oliveira",
    whatsapp: "11998765432",
    treatment: "Ultraformer MPT",
    message: "Olá! Vi as fotos do lifting mandibular e gostaria de agendar uma consulta para tratar minha papada urgente.",
    scoreResult: "Ultraformer MPT - Lifting 3D",
    date: new Date(Date.now() - 3600000 * 4).toISOString(), // 4h ago
    status: "novo"
  },
  {
    id: "l_pre_2",
    name: "Ana Beatriz Ramos",
    whatsapp: "11991234567",
    treatment: "Lavien BB Laser",
    message: "Melasma pós gravidez me atinge muito, gostaria de saber se o laser de tulium Lavien é doloroso.",
    scoreResult: "Lavien BB Laser Premium",
    date: new Date(Date.now() - 3600000 * 20).toISOString(), // 20h ago
    status: "contatado"
  },
  {
    id: "l_pre_3",
    name: "Renata Vasconcellos",
    whatsapp: "11981112233",
    treatment: "Bumbum Max",
    message: "Gostaria de ver o preço do bumbum max com bioestimulador e preenchedor de ácido hialurônico corporal.",
    scoreResult: "Protocolo Bumbum Max",
    date: new Date(Date.now() - 3600000 * 48).toISOString(), // 2 days ago
    status: "agendado"
  }
];

export default function App() {
  const [activeSection, setActiveSection] = useState<string>("inicio");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isCrmOpen, setIsCrmOpen] = useState<boolean>(() => {
    return localStorage.getItem("musa_crm_open") === "true";
  });
  const [presetQuizTreatmentName, setPresetQuizTreatmentName] = useState<string>("");
  const [activeReviewIndex, setActiveReviewIndex] = useState<number>(0);

  useEffect(() => {
    localStorage.setItem("musa_crm_open", String(isCrmOpen));
  }, [isCrmOpen]);

  // URL da API backend (detecta automaticamente se está local ou em produção)
  const API_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001/api/leads"
    : "/api/leads";

  // Initialize and load saved leads from API backend
  useEffect(() => {
    fetch(API_URL)
      .then(res => {
        if (!res.ok) throw new Error("Falha ao carregar do servidor");
        return res.json();
      })
      .then(data => {
        // Mapear campos vindos do banco para o padrão do frontend
        const mappedData = data.map((item: any) => ({
          id: item.id,
          name: item.name,
          phone: item.whatsapp,
          email: item.email || "",
          interest: item.treatment,
          status: item.status || "novo",
          source: item.source || "site",
          scoreResult: item.score_result,
          createdAt: item.date || new Date().toISOString()
        }));
        setLeads(mappedData);
      })
      .catch(err => {
        console.warn("Backend indisponível, usando localStorage de backup:", err);
        const saved = localStorage.getItem("musa_leads_v2");
        if (saved) {
          setLeads(JSON.parse(saved));
        } else {
          localStorage.setItem("musa_leads_v2", JSON.stringify(PRESEEDED_LEADS));
          setLeads(PRESEEDED_LEADS);
        }
      });
  }, []);

  // Update Section Tracker on Scroll
  useEffect(() => {
    const handleScroll = () => {
      const sections = ["inicio", "tratamentos", "dra-musa", "resultados", "quiz", "contato"];
      const scrollPosition = window.scrollY + 200;

      for (const section of sections) {
        const el = document.getElementById(section);
        if (el) {
          const top = el.offsetTop;
          const height = el.offsetHeight;
          if (scrollPosition >= top && scrollPosition < top + height) {
            setActiveSection(section);
            break;
          }
        }
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleLeadCapture = (newLead: Lead) => {
    // 1. Atualiza o estado visual imediatamente (Optimistic UI)
    const updated = [newLead, ...leads];
    setLeads(updated);
    localStorage.setItem("musa_leads_v2", JSON.stringify(updated));

    // 2. Persiste no banco de dados via API
    fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: newLead.id,
        name: newLead.name,
        whatsapp: newLead.whatsapp,
        treatment: newLead.treatment,
        message: newLead.message,
        scoreResult: newLead.scoreResult,
        date: newLead.date,
        status: newLead.status
      })
    })
    .then(res => {
      if (!res.ok) console.error("Erro ao sincronizar novo lead com o backend.");
    })
    .catch(err => console.error("Falha ao conectar com o backend:", err));
  };

  const handleUpdateLeadStatus = (leadId: string, newStatus: Lead["status"], phone?: string, email?: string) => {
    // Atualiza apenas o estado visual do componente pai (App.tsx)
    const updated = leads.map(l => l.id === leadId ? { 
      ...l, 
      status: newStatus,
      ...(phone !== undefined ? { phone } : {}),
      ...(email !== undefined ? { email } : {})
    } : l);
    setLeads(updated);
    localStorage.setItem("musa_leads_v2", JSON.stringify(updated));
  };

  const handleDeleteLead = (leadId: string) => {
    // Atualiza apenas o estado visual do componente pai (App.tsx)
    const updated = leads.filter(l => l.id !== leadId);
    setLeads(updated);
    localStorage.setItem("musa_leads_v2", JSON.stringify(updated));
  };

  const handleClearLeads = () => {
    if (window.confirm("Deseja realmente limpar todos os leads capturados neste navegador?")) {
      setLeads([]);
      localStorage.removeItem("musa_leads_v2");
      // Opcional: Você pode optar por não expor um botão de deletar tudo no MySQL diretamente por segurança física de dados, limpando apenas o local
    }
  };

  // Navigates to selector smoothly
  const handleNavigation = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  // Triggers quiz simulation from treatment card modal
  const handleSelectSimulatedTreatment = (treatmentName: string) => {
    setPresetQuizTreatmentName(treatmentName);
    handleNavigation("quiz");
  };

  return (
    <div className="bg-bg-luxe text-neutral selection:bg-primary/25 selection:text-primary min-h-screen relative font-sans">
      
      {/* Premium Navigation Header */}
      <Header
        activeSection={activeSection}
        onNavigate={handleNavigation}
        onOpenDashboard={() => setIsCrmOpen(true)}
      />

      {/* Hero Visual Block */}
      <Hero
        onStartQuiz={() => handleNavigation("quiz")}
        onNavigateToTreatments={() => handleNavigation("tratamentos")}
      />

      {/* Brand Trust Badges block */}
      <div className="bg-white border-y border-primary/10 py-10 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            
            {/* Tech Quality badge */}
            <div className="space-y-1.5 flex flex-col items-center">
              <Award className="w-7 h-7 text-primary" />
              <p className="text-[11px] uppercase tracking-widest font-bold text-neutral">Equipamentos Originais</p>
              <p className="text-[10px] text-neutral-muted font-light max-w-[160px] leading-normal mx-auto">
                Consumíveis autênticos com rastreabilidade de disparo.
              </p>
            </div>

            {/* Individual Protocols Badge */}
            <div className="space-y-1.5 flex flex-col items-center">
              <Sparkles className="w-7 h-7 text-primary" />
              <p className="text-[11px] uppercase tracking-widest font-bold text-neutral">Estética Integrativa</p>
              <p className="text-[10px] text-neutral-muted font-light max-w-[160px] leading-normal mx-auto">
                Diagnósticos que conciliam face, corpo e hábitos de saúde.
              </p>
            </div>

            {/* Safety validation */}
            <div className="space-y-1.5 flex flex-col items-center">
              <ShieldCheck className="w-7 h-7 text-primary" />
              <p className="text-[11px] uppercase tracking-widest font-bold text-neutral">Anvisa & FDA Compliant</p>
              <p className="text-[10px] text-neutral-muted font-light max-w-[160px] leading-normal mx-auto">
                Garantia legal e clínica total em todos os ativos aplicados.
              </p>
            </div>

            {/* Doctor Bio */}
            <div className="space-y-1.5 flex flex-col items-center">
              <Heart className="w-7 h-7 text-primary" />
              <p className="text-[11px] uppercase tracking-widest font-bold text-neutral">Ambiente Elegante</p>
              <p className="text-[10px] text-neutral-muted font-light max-w-[160px] leading-normal mx-auto">
                Elegância, discrição e atendimento concierge incomparável.
              </p>
            </div>

          </div>
        </div>
      </div>

      {/* Treatments Lists */}
      <Treatments onSelectTreatment={handleSelectSimulatedTreatment} />

      {/* Doctor Bio and approach values */}
      <DrBio />

      {/* Comparative Before/After Cases slider */}
      <BeforeAfter />

      {/* Lead Capture and skin target Assessment Quiz */}
      <LeadQuiz
        onLeadCaptured={handleLeadCapture}
        presetTreatmentName={presetQuizTreatmentName}
        onClearPresetName={() => setPresetQuizTreatmentName("")}
      />

      {/* Reviews and Client Testimonials Section */}
      <section className="py-24 bg-white border-t border-primary/10 relative">
        <div className="absolute top-1/2 left-1/3 w-80 h-80 rounded-full bg-primary/5 blur-[100px] pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          
          <div className="text-center max-w-2xl mx-auto mb-16">
            <span className="text-[10px] tracking-[0.3em] text-primary uppercase font-bold block mb-3">
              Quem Confia em Nós
            </span>
            <h2 className="text-3xl sm:text-4xl font-serif tracking-tight text-neutral leading-tight">
              A Opinião de <span className="text-gold-gradient italic">Nossas Pacientes</span>
            </h2>
            <div className="w-16 h-[1.5px] bg-primary/25 mx-auto mt-6" />
          </div>

          {/* Testimonial slider layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {REVIEWS.map((review) => (
              <div 
                key={review.id} 
                className="bg-bg-luxe border border-primary/10 p-6 rounded-md hover:border-primary/25 transition-all duration-300 flex flex-col justify-between space-y-4"
              >
                <div className="space-y-3 text-left">
                  <div className="flex spacing-x-1">
                    {[...Array(review.rating)].map((_, i) => (
                      <Star key={i} className="w-4 h-4 fill-primary text-primary" />
                    ))}
                  </div>
                  <p className="text-xs sm:text-sm font-light text-neutral-muted italic leading-relaxed">
                    "{review.text}"
                  </p>
                </div>

                <div className="border-t border-primary/10 pt-3.5 flex items-center justify-between text-[11px]">
                  <div>
                    <p className="font-bold text-neutral uppercase tracking-wider">{review.author}</p>
                    <p className="text-neutral-muted mt-0.5">Paciente de {review.treatment}</p>
                  </div>
                  <span className="text-neutral-muted bg-white border border-primary/10 px-2 py-0.5 rounded font-mono">
                    Google Review
                  </span>
                </div>
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* Booking Form and Map Coordinates contact channel page */}
      <ContactForm
        onLeadCaptured={handleLeadCapture}
        selectedTreatmentName={presetQuizTreatmentName}
        onClearSelectedTreatment={() => setPresetQuizTreatmentName("")}
      />

      {/* Core Footer section */}
      <footer className="bg-bg-luxe border-t border-primary/20 py-16 text-neutral-muted text-xs text-left relative overflow-hidden">
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-10">
            
            {/* Branding Column */}
            <div className="md:col-span-4 space-y-4">
              <div className="flex flex-col">
                <span className="text-2xl font-serif text-neutral tracking-[0.25em] font-bold">
                  MUSA
                </span>
                <span className="text-[10px] tracking-[0.3em] text-primary uppercase font-bold mt-0.5">
                  Estética de Elite
                </span>
              </div>
              <p className="text-neutral-muted font-light leading-relaxed max-w-sm">
                Uma experiência estética integrativa de alto escalão em São Paulo/SP.
                Sua beleza natural sob cuidados médicos e científicos padrão ouro internacional.
              </p>
              
              {/* Instagram link */}
              <div className="flex items-center space-x-3.5 pt-2">
                <a 
                  href="https://instagram.com" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="bg-white border border-primary/10 p-2.5 rounded-full hover:border-primary hover:text-primary transition-all cursor-pointer text-neutral-muted"
                >
                  <Instagram className="w-5 h-5" />
                </a>
                <span className="text-[11px] text-neutral-muted font-semibold tracking-wider">Siga-nos @dra.musa.estetica</span>
              </div>
            </div>

            {/* Quick Navigation column */}
            <div className="md:col-span-4 space-y-4">
              <h5 className="text-[11px] uppercase tracking-[0.25em] text-neutral font-bold">Navegação Clínica</h5>
              <div className="grid grid-cols-2 gap-2 text-neutral-muted">
                <button onClick={() => handleNavigation("inicio")} className="hover:text-primary transition-colors text-left font-semibold py-1 cursor-pointer">Início</button>
                <button onClick={() => handleNavigation("tratamentos")} className="hover:text-primary transition-colors text-left font-semibold py-1 cursor-pointer">Procedimentos</button>
                <button onClick={() => handleNavigation("dra-musa")} className="hover:text-primary transition-colors text-left font-semibold py-1 cursor-pointer">Dra. Musa</button>
                <button onClick={() => handleNavigation("resultados")} className="hover:text-primary transition-colors text-left font-semibold py-1 cursor-pointer">Resultados</button>
                <button onClick={() => handleNavigation("quiz")} className="hover:text-primary transition-colors text-left font-semibold py-1 cursor-pointer">Avaliação Pele</button>
                <button onClick={() => handleNavigation("contato")} className="hover:text-primary transition-colors text-left font-semibold py-1 cursor-pointer">Contato</button>
              </div>
              
              {/* License/Disclaimer info */}
              <div className="pt-2 border-t border-primary/10">
                <span className="text-[9px] text-neutral-muted/70 leading-relaxed font-light block">
                  Responsável Técnica: Dra. Musa Valentina • Harmonização Estética Avançada • Registro de Classe Ativo • Consultórios devidamente regulamentados.
                </span>
              </div>
            </div>

            {/* Featured Treatment column */}
            <div className="md:col-span-4 space-y-4">
              <h5 className="text-[11px] uppercase tracking-[0.25em] text-neutral font-bold">Procedimentos de Elite</h5>
              <ul className="space-y-1.5 text-neutral-muted font-light">
                <li className="hover:text-primary transition-colors cursor-pointer" onClick={() => handleNavigation("tratamentos")}>✦ Ultraformer MPT (Sculpting)</li>
                <li className="hover:text-primary transition-colors cursor-pointer" onClick={() => handleNavigation("tratamentos")}>✦ Lavien BB Laser (Porcelain Skin)</li>
                <li className="hover:text-primary transition-colors cursor-pointer" onClick={() => handleNavigation("tratamentos")}>✦ Protocolo Pós-Mounjaro / Ozempic</li>
                <li className="hover:text-primary transition-colors cursor-pointer" onClick={() => handleNavigation("tratamentos")}>✦ Harmonização Glútea Bumbum Max</li>
              </ul>
            </div>

          </div>

          <div className="border-t border-primary/10 mt-12 pt-8 flex flex-col sm:flex-row items-center justify-between text-[10px] text-neutral-muted space-y-2.5 sm:space-y-0">
            <p>© {new Date().getFullYear()} Dra. Musa Estética de Elite São Paulo. Todos os direitos reservados.</p>
            <div className="flex space-x-4">
              <span className="hover:text-neutral transition-colors cursor-pointer">Políticas de Privacidade</span>
              <span className="hover:text-neutral transition-colors cursor-pointer">Termos de Uso</span>
            </div>
          </div>

        </div>
      </footer>

      {/* Floating Active WhatsApp messenger widget */}
      <FloatingWhatsApp />

      {/* Integrated Administrative CRM console Dashboard */}
      <CrmDashboard
        isOpen={isCrmOpen}
        onClose={() => setIsCrmOpen(false)}
        leads={leads as any}
        onUpdateLeadStatus={handleUpdateLeadStatus as any}
        onDeleteLead={handleDeleteLead}
      />

    </div>
  );
}

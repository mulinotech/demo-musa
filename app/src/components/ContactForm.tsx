import React, { useState, useEffect, useMemo } from "react";
import { TREATMENTS, Lead } from "../data";
import { MapPin, Phone, Mail, Clock, Calendar, Check, Send, AlertCircle } from "lucide-react";

interface ContactFormProps {
  onLeadCaptured: (newLead: Lead) => void;
  selectedTreatmentName?: string;
  onClearSelectedTreatment?: () => void;
}

export default function ContactForm({ onLeadCaptured, selectedTreatmentName, onClearSelectedTreatment }: ContactFormProps) {
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [whatsapp, setWhatsapp] = useState<string>("");
  const [treatment, setTreatment] = useState<string>(selectedTreatmentName || "");
  const [message, setMessage] = useState<string>("");
  
  // Submit state
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const [catalogTreatments, setCatalogTreatments] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    fetch('/api/treatment-catalog')
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('Failed to load treatments');
      })
      .then(data => {
        setCatalogTreatments(data);
      })
      .catch(err => {
        console.error('Error fetching treatment catalog:', err);
      });
  }, []);

  const allTreatments = useMemo(() => {
    const list = [...TREATMENTS.map(t => t.name)];
    catalogTreatments.forEach(t => {
      if (!list.includes(t.name)) {
        list.push(t.name);
      }
    });
    // Sort alphabetically
    return list.sort((a, b) => a.localeCompare(b));
  }, [catalogTreatments]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (!name.trim() || !whatsapp.trim() || !treatment) {
      setErrorMsg("Por favor, preencha todos os campos obrigatórios (*).");
      return;
    }

    setIsSubmitting(true);

    const newLead: Lead = {
      id: Math.random().toString(36).substring(2, 9),
      name: name.trim(),
      whatsapp: whatsapp.replace(/\D/g, ""), // only numbers
      treatment,
      message: message.trim() || `Interesse em agendamento para o procedimento de ${treatment}.`,
      date: new Date().toISOString(),
      status: "novo"
    };

    setTimeout(() => {
      onLeadCaptured(newLead);
      setIsSubmitting(false);
      setSubmitted(true);
      
      // Reset form variables
      setName("");
      setEmail("");
      setWhatsapp("");
      setTreatment("");
      setMessage("");
      if (onClearSelectedTreatment) onClearSelectedTreatment();
    }, 1200);
  };

  return (
    <section
      id="contato"
      className="py-24 bg-white relative border-t border-primary/10"
    >
      <div className="absolute bottom-12 right-0 w-80 h-80 rounded-full bg-primary/5 blur-[120px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Section Heading */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="text-[10px] tracking-[0.3em] text-primary uppercase font-bold block mb-3">
            Inicie sua Jornada de Beleza
          </span>
          <h2 className="text-3xl sm:text-4xl font-serif tracking-tight text-neutral leading-tight">
            Nossos Canais de <span className="text-gold-gradient italic">Atendimento & Localização</span>
          </h2>
          <div className="w-16 h-[1.5px] bg-primary/20 mx-auto mt-6" />
          <p className="text-neutral-muted text-xs sm:text-sm font-light mt-5 leading-relaxed">
            Tem dúvidas sobre algum procedimento ou deseja falar com nossa concierge para reservar seu horário? 
            Envie sua mensagem abaixo ou ligue diretamente para nossa central no WhatsApp.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          
          {/* Column Left: Information channels / Address details */}
          <div className="lg:col-span-4 space-y-8 flex flex-col justify-between">
            <div className="space-y-6">
              <h3 className="text-xl md:text-2xl font-serif text-neutral tracking-wide">
                Dra. Musa Estética de Elite
              </h3>
              <p className="text-xs text-neutral-muted font-light leading-relaxed">
                Um espaço sofisticado planejado nos mínimos detalhes para acolher você com conforto,
                máxima higiene e privacidade absoluta no coração de São Paulo/SP.
              </p>

              {/* Contact Channels List */}
              <div className="space-y-4">
                
                {/* Location */}
                <div className="flex items-start space-x-3 text-xs">
                  <MapPin className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-neutral uppercase tracking-wider text-[10px]">Nosso Endereço</p>
                    <p className="font-light mt-1 text-neutral-muted">
                      Av. das Musas, 900 — Jardim Paulista — São Paulo/SP — CEP 01400-000
                    </p>
                  </div>
                </div>

                {/* Operations Hours */}
                <div className="flex items-start space-x-3 text-xs">
                  <Clock className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-neutral uppercase tracking-wider text-[10px]">Horário de Atendimento</p>
                    <p className="font-light mt-1 text-neutral-muted">
                      Segunda à sexta: 9hrs às 11hrs / 14hrs às 20hrs<br />
                      Sábado: 8hrs às 13hrs
                    </p>
                  </div>
                </div>

                {/* Main WhatsApp */}
                <div className="flex items-start space-x-3 text-xs">
                  <Phone className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-neutral uppercase tracking-wider text-[10px]">Central de Agendamento</p>
                    <p className="font-semibold mt-1 text-primary">
                      (11) 90000-0000 (Concierge Clínica)
                    </p>
                  </div>
                </div>

                {/* Secondary email */}
                <div className="flex items-start space-x-3 text-xs">
                  <Mail className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-neutral uppercase tracking-wider text-[10px]">E-mail Corporativo</p>
                    <p className="font-light mt-1 text-neutral-muted">
                      contato@dramusaestetica.com.br
                    </p>
                  </div>
                </div>

              </div>
            </div>

            {/* Simulated Interactive Map */}
            <div className="relative w-full aspect-[16/10] border border-primary/10 rounded-md overflow-hidden bg-bg-luxe flex flex-col justify-center items-center text-center p-6 shadow-md">
              <div className="absolute inset-0 bg-cover bg-center opacity-10 filter grayscale pointer-events-none" style={{ backgroundImage: `url('https://images.unsplash.com/photo-1524661135-423995f22d0b?auto=format&fit=crop&q=80&w=600')` }} />
              <MapPin className="w-8 h-8 text-primary mb-2 animate-bounce" />
              <p className="text-xs uppercase tracking-widest font-bold text-neutral">Visualização de Mapa Ativa</p>
              <p className="text-[10px] text-neutral-muted mt-1 max-w-xs font-light">
                Ala comercial nobre do Jardim Paulista, estacionamento coberto com serviço de manobrista no local.
              </p>
              <a
                href="https://www.google.com/maps/search/?api=1&query=Av.+das+Musas%2C+900+-+Jardim+Paulista+-+S%C3%A3o+Paulo%2FSP+-+CEP+01400-000"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3.5 text-[10px] tracking-widest uppercase font-bold text-primary border border-primary/20 px-4 py-1.5 rounded hover:bg-primary/5 cursor-pointer"
              >
                Abrir no Google Maps
              </a>
            </div>

          </div>

          {/* Column Right: Interactive Contact Form */}
          <div className="lg:col-span-8">
            <div className="bg-bg-luxe border border-primary/10 rounded-lg p-6 md:p-8 shadow-lg relative">
              
              {submitted ? (
                <div className="text-center py-12 space-y-6 animate-fade-in">
                  <div className="inline-flex items-center justify-center bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 p-4 rounded-full">
                    <Check className="w-10 h-10" />
                  </div>
                  <h4 className="text-xl md:text-2xl font-serif text-neutral tracking-wide">
                    Sua mensagem foi enviada!
                  </h4>
                  <p className="text-neutral-muted font-light text-xs sm:text-sm max-w-md mx-auto leading-relaxed">
                    Agradecemos seu contato. Nossa equipe de concierge já recebeu suas informações e entrará em contato via WhatsApp nas próximas 2 horas para formalizar o agendamento da sua avaliação VIP de pele.
                  </p>
                  
                  {/* Shortcut button to speed up via WhatsApp link */}
                  <div className="pt-4 space-y-2">
                    <p className="text-[10px] uppercase text-neutral-muted tracking-wider font-bold">Deseja atendimento imediato?</p>
                    <a
                      href={`https://wa.me/5511900000000?text=${encodeURIComponent("Olá! Enviei meus dados no formulário estético e gostaria de antecipar o retorno da minha consulta VIP.")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center space-x-2 bg-primary hover:bg-primary-light text-white font-black uppercase text-xs tracking-widest px-6 py-3 rounded shadow-sm cursor-pointer"
                    >
                      <Calendar className="w-4 h-4" />
                      <span>Chamar no WhatsApp Concierge</span>
                    </a>
                  </div>

                  <button
                    onClick={() => setSubmitted(false)}
                    className="text-xs text-neutral-muted hover:text-neutral cursor-pointer block mx-auto pt-6 border-t border-primary/10 w-full"
                  >
                    Enviar outro formulário de contato
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="text-left animate-fade-in">
                    <h4 className="text-lg font-serif text-neutral tracking-wide">
                      Formulário de Pré-Agendamento
                    </h4>
                    <p className="text-xs text-neutral-muted font-light mt-1">
                      Preencha os dados e entraremos em contato o mais rápido possível para confirmar sua avaliação vip.
                    </p>
                  </div>

                  {errorMsg && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-3.5 rounded text-xs flex items-center space-x-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span>{errorMsg}</span>
                    </div>
                  )}

                  {/* Form fields Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    
                    {/* Name Input */}
                    <div className="space-y-1.5 col-span-1">
                      <label className="text-[10px] uppercase tracking-widest text-neutral-muted font-bold block">
                        Nome Completo *
                      </label>
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ex: Clara Silva"
                        className="w-full bg-white border border-primary/15 focus:border-primary rounded px-4 py-3 text-xs sm:text-sm text-neutral font-light focus:outline-none transition-colors"
                      />
                    </div>

                    {/* Email Input */}
                    <div className="space-y-1.5 col-span-1">
                      <label className="text-[10px] uppercase tracking-widest text-neutral-muted font-bold block">
                        E-mail de Contato
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Ex: clara@email.com"
                        className="w-full bg-white border border-primary/15 focus:border-primary rounded px-4 py-3 text-xs sm:text-sm text-neutral font-light focus:outline-none transition-colors"
                      />
                    </div>

                    {/* WhatsApp Input */}
                    <div className="space-y-1.5 col-span-1">
                      <label className="text-[10px] uppercase tracking-widest text-neutral-muted font-bold block">
                        WhatsApp (com DDD) *
                      </label>
                      <input
                        type="tel"
                        required
                        value={whatsapp}
                        onChange={(e) => setWhatsapp(e.target.value)}
                        placeholder="Ex: (15) 98888-8888"
                        className="w-full bg-white border border-primary/15 focus:border-primary rounded px-4 py-3 text-xs sm:text-sm text-neutral font-light focus:outline-none transition-colors"
                      />
                    </div>

                    {/* Selected Treatment dropdown */}
                    <div className="space-y-1.5 col-span-1">
                      <label className="text-[10px] uppercase tracking-widest text-neutral-muted font-bold block">
                        Procedimento de Interesse *
                      </label>
                      <div className="relative">
                        <select
                          required
                          value={treatment}
                          onChange={(e) => setTreatment(e.target.value)}
                          className="w-full bg-white border border-primary/15 focus:border-primary rounded px-4 py-3 pr-10 text-xs sm:text-sm text-neutral font-light focus:outline-none transition-colors appearance-none cursor-pointer"
                        >
                          <option value="" disabled className="text-neutral-muted">Selecione o procedimento</option>
                          {allTreatments.map((name) => (
                            <option key={name} value={name} className="bg-white text-neutral">
                              {name}
                            </option>
                          ))}
                        </select>
                        <span className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-neutral-muted">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </span>
                      </div>
                    </div>

                  </div>

                  {/* Message input */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase tracking-widest text-neutral-muted font-bold block">
                      Mensagem Adicional / Dúvida (Opcional)
                    </label>
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      rows={4}
                      placeholder="Fale um pouco sobre o que você gostaria de melhorar ou suas dúvidas..."
                      className="w-full bg-white border border-primary/15 focus:border-primary rounded px-4 py-3 text-xs sm:text-sm text-neutral font-light focus:outline-none transition-colors resize-none"
                    />
                  </div>

                  {/* Submission triggers */}
                  <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex-1 bg-primary hover:bg-primary-light text-white text-xs font-black uppercase tracking-widest py-4 rounded-sm shadow-md hover:scale-101 active:scale-99 transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
                    >
                      {isSubmitting ? (
                        <span>Enviando dados...</span>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          <span>Solicitar Orçamento VIP</span>
                        </>
                      )}
                    </button>
                    
                    <a
                      href={`https://wa.me/5511900000000?text=${encodeURIComponent("Olá! Gostaria de falar com a concierge sobre agendamentos na Dra. Musa Estética de Elite.")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-center bg-transparent border border-emerald-600/45 hover:bg-emerald-600/5 text-emerald-600 text-xs font-bold uppercase tracking-widest px-6 py-4 rounded-sm transition-all flex items-center justify-center space-x-2 cursor-pointer"
                    >
                      <span>Falar via WhatsApp Comercial</span>
                    </a>
                  </div>

                </form>
              )}

            </div>
          </div>

        </div>
      </div>
    </section>
  );
}

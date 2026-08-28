import { useState } from "react";
import { Lock } from "lucide-react";
import { motion } from "motion/react";
import ChatConsole from "../../components/ChatConsole";
import WhatsAppManager from "../../components/WhatsAppManager";
import { papelDoToken } from "../../lib/api";
import { useCrm } from "./contexto";

export default function Atendimento() {
  const crm = useCrm();
  const [visao, setVisao] = useState<"crm" | "evolution">("crm");
  const podeGerenciar = ["admin", "gerente"].includes(papelDoToken());

  const classeAba = (ativa: boolean) =>
    `px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all duration-300 ${
      ativa
        ? "bg-brand-brown text-brand-beige shadow-sm scale-102 font-bold"
        : "bg-brand-brown/5 text-brand-brown/85 hover:bg-brand-beige hover:text-brand-brown"
    }`;

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex justify-end space-x-2">
        <button onClick={() => setVisao("crm")} className={classeAba(visao === "crm")}>
          Atendimento CRM
        </button>
        <button onClick={() => setVisao("evolution")} className={classeAba(visao === "evolution")}>
          Gerenciador WhatsApp
        </button>
      </div>

      {visao === "crm" ? (
        <ChatConsole
          clients={crm.clients}
          leads={crm.leads}
          interactions={crm.interactions}
          onSendMessage={crm.onSendMessage}
          isAiConfigured={crm.isAiConfigured}
          onDeleteLead={crm.onDeleteLead}
          onRefreshData={() => crm.atualizar(true)}
        />
      ) : (
        <div className="relative flex-1 h-[calc(100vh-200px)] overflow-hidden">
          {/* O antigo <iframe> do Evolution Manager era cross-origin: os botoes de
              nova conversa e de envio nao funcionavam dentro do frame. O
              gerenciador e nativo e fala com a Evolution API pelo nosso backend. */}
          <div className={`w-full h-full ${podeGerenciar ? "" : "filter blur-md pointer-events-none select-none"}`}>
            <WhatsAppManager onMessageSent={() => crm.atualizar(true)} />
          </div>

          {!podeGerenciar && (
            <div className="absolute inset-0 bg-brand-brown/30 backdrop-blur-md flex items-center justify-center p-4 z-20">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-full max-w-md bg-white border border-red-200 shadow-2xl rounded-2xl p-6 md:p-8 text-center flex flex-col items-center justify-center space-y-5"
              >
                <div className="bg-red-50 text-red-600 p-3.5 rounded-full flex items-center justify-center shadow-inner">
                  <Lock className="h-7 w-7 text-red-600 animate-pulse" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-serif font-black text-red-600 tracking-wide uppercase">
                    Acesso restrito ao administrador
                  </h3>
                  <p className="text-xs text-brand-brown/70 leading-relaxed font-sans">
                    O Gerenciador de WhatsApp e de acesso exclusivo da Direcao e da Gerencia.
                  </p>
                </div>
                <p className="text-[11px] text-brand-brown/70 font-light leading-relaxed">
                  Peca a um administrador para liberar o seu acesso.
                </p>
              </motion.div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

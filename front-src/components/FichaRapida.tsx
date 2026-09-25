/**
 * A ficha da paciente sem sair da conversa (M6.2, 24/09).
 *
 * ===================================================== POR QUE ISTO EXISTE
 *
 * Pedido do bloco de Funil do PDF de 19/09: *"modal da paciente dentro do
 * Atendimento"*. A recepção está com a paciente do outro lado do WhatsApp
 * perguntando "quando é a minha próxima?" ou "quantas sessões faltam?", e para
 * responder precisava sair da tela, abrir Pacientes, procurar o nome, ler, e
 * voltar — perdendo a conversa aberta e, às vezes, a linha do que se ia dizer.
 *
 * ==================================== O QUE ESTA JANELA MOSTRA, E O QUE NÃO
 *
 * Ela responde as três perguntas que se fazem COM a paciente esperando:
 * quem é, o que está em andamento, e quando ela volta. Nada além disso.
 *
 * Em especial, **não mostra anamnese, laudo nem foto**. Não é esquecimento: é
 * a mesma linha da M5.2. Dado clínico sensível (LGPD art. 5º, II) não precisa
 * estar na tela de quem está respondendo mensagem — e uma tela de atendimento
 * fica aberta o dia inteiro, à vista de quem passa pelo balcão. Quem precisa do
 * prontuário abre o prontuário, que tem trilha de quem leu.
 *
 * O botão do rodapé leva à ficha completa em Pacientes, e é por lá que se
 * edita: esta janela é de LEITURA. Editar cadastro no meio de uma conversa é
 * como um campo salvo por engano nasce.
 */
import { useEffect, useState } from "react";
import { X, Phone, Mail, CalendarClock, ClipboardList, ExternalLink } from "lucide-react";
import type { Client, Treatment, TreatmentPlan } from "../types";

interface Compromisso {
  id: string;
  title?: string;
  startsAt?: string;
  status?: string;
  professionalName?: string;
}

const dataBr = (v?: string | null) => {
  if (!v) return "";
  const d = new Date(String(v).replace(" ", "T"));
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("pt-BR");
};

const dataHoraBr = (v?: string | null) => {
  if (!v) return "";
  const d = new Date(String(v).replace(" ", "T"));
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("pt-BR") + " às " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};

export default function FichaRapida({
  cliente, treatments, planos, aoFechar,
}: {
  cliente: Client;
  treatments: Treatment[];
  planos: TreatmentPlan[];
  aoFechar: () => void;
}) {
  const [futuros, setFuturos] = useState<Compromisso[] | null>(null);
  const [erroAgenda, setErroAgenda] = useState("");

  useEffect(() => {
    /* O filtro de data é do SERVIDOR (`from`), e não do navegador: a agenda de
       uma clínica com dois anos de uso tem milhares de linhas, e trazer tudo
       para descartar no `filter` é o tipo de lentidão que só aparece depois. */
    const hoje = new Date().toISOString().slice(0, 10);
    fetch("/api/appointments?clientId=" + encodeURIComponent(cliente.id) + "&from=" + hoje)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setFuturos(Array.isArray(d) ? d.slice(0, 4) : []))
      .catch(() => setErroAgenda("Não foi possível ler a agenda desta paciente agora."));
  }, [cliente.id]);

  const meus = treatments.filter((t) => t.clientId === cliente.id);
  const meusPlanos = planos.filter((p) => p.clientId === cliente.id);

  const restantes = (p: TreatmentPlan) => {
    const s = p.sessions || [];
    if (!s.length) return null;
    const feitas = s.filter((x) => x.status === "REALIZADA").length;
    return { feitas, total: p.totalSessions || s.length };
  };

  const bloco = "bg-white border border-brand-gold/15 rounded-xl p-4";
  const titulo = "text-[10px] uppercase tracking-widest text-brand-brown/55 font-bold mb-2";

  return (
    <div className="fixed inset-0 z-50 bg-brand-brown/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-brand-beige border border-brand-gold/25 rounded-2xl w-full max-w-2xl max-h-[88vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-brand-beige/95 backdrop-blur px-6 py-4 border-b border-brand-gold/20 flex items-start justify-between gap-4">
          <div>
            <h3 className="font-serif font-bold text-brand-brown text-lg leading-tight">{cliente.name}</h3>
            <p className="text-[10px] uppercase tracking-widest text-brand-brown/55 mt-0.5">
              Ficha rápida — paciente desde {dataBr(cliente.createdAt) || "—"}
            </p>
          </div>
          <button
            onClick={aoFechar}
            title="Fechar"
            className="p-1.5 rounded-lg hover:bg-brand-gold/10 text-brand-brown/70 cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className={bloco}>
            <p className={titulo}>Contato</p>
            <div className="space-y-1.5 text-xs text-brand-brown">
              <p className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-brand-gold" />
                <span className="font-mono">{cliente.phone || "sem telefone"}</span>
              </p>
              <p className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-brand-gold" />
                <span>{cliente.email || "sem e-mail"}</span>
              </p>
            </div>
          </div>

          <div className={bloco}>
            <p className={titulo}>Próximos horários</p>
            {erroAgenda ? (
              <p className="text-xs text-red-700">{erroAgenda}</p>
            ) : futuros === null ? (
              <p className="text-xs text-brand-brown/55">Consultando a agenda...</p>
            ) : futuros.length === 0 ? (
              /* A frase é afirmativa: "nenhum horário marcado" é uma resposta,
                 e é justamente a que faz a recepção oferecer um. Um espaço em
                 branco aqui seria lido como "ainda carregando". */
              <p className="text-xs text-brand-brown/65">Nenhum horário marcado daqui para a frente.</p>
            ) : (
              <ul className="space-y-1.5">
                {futuros.map((a) => (
                  <li key={a.id} className="flex items-start gap-2 text-xs text-brand-brown">
                    <CalendarClock className="h-3.5 w-3.5 text-brand-gold shrink-0 mt-0.5" />
                    <span>
                      <strong>{dataHoraBr(a.startsAt)}</strong>
                      {a.title ? " — " + a.title : ""}
                      {a.professionalName ? " · " + a.professionalName : ""}
                      {a.status && a.status !== "AGENDADO" ? " (" + a.status.toLowerCase() + ")" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={bloco}>
            <p className={titulo}>Planos de tratamento</p>
            {meusPlanos.length === 0 ? (
              <p className="text-xs text-brand-brown/65">Nenhum plano cadastrado.</p>
            ) : (
              <ul className="space-y-2">
                {meusPlanos.map((p) => {
                  const r = restantes(p);
                  return (
                    <li key={p.id} className="text-xs text-brand-brown flex items-start gap-2">
                      <ClipboardList className="h-3.5 w-3.5 text-brand-gold shrink-0 mt-0.5" />
                      <span>
                        <strong>{p.title}</strong>
                        <span className="text-brand-brown/60">
                          {" "}· {p.status.toLowerCase()}
                          {r ? " · " + r.feitas + " de " + r.total + " sessões realizadas" : ""}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className={bloco}>
            <p className={titulo}>Últimos procedimentos</p>
            {meus.length === 0 ? (
              <p className="text-xs text-brand-brown/65">Nenhum procedimento lançado.</p>
            ) : (
              <ul className="space-y-1.5">
                {meus
                  .slice()
                  .sort((a, b) => String(b.sessionDate || "").localeCompare(String(a.sessionDate || "")))
                  .slice(0, 5)
                  .map((t) => (
                    <li key={t.id} className="text-xs text-brand-brown">
                      <span className="font-mono text-brand-brown/55">{dataBr(t.sessionDate)}</span>{" "}
                      — {t.procedure}
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <a
            href={"/crm/pacientes?paciente=" + encodeURIComponent(cliente.id)}
            className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-brand-brown bg-brand-gold/10 hover:bg-brand-gold/20 border border-brand-gold/30 px-4 py-2.5 rounded-xl cursor-pointer"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Abrir a ficha completa
          </a>
        </div>
      </div>
    </div>
  );
}

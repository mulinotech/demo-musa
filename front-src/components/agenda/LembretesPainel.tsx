/**
 * Painel de lembretes automáticos (T1.5).
 *
 * A tela existe por causa de uma coisa só: **ligar isto manda mensagem para o
 * celular de gente de verdade, e não existe desfazer**. Então a ordem aqui é
 * deliberada — primeiro a prévia do que sairia, depois o botão de ligar. Um
 * interruptor sozinho, sem a lista ao lado, seria um convite a descobrir o
 * conteúdo da mensagem pelo retorno da paciente.
 *
 * A prévia é calculada pelo servidor com a mesma função que o worker usa. Se
 * fosse recalculada aqui, um dia as duas divergiriam e a lista mostraria uma
 * coisa enquanto o envio faria outra.
 */
import { useEffect, useState } from "react";
import { X, Send, AlertTriangle, Check, Clock } from "lucide-react";
import { motion } from "motion/react";
import { hora, dataBR } from "./comum";

interface ItemPrevia {
  id: string;
  titulo: string;
  paciente: string | null;
  telefone: string | null;
  quando: string;
  momentoDeEnvio: string | null;
  enviar: boolean;
  motivo: string | null;
  atrasadoMin: number;
  /** Etapa da régua que ESTE disparo é: 1 lembrete, 2 cobrança, 3 cancelamento. */
  etapa: number | null;
  /** Etapas que já saíram para este compromisso. */
  etapaFeita: number;
  /** `true` só na 3ª: este envio desmarca o horário. */
  cancela: boolean;
  mensagem?: string;
  enviado?: boolean;
  erro?: string;
}

interface Previa {
  ativo: boolean;
  avaliados: number;
  enviados: number;
  falhas: number;
  cancelados?: number;
  itens: ItemPrevia[];
  aviso?: string;
}

interface Config {
  /** Já leva a instância em conta: `ligadoNaConfiguracao && tem instância`.
   *  "Ligado" sem instância seria prometer um envio que não acontece. */
  ativo: boolean;
  /** O que a pessoa escolheu no interruptor, independente de haver WhatsApp. */
  ligadoNaConfiguracao: boolean;
  /** A instância de WhatsApp desta clínica, ou `null` — e `null` não é
   *  "use a padrão": é **não mande**. */
  instancia: string | null;
  template: string;
  /** 2ª mensagem: a cobrança, 2 h depois da 1ª. */
  templateCobranca: string;
  /** 3ª mensagem: o cancelamento, 4 h depois da 2ª. */
  templateCancelamento: string;
  antecedenciaH: number;
}

/* O NOME DE CADA ETAPA NA TELA.
 *
 * A terceira é escrita com o verbo no que ela faz — "cancela o horário" — e não
 * com um nome neutro como "3ª mensagem". Quem liga a régua precisa entender,
 * antes de clicar, que o sistema vai desmarcar paciente sozinho. */
const ETAPA = {
  1: { rotulo: "1ª · lembrete", cor: "bg-brand-gold/20 text-brand-brown" },
  2: { rotulo: "2ª · cobrança", cor: "bg-amber-100 text-amber-800" },
  3: { rotulo: "3ª · CANCELA o horário", cor: "bg-red-100 text-red-800" },
} as Record<number, { rotulo: string; cor: string }>;

export default function LembretesPainel(p: { aoFechar: () => void; aoMudar: () => void }) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [recado, setRecado] = useState("");

  const carregar = async () => {
    try {
      const [a, b] = await Promise.all([
        fetch("/api/appointments/reminders/settings").then((r) => r.json()),
        fetch("/api/appointments/reminders/preview").then((r) => r.json()),
      ]);
      if (a.error || b.error) return setErro(a.error || b.error);
      setCfg(a);
      setPrevia(b);
      setErro("");
    } catch {
      setErro("Não foi possível carregar a configuração de lembretes.");
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const salvar = async (mudanca: Partial<Config>) => {
    setOcupado(true);
    try {
      const r = await fetch("/api/appointments/reminders/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mudanca),
      });
      const d = await r.json();
      if (!r.ok) return setErro(d.error || "Não foi possível salvar.");
      setCfg(d);
      setErro("");
      setRecado(
        mudanca.ativo === true
          ? "Lembretes ligados. A partir de agora as mensagens saem sozinhas, a cada 15 minutos."
          : mudanca.ativo === false
            ? "Lembretes desligados. Nada mais sai automaticamente."
            : "Configuração salva.",
      );
      p.aoMudar();
    } finally {
      setOcupado(false);
    }
  };

  const enviarAgora = async () => {
    const quantos = fila.length;
    if (!window.confirm(
      "Enviar " + quantos + " lembrete(s) por WhatsApp agora?\n\n" +
      "As mensagens vão para os telefones cadastrados. Não há como desfazer.",
    )) return;
    setOcupado(true);
    try {
      const r = await fetch("/api/appointments/reminders/run", { method: "POST" });
      const d = await r.json();
      if (!r.ok) return setErro(d.error || "Falha ao enviar.");
      setRecado(d.enviados + " enviado(s)" + (d.falhas ? ", " + d.falhas + " falha(s)" : "") + ".");
      await carregar();
      p.aoMudar();
    } finally {
      setOcupado(false);
    }
  };

  const itens = previa?.itens || [];
  const fila = itens.filter((i) => i.enviar);
  const parados = itens.filter((i) => !i.enviar);

  const rotulo = "block text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold mb-1";
  const campo =
    "w-full bg-white border border-brand-gold/30 rounded px-3 py-2 text-xs text-brand-brown focus:outline-none focus:border-brand-brown transition-colors";

  return (
    <div className="fixed inset-0 z-[70] bg-brand-brown/40 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl bg-brand-beige rounded-2xl shadow-2xl border border-brand-gold/20 my-4"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-gold/20">
          <div>
            <h3 className="text-sm font-serif font-bold text-brand-brown uppercase tracking-wider">
              Lembrete automático
            </h3>
            <p className="text-[10px] text-brand-brown/60 mt-0.5">
              WhatsApp na véspera · régua de 3 mensagens — a 3ª cancela o horário
            </p>
          </div>
          <button onClick={p.aoFechar} className="p-2 rounded-full text-brand-brown/60 hover:bg-white cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {recado && (
            <div className="rounded-xl px-4 py-3 text-xs border bg-emerald-50 border-emerald-200 text-emerald-800 flex items-start gap-2">
              <Check className="h-4 w-4 shrink-0 mt-0.5" />
              <p>{recado}</p>
            </div>
          )}
          {erro && (
            <div className="rounded-xl px-4 py-3 text-xs border bg-red-50 border-red-200 text-red-700 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>{erro}</p>
            </div>
          )}

          {/* ============================ TRÊS ESTADOS, E NÃO DOIS
            *
            * Eram dois — Ligado e Desligado — e faltava o que a Silvia
            * encontrou em 10/09: **"não vejo qual instância está ligada"**.
            *
            * O terceiro estado é o que morde. Sem instância de WhatsApp, o
            * servidor devolve `ativo: false` mesmo com o interruptor ligado, de
            * propósito: "ligado" sem instância seria prometer um envio que não
            * acontece. Só que a tela mostrava isso como um "Desligado" comum —
            * então clicar em "Ligar" salvava a escolha e o rótulo continuava
            * dizendo Desligado, sem explicar por quê. Duas partes do sistema
            * discordando sobre se algo está ligado é pior do que qualquer uma
            * das duas estar errada.
            *
            * E o nome da instância aparece porque é a única coisa na tela que
            * responde "por qual número isso vai sair?". Mensagem enviada para
            * paciente real, pelo número do consultório errado, não tem desfazer. */}
          {cfg && !cfg.instancia && (
            <div className="rounded-xl border px-4 py-3 bg-amber-50 border-amber-200">
              <p className="text-xs font-bold text-brand-brown">Sem WhatsApp conectado</p>
              <p className="text-[11px] text-brand-brown/75 leading-relaxed mt-0.5">
                Nenhuma mensagem sai — não há por onde. O interruptor abaixo guarda a sua escolha, e
                os lembretes começam a sair sozinhos no momento em que o WhatsApp desta clínica for
                conectado, em <strong>Integração</strong>.
              </p>
              <button
                onClick={() => salvar({ ativo: !cfg.ligadoNaConfiguracao })}
                disabled={ocupado}
                className="mt-2.5 px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest cursor-pointer transition-colors disabled:opacity-50 bg-white border border-brand-gold/30 text-brand-brown/80 hover:border-brand-brown"
              >
                {cfg.ligadoNaConfiguracao ? "Deixar desligado" : "Deixar ligado para depois"}
              </button>
            </div>
          )}

          {cfg && cfg.instancia && (
            <div
              className={
                "rounded-xl border px-4 py-3 flex items-start justify-between gap-4 " +
                (cfg.ativo ? "bg-emerald-50 border-emerald-200" : "bg-white/70 border-brand-gold/20")
              }
            >
              <div>
                <p className="text-xs font-bold text-brand-brown">
                  {cfg.ativo ? "Ligado" : "Desligado"}
                </p>
                <p className="text-[11px] text-brand-brown/70 leading-relaxed mt-0.5">
                  {cfg.ativo
                    ? "As mensagens saem sozinhas, entre 08:00 e 20:00: a 1ª " +
                      cfg.antecedenciaH + " h antes do horário, a 2ª 2 h depois dela e a 3ª " +
                      "4 h depois da 2ª — e a 3ª cancela o horário."
                    : "Nenhuma mensagem sai sozinha. A lista abaixo mostra o que sairia se você ligar."}
                </p>
                <p className="text-[10px] text-brand-brown/55 mt-1.5">
                  Sai pelo WhatsApp <strong className="font-mono">{cfg.instancia}</strong>
                </p>
              </div>
              <button
                onClick={() => salvar({ ativo: !cfg.ativo })}
                disabled={ocupado}
                className={
                  "shrink-0 px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest cursor-pointer transition-colors disabled:opacity-50 " +
                  (cfg.ativo
                    ? "bg-white border border-brand-gold/30 text-brand-brown/80 hover:border-brand-brown"
                    : "bg-brand-brown text-brand-beige hover:bg-brand-brown/95")
                }
              >
                {cfg.ativo ? "Desligar" : "Ligar"}
              </button>
            </div>
          )}

          {cfg && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className={rotulo}>Antecedência (h)</label>
                <input
                  type="number"
                  min={1}
                  max={168}
                  className={campo}
                  defaultValue={cfg.antecedenciaH}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v && v !== cfg.antecedenciaH) salvar({ antecedenciaH: v });
                  }}
                />
              </div>
              <div className="md:col-span-3">
                <label className={rotulo}>Texto da mensagem</label>
                <textarea
                  className={campo}
                  rows={3}
                  defaultValue={cfg.template}
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value !== cfg.template) salvar({ template: e.target.value });
                  }}
                />
                <p className="text-[10px] text-brand-brown/50 mt-1">
                  Variáveis: {"{paciente} {procedimento} {data} {hora} {profissional}"}
                </p>
              </div>

              {/* A 2ª e a 3ª mensagem ficam ABAIXO e na ordem em que saem. A
                  régua é uma sequência; empilhar os três textos fora de ordem
                  faria a clínica editar a cobrança achando que é o lembrete. */}
              <div className="md:col-span-4">
                <label className={rotulo}>2ª mensagem · 2 h depois, se não responder</label>
                <textarea
                  className={campo}
                  rows={3}
                  defaultValue={cfg.templateCobranca}
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value !== cfg.templateCobranca)
                      salvar({ templateCobranca: e.target.value });
                  }}
                />
              </div>

              <div className="md:col-span-4">
                <label className={rotulo}>
                  3ª mensagem · 4 h depois da 2ª — <span className="text-red-700">cancela o horário</span>
                </label>
                <textarea
                  className={campo}
                  rows={3}
                  defaultValue={cfg.templateCancelamento}
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value !== cfg.templateCancelamento)
                      salvar({ templateCancelamento: e.target.value });
                  }}
                />
                <p className="text-[10px] text-red-700/80 mt-1 leading-relaxed">
                  Esta é a única mensagem que muda a agenda: o horário passa a
                  CANCELADO antes de o texto sair. Qualquer resposta da paciente
                  — mesmo uma que o sistema não entenda — para a régua antes disso.
                </p>
              </div>
            </div>
          )}

          <div className="pt-3 border-t border-brand-gold/20">
            <p className={rotulo}>
              Sairia agora {fila.length > 0 && <span className="text-brand-brown">· {fila.length}</span>}
            </p>
            {fila.length === 0 ? (
              <p className="text-[11px] text-brand-brown/60">
                Nenhum lembrete pronto neste momento. Um lembrete só entra na fila quando falta
                menos que a antecedência configurada para o horário.
              </p>
            ) : (
              <div className="space-y-2">
                {fila.map((i) => (
                  <div key={i.id} className="bg-white/80 border border-brand-gold/20 rounded-xl px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-brand-brown">
                        {i.paciente || "sem paciente"} · {i.titulo}
                        {i.etapa && ETAPA[i.etapa] && (
                          <span
                            className={
                              "ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide " +
                              ETAPA[i.etapa].cor
                            }
                          >
                            {ETAPA[i.etapa].rotulo}
                          </span>
                        )}
                      </p>
                      <span className="text-[10px] font-mono text-brand-brown/60 shrink-0">
                        {dataBR(i.quando)} {hora(i.quando)}
                      </span>
                    </div>
                    {i.atrasadoMin > 0 && (
                      <p className="text-[10px] text-amber-700 mt-1 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        atrasado {Math.round(i.atrasadoMin / 60)} h — o disparo automático esteve parado
                      </p>
                    )}
                    {i.mensagem && (
                      <p className="text-[11px] text-brand-brown/70 mt-1.5 whitespace-pre-line leading-relaxed border-l-2 border-brand-gold/30 pl-2">
                        {i.mensagem}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {parados.length > 0 && (
            <div>
              <p className={rotulo}>Não sairia, e por quê</p>
              <div className="space-y-1">
                {parados.slice(0, 8).map((i) => (
                  <div key={i.id} className="flex items-center justify-between gap-2 text-[11px] text-brand-brown/70">
                    <span className="truncate">
                      {i.paciente || "sem paciente"} · {i.titulo}
                    </span>
                    <span className="shrink-0 text-brand-brown/50">{i.motivo}</span>
                  </div>
                ))}
                {parados.length > 8 && (
                  <p className="text-[10px] text-brand-brown/40">e mais {parados.length - 8}</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-t border-brand-gold/20">
          <p className="text-[10px] text-brand-brown/50 max-w-xs leading-relaxed">
            Responder <strong>1</strong> confirma o horário; <strong>2</strong> sinaliza pedido de
            remarcação — o sistema não remarca sozinho.
          </p>
          <div className="flex items-center gap-2">
            <button onClick={p.aoFechar} className="px-4 py-2 rounded-xl text-[11px] font-semibold text-brand-brown/70 hover:bg-white cursor-pointer">
              Fechar
            </button>
            <button
              onClick={enviarAgora}
              disabled={ocupado || fila.length === 0}
              className="flex items-center gap-1.5 bg-brand-brown hover:bg-brand-brown/95 disabled:opacity-40 text-brand-beige px-5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest cursor-pointer transition-colors"
            >
              <Send className="h-3.5 w-3.5" />
              {ocupado ? "Enviando..." : "Enviar agora"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}



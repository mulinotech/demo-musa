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
  mensagem?: string;
  enviado?: boolean;
  erro?: string;
}

interface Previa {
  ativo: boolean;
  avaliados: number;
  enviados: number;
  falhas: number;
  itens: ItemPrevia[];
  aviso?: string;
}

interface Config {
  ativo: boolean;
  template: string;
  antecedenciaH: number;
}

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
              WhatsApp na véspera · confirmação pela resposta da paciente
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

          {cfg && (
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
                    ? "As mensagens saem sozinhas, " + cfg.antecedenciaH + " h antes de cada horário, entre 08:00 e 20:00."
                    : "Nenhuma mensagem sai sozinha. A lista abaixo mostra o que sairia se você ligar."}
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



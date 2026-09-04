/**
 * Modal de agendamento (T1.3).
 *
 * Criar, editar, remarcar e mudar status. Remarcar tem botão próprio de
 * propósito: **remarcar não é editar a data**. O servidor cria um compromisso
 * novo apontando para o antigo e cancela o antigo, porque o histórico de
 * remarcação é o número que diz à clínica quem remarca demais — e editar a data
 * no lugar apaga essa informação para sempre.
 *
 * O conflito de horário é decidido no servidor, nunca aqui. Esta tela só mostra
 * o que ele respondeu.
 */
import { useEffect, useState } from "react";
import { X, Trash2, CalendarClock, Check, AlertTriangle, RotateCcw, Award } from "lucide-react";
import { motion } from "motion/react";
import { Compromisso, Profissional, StatusAgenda, ESTILO_STATUS, iso, hora, reais } from "./comum";
import { papelDoToken } from "../../lib/api";
import ResgateModal from "../fidelidade/ResgateModal";
import ClienteFidelidadeCard from "../fidelidade/ClienteFidelidadeCard";
import AlertasClinicos from "../documentos/AlertasClinicos";

interface Servico {
  id: string;
  name: string;
  price: number;
  duration_min: number | null;
}

interface Paciente {
  id: string;
  name: string;
}

interface Props {
  compromisso: Compromisso | null;
  dataPadrao: string;
  horaPadrao?: string;
  profissionalPadrao?: string;
  profissionais: Profissional[];
  servicos: Servico[];
  pacientes: Paciente[];
  aoFechar: () => void;
  aoSalvar: () => void;
}

const STATUS_POSSIVEIS: StatusAgenda[] = ["AGENDADO", "CONFIRMADO", "REALIZADO", "FALTOU", "CANCELADO"];

export default function AppointmentModal(p: Props) {
  const editando = !!p.compromisso;
  const [erro, setErro] = useState("");
  const [conflito, setConflito] = useState<{ title: string; startsAt: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [remarcando, setRemarcando] = useState(false);
  const [recado, setRecado] = useState("");
  const [resgatando, setResgatando] = useState(false);

  // Concluído é diferente de "status REALIZADO": é o carimbo de que os efeitos
  // (receita, e adiante estoque e pontos) já foram aplicados. Sair daí não é
  // trocar de status, é estornar — e tem caminho próprio, com motivo.
  const concluido = !!p.compromisso?.completedAt;
  const papel = papelDoToken();
  const podeEstornar = papel === "admin" || papel === "gerente";

  const [f, setF] = useState({
    kind: "ATENDIMENTO" as "ATENDIMENTO" | "BLOQUEIO",
    clientId: "",
    catalogId: "",
    professionalId: p.profissionalPadrao || (p.profissionais[0]?.id ?? ""),
    title: "",
    data: p.dataPadrao,
    inicio: p.horaPadrao || "09:00",
    fim: "10:00",
    room: "",
    price: "",
    notes: "",
  });

  useEffect(() => {
    const c = p.compromisso;
    if (!c) return;
    setF({
      kind: c.kind,
      clientId: c.clientId || "",
      catalogId: c.catalogId || "",
      professionalId: c.professionalId,
      title: c.title,
      data: iso(new Date(String(c.startsAt).replace(" ", "T"))),
      inicio: hora(c.startsAt),
      fim: hora(c.endsAt),
      room: c.room || "",
      price: c.price === null ? "" : String(c.price),
      notes: c.notes || "",
    });
  }, [p.compromisso]);

  /** Escolher um serviço preenche duração e preço — é o atalho que faz a
   *  recepção marcar em segundos em vez de digitar tudo. */
  const escolherServico = (id: string) => {
    const s = p.servicos.find((x) => x.id === id);
    if (!s) return setF({ ...f, catalogId: "" });
    const minutos = s.duration_min || 60;
    const [h, m] = f.inicio.split(":").map(Number);
    const fim = new Date(2000, 0, 1, h, m + minutos);
    setF({
      ...f,
      catalogId: id,
      title: s.name,
      price: String(s.price),
      fim: String(fim.getHours()).padStart(2, "0") + ":" + String(fim.getMinutes()).padStart(2, "0"),
    });
  };

  const corpo = () => ({
    kind: f.kind,
    clientId: f.kind === "BLOQUEIO" ? null : f.clientId || null,
    catalogId: f.kind === "BLOQUEIO" ? null : f.catalogId || null,
    professionalId: f.professionalId,
    title: f.title.trim(),
    startsAt: f.data + " " + f.inicio + ":00",
    endsAt: f.data + " " + f.fim + ":00",
    room: f.room || null,
    price: f.price === "" ? null : Number(String(f.price).replace(",", ".")),
    notes: f.notes || null,
  });

  /** Devolve o corpo da resposta quando deu certo, ou null quando não deu —
   *  quem conclui atendimento precisa do que o servidor respondeu, não só de
   *  um "ok". */
  const tratarComCorpo = async (r: Response): Promise<any | null> => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErro(d.error || "Não foi possível salvar.");
      setConflito(d.conflito || null);
      return null;
    }
    setErro("");
    setConflito(null);
    return d || {};
  };

  const tratar = async (r: Response) => (await tratarComCorpo(r)) !== null;

  const salvar = async () => {
    if (f.kind === "ATENDIMENTO" && !f.clientId && !f.title.trim()) {
      return setErro("Escolha o paciente ou dê um título ao compromisso.");
    }
    setSalvando(true);
    try {
      const r = editando
        ? await fetch("/api/appointments/" + p.compromisso!.id, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(corpo()),
          })
        : await fetch("/api/appointments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(corpo()),
          });
      if (await tratar(r)) {
        p.aoSalvar();
        p.aoFechar();
      }
    } finally {
      setSalvando(false);
    }
  };

  const remarcar = async () => {
    setSalvando(true);
    try {
      const r = await fetch("/api/appointments/" + p.compromisso!.id + "/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startsAt: f.data + " " + f.inicio + ":00",
          endsAt: f.data + " " + f.fim + ":00",
          professionalId: f.professionalId,
        }),
      });
      if (await tratar(r)) {
        p.aoSalvar();
        p.aoFechar();
      }
    } finally {
      setSalvando(false);
    }
  };

  const mudarStatus = async (status: StatusAgenda) => {
    let reason: string | null = null;
    if (status === "CANCELADO") {
      reason = window.prompt("Motivo do cancelamento (opcional):") || null;
    }
    const r = await fetch("/api/appointments/" + p.compromisso!.id + "/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, reason }),
    });
    const resp = await tratarComCorpo(r);
    if (!resp) return;

    // Concluir dispara receita (e, mais adiante, baixa de estoque e pontos).
    // A tela precisa DIZER o que aconteceu: efeito colateral silencioso em
    // dinheiro é como a pessoa perde a confiança no sistema.
    const fin = resp.efeitos?.financeiro;
    if (status === "REALIZADO" && fin?.lancado) {
      setRecado("Atendimento concluído. Receita de " + reais(fin.valor) + " lançada a receber.");
      p.aoSalvar();
      return;
    }
    p.aoSalvar();
    p.aoFechar();
  };

  /** Desfazer a conclusão estorna dinheiro. Motivo obrigatório, e o estorno é
   *  lançamento novo — o erro continua visível no histórico, ao lado da
   *  correção. É isso que permite auditar uma divergência de saldo depois. */
  const desfazerConclusao = async () => {
    const motivo = window.prompt(
      "Por que esta conclusão está sendo desfeita?\n\n" +
        "A receita lançada será estornada com um lançamento de correção.",
    );
    if (!motivo || !motivo.trim()) return;
    const r = await fetch("/api/appointments/" + p.compromisso!.id + "/reopen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: motivo }),
    });
    const resp = await tratarComCorpo(r);
    if (!resp) return;
    const est = resp.efeitos?.financeiro;
    setRecado(
      est?.estornado
        ? "Conclusão desfeita. Estorno de " + reais(est.valor) + " lançado no financeiro."
        : "Conclusão desfeita. Não havia receita lançada para estornar.",
    );
    p.aoSalvar();
  };

  const apagar = async () => {
    if (!window.confirm("Remover este bloqueio da agenda?")) return;
    const r = await fetch("/api/appointments/" + p.compromisso!.id, { method: "DELETE" });
    if (await tratar(r)) {
      p.aoSalvar();
      p.aoFechar();
    }
  };

  const campo =
    "w-full bg-white border border-brand-gold/30 rounded px-3 py-2 text-xs text-brand-brown focus:outline-none focus:border-brand-brown transition-colors";
  const rotulo = "block text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold mb-1";

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
              {editando ? "Compromisso" : "Novo compromisso"}
            </h3>
            {editando && (
              <p className="text-[10px] text-brand-brown/60 mt-0.5">
                {ESTILO_STATUS[p.compromisso!.status].rotulo}
                {p.compromisso!.rescheduledFrom ? " · remarcado de outro horário" : ""}
              </p>
            )}
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
              <div>
                <p>{erro}</p>
                {conflito && (
                  <p className="text-[11px] mt-1 opacity-80">
                    Conflita com "{conflito.title}" às {hora(conflito.startsAt)}.
                  </p>
                )}
              </div>
            </div>
          )}

          {!editando && (
            <div className="flex items-center gap-1 bg-white/70 p-1 rounded-xl w-fit">
              {(["ATENDIMENTO", "BLOQUEIO"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setF({ ...f, kind: k, title: k === "BLOQUEIO" ? "Horário bloqueado" : "" })}
                  className={
                    "px-4 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer " +
                    (f.kind === k ? "bg-brand-brown text-brand-beige shadow-sm" : "text-brand-brown/70 hover:bg-white")
                  }
                >
                  {k === "ATENDIMENTO" ? "Atendimento" : "Bloqueio"}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {f.kind === "ATENDIMENTO" && (
              <>
                <div>
                  <label className={rotulo}>Paciente</label>
                  <select className={campo} value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })}>
                    <option value="">— sem paciente vinculado —</option>
                    {p.pacientes.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={rotulo}>Procedimento</label>
                  <select className={campo} value={f.catalogId} onChange={(e) => escolherServico(e.target.value)}>
                    <option value="">— avulso —</option>
                    {p.servicos.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.duration_min ? ` · ${s.duration_min} min` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div className={f.kind === "BLOQUEIO" ? "md:col-span-2" : "md:col-span-2"}>
              <label className={rotulo}>{f.kind === "BLOQUEIO" ? "Motivo do bloqueio" : "Título"}</label>
              <input
                className={campo}
                value={f.title}
                onChange={(e) => setF({ ...f, title: e.target.value })}
                placeholder={f.kind === "BLOQUEIO" ? "Almoço, congresso, folga..." : "Preenchido pelo procedimento"}
              />
            </div>

            <div>
              <label className={rotulo}>Profissional</label>
              <select className={campo} value={f.professionalId} onChange={(e) => setF({ ...f, professionalId: e.target.value })}>
                {p.profissionais.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={rotulo}>Data</label>
              <input type="date" className={campo} value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
            </div>
            <div>
              <label className={rotulo}>Início</label>
              <input type="time" step={900} className={campo} value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} />
            </div>
            <div>
              <label className={rotulo}>Fim</label>
              <input type="time" step={900} className={campo} value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} />
            </div>

            {f.kind === "ATENDIMENTO" && (
              <>
                <div>
                  <label className={rotulo}>Sala</label>
                  <input className={campo} value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })} />
                </div>
                <div>
                  <label className={rotulo}>Valor</label>
                  <input className={campo} inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
                  <p className="text-[10px] text-brand-brown/50 mt-1">
                    copiado do catálogo; mudar o preço lá não altera este
                  </p>
                </div>
              </>
            )}

            <div className="md:col-span-2">
              <label className={rotulo}>Observação</label>
              <textarea className={campo} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
            </div>
          </div>

          {editando && (
            <div className="pt-3 border-t border-brand-gold/20 space-y-3">
              <div>
                <p className={rotulo}>Situação</p>
                <div className="flex flex-wrap gap-2">
                  {STATUS_POSSIVEIS.map((s) => {
                    const atual = p.compromisso!.status === s;
                    // Depois de concluído, trocar de status pelo botão sairia
                    // deixando a receita lançada para trás. O caminho é desfazer.
                    const travado = concluido && !atual;
                    return (
                      <button
                        key={s}
                        onClick={() => mudarStatus(s)}
                        disabled={atual || travado}
                        title={travado ? "Atendimento concluído. Desfaça a conclusão para mudar." : undefined}
                        className={
                          "px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-all disabled:cursor-default " +
                          (atual
                            ? ESTILO_STATUS[s].caixa + " " + ESTILO_STATUS[s].texto + " disabled:opacity-100"
                            : travado
                              ? "bg-white border-brand-gold/20 text-brand-brown/30"
                              : "bg-white border-brand-gold/30 text-brand-brown/70 hover:border-brand-brown cursor-pointer")
                        }
                      >
                        {atual && <Check className="h-3 w-3 inline mr-1" />}
                        {ESTILO_STATUS[s].rotulo}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Contraindicação vem ANTES de qualquer outra coisa do paciente.
                  Este é o lugar onde a profissional está segundos antes de
                  aplicar o produto — se o aviso não aparece aqui, a anamnese
                  virou papel guardado. */}
              {p.compromisso!.clientId && p.compromisso!.kind === "ATENDIMENTO" && (
                <AlertasClinicos clientId={p.compromisso!.clientId!} />
              )}

              {/* Saldo de pontos do paciente. Fica aqui, no compromisso, porque
                  e onde a recepcao esta quando a paciente pergunta -- e onde ela
                  lembra de OFERECER. Programa de pontos que a equipe nao
                  menciona nao muda comportamento nenhum. */}
              {p.compromisso!.clientId && p.compromisso!.kind === "ATENDIMENTO" && (
                <div className="space-y-2">
                  <ClienteFidelidadeCard
                    clientId={p.compromisso!.clientId!}
                    nomeDoPaciente={p.compromisso!.clientName || undefined}
                    podeAjustar={false}
                    compacto
                  />
                  {!concluido && (
                    <button
                      onClick={() => setResgatando(true)}
                      className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-brown/80 border border-brand-gold/30 rounded-xl px-3 py-2 hover:border-brand-brown cursor-pointer"
                    >
                      <Award className="h-3.5 w-3.5 text-brand-gold" />
                      Resgatar pontos neste atendimento
                    </button>
                  )}
                </div>
              )}

              {concluido && (
                <p className="text-[11px] text-brand-brown/70 bg-white/70 border border-brand-gold/20 rounded px-3 py-2 leading-relaxed">
                  Atendimento concluído — a receita já foi lançada no financeiro, a receber.
                  {podeEstornar
                    ? " Para corrigir, use “Desfazer conclusão”: o valor é estornado com um lançamento novo, e os dois ficam no histórico."
                    : " Só admin ou gerente pode desfazer, porque o estorno mexe em dinheiro."}
                </p>
              )}

              {remarcando && (
                <p className="text-[11px] text-brand-brown/70 bg-white/70 border border-brand-gold/20 rounded px-3 py-2 leading-relaxed">
                  Remarcar cria um compromisso novo no horário acima e cancela este, com o motivo
                  "Reagendado". O histórico de remarcação fica — é assim que a clínica descobre quem
                  remarca demais.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-t border-brand-gold/20">
          <div className="flex items-center gap-2">
            {editando && p.compromisso!.kind === "BLOQUEIO" && (
              <button
                onClick={apagar}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold text-red-600 hover:bg-red-50 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remover bloqueio
              </button>
            )}
            {editando && concluido && podeEstornar && (
              <button
                onClick={desfazerConclusao}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold text-amber-700 hover:bg-amber-50 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Desfazer conclusão
              </button>
            )}
            {editando && !concluido && p.compromisso!.status !== "REALIZADO" && (
              <button
                onClick={() => (remarcando ? remarcar() : setRemarcando(true))}
                disabled={salvando}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold text-brand-brown/80 hover:bg-white cursor-pointer"
              >
                <CalendarClock className="h-3.5 w-3.5" />
                {remarcando ? "Confirmar remarcação" : "Remarcar"}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {f.price !== "" && f.kind === "ATENDIMENTO" && (
              <span className="text-xs font-mono text-brand-brown/70 mr-2">{reais(Number(String(f.price).replace(",", ".")))}</span>
            )}
            <button onClick={p.aoFechar} className="px-4 py-2 rounded-xl text-[11px] font-semibold text-brand-brown/70 hover:bg-white cursor-pointer">
              Cancelar
            </button>
            <button
              onClick={salvar}
              disabled={salvando || remarcando}
              className="bg-brand-brown hover:bg-brand-brown/95 disabled:opacity-50 text-brand-beige px-5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest cursor-pointer transition-colors"
            >
              {salvando ? "Salvando..." : editando ? "Salvar" : "Agendar"}
            </button>
          </div>
        </div>
      </motion.div>

      {resgatando && p.compromisso?.clientId && (
        <ResgateModal
          compromissoId={p.compromisso.id}
          clientId={p.compromisso.clientId}
          precoAtual={p.compromisso.price}
          aoFechar={() => setResgatando(false)}
          aoAplicar={() => {
            setRecado("Resgate aplicado. O preço do atendimento foi descontado — o acúmulo vai cair sobre o novo valor.");
            p.aoSalvar();
          }}
        />
      )}
    </div>
  );
}

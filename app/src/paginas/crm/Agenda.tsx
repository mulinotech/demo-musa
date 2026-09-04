/**
 * Agenda — rota /crm/agenda (T1.3).
 *
 * É onde a recepção vive o dia inteiro, então a tela abre no dia de hoje e o
 * caminho mais curto — clicar num espaço vazio e agendar — tem dois cliques.
 *
 * Não há arrastar-e-soltar de propósito. É bonito, custa dois a três dias e
 * traz bug de fuso e de precisão de pixel que não se paga agora; remarcar é
 * pelo modal, que além de tudo preserva o histórico de remarcação.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, CalendarDays, RefreshCw, MessageCircle } from "lucide-react";
import Grade, { GradeMes } from "../../components/agenda/Grade";
import AppointmentModal from "../../components/agenda/AppointmentModal";
import LembretesPainel from "../../components/agenda/LembretesPainel";
import {
  Compromisso, Profissional, iso, somarDias, inicioDaSemana, SEMANA, SEMANA_CURTA, ESTILO_STATUS,
} from "../../components/agenda/comum";
import { papelDoToken } from "../../lib/api";

type Visao = "dia" | "semana" | "mes";

export default function Agenda() {
  const [visao, setVisao] = useState<Visao>("dia");
  const [referencia, setReferencia] = useState(new Date());
  const [compromissos, setCompromissos] = useState<Compromisso[]>([]);
  const [profissionais, setProfissionais] = useState<Profissional[]>([]);
  const [servicos, setServicos] = useState<any[]>([]);
  const [pacientes, setPacientes] = useState<any[]>([]);
  const [filtroProf, setFiltroProf] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [modal, setModal] = useState<{
    compromisso: Compromisso | null; data: string; hora?: string; professionalId?: string;
  } | null>(null);
  const [lembretes, setLembretes] = useState(false);

  const papel = papelDoToken();
  const podeVerTodos = papel === "admin" || papel === "gerente";

  /** Janela buscada do servidor, mais folga de um dia dos dois lados. */
  const janela = useMemo(() => {
    if (visao === "dia") return { de: iso(somarDias(referencia, -1)), ate: iso(somarDias(referencia, 1)) };
    if (visao === "semana") {
      const i = inicioDaSemana(referencia);
      return { de: iso(somarDias(i, -1)), ate: iso(somarDias(i, 7)) };
    }
    const p = new Date(referencia.getFullYear(), referencia.getMonth(), 1);
    return { de: iso(somarDias(p, -7)), ate: iso(somarDias(new Date(referencia.getFullYear(), referencia.getMonth() + 1, 0), 7)) };
  }, [visao, referencia]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const q = new URLSearchParams({ from: janela.de, to: janela.ate });
      if (filtroProf) q.set("professionalId", filtroProf);
      const r = await fetch("/api/appointments?" + q.toString());
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        setErro(e.error || "Não foi possível carregar a agenda.");
        return;
      }
      setErro("");
      setCompromissos(await r.json());
    } catch {
      setErro("Erro de conexão ao carregar a agenda.");
    } finally {
      setCarregando(false);
    }
  }, [janela, filtroProf]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    (async () => {
      try {
        const [u, s, c] = await Promise.all([
          fetch("/api/users"),
          fetch("/api/treatment-catalog"),
          fetch("/api/clients"),
        ]);
        if (u.ok) {
          const lista = await u.json();
          setProfissionais(lista.filter((x: any) => x.status === "active"));
        }
        if (s.ok) setServicos(await s.json());
        if (c.ok) setPacientes(await c.json());
      } catch {
        /* a agenda funciona sem as listas auxiliares */
      }
    })();
  }, []);

  const andar = (n: number) => {
    if (visao === "dia") return setReferencia(somarDias(referencia, n));
    if (visao === "semana") return setReferencia(somarDias(referencia, n * 7));
    setReferencia(new Date(referencia.getFullYear(), referencia.getMonth() + n, 1));
  };

  const titulo = () => {
    if (visao === "dia") {
      return SEMANA[referencia.getDay()] + ", " + referencia.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
    }
    if (visao === "semana") {
      const i = inicioDaSemana(referencia);
      const f = somarDias(i, 6);
      return i.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) + " – " +
             f.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
    }
    return referencia.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  };

  /** Colunas por profissional no dia; por dia na semana. */
  const colunas = useMemo(() => {
    if (visao === "dia") {
      const lista = filtroProf ? profissionais.filter((p) => p.id === filtroProf) : profissionais;
      const base = lista.length ? lista : [{ id: "", name: "Agenda", role: "" } as Profissional];
      return base.map((p) => ({
        chave: p.id, titulo: p.name, data: iso(referencia), professionalId: p.id,
      }));
    }
    const i = inicioDaSemana(referencia);
    const hoje = iso(new Date());
    return Array.from({ length: 7 }, (_, n) => {
      const d = somarDias(i, n);
      return {
        chave: iso(d),
        titulo: SEMANA_CURTA[d.getDay()],
        subtitulo: String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0"),
        destaque: iso(d) === hoje,
        data: iso(d),
        professionalId: filtroProf || undefined,
      };
    });
  }, [visao, referencia, profissionais, filtroProf]);

  const doPeriodo = useMemo(() => {
    if (visao === "dia") return compromissos.filter((c) => c.startsAt.slice(0, 10) === iso(referencia));
    if (visao === "semana") {
      const i = iso(inicioDaSemana(referencia));
      const f = iso(somarDias(inicioDaSemana(referencia), 6));
      return compromissos.filter((c) => c.startsAt.slice(0, 10) >= i && c.startsAt.slice(0, 10) <= f);
    }
    return compromissos;
  }, [compromissos, visao, referencia]);

  const resumo = useMemo(() => {
    const ativos = doPeriodo.filter((c) => c.status !== "CANCELADO" && c.kind === "ATENDIMENTO");
    return {
      total: ativos.length,
      confirmados: ativos.filter((c) => c.status === "CONFIRMADO").length,
      aConfirmar: ativos.filter((c) => c.status === "AGENDADO").length,
    };
  }, [doPeriodo]);

  const botao = "px-3 py-2 rounded-xl text-[11px] font-semibold transition-all cursor-pointer";

  return (
    <div className="space-y-4">
      <div className="bg-white border border-brand-gold/15 rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => andar(-1)} className="p-2 rounded-lg text-brand-brown/60 hover:bg-brand-beige cursor-pointer">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="min-w-[13rem]">
            <h3 className="text-sm font-serif font-bold text-brand-brown capitalize">{titulo()}</h3>
            <p className="text-[10px] text-brand-brown/60">
              {resumo.total} atendimento{resumo.total === 1 ? "" : "s"}
              {resumo.aConfirmar > 0 && ` · ${resumo.aConfirmar} a confirmar`}
            </p>
          </div>
          <button onClick={() => andar(1)} className="p-2 rounded-lg text-brand-brown/60 hover:bg-brand-beige cursor-pointer">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => setReferencia(new Date())}
            className={botao + " text-brand-brown/75 hover:bg-brand-beige"}
          >
            Hoje
          </button>
          {carregando && <RefreshCw className="h-3.5 w-3.5 text-brand-gold animate-spin" />}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {podeVerTodos && profissionais.length > 1 && (
            <select
              value={filtroProf}
              onChange={(e) => setFiltroProf(e.target.value)}
              className="bg-white border border-brand-gold/30 rounded px-2.5 py-1.5 text-xs text-brand-brown focus:outline-none focus:border-brand-brown cursor-pointer"
            >
              <option value="">Todos os profissionais</option>
              {profissionais.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-1 bg-brand-beige/60 p-1 rounded-xl">
            {(["dia", "semana", "mes"] as Visao[]).map((v) => (
              <button
                key={v}
                onClick={() => setVisao(v)}
                className={
                  "px-3 py-1.5 rounded-lg text-[11px] font-bold capitalize transition-all cursor-pointer " +
                  (visao === v ? "bg-brand-brown text-brand-beige shadow-sm" : "text-brand-brown/70 hover:bg-white")
                }
              >
                {v === "mes" ? "mês" : v}
              </button>
            ))}
          </div>

          {podeVerTodos && (
            <button
              onClick={() => setLembretes(true)}
              title="Lembrete automático por WhatsApp"
              className="flex items-center gap-1.5 bg-white border border-brand-gold/30 hover:border-brand-brown text-brand-brown/80 px-3 py-2 rounded-xl text-[11px] font-semibold cursor-pointer"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Lembretes
            </button>
          )}

          <button
            onClick={() => setModal({ compromisso: null, data: iso(referencia), hora: "09:00" })}
            className="flex items-center gap-1.5 bg-brand-brown hover:bg-brand-brown/95 text-brand-beige px-4 py-2 rounded-xl text-[11px] font-bold shadow-sm border border-brand-gold/20 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 text-brand-gold" />
            Agendar
          </button>
        </div>
      </div>

      {erro && <div className="rounded-xl px-4 py-3 text-xs border bg-red-50 border-red-200 text-red-700">{erro}</div>}

      {visao === "mes" ? (
        <GradeMes
          referencia={referencia}
          compromissos={compromissos}
          aoEscolherDia={(d) => {
            setReferencia(new Date(d + "T12:00:00"));
            setVisao("dia");
          }}
        />
      ) : (
        <Grade
          colunas={colunas}
          compromissos={doPeriodo}
          colunaDe={(c) => (visao === "dia" ? c.professionalId : c.startsAt.slice(0, 10))}
          aoAbrir={(c) => setModal({ compromisso: c, data: c.startsAt.slice(0, 10) })}
          aoClicarVazio={(data, hhmm, professionalId) =>
            setModal({ compromisso: null, data, hora: hhmm, professionalId })
          }
        />
      )}

      <div className="flex flex-wrap items-center gap-3 px-1">
        {(Object.keys(ESTILO_STATUS) as (keyof typeof ESTILO_STATUS)[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5 text-[10px] text-brand-brown/60">
            <span className={"w-3 h-3 rounded border " + ESTILO_STATUS[s].caixa} />
            {ESTILO_STATUS[s].rotulo}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[10px] text-brand-brown/60 ml-auto">
          <CalendarDays className="h-3 w-3" />
          Clique num espaço vazio da grade para agendar naquele horário
        </span>
      </div>

      {lembretes && <LembretesPainel aoFechar={() => setLembretes(false)} aoMudar={carregar} />}

      {modal && (
        <AppointmentModal
          /* A versão FRESCA da lista, não a cópia de quando o modal abriu:
             concluir um atendimento muda o registro no servidor, e o modal
             continua aberto mostrando o que aconteceu. Com a cópia velha ele
             mostraria o estado anterior e ofereceria botões que já não valem. */
          compromisso={
            modal.compromisso
              ? compromissos.find((c) => c.id === modal.compromisso!.id) || modal.compromisso
              : null
          }
          dataPadrao={modal.data}
          horaPadrao={modal.hora}
          profissionalPadrao={modal.professionalId}
          profissionais={profissionais}
          servicos={servicos}
          pacientes={pacientes}
          aoFechar={() => setModal(null)}
          aoSalvar={carregar}
        />
      )}
    </div>
  );
}

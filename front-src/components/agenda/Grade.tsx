/**
 * Grade de horários — visão de dia e de semana (T1.3).
 *
 * As duas visões são a mesma régua de horário com colunas diferentes: no dia,
 * uma coluna por profissional; na semana, uma por dia. Escrever duas vezes a
 * mesma matemática de posicionamento seria garantir que uma das duas ficasse
 * com o bloco meio pixel fora do lugar.
 *
 * Clicar num espaço vazio abre o modal já com o horário daquele ponto — é o que
 * faz a recepção marcar em dois cliques.
 */
import {
  Compromisso, ESTILO_STATUS, HORA_INICIO, HORA_FIM, PIXEL_POR_MINUTO, ALTURA_GRADE,
  topoDoBloco, alturaDoBloco, hora, iso, paraData,
} from "./comum";

interface Coluna {
  chave: string;
  titulo: string;
  subtitulo?: string;
  destaque?: boolean;
  /** Data desta coluna, para saber o que abrir ao clicar no vazio. */
  data: string;
  /** Profissional desta coluna, quando a visão é por profissional. */
  professionalId?: string;
}

interface Props {
  colunas: Coluna[];
  compromissos: Compromisso[];
  /** Decide em qual coluna cada compromisso entra. */
  colunaDe: (c: Compromisso) => string;
  aoAbrir: (c: Compromisso) => void;
  aoClicarVazio: (data: string, hhmm: string, professionalId?: string) => void;
}

const HORAS = Array.from({ length: HORA_FIM - HORA_INICIO + 1 }, (_, i) => HORA_INICIO + i);

export default function Grade({ colunas, compromissos, colunaDe, aoAbrir, aoClicarVazio }: Props) {
  /** Converte a posição do clique dentro da coluna em horário, arredondando
   *  para a grade de 15 minutos — ninguém marca às 09:07. */
  const horarioDoClique = (e: React.MouseEvent<HTMLDivElement>) => {
    const caixa = e.currentTarget.getBoundingClientRect();
    const minutos = (e.clientY - caixa.top) / PIXEL_POR_MINUTO + HORA_INICIO * 60;
    const arredondado = Math.max(HORA_INICIO * 60, Math.round(minutos / 15) * 15);
    const h = Math.floor(arredondado / 60), m = arredondado % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  };

  return (
    <div className="bg-white border border-brand-gold/15 rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          {/* cabeçalho das colunas */}
          <div className="flex border-b border-brand-gold/20 bg-brand-beige/60 sticky top-0 z-10">
            <div className="w-14 shrink-0" />
            {colunas.map((c) => (
              <div
                key={c.chave}
                className={"flex-1 px-2 py-2.5 text-center border-l border-brand-gold/15 " + (c.destaque ? "bg-brand-gold/10" : "")}
              >
                <p className="text-[11px] font-bold text-brand-brown truncate">{c.titulo}</p>
                {c.subtitulo && <p className="text-[10px] text-brand-brown/55">{c.subtitulo}</p>}
              </div>
            ))}
          </div>

          <div className="flex relative" style={{ height: ALTURA_GRADE }}>
            {/* régua */}
            <div className="w-14 shrink-0 relative">
              {HORAS.map((h) => (
                <div
                  key={h}
                  className="absolute right-2 text-[10px] font-mono text-brand-brown/45 -translate-y-1/2"
                  style={{ top: (h - HORA_INICIO) * 60 * PIXEL_POR_MINUTO }}
                >
                  {String(h).padStart(2, "0")}:00
                </div>
              ))}
            </div>

            {colunas.map((col) => {
              const daColuna = compromissos.filter((c) => colunaDe(c) === col.chave);
              return (
                <div
                  key={col.chave}
                  onClick={(e) => aoClicarVazio(col.data, horarioDoClique(e), col.professionalId)}
                  className={"flex-1 relative border-l border-brand-gold/15 cursor-copy " + (col.destaque ? "bg-brand-gold/[0.04]" : "")}
                >
                  {/* linhas de hora */}
                  {HORAS.map((h) => (
                    <div
                      key={h}
                      className="absolute left-0 right-0 border-t border-brand-gold/10"
                      style={{ top: (h - HORA_INICIO) * 60 * PIXEL_POR_MINUTO }}
                    />
                  ))}

                  {daColuna.map((c) => {
                    const estilo = ESTILO_STATUS[c.status];
                    const bloqueio = c.kind === "BLOQUEIO";
                    return (
                      <button
                        key={c.id}
                        onClick={(e) => { e.stopPropagation(); aoAbrir(c); }}
                        title={`${hora(c.startsAt)}–${hora(c.endsAt)} · ${c.title}${c.clientName ? " · " + c.clientName : ""}`}
                        className={
                          "absolute left-1 right-1 rounded-md border px-1.5 py-1 text-left overflow-hidden cursor-pointer transition-shadow hover:shadow-md " +
                          (bloqueio
                            ? "bg-neutral-200/70 border-neutral-400 text-neutral-600 [background-image:repeating-linear-gradient(45deg,transparent,transparent_5px,rgba(0,0,0,0.05)_5px,rgba(0,0,0,0.05)_10px)]"
                            : estilo.caixa + " " + estilo.texto)
                        }
                        style={{ top: topoDoBloco(c.startsAt), height: alturaDoBloco(c.startsAt, c.endsAt) }}
                      >
                        <span className="block text-[10px] font-mono opacity-75 leading-tight">{hora(c.startsAt)}</span>
                        <span className="block text-[11px] font-semibold leading-tight truncate">{c.title}</span>
                        {c.clientName && (
                          <span className="block text-[10px] leading-tight truncate opacity-80">{c.clientName}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Visão de mês: grade de dias com contagem. Clicar entra no dia. */
export function GradeMes({
  referencia, compromissos, aoEscolherDia,
}: { referencia: Date; compromissos: Compromisso[]; aoEscolherDia: (data: string) => void }) {
  const primeiro = new Date(referencia.getFullYear(), referencia.getMonth(), 1);
  const inicio = new Date(primeiro);
  inicio.setDate(1 - primeiro.getDay());

  const dias: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(inicio);
    d.setDate(inicio.getDate() + i);
    dias.push(d);
  }

  const porDia = new Map<string, Compromisso[]>();
  for (const c of compromissos) {
    const chave = iso(paraData(c.startsAt));
    porDia.set(chave, (porDia.get(chave) || []).concat(c));
  }

  const hoje = iso(new Date());

  return (
    <div className="bg-white border border-brand-gold/15 rounded-2xl overflow-hidden">
      <div className="grid grid-cols-7 bg-brand-beige/60 border-b border-brand-gold/20">
        {["dom", "seg", "ter", "qua", "qui", "sex", "sáb"].map((d) => (
          <div key={d} className="px-2 py-2 text-center text-[10px] uppercase tracking-widest font-bold text-brand-brown/55">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {dias.map((d) => {
          const chave = iso(d);
          const doMes = d.getMonth() === referencia.getMonth();
          const lista = (porDia.get(chave) || []).filter((c) => c.status !== "CANCELADO");
          return (
            <button
              key={chave}
              onClick={() => aoEscolherDia(chave)}
              className={
                "min-h-[92px] border-t border-l border-brand-gold/10 p-1.5 text-left align-top cursor-pointer transition-colors hover:bg-brand-beige/40 " +
                (doMes ? "" : "opacity-35 ")
              }
            >
              <span
                className={
                  "inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-semibold mb-1 " +
                  (chave === hoje ? "bg-brand-brown text-brand-beige" : "text-brand-brown/70")
                }
              >
                {d.getDate()}
              </span>
              <div className="space-y-0.5">
                {lista.slice(0, 3).map((c) => (
                  <div key={c.id} className="flex items-center gap-1 text-[10px] text-brand-brown/80 truncate">
                    <span className={"w-1.5 h-1.5 rounded-full shrink-0 " + ESTILO_STATUS[c.status].caixa.split(" ")[0]} />
                    <span className="font-mono opacity-70">{hora(c.startsAt)}</span>
                    <span className="truncate">{c.clientName || c.title}</span>
                  </div>
                ))}
                {lista.length > 3 && (
                  <p className="text-[10px] text-brand-gold font-semibold">+{lista.length - 3}</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

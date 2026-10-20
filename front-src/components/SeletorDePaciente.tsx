/**
 * Escolher UMA paciente numa lista que pode ter milhares (20/10/2026).
 *
 * Documentos e Fidelidade mostravam as pacientes como botões lado a lado. Com
 * 15 já era uma parede; com 1.000, a tela inteira. Aqui é busca com lista
 * suspensa: digita parte do nome OU do telefone, aparecem no máximo 8, escolhe
 * com clique ou com as setas + Enter. Escolhida, vira uma linha só, com
 * "Trocar".
 */
import { useMemo, useRef, useState } from "react";
import { Search, X, User } from "lucide-react";

export interface PacienteDaLista {
  id: string;
  name: string;
  phone?: string;
}

const MAX = 8;

function semAcento(s: string) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export default function SeletorDePaciente(p: {
  pacientes: PacienteDaLista[];
  escolhido: PacienteDaLista | null;
  aoEscolher: (c: PacienteDaLista | null) => void;
}) {
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const campo = useRef<HTMLInputElement>(null);

  const resultado = useMemo(() => {
    const t = semAcento(busca.trim());
    if (!t) return { lista: [] as PacienteDaLista[], total: 0 };
    const digitos = t.replace(/\D/g, "");
    const todos = p.pacientes.filter((c) =>
      semAcento(c.name).includes(t) ||
      (digitos.length >= 3 && String(c.phone || "").replace(/\D/g, "").includes(digitos)));
    // quem COMEÇA com o que foi digitado vem primeiro
    todos.sort((a, b) => {
      const ia = semAcento(a.name).startsWith(t) ? 0 : 1;
      const ib = semAcento(b.name).startsWith(t) ? 0 : 1;
      return ia - ib || a.name.localeCompare(b.name, "pt-BR", { numeric: true });
    });
    return { lista: todos.slice(0, MAX), total: todos.length };
  }, [busca, p.pacientes]);

  const escolher = (c: PacienteDaLista) => {
    p.aoEscolher(c);
    setBusca("");
    setAberto(false);
  };

  if (p.escolhido) {
    return (
      <div className="flex items-center justify-between gap-3 bg-brand-beige/50 border border-brand-gold/25 rounded-xl px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="h-7 w-7 rounded-full bg-white border border-brand-gold/25 flex items-center justify-center shrink-0">
            <User className="h-3.5 w-3.5 text-brand-gold" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-brand-brown truncate">{p.escolhido.name}</p>
            {p.escolhido.phone && <p className="text-[10px] text-brand-brown/55 font-mono truncate">{p.escolhido.phone}</p>}
          </div>
        </div>
        <button
          onClick={() => { p.aoEscolher(null); setTimeout(() => campo.current?.focus(), 0); }}
          className="text-[11px] font-semibold text-brand-brown/70 hover:text-brand-brown border border-brand-gold/30 rounded-lg px-2.5 py-1 cursor-pointer"
        >
          Trocar
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="h-3.5 w-3.5 text-brand-brown/40 absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        ref={campo}
        role="combobox"
        aria-expanded={aberto && resultado.lista.length > 0}
        className="w-full bg-white border border-brand-gold/30 rounded px-3 py-2 pl-8 pr-8 text-xs text-brand-brown focus:outline-none focus:border-brand-brown transition-colors"
        placeholder={"Digite o nome ou o telefone da paciente (" + p.pacientes.length + " cadastradas)"}
        value={busca}
        onChange={(e) => { setBusca(e.target.value); setAberto(true); setAtivo(0); }}
        onFocus={() => setAberto(true)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setAtivo((i) => Math.min(i + 1, resultado.lista.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter" && resultado.lista[ativo]) { e.preventDefault(); escolher(resultado.lista[ativo]); }
          else if (e.key === "Escape") setAberto(false);
        }}
      />
      {busca && (
        <button
          onClick={() => { setBusca(""); campo.current?.focus(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-brand-brown/40 hover:text-brand-brown cursor-pointer"
          aria-label="Limpar busca"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {aberto && busca.trim() && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-brand-gold/25 rounded-xl shadow-lg overflow-hidden">
          {resultado.lista.length === 0 ? (
            <p className="px-3 py-2.5 text-[11px] text-brand-brown/50">Nenhuma paciente encontrada.</p>
          ) : (
            <ul role="listbox">
              {resultado.lista.map((c, i) => (
                <li
                  key={c.id}
                  role="option"
                  aria-selected={i === ativo}
                  onMouseDown={(e) => { e.preventDefault(); escolher(c); }}
                  onMouseEnter={() => setAtivo(i)}
                  className={"flex items-center justify-between gap-3 px-3 py-2 cursor-pointer " +
                    (i === ativo ? "bg-brand-beige/70" : "")}
                >
                  <span className="text-xs text-brand-brown truncate">{c.name}</span>
                  {c.phone && <span className="text-[10px] text-brand-brown/50 font-mono shrink-0">{c.phone}</span>}
                </li>
              ))}
            </ul>
          )}
          {resultado.total > resultado.lista.length && (
            <p className="px-3 py-1.5 text-[10px] text-brand-brown/50 border-t border-brand-gold/15 bg-brand-beige/30">
              Mostrando {resultado.lista.length} de {resultado.total}. Continue digitando para refinar.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

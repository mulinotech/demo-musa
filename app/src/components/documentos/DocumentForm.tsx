/**
 * Renderizador genérico do formulário (T4.2).
 *
 * Desenha as perguntas a partir do `fields_json` do modelo. Não há formulário
 * escrito à mão para anamnese: modelo novo passa a funcionar sem código novo, e
 * é isso que permite a clínica ajustar as perguntas sem depender de deploy.
 *
 * Duas coisas que a tela faz e o servidor repete:
 *
 * - **Condicional**: pergunta com `showIf` só aparece quando a condição vale, e
 *   a resposta dela é descartada quando a condição deixa de valer — senão fica
 *   guardado "alergia a dipirona" de quem depois respondeu que não tem alergia.
 * - **Marca de alerta**: pergunta de contraindicação fica visualmente diferente
 *   ao ser respondida afirmativamente, ali na hora. Quem preenche vê o peso da
 *   resposta antes de seguir.
 */
import { AlertTriangle } from "lucide-react";
import { CampoModelo, SecaoModelo, campoVisivel } from "./comum";

export default function DocumentForm(p: {
  secoes: SecaoModelo[];
  respostas: Record<string, any>;
  aoMudar: (respostas: Record<string, any>) => void;
  somenteLeitura?: boolean;
  problemas?: Record<string, string>;
}) {
  const campo =
    "w-full bg-white border border-brand-gold/30 rounded px-3 py-2 text-xs text-brand-brown focus:outline-none focus:border-brand-brown transition-colors disabled:bg-brand-beige/40 disabled:text-brand-brown/60";

  const definir = (c: CampoModelo, valor: any) => {
    const novo = { ...p.respostas, [c.key]: valor };

    // Pergunta que deixou de fazer sentido perde a resposta. Guardar "dipirona"
    // de quem depois disse que não tem alergia é um dado clínico falso.
    for (const s of p.secoes) {
      for (const f of s.fields) {
        if (f.showIf && f.showIf.field === c.key && !campoVisivel(f, novo)) {
          delete novo[f.key];
        }
      }
    }
    p.aoMudar(novo);
  };

  const desenhar = (c: CampoModelo) => {
    const v = p.respostas[c.key];
    const ro = !!p.somenteLeitura;

    if (c.type === "boolean") {
      return (
        <div className="flex items-center gap-1.5">
          {[["Sim", true], ["Não", false]].map(([rot, val]) => (
            <button
              key={String(val)}
              disabled={ro}
              onClick={() => definir(c, v === val ? undefined : val)}
              className={
                "px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all disabled:cursor-default " +
                (v === val
                  ? val === true && c.alert
                    ? "bg-red-600 text-white border-red-600"
                    : "bg-brand-brown text-brand-beige border-brand-brown"
                  : "bg-white border-brand-gold/30 text-brand-brown/70 hover:border-brand-brown cursor-pointer")
              }
            >
              {rot}
            </button>
          ))}
        </div>
      );
    }

    if (c.type === "textarea") {
      return (
        <textarea
          className={campo}
          rows={3}
          disabled={ro}
          value={v == null ? "" : String(v)}
          onChange={(e) => definir(c, e.target.value)}
        />
      );
    }

    if (c.type === "select") {
      return (
        <select className={campo} disabled={ro} value={v == null ? "" : String(v)} onChange={(e) => definir(c, e.target.value || undefined)}>
          <option value="">—</option>
          {(c.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }

    if (c.type === "multiselect") {
      const lista: string[] = Array.isArray(v) ? v : [];
      return (
        <div className="flex flex-wrap gap-1.5">
          {(c.options || []).map((o) => (
            <button
              key={o}
              disabled={ro}
              onClick={() => definir(c, lista.includes(o) ? lista.filter((x) => x !== o) : lista.concat([o]))}
              className={
                "px-2.5 py-1 rounded-lg text-[11px] border transition-all disabled:cursor-default " +
                (lista.includes(o)
                  ? "bg-brand-brown text-brand-beige border-brand-brown"
                  : "bg-white border-brand-gold/30 text-brand-brown/70 hover:border-brand-brown cursor-pointer")
              }
            >
              {o}
            </button>
          ))}
        </div>
      );
    }

    if (c.type === "scale") {
      const min = c.min == null ? 0 : c.min;
      const max = c.max == null ? 10 : c.max;
      return (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={min}
            max={max}
            disabled={ro}
            value={v == null ? min : Number(v)}
            onChange={(e) => definir(c, Number(e.target.value))}
            className="flex-1 accent-brand-brown"
          />
          <span className="text-xs font-mono text-brand-brown w-14 text-right">
            {v == null ? "—" : v + " / " + max}
          </span>
        </div>
      );
    }

    return (
      <input
        type={c.type === "date" ? "date" : c.type === "number" ? "number" : "text"}
        className={campo}
        disabled={ro}
        value={v == null ? "" : String(v)}
        onChange={(e) => definir(c, c.type === "number" ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value)}
      />
    );
  };

  return (
    <div className="space-y-5">
      {p.secoes.map((s) => (
        <div key={s.title} className="space-y-3">
          <p className="text-[10px] uppercase tracking-widest font-bold text-brand-brown/60 border-b border-brand-gold/20 pb-1.5">
            {s.title}
          </p>
          {s.fields.filter((c) => campoVisivel(c, p.respostas)).map((c) => {
            const marcado = c.alert && (c.type === "boolean" ? p.respostas[c.key] === true : !!p.respostas[c.key]);
            const problema = p.problemas ? p.problemas[c.key] : undefined;
            return (
              <div
                key={c.key}
                className={
                  "rounded-xl px-3 py-2.5 border " +
                  (marcado
                    ? "bg-red-50 border-red-200"
                    : problema
                      ? "bg-amber-50 border-amber-200"
                      : "bg-white/60 border-transparent")
                }
              >
                <label className="block text-xs text-brand-brown mb-1.5 leading-snug">
                  {c.label}
                  {c.required && <span className="text-red-600 ml-1">*</span>}
                  {marcado && (
                    <span className="ml-2 inline-flex items-center gap-1 text-[9px] uppercase tracking-wider text-red-700 font-bold">
                      <AlertTriangle className="h-3 w-3" />
                      contraindicação
                    </span>
                  )}
                </label>
                {desenhar(c)}
                {problema && <p className="text-[10px] text-amber-800 mt-1">{problema}</p>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

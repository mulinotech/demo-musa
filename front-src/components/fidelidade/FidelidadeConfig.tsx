/**
 * Configuração do programa de pontos (T5.4).
 *
 * A tela tem uma frase calculada ao vivo, e ela é o ponto inteiro deste
 * componente: **"um atendimento de R$ 250 gera 250 pontos, que valem R$ 25,00 —
 * 10% de volta"**.
 *
 * Sem essa frase, alguém olha dois campos numéricos, digita "1 ponto por real"
 * e "R$ 0,50 por ponto" achando generoso, e acabou de prometer devolver
 * **metade do faturamento** em desconto. Não existe erro na tela, não existe
 * validação que pegue isso — o número só é errado em relação à margem da
 * clínica, e quem sabe disso é a pessoa. A tela precisa mostrar a consequência
 * antes de ela salvar.
 */
import { useEffect, useState } from "react";
import { Check, AlertTriangle, Award } from "lucide-react";
import { ConfigFidelidade, ExemploFidelidade, reais, pts } from "./comum";

export default function FidelidadeConfig(p: { podeEditar: boolean; aoMudar?: () => void }) {
  const [cfg, setCfg] = useState<ConfigFidelidade | null>(null);
  const [exemplo, setExemplo] = useState<ExemploFidelidade | null>(null);
  const [erro, setErro] = useState("");
  const [recado, setRecado] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [precoExemplo, setPrecoExemplo] = useState("250");

  const carregar = async () => {
    const r = await fetch("/api/loyalty/settings");
    const d = await r.json();
    if (!r.ok) return setErro(d.error || "Não foi possível ler a configuração.");
    setCfg(d.config);
    setExemplo(d.exemplo);
    setErro("");
  };

  useEffect(() => {
    carregar();
  }, []);

  const salvar = async (mudanca: Partial<ConfigFidelidade>) => {
    setOcupado(true);
    try {
      const r = await fetch("/api/loyalty/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mudanca),
      });
      const d = await r.json();
      if (!r.ok) return setErro(d.error || "Não foi possível salvar.");
      setCfg(d.config);
      setExemplo(d.exemplo);
      setErro("");
      setRecado(
        mudanca.active === true
          ? "Programa ativado. Atendimentos concluídos passam a gerar pontos."
          : mudanca.active === false
            ? "Programa desativado. Nada mais acumula; o saldo existente fica."
            : "Configuração salva. Pontos já creditados não mudam.",
      );
      if (p.aoMudar) p.aoMudar();
    } finally {
      setOcupado(false);
    }
  };

  /** Prévia local do exemplo, para reagir enquanto a pessoa digita. O número
   *  que vale é o do servidor; este é só o espelho imediato. */
  const previa = (): ExemploFidelidade | null => {
    if (!cfg) return null;
    const preco = Number(String(precoExemplo).replace(",", ".")) || 0;
    const pontos = Math.floor(preco * cfg.pointsPerReal);
    const vale = Math.round(pontos * cfg.redemptionValue * 100) / 100;
    return {
      preco,
      pontos,
      vale,
      percentualDeVolta: preco > 0 ? Math.round((vale / preco) * 1000) / 10 : 0,
      expiraEm: cfg.expiryDays ? cfg.expiryDays + " dias" : "não expira",
    };
  };

  const e = previa() || exemplo;
  const generoso = e && e.percentualDeVolta >= 20;

  const campo =
    "w-full bg-white border border-brand-gold/30 rounded px-3 py-2 text-xs text-brand-brown focus:outline-none focus:border-brand-brown transition-colors disabled:bg-brand-beige/40";
  const rotulo = "block text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold mb-1";

  if (!cfg) return <p className="text-[11px] text-brand-brown/50">Carregando…</p>;

  return (
    <div className="space-y-4">
      {recado && (
        <div className="rounded-2xl px-4 py-3 text-xs border bg-emerald-50 border-emerald-200 text-emerald-800 flex items-start gap-2">
          <Check className="h-4 w-4 shrink-0 mt-0.5" />
          <p>{recado}</p>
        </div>
      )}
      {erro && (
        <div className="rounded-2xl px-4 py-3 text-xs border bg-red-50 border-red-200 text-red-700 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <p>{erro}</p>
        </div>
      )}

      <div
        className={
          "rounded-2xl border px-4 py-3 flex items-start justify-between gap-4 " +
          (cfg.active ? "bg-emerald-50 border-emerald-200" : "bg-white border-brand-gold/20")
        }
      >
        <div>
          <p className="text-xs font-bold text-brand-brown">{cfg.active ? "Ativo" : "Desativado"}</p>
          <p className="text-[11px] text-brand-brown/70 leading-relaxed mt-0.5">
            {cfg.active
              ? "Cada atendimento concluído credita pontos ao paciente, sobre o valor efetivamente cobrado."
              : "Nenhum atendimento acumula pontos. O saldo já existente continua válido para resgate."}
          </p>
        </div>
        {p.podeEditar && (
          <button
            onClick={() => salvar({ active: !cfg.active })}
            disabled={ocupado}
            className={
              "shrink-0 px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest cursor-pointer transition-colors disabled:opacity-50 " +
              (cfg.active
                ? "bg-white border border-brand-gold/30 text-brand-brown/80 hover:border-brand-brown"
                : "bg-brand-brown text-brand-beige hover:bg-brand-brown/95")
            }
          >
            {cfg.active ? "Desativar" : "Ativar"}
          </button>
        )}
      </div>

      <div className="bg-white border border-brand-gold/15 rounded-2xl p-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className={rotulo}>Pontos por real</label>
          <input
            className={campo}
            disabled={!p.podeEditar}
            defaultValue={String(cfg.pointsPerReal)}
            onChange={(ev) => setCfg({ ...cfg, pointsPerReal: Number(ev.target.value.replace(",", ".")) || 0 })}
            onBlur={(ev) => {
              const v = Number(ev.target.value.replace(",", "."));
              if (v > 0) salvar({ pointsPerReal: v });
            }}
          />
        </div>
        <div>
          <label className={rotulo}>Valor do ponto (R$)</label>
          <input
            className={campo}
            disabled={!p.podeEditar}
            defaultValue={String(cfg.redemptionValue)}
            onChange={(ev) => setCfg({ ...cfg, redemptionValue: Number(ev.target.value.replace(",", ".")) || 0 })}
            onBlur={(ev) => {
              const v = Number(ev.target.value.replace(",", "."));
              if (v >= 0) salvar({ redemptionValue: v });
            }}
          />
        </div>
        <div>
          <label className={rotulo}>Validade (dias)</label>
          <input
            type="number"
            min={0}
            max={1825}
            className={campo}
            disabled={!p.podeEditar}
            defaultValue={cfg.expiryDays}
            onBlur={(ev) => salvar({ expiryDays: Number(ev.target.value) })}
          />
          <p className="text-[9px] text-brand-brown/45 mt-1">
            0 = não expira · a maioria das clínicas usa 90
          </p>
        </div>
        <div>
          <label className={rotulo}>Mínimo p/ resgatar</label>
          <input
            type="number"
            min={0}
            className={campo}
            disabled={!p.podeEditar}
            defaultValue={cfg.minPointsToRedeem}
            onBlur={(ev) => salvar({ minPointsToRedeem: Number(ev.target.value) })}
          />
        </div>
      </div>

      {e && (
        <div
          className={
            "rounded-2xl border p-4 " +
            (generoso ? "bg-amber-50 border-amber-200" : "bg-brand-beige/60 border-brand-gold/20")
          }
        >
          <div className="flex items-start gap-3">
            <Award className={"h-5 w-5 shrink-0 mt-0.5 " + (generoso ? "text-amber-700" : "text-brand-gold")} />
            <div className="space-y-1.5">
              <p className={rotulo}>O que essa regra significa</p>
              <p className="text-sm text-brand-brown leading-relaxed">
                Um atendimento de{" "}
                <input
                  className="w-24 bg-white border-b border-brand-gold/40 px-1 text-sm font-mono text-brand-brown focus:outline-none focus:border-brand-brown"
                  value={precoExemplo}
                  onChange={(ev) => setPrecoExemplo(ev.target.value)}
                />{" "}
                gera <strong>{pts(e.pontos)} pontos</strong>, que valem{" "}
                <strong>{reais(e.vale)}</strong> em resgate — ou seja,{" "}
                <strong className={generoso ? "text-amber-800" : ""}>
                  {String(e.percentualDeVolta).replace(".", ",")}% de volta
                </strong>
                . Os pontos {e.expiraEm === "não expira" ? "não expiram" : "expiram em " + e.expiraEm}.
              </p>
              {generoso && (
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  Isso é bastante: cada real faturado devolve{" "}
                  {String(e.percentualDeVolta).replace(".", ",")} centavos em desconto futuro. Compare
                  com a margem dos seus procedimentos antes de manter essa configuração.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <p className="text-[10px] text-brand-brown/50 leading-relaxed">
        Mudar a regra não altera pontos já creditados, de propósito: quem acumulou sob a regra antiga
        mantém o que tem. Mexer no passado quebraria a confiança do paciente no saldo que ele anotou.
      </p>
    </div>
  );
}

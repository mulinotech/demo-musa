/**
 * Resgate de recompensa num compromisso (T5.3).
 *
 * A tela mostra **o efeito no preço antes de confirmar**: preço atual, desconto,
 * preço final e quantos pontos o atendimento vai acumular depois do desconto.
 * Esse último número é o que evita a pergunta "por que ela só ganhou 225
 * pontos?" — porque o acúmulo cai sobre o que foi pago, não sobre a tabela.
 *
 * Prêmios que não cabem no saldo aparecem, desabilitados, com quanto falta. Uma
 * lista que só mostra o que cabe esconde a razão de a paciente voltar.
 */
import { useEffect, useState } from "react";
import { X, Award, AlertTriangle, Check } from "lucide-react";
import { motion } from "motion/react";
import { Recompensa, SaldoCliente, reais, pts, descreverPremio } from "./comum";

export default function ResgateModal(p: {
  compromissoId: string;
  clientId: string;
  precoAtual: number | null;
  aoFechar: () => void;
  aoAplicar: () => void;
}) {
  const [premios, setPremios] = useState<Recompensa[]>([]);
  const [saldo, setSaldo] = useState<SaldoCliente | null>(null);
  const [escolhido, setEscolhido] = useState<string>("");
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState<any>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [a, b] = await Promise.all([
          fetch("/api/loyalty/rewards").then((r) => r.json()),
          fetch("/api/clients/" + p.clientId + "/loyalty").then((r) => r.json()),
        ]);
        if (a.error || b.error) return setErro(a.error || b.error);
        setPremios((Array.isArray(a) ? a : []).filter((x: Recompensa) => x.active));
        setSaldo(b);
      } catch {
        setErro("Não foi possível carregar as recompensas.");
      }
    })();
  }, [p.clientId]);

  const preco = Number(p.precoAtual) || 0;

  /** Espelho local do cálculo do servidor, para a pessoa ver antes de clicar.
   *  O número que vale é o que o servidor devolve. */
  const efeito = (r: Recompensa) => {
    let bruto = 0;
    if (r.type === "DESCONTO_VALOR") bruto = Number(r.value) || 0;
    else if (r.type === "DESCONTO_PCT") bruto = (preco * (Number(r.value) || 0)) / 100;
    else if (r.type === "SERVICO") bruto = r.value == null ? preco : Number(r.value);
    const desconto = Math.round(Math.min(Math.max(bruto, 0), preco) * 100) / 100;
    return { desconto, precoFinal: Math.round((preco - desconto) * 100) / 100 };
  };

  const aplicar = async () => {
    if (!escolhido) return setErro("Escolha a recompensa.");
    setOcupado(true);
    try {
      const r = await fetch("/api/appointments/" + p.compromissoId + "/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rewardId: escolhido }),
      });
      const d = await r.json();
      if (!r.ok) return setErro(d.error || "Não foi possível aplicar o resgate.");
      setErro("");
      setFeito(d);
      p.aoAplicar();
    } finally {
      setOcupado(false);
    }
  };

  const rotulo = "block text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold mb-1";

  return (
    <div className="fixed inset-0 z-[80] bg-brand-brown/40 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-lg bg-brand-beige rounded-2xl shadow-2xl border border-brand-gold/20 my-4"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-gold/20">
          <div>
            <h3 className="text-sm font-serif font-bold text-brand-brown uppercase tracking-wider">
              Resgatar pontos
            </h3>
            <p className="text-[10px] text-brand-brown/60 mt-0.5">
              {saldo ? pts(saldo.saldo) + " pontos · " + reais(saldo.vale) + " disponíveis" : "carregando…"}
            </p>
          </div>
          <button onClick={p.aoFechar} className="p-2 rounded-full text-brand-brown/60 hover:bg-white cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {erro && (
            <div className="rounded-xl px-4 py-3 text-xs border bg-red-50 border-red-200 text-red-700 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>{erro}</p>
            </div>
          )}

          {feito ? (
            <div className="rounded-xl px-4 py-3 text-xs border bg-emerald-50 border-emerald-200 text-emerald-800 space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <Check className="h-4 w-4" /> {feito.recompensa} aplicado.
              </p>
              <p>
                Preço: {reais(feito.precoAnterior)} → <strong>{reais(feito.precoFinal)}</strong>
                {" "}({pts(feito.pontosUsados)} pontos usados).
              </p>
              <p>
                Ao concluir, o atendimento vai acumular <strong>{pts(feito.acumuloPrevisto)} pontos</strong> —
                sobre o valor pago, não sobre o preço de tabela.
              </p>
              <p>Saldo depois: {pts(feito.saldoDepois)} pontos.</p>
            </div>
          ) : (
            <>
              {preco <= 0 && (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  Este compromisso não tem preço. Informe o valor do atendimento antes de resgatar.
                </p>
              )}

              <div className="space-y-2">
                {premios.map((r) => {
                  const s = saldo ? saldo.saldo : 0;
                  const minimo = saldo ? saldo.minimoParaResgate : 0;
                  const falta = r.pointsCost - s;
                  const abaixoDoMinimo = s < minimo;
                  const cabe = falta <= 0 && !abaixoDoMinimo && preco > 0;
                  const ef = efeito(r);
                  return (
                    <button
                      key={r.id}
                      onClick={() => cabe && setEscolhido(r.id)}
                      disabled={!cabe}
                      className={
                        "w-full text-left rounded-xl border px-3 py-2.5 transition-all " +
                        (escolhido === r.id
                          ? "bg-white border-brand-brown shadow-sm cursor-pointer"
                          : cabe
                            ? "bg-white/70 border-brand-gold/25 hover:border-brand-brown cursor-pointer"
                            : "bg-brand-beige/40 border-brand-gold/15 opacity-60 cursor-default")
                      }
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-brand-brown truncate flex items-center gap-1.5">
                            {escolhido === r.id && <Award className="h-3.5 w-3.5 text-brand-gold" />}
                            {r.name}
                          </p>
                          <p className="text-[10px] text-brand-brown/55">{descreverPremio(r)}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-mono font-bold text-brand-brown">{pts(r.pointsCost)} pts</p>
                          {cabe ? (
                            <p className="text-[10px] text-emerald-700">−{reais(ef.desconto)}</p>
                          ) : abaixoDoMinimo ? (
                            <p className="text-[10px] text-brand-brown/50">mínimo {pts(minimo)}</p>
                          ) : (
                            <p className="text-[10px] text-brand-brown/50">faltam {pts(falta)}</p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {premios.length === 0 && (
                  <p className="text-[11px] text-brand-brown/50 text-center py-4">
                    Nenhuma recompensa ativa.
                  </p>
                )}
              </div>

              {escolhido && (
                <div className="bg-white/80 border border-brand-gold/20 rounded-xl px-3 py-2.5 space-y-1">
                  <p className={rotulo}>Efeito neste atendimento</p>
                  {(() => {
                    const r = premios.find((x) => x.id === escolhido)!;
                    const ef = efeito(r);
                    const cfgVale = saldo && saldo.saldo > 0 ? saldo.vale / saldo.saldo : 0.1;
                    const acumulo = Math.floor(ef.precoFinal * 1); // 1 ponto por real, espelho
                    return (
                      <>
                        <p className="text-xs text-brand-brown">
                          {reais(preco)} − {reais(ef.desconto)} = <strong>{reais(ef.precoFinal)}</strong>
                        </p>
                        <p className="text-[11px] text-brand-brown/70 leading-relaxed">
                          O atendimento vai acumular pontos sobre <strong>{reais(ef.precoFinal)}</strong>,
                          não sobre {reais(preco)} — quem paga menos acumula menos, senão os pontos
                          financiariam os próprios pontos.
                        </p>
                        <p className="text-[10px] text-brand-brown/45">
                          {pts(r.pointsCost)} pontos ≈ {reais(Math.round(r.pointsCost * cfgVale * 100) / 100)} pela tabela ·
                          desconto real {reais(ef.desconto)}
                          {acumulo ? "" : ""}
                        </p>
                      </>
                    );
                  })()}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-brand-gold/20">
          <p className="text-[10px] text-brand-brown/50 max-w-[15rem] leading-relaxed">
            O resgate tem de entrar <strong>antes</strong> de concluir o atendimento.
          </p>
          <div className="flex items-center gap-2">
            <button onClick={p.aoFechar} className="px-4 py-2 rounded-xl text-[11px] font-semibold text-brand-brown/70 hover:bg-white cursor-pointer">
              {feito ? "Fechar" : "Cancelar"}
            </button>
            {!feito && (
              <button
                onClick={aplicar}
                disabled={ocupado || !escolhido}
                className="bg-brand-brown hover:bg-brand-brown/95 disabled:opacity-40 text-brand-beige px-5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest cursor-pointer transition-colors"
              >
                {ocupado ? "Aplicando..." : "Aplicar resgate"}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Fidelização — rota /crm/fidelidade (Fase 5).
 *
 * Quatro abas: o programa, as recompensas, o saldo por paciente e o relatório.
 *
 * O relatório tem dois números que não existiam no plano e que a clínica precisa
 * ver juntos: **o custo real em reais** (a soma do que os descontos tiraram) e
 * **o passivo em circulação** (o que os saldos existentes valem se todos forem
 * resgatados). O segundo não é dívida contábil — não é obrigação em dinheiro —
 * mas é o tamanho da promessa que a clínica já fez.
 */
import { useCallback, useEffect, useState } from "react";
import { Award, RefreshCw, AlertTriangle, Clock, Search } from "lucide-react";
import FidelidadeConfig from "../../components/fidelidade/FidelidadeConfig";
import RecompensasPanel from "../../components/fidelidade/RecompensasPanel";
import ClienteFidelidadeCard from "../../components/fidelidade/ClienteFidelidadeCard";
import { ConfigFidelidade, reais, pts } from "../../components/fidelidade/comum";
import { papelDoToken } from "../../lib/api";

type Aba = "programa" | "recompensas" | "pacientes" | "relatorio";

interface Relatorio {
  periodo: { de: string; ate: string };
  emitidos: number;
  resgatados: number;
  expirados: number;
  ajustes: number;
  estornos: number;
  custoEmReais: number;
  custoEstimadoPelaTabela: number;
  saldoEmCirculacao: number;
  passivoEmReais: number;
  pacientesComSaldo: number;
}

export default function Fidelidade() {
  const [aba, setAba] = useState<Aba>("programa");
  const [cfg, setCfg] = useState<ConfigFidelidade | null>(null);
  const [rel, setRel] = useState<Relatorio | null>(null);
  const [pacientes, setPacientes] = useState<{ id: string; name: string }[]>([]);
  const [busca, setBusca] = useState("");
  const [escolhido, setEscolhido] = useState<{ id: string; name: string } | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  const papel = papelDoToken();
  const podeEditar = papel === "admin";

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/loyalty/settings");
      const d = await r.json();
      if (r.ok) setCfg(d.config);
      else setErro(d.error || "");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    if (aba !== "relatorio") return;
    const hoje = new Date();
    const de = new Date(hoje.getFullYear(), hoje.getMonth() - 5, 1).toISOString().slice(0, 10);
    fetch("/api/loyalty/report?from=" + de + "&to=" + hoje.toISOString().slice(0, 10))
      .then((r) => r.json())
      .then((d) => (d.error ? setErro(d.error) : setRel(d)))
      .catch(() => setErro("Não foi possível montar o relatório."));
  }, [aba]);

  useEffect(() => {
    if (aba !== "pacientes" || pacientes.length) return;
    fetch("/api/clients")
      .then((r) => r.json())
      .then((d) => setPacientes(Array.isArray(d) ? d.map((c: any) => ({ id: c.id, name: c.name })) : []))
      .catch(() => setPacientes([]));
  }, [aba, pacientes.length]);

  const filtrados = busca.trim()
    ? pacientes.filter((c) => c.name.toLowerCase().includes(busca.trim().toLowerCase()))
    : pacientes.slice(0, 12);

  const botao = "px-3 py-2 rounded-xl text-[11px] font-semibold transition-all cursor-pointer";
  const rotulo = "block text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold mb-1";
  const campo =
    "w-full bg-white border border-brand-gold/30 rounded px-3 py-2 text-xs text-brand-brown focus:outline-none focus:border-brand-brown transition-colors";

  return (
    <div className="space-y-4">
      <div className="bg-white border border-brand-gold/15 rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-brand-beige p-2.5 rounded-xl">
            <Award className="h-5 w-5 text-brand-gold" />
          </div>
          <div>
            <h3 className="text-sm font-serif font-bold text-brand-brown">Fidelização</h3>
            <p className="text-[10px] text-brand-brown/60">
              {cfg
                ? cfg.active
                  ? cfg.pointsPerReal + " ponto por real · ponto vale " + reais(cfg.redemptionValue)
                  : "programa desativado"
                : "carregando…"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-brand-beige/60 p-1 rounded-xl flex-wrap">
            {([
              ["programa", "Programa"],
              ["recompensas", "Recompensas"],
              ["pacientes", "Pacientes"],
              ["relatorio", "Relatório"],
            ] as [Aba, string][]).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setAba(v)}
                className={botao + " " + (aba === v ? "bg-brand-brown text-brand-beige shadow-sm" : "text-brand-brown/70 hover:bg-white")}
              >
                {label}
              </button>
            ))}
          </div>
          <button onClick={carregar} className="p-2 rounded-lg text-brand-brown/60 hover:bg-brand-beige cursor-pointer" title="Recarregar">
            <RefreshCw className={"h-4 w-4 " + (carregando ? "animate-spin" : "")} />
          </button>
        </div>
      </div>

      {erro && (
        <div className="rounded-2xl px-4 py-3 text-xs border bg-red-50 border-red-200 text-red-700 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <p>{erro}</p>
        </div>
      )}

      {aba === "programa" && <FidelidadeConfig podeEditar={podeEditar} aoMudar={carregar} />}
      {aba === "recompensas" && <RecompensasPanel podeEditar={podeEditar} config={cfg} />}

      {aba === "pacientes" && (
        <div className="space-y-3">
          <div className="bg-white border border-brand-gold/15 rounded-2xl p-4">
            <label className={rotulo}>Paciente</label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="h-3.5 w-3.5 text-brand-brown/40 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  className={campo + " pl-8"}
                  placeholder="Buscar por nome…"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {filtrados.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setEscolhido(c)}
                  className={
                    "px-2.5 py-1.5 rounded-lg text-[11px] border cursor-pointer transition-all " +
                    (escolhido?.id === c.id
                      ? "bg-brand-brown text-brand-beige border-brand-brown"
                      : "bg-white border-brand-gold/25 text-brand-brown/80 hover:border-brand-brown")
                  }
                >
                  {c.name}
                </button>
              ))}
              {filtrados.length === 0 && (
                <p className="text-[11px] text-brand-brown/50">Nenhum paciente encontrado.</p>
              )}
            </div>
          </div>

          {escolhido && (
            <ClienteFidelidadeCard
              clientId={escolhido.id}
              nomeDoPaciente={escolhido.name}
              podeAjustar={podeEditar}
            />
          )}
        </div>
      )}

      {aba === "relatorio" && rel && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              ["Pontos emitidos", pts(rel.emitidos), "no período"],
              ["Pontos resgatados", pts(rel.resgatados), "no período"],
              ["Pontos expirados", pts(rel.expirados), "viraram pó"],
              ["Saldo em circulação", pts(rel.saldoEmCirculacao), rel.pacientesComSaldo + " paciente(s)"],
            ].map(([t, v, s]) => (
              <div key={t} className="bg-white border border-brand-gold/15 rounded-2xl p-4">
                <p className={rotulo}>{t}</p>
                <p className="text-xl font-serif font-semibold text-brand-brown">{v}</p>
                <p className="text-[10px] text-brand-brown/50 mt-0.5">{s}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="bg-white border border-brand-gold/15 rounded-2xl p-4 space-y-1">
              <p className={rotulo}>Custo do programa no período</p>
              <p className="text-2xl font-serif font-semibold text-brand-brown">{reais(rel.custoEmReais)}</p>
              <p className="text-[11px] text-brand-brown/65 leading-relaxed">
                É o dinheiro que os descontos efetivamente tiraram, gravado em cada resgate. Pela
                tabela de pontos daria {reais(rel.custoEstimadoPelaTabela)} — a diferença aparece
                quando um desconto percentual cai num procedimento caro.
              </p>
              <p className="text-[10px] text-brand-brown/45 leading-relaxed pt-1">
                Este número não vira lançamento no financeiro: desconto não é dinheiro que saiu, é
                dinheiro que não entrou. A receita já foi lançada menor.
              </p>
            </div>

            <div className="bg-brand-beige/60 border border-brand-gold/20 rounded-2xl p-4 space-y-1">
              <p className={rotulo}>Passivo em circulação</p>
              <p className="text-2xl font-serif font-semibold text-brand-brown">{reais(rel.passivoEmReais)}</p>
              <p className="text-[11px] text-brand-brown/65 leading-relaxed">
                O que os saldos existentes valeriam se todos fossem resgatados hoje. Não é dívida
                contábil — não é obrigação em dinheiro — mas é o tamanho da promessa que a clínica já
                fez, e um dia parte disso vira desconto.
              </p>
              {rel.expirados > 0 && (
                <p className="text-[10px] text-amber-800 leading-relaxed pt-1 flex items-start gap-1.5">
                  <Clock className="h-3 w-3 shrink-0 mt-0.5" />
                  {pts(rel.expirados)} pontos expiraram no período. Ponto que vira pó sem o paciente
                  saber é promessa quebrada em silêncio — vale avisar antes.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

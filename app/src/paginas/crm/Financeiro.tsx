/**
 * Financeiro — rota /crm/financeiro (T2.4 e T2.6).
 *
 * Só admin e gerente. Um profissional não enxerga o caixa da clínica, e quem
 * garante isso é REGRAS_DE_PAPEL no servidor — esconder a aba é conveniência,
 * não controle de acesso.
 *
 * O gateway de pagamento está fora de escopo por decisão da Silvia em
 * 20/08/2026: o sistema **registra** dinheiro, não **movimenta** dinheiro.
 */
import { useCallback, useEffect, useState } from "react";
import { LineChart, ListPlus, Repeat, DownloadCloud } from "lucide-react";
import ResumoFinanceiro from "../../components/financeiro/ResumoFinanceiro";
import LancamentosList from "../../components/financeiro/LancamentosList";
import Recorrentes from "../../components/financeiro/Recorrentes";
import { Base, Categoria, mesCorrente } from "../../components/financeiro/comum";

type Aba = "resumo" | "lancamentos" | "recorrentes";

export default function Financeiro() {
  const inicial = mesCorrente();
  const [aba, setAba] = useState<Aba>("resumo");
  const [base, setBase] = useState<Base>("competencia");
  const [de, setDe] = useState(inicial.de);
  const [ate, setAte] = useState(inicial.ate);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [versao, setVersao] = useState(0);
  const [importando, setImportando] = useState(false);
  const [aviso, setAviso] = useState("");

  const carregarCategorias = useCallback(async () => {
    try {
      const r = await fetch("/api/finance/categories");
      if (r.ok) setCategorias(await r.json());
    } catch {
      /* a tela funciona sem categoria */
    }
  }, []);

  useEffect(() => {
    carregarCategorias();
  }, [carregarCategorias]);

  const mudou = () => setVersao((v) => v + 1);

  const importarAtendimentos = async () => {
    setImportando(true);
    try {
      const r = await fetch("/api/finance/sync-atendimentos", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setAviso(d.error || "Não foi possível importar.");
        return;
      }
      setAviso(
        d.criados === 0
          ? `Nada novo: as ${d.jaExistiam} sessões realizadas já estavam no razão.`
          : `${d.criados} atendimento(s) importado(s) como receita.` +
              (d.jaExistiam ? ` Outros ${d.jaExistiam} já estavam lá.` : ""),
      );
      mudou();
    } finally {
      setImportando(false);
      window.setTimeout(() => setAviso(""), 8000);
    }
  };

  const abas: { id: Aba; rotulo: string; icone: typeof LineChart }[] = [
    { id: "resumo", rotulo: "Resultado", icone: LineChart },
    { id: "lancamentos", rotulo: "Lançamentos", icone: ListPlus },
    { id: "recorrentes", rotulo: "Recorrentes", icone: Repeat },
  ];

  return (
    <div className="space-y-5">
      <div className="bg-white border border-brand-gold/15 rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h3 className="text-xs font-serif font-bold text-brand-brown uppercase tracking-wider">Financeiro</h3>
          <p className="text-[10px] text-brand-brown/65">Entradas, saídas, contas a pagar e o que sobrou no fim.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={importarAtendimentos}
            disabled={importando}
            title="Traz para o razão as sessões já marcadas como realizadas"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold text-brand-brown/80 hover:bg-brand-beige disabled:opacity-50 cursor-pointer"
          >
            <DownloadCloud className="h-3.5 w-3.5" />
            {importando ? "Importando..." : "Importar atendimentos"}
          </button>
          <nav className="flex items-center gap-2">
            {abas.map((a) => {
              const Icone = a.icone;
              const ativa = aba === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => setAba(a.id)}
                  className={
                    "flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold transition-all cursor-pointer " +
                    (ativa ? "bg-brand-brown text-brand-beige shadow-sm" : "bg-brand-brown/5 text-brand-brown/80 hover:bg-brand-beige")
                  }
                >
                  <Icone className="h-3.5 w-3.5 text-brand-gold" />
                  {a.rotulo}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {aviso && (
        <div className="rounded-xl px-4 py-3 text-xs border bg-emerald-50 border-emerald-200 text-emerald-800">{aviso}</div>
      )}

      {aba === "resumo" && (
        <ResumoFinanceiro
          de={de}
          ate={ate}
          base={base}
          versao={versao}
          aoTrocarBase={setBase}
          aoTrocarPeriodo={(d, a) => {
            setDe(d);
            setAte(a);
          }}
        />
      )}

      {aba === "lancamentos" && (
        <LancamentosList de={de} ate={ate} base={base} categorias={categorias} versao={versao} aoMudar={mudou} />
      )}

      {aba === "recorrentes" && <Recorrentes categorias={categorias} aoMudar={mudou} />}
    </div>
  );
}

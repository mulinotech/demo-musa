/**
 * A entrada de mensagens do WhatsApp: está viva? (M5.9, 21/09)
 *
 * ===================================================== POR QUE ESTA FAIXA EXISTE
 *
 * Em 18/09 descobrimos que o caminho de entrada do WhatsApp da clínica estava
 * morto **desde sempre**: 8 mensagens enviadas, zero recebidas, em nenhum dia.
 * A instância nunca tinha sido apontada para o nosso webhook.
 *
 * O que fez esse defeito durar semanas não foi a configuração faltando — foi o
 * **silêncio**. A clínica enviava e via sair; a paciente respondia e a resposta
 * caía num buraco. Nas duas telas, o sistema parecia igual.
 *
 * Esta faixa resolve as duas metades do problema:
 *
 *   1. **Diz** o estado da entrada, em uma frase, sem jargão — e diz o que
 *      fazer quando está errado.
 *   2. **Liga** a entrada por um botão. Até aqui isso só era possível dentro do
 *      painel da Evolution, que a clínica não tem e não deve ter.
 *
 * A regra que decide o que aparece vive no servidor (`services/entrada-whatsapp.js`),
 * em função pura e com teste. Esta tela só desenha — inclusive porque a mesma
 * resposta serve ao painel da plataforma, que vigia as 50 clínicas.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Plug, RefreshCw, Loader2 } from "lucide-react";
import { papelDoToken } from "../lib/api";
import { ehGestao } from "../lib/papeis.mjs";

interface Diagnostico {
  nivel: "ok" | "atencao" | "parada";
  titulo: string;
  detalhe: string;
  oQueFazer: string;
  podeLigar: boolean;
  urlEsperada?: string;
  evolutionIndisponivel?: boolean;
  contagem?: { recebidas: number; enviadas: number };
  fatos?: {
    instancia: string | null;
    webhookLigado: boolean;
    webhookUrl: string | null;
    apontaParaCa: boolean;
    temEventoDeMensagem: boolean;
    ultimaRecebida: string | null;
    diasSemReceber: number | null;
  };
}

const ESTILO = {
  ok: { caixa: "bg-emerald-50 border-emerald-200", texto: "text-emerald-800", Icone: CheckCircle2 },
  atencao: { caixa: "bg-amber-50 border-amber-200", texto: "text-amber-900", Icone: AlertTriangle },
  parada: { caixa: "bg-red-50 border-red-200", texto: "text-red-800", Icone: XCircle },
};

export default function EntradaDeMensagens() {
  const podeLigar = ehGestao(papelDoToken());
  const [d, setD] = useState<Diagnostico | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ligando, setLigando] = useState(false);
  const [erro, setErro] = useState("");

  const conferir = useCallback(async (silencioso?: boolean) => {
    if (!silencioso) setCarregando(true);
    try {
      const r = await fetch("/api/evolution/entrada");
      if (!r.ok) throw new Error();
      setD(await r.json());
      setErro("");
    } catch {
      setErro("Não foi possível conferir a entrada de mensagens agora.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { conferir(); }, [conferir]);

  const ligar = async () => {
    setLigando(true);
    setErro("");
    try {
      const r = await fetch("/api/evolution/entrada/ligar", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setErro(j.error || "Não foi possível ligar a entrada.");
      setD(j);
    } finally {
      setLigando(false);
    }
  };

  if (carregando) {
    return (
      <div className="bg-white p-4 rounded-2xl border border-brand-gold/15 text-[11px] font-mono uppercase tracking-widest text-brand-brown/60">
        Conferindo a entrada de mensagens...
      </div>
    );
  }

  if (!d) {
    return (
      <div className="bg-white p-4 rounded-2xl border border-brand-gold/15 text-xs text-brand-brown/70">
        {erro || "Sem informação sobre a entrada de mensagens."}
      </div>
    );
  }

  const e = ESTILO[d.nivel] || ESTILO.atencao;
  const Icone = e.Icone;

  return (
    <div className={`rounded-2xl border p-5 space-y-3 ${e.caixa}`}>
      <div className="flex items-start gap-3">
        <Icone className={`h-5 w-5 shrink-0 mt-0.5 ${e.texto}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <h3 className={`text-sm font-serif font-bold ${e.texto}`}>{d.titulo}</h3>
            <button
              onClick={() => conferir(true)}
              title="Conferir de novo"
              className={`p-1.5 rounded-lg hover:bg-white/60 shrink-0 cursor-pointer ${e.texto}`}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className={`text-xs mt-1 leading-relaxed ${e.texto} opacity-90`}>{d.detalhe}</p>

          {d.oQueFazer && (
            <p className={`text-xs mt-2 font-semibold ${e.texto}`}>{d.oQueFazer}</p>
          )}

          {/* Os números brutos ficam à vista de propósito: foi a contagem
              "8 enviadas, 0 recebidas" que revelou o defeito em 18/09, e ela
              conta a história melhor do que qualquer rótulo. */}
          {d.contagem && (
            <p className={`text-[11px] mt-2 font-mono ${e.texto} opacity-75`}>
              {d.contagem.recebidas} recebida(s) · {d.contagem.enviadas} enviada(s)
              {d.fatos?.ultimaRecebida ? ` · última entrada em ${d.fatos.ultimaRecebida.split("-").reverse().join("/")}` : ""}
            </p>
          )}

          {d.evolutionIndisponivel && (
            <p className={`text-[11px] mt-2 ${e.texto} opacity-75`}>
              A Evolution não respondeu agora, então o estado do webhook não pôde ser lido.
              O resto do diagnóstico continua valendo.
            </p>
          )}

          {d.podeLigar && podeLigar && (
            <button
              onClick={ligar}
              disabled={ligando}
              className="mt-3 flex items-center gap-1.5 bg-brand-brown hover:bg-brand-brown/95 disabled:opacity-60 text-brand-beige px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest cursor-pointer"
            >
              {ligando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5 text-brand-gold" />}
              {ligando ? "Ligando..." : "Ligar a entrada de mensagens"}
            </button>
          )}

          {d.podeLigar && !podeLigar && (
            <p className={`text-[11px] mt-2 ${e.texto} opacity-80`}>
              Peça à administração ou à gerência para ligar a entrada — só elas mexem nesta configuração.
            </p>
          )}

          {erro && <p className="text-[11px] mt-2 text-red-700 font-semibold">{erro}</p>}

          {/* O endereço fica escrito para quem for conferir do lado da Evolution:
              é a informação que faltava em 18/09 e que obrigou a abrir o painel
              dela para descobrir o que estava configurado. */}
          {d.urlEsperada && (
            <p className={`text-[10px] mt-3 font-mono break-all ${e.texto} opacity-60`}>
              entrega em: {d.urlEsperada}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

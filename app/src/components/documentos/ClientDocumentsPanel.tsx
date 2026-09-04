/**
 * Documentos do paciente (T4.3 e T4.4).
 *
 * O fluxo inteiro numa tela: escolher o modelo, preencher, gerar para
 * assinatura, assinar, abrir.
 *
 * A ordem dos botões acompanha a ordem dos estados, e o botão de "gerar para
 * assinatura" avisa o que está fazendo: **depois dele o conteúdo não muda
 * mais**. É a informação que a pessoa precisa ter antes de clicar, não depois
 * de tentar corrigir.
 */
import { useCallback, useEffect, useState } from "react";
import { FileText, Plus, PenLine, ExternalLink, Ban, Lock, AlertTriangle, Check, Download } from "lucide-react";
import DocumentForm from "./DocumentForm";
import SignaturePad from "./SignaturePad";
import AlertasClinicos from "./AlertasClinicos";
import { Documento, Modelo, ESTILO_STATUS_DOC, ROTULO_TIPO, dataHoraBR } from "./comum";

export default function ClientDocumentsPanel(p: { clientId: string; nomeDoPaciente?: string }) {
  const [docs, setDocs] = useState<Documento[]>([]);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [aberto, setAberto] = useState<Documento | null>(null);
  const [respostas, setRespostas] = useState<Record<string, any>>({});
  const [problemas, setProblemas] = useState<Record<string, string>>({});
  const [assinando, setAssinando] = useState(false);
  const [assinatura, setAssinatura] = useState<{ nome: string; cpf: string; traco: string | null }>({ nome: "", cpf: "", traco: null });
  const [erro, setErro] = useState("");
  const [recado, setRecado] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [chaveAlertas, setChaveAlertas] = useState(0);

  const carregar = useCallback(async () => {
    if (!p.clientId) return;
    const r = await fetch("/api/clients/" + p.clientId + "/documents");
    const j = await r.json();
    if (!r.ok) return setErro(j.error || "Não foi possível listar os documentos.");
    setDocs(j);
    setErro("");
  }, [p.clientId]);

  useEffect(() => {
    carregar();
    fetch("/api/document-templates?active=1")
      .then((r) => r.json())
      .then((d) => setModelos(Array.isArray(d) ? d : []))
      .catch(() => setModelos([]));
  }, [carregar]);

  const abrir = (doc: Documento) => {
    setAberto(doc);
    setRespostas(doc.answers || {});
    setProblemas({});
    setAssinando(false);
    setAssinatura({ nome: p.nomeDoPaciente || "", cpf: "", traco: null });
    setErro("");
    setRecado("");
  };

  const criar = async (modelo: Modelo) => {
    setOcupado(true);
    try {
      const r = await fetch("/api/clients/" + p.clientId + "/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: modelo.id }),
      });
      const j = await r.json();
      if (!r.ok) return setErro(j.error || "Não foi possível criar.");
      await carregar();
      const lista = await (await fetch("/api/clients/" + p.clientId + "/documents")).json();
      const novo = (lista as Documento[]).find((x) => x.id === j.id);
      if (novo) abrir(novo);
    } finally {
      setOcupado(false);
    }
  };

  const salvarRascunho = async () => {
    if (!aberto) return;
    setOcupado(true);
    try {
      const r = await fetch("/api/documents/" + aberto.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: respostas }),
      });
      const j = await r.json();
      if (!r.ok) return setErro(j.error || "Não foi possível salvar.");
      setErro("");
      setRecado(
        j.alertas && j.alertas.length
          ? j.alertas.length + " contraindicação(ões) relatada(s) — já aparecem na faixa do paciente."
          : "Rascunho salvo.",
      );
      setChaveAlertas((n) => n + 1);
      carregar();
    } finally {
      setOcupado(false);
    }
  };

  const gerar = async () => {
    if (!aberto) return;
    if (!window.confirm(
      "Gerar para assinatura?\n\n" +
      "A partir daqui o conteúdo do documento fica IMUTÁVEL — é isso que dá valor à assinatura. " +
      "Para corrigir depois será preciso emitir um documento novo.",
    )) return;
    setOcupado(true);
    try {
      // SALVA ANTES DE GERAR. O `finalize` valida e renderiza as respostas
      // GRAVADAS, não o estado da tela — sem este passo a pessoa preenche o
      // formulário, clica em gerar, e o sistema reclama das perguntas que ela
      // acabou de responder. Foi assim que este defeito apareceu.
      const salvou = await fetch("/api/documents/" + aberto.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: respostas }),
      });
      if (!salvou.ok) {
        const j0 = await salvou.json().catch(() => ({}));
        return setErro(j0.error || "Não foi possível salvar antes de gerar.");
      }
      setChaveAlertas((n) => n + 1);

      const r = await fetch("/api/documents/" + aberto.id + "/finalize", { method: "POST" });
      const j = await r.json();
      if (!r.ok) {
        setErro(j.error || "Não foi possível gerar.");
        const mapa: Record<string, string> = {};
        for (const x of (j.problemas || [])) mapa[x.campo] = x.erro;
        setProblemas(mapa);
        return;
      }
      setErro("");
      setProblemas({});
      setRecado("Documento gerado. Código de integridade: " + String(j.contentHash).slice(0, 16) + "…");
      await carregar();
      setAberto({ ...aberto, status: "AGUARDANDO_ASSINATURA", contentHash: j.contentHash });
      setAssinando(true);
    } finally {
      setOcupado(false);
    }
  };

  const assinar = async () => {
    if (!aberto) return;
    if (!assinatura.nome.trim()) return setErro("Informe o nome completo de quem assina.");
    if (!assinatura.traco) return setErro("Assinatura em branco: peça para assinar no campo.");
    setOcupado(true);
    try {
      const r = await fetch("/api/documents/" + aberto.id + "/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signerName: assinatura.nome,
          signerDocument: assinatura.cpf || null,
          signatureImage: assinatura.traco,
        }),
      });
      const j = await r.json();
      if (!r.ok) return setErro(j.error || "Não foi possível assinar.");
      setErro("");
      setRecado("Documento assinado.");
      setAssinando(false);
      await carregar();
      setAberto({ ...aberto, status: "ASSINADO" });
    } finally {
      setOcupado(false);
    }
  };

  const cancelar = async (doc: Documento) => {
    const motivo = window.prompt("Motivo do cancelamento (obrigatório):\n\nO documento não é apagado — fica no histórico marcado como cancelado.");
    if (!motivo || !motivo.trim()) return;
    const r = await fetch("/api/documents/" + doc.id + "/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: motivo }),
    });
    const j = await r.json();
    if (!r.ok) return setErro(j.error || "Não foi possível cancelar.");
    setRecado("Documento cancelado. O conteúdo continua guardado.");
    carregar();
    if (aberto && aberto.id === doc.id) setAberto({ ...aberto, status: "CANCELADO" });
  };

  const modeloDoAberto = aberto ? modelos.find((m) => m.id === aberto.templateId) : null;
  const rotulo = "block text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold mb-1";
  const campo =
    "w-full bg-white border border-brand-gold/30 rounded px-3 py-2 text-xs text-brand-brown focus:outline-none focus:border-brand-brown transition-colors";

  return (
    <div className="space-y-3">
      <AlertasClinicos key={chaveAlertas} clientId={p.clientId} />

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

      <div className="bg-white border border-brand-gold/15 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-brand-gold/15 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold text-brand-brown flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Documentos · {docs.length}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {modelos.map((m) => (
              <button
                key={m.id}
                onClick={() => criar(m)}
                disabled={ocupado}
                className="flex items-center gap-1 bg-brand-brown hover:bg-brand-brown/95 disabled:opacity-50 text-brand-beige px-2.5 py-1.5 rounded-xl text-[10px] font-bold cursor-pointer"
              >
                <Plus className="h-3 w-3 text-brand-gold" />
                {m.type === "ANAMNESE" ? "Anamnese" : m.type === "TERMO_CONSENTIMENTO" ? "Termo" : m.name}
              </button>
            ))}
            <a
              href={"/api/clients/" + p.clientId + "/export"}
              className="flex items-center gap-1 border border-brand-gold/30 text-brand-brown/75 px-2.5 py-1.5 rounded-xl text-[10px] font-semibold hover:border-brand-brown"
              title="Exportar todos os dados deste paciente (LGPD)"
            >
              <Download className="h-3 w-3" />
              Exportar dados
            </a>
          </div>
        </div>

        <div className="divide-y divide-brand-gold/10">
          {docs.map((doc) => (
            <div key={doc.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
              <button onClick={() => abrir(doc)} className="flex-1 min-w-0 text-left cursor-pointer">
                <p className="text-xs font-semibold text-brand-brown truncate">{doc.title}</p>
                <p className="text-[10px] text-brand-brown/55">
                  {ROTULO_TIPO[doc.type]} · {dataHoraBR(doc.createdAt)}
                  {doc.signedAt && " · assinado " + doc.signedAt}
                  {doc.signerName && " por " + doc.signerName}
                </p>
              </button>
              <span className={"text-[9px] uppercase tracking-wider border rounded px-1.5 py-0.5 shrink-0 " + ESTILO_STATUS_DOC[doc.status].classe}>
                {ESTILO_STATUS_DOC[doc.status].rotulo}
              </span>
              {doc.status !== "RASCUNHO" && (
                <a
                  href={"/api/documents/" + doc.id + "/view"}
                  target="_blank"
                  rel="noreferrer"
                  title="Abrir para ler ou imprimir"
                  className="shrink-0 p-1.5 rounded-lg text-brand-brown/70 hover:bg-brand-beige"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              {doc.status !== "CANCELADO" && (
                <button
                  onClick={() => cancelar(doc)}
                  title="Cancelar documento"
                  className="shrink-0 p-1.5 rounded-lg text-red-600 hover:bg-red-50 cursor-pointer"
                >
                  <Ban className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          {docs.length === 0 && (
            <p className="px-4 py-8 text-center text-[11px] text-brand-brown/50">
              Nenhum documento. Comece pela anamnese.
            </p>
          )}
        </div>
      </div>

      {aberto && (
        <div className="bg-brand-beige/60 border border-brand-gold/20 rounded-2xl p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-brand-brown">{aberto.title}</p>
              <p className="text-[10px] text-brand-brown/60">
                {ESTILO_STATUS_DOC[aberto.status].rotulo}
                {aberto.contentHash && " · integridade " + aberto.contentHash.slice(0, 12) + "…"}
                {modeloDoAberto && " · modelo versão " + modeloDoAberto.version}
              </p>
            </div>
            <button onClick={() => setAberto(null)} className="text-[10px] font-semibold text-brand-brown/60 hover:text-brand-brown cursor-pointer">
              fechar
            </button>
          </div>

          {aberto.status !== "RASCUNHO" && (
            <p className="text-[11px] text-brand-brown/70 bg-white/70 border border-brand-gold/20 rounded px-3 py-2 flex items-start gap-2">
              <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              Conteúdo congelado. Para corrigir, emita um documento novo — é a imutabilidade que dá
              valor à assinatura.
            </p>
          )}

          {modeloDoAberto ? (
            <DocumentForm
              secoes={modeloDoAberto.fields.sections}
              respostas={respostas}
              aoMudar={(r) => {
                setRespostas(r);
                // O aviso de pendência sai assim que a pessoa mexe no campo:
                // deixá-lo aceso depois de respondido faz o formulário parecer
                // travado.
                if (Object.keys(problemas).length) setProblemas({});
              }}
              somenteLeitura={aberto.status !== "RASCUNHO"}
              problemas={problemas}
            />
          ) : (
            <div>
              <p className={rotulo}>Anamnese do cadastro anterior</p>
              <p className="text-xs text-brand-brown/80 whitespace-pre-line bg-white/70 border-l-2 border-brand-gold/40 pl-3 py-2">
                {respostas.texto_livre || "—"}
              </p>
              <p className="text-[10px] text-brand-brown/50 mt-2">
                Texto livre, sem perguntas estruturadas — o sistema não consegue avaliar
                contraindicação a partir dele.
              </p>
            </div>
          )}

          {assinando && aberto.status === "AGUARDANDO_ASSINATURA" && (
            <div className="space-y-3 pt-3 border-t border-brand-gold/20">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={rotulo}>Nome completo de quem assina</label>
                  <input className={campo} value={assinatura.nome} onChange={(e) => setAssinatura({ ...assinatura, nome: e.target.value })} />
                </div>
                <div>
                  <label className={rotulo}>CPF (opcional)</label>
                  <input className={campo} value={assinatura.cpf} onChange={(e) => setAssinatura({ ...assinatura, cpf: e.target.value })} />
                </div>
              </div>
              <SignaturePad aoMudar={(t) => setAssinatura((a) => ({ ...a, traco: t }))} />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            {aberto.status === "RASCUNHO" && (
              <>
                <button
                  onClick={salvarRascunho}
                  disabled={ocupado}
                  className="px-4 py-2 rounded-xl text-[11px] font-semibold text-brand-brown/80 border border-brand-gold/30 hover:border-brand-brown cursor-pointer disabled:opacity-50"
                >
                  Salvar rascunho
                </button>
                <button
                  onClick={gerar}
                  disabled={ocupado}
                  className="flex items-center gap-1.5 bg-brand-brown hover:bg-brand-brown/95 disabled:opacity-50 text-brand-beige px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest cursor-pointer"
                >
                  <Lock className="h-3.5 w-3.5" />
                  Gerar para assinatura
                </button>
              </>
            )}

            {aberto.status === "AGUARDANDO_ASSINATURA" && !assinando && (
              <button
                onClick={() => setAssinando(true)}
                className="flex items-center gap-1.5 bg-brand-brown hover:bg-brand-brown/95 text-brand-beige px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest cursor-pointer"
              >
                <PenLine className="h-3.5 w-3.5" />
                Assinar
              </button>
            )}

            {assinando && (
              <button
                onClick={assinar}
                disabled={ocupado || !assinatura.traco}
                className="flex items-center gap-1.5 bg-brand-brown hover:bg-brand-brown/95 disabled:opacity-40 text-brand-beige px-5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest cursor-pointer"
              >
                <PenLine className="h-3.5 w-3.5" />
                {ocupado ? "Registrando..." : "Confirmar assinatura"}
              </button>
            )}

            {aberto.status !== "RASCUNHO" && (
              <a
                href={"/api/documents/" + aberto.id + "/view"}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[11px] font-semibold text-brand-brown/80 border border-brand-gold/30 hover:border-brand-brown"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Abrir / imprimir
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

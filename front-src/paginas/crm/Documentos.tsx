/**
 * Documentos e anamnese — rota /crm/documentos (Fase 4).
 *
 * Duas abas: os documentos de um paciente e os modelos.
 *
 * A aba de modelos mostra a **versão** de cada um e diz, em texto, por que
 * editar cria a versão seguinte em vez de alterar a atual: um documento
 * assinado aponta para a versão que foi assinada, e mudar o modelo no lugar
 * faria o histórico exibir perguntas que aquela paciente nunca viu.
 */
import { useEffect, useState } from "react";
import { FileText, Search, AlertTriangle, Layers, ShieldCheck } from "lucide-react";
import ClientDocumentsPanel from "../../components/documentos/ClientDocumentsPanel";
import { Modelo, ROTULO_TIPO } from "../../components/documentos/comum";

type Aba = "pacientes" | "modelos";

export default function Documentos() {
  const [aba, setAba] = useState<Aba>("pacientes");
  const [pacientes, setPacientes] = useState<{ id: string; name: string }[]>([]);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [busca, setBusca] = useState("");
  const [escolhido, setEscolhido] = useState<{ id: string; name: string } | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((d) => setPacientes(Array.isArray(d) ? d.map((c: any) => ({ id: c.id, name: c.name })) : []))
      .catch(() => setErro("Não foi possível carregar os pacientes."));
  }, []);

  useEffect(() => {
    if (aba !== "modelos" || modelos.length) return;
    fetch("/api/document-templates")
      .then((r) => r.json())
      .then((d) => setModelos(Array.isArray(d) ? d : []))
      .catch(() => setModelos([]));
  }, [aba, modelos.length]);

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
            <FileText className="h-5 w-5 text-brand-brown" />
          </div>
          <div>
            <h3 className="text-sm font-serif font-bold text-brand-brown">Documentos e anamnese</h3>
            <p className="text-[10px] text-brand-brown/60">
              Assinatura eletrônica simples · dado de saúde com trilha de acesso
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-brand-beige/60 p-1 rounded-xl">
          {([["pacientes", "Pacientes"], ["modelos", "Modelos"]] as [Aba, string][]).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setAba(v)}
              className={botao + " " + (aba === v ? "bg-brand-brown text-brand-beige shadow-sm" : "text-brand-brown/70 hover:bg-white")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {erro && (
        <div className="rounded-2xl px-4 py-3 text-xs border bg-red-50 border-red-200 text-red-700 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <p>{erro}</p>
        </div>
      )}

      {aba === "pacientes" && (
        <div className="space-y-3">
          <div className="bg-white border border-brand-gold/15 rounded-2xl p-4">
            <label className={rotulo}>Paciente</label>
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-brand-brown/40 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                className={campo + " pl-8"}
                placeholder="Buscar por nome…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
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

          {escolhido ? (
            <ClientDocumentsPanel key={escolhido.id} clientId={escolhido.id} nomeDoPaciente={escolhido.name} />
          ) : (
            <p className="text-center text-[11px] text-brand-brown/50 py-6">
              Escolha um paciente para ver a anamnese, os termos e as contraindicações.
            </p>
          )}
        </div>
      )}

      {aba === "modelos" && (
        <div className="space-y-3">
          <div className="bg-white border border-brand-gold/15 rounded-2xl overflow-hidden">
            <p className="px-4 py-2.5 text-[10px] uppercase tracking-widest font-bold text-brand-brown/60 border-b border-brand-gold/15 bg-brand-beige/40">
              Modelos · {modelos.length}
            </p>
            <div className="divide-y divide-brand-gold/10">
              {modelos.map((m) => {
                const perguntas = (m.fields.sections || []).reduce((n, s) => n + (s.fields || []).length, 0);
                const alertas = (m.fields.sections || []).reduce(
                  (n, s) => n + (s.fields || []).filter((f) => f.alert).length, 0);
                return (
                  <div key={m.id} className={"px-4 py-3 flex items-center justify-between gap-3 " + (m.active ? "" : "opacity-50")}>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-brand-brown truncate">{m.name}</p>
                      <p className="text-[10px] text-brand-brown/55">
                        {ROTULO_TIPO[m.type]} · {(m.fields.sections || []).length} seção(ões) · {perguntas} pergunta(s)
                        {alertas > 0 && " · " + alertas + " de contraindicação"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] font-mono text-brand-brown/60 flex items-center gap-1">
                        <Layers className="h-3 w-3" />
                        v{m.version}
                      </span>
                      {!m.active && (
                        <span className="text-[9px] uppercase tracking-wider text-brand-brown/50 border border-brand-gold/25 rounded px-1.5 py-0.5">
                          versão antiga
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {modelos.length === 0 && (
                <p className="px-4 py-8 text-center text-[11px] text-brand-brown/50">Nenhum modelo cadastrado.</p>
              )}
            </div>
          </div>

          <p className="text-[10px] text-brand-brown/55 leading-relaxed">
            <strong>Versão antiga não se apaga.</strong> Um documento assinado aponta para a versão do
            modelo que foi assinada. Se editar o modelo alterasse a versão existente, o histórico
            passaria a exibir perguntas que aquela paciente nunca viu — e a assinatura dela cobriria um
            texto que não existia. Por isso salvar mudanças cria a versão seguinte e tira a anterior de
            circulação, sem removê-la.
          </p>

          <div className="rounded-2xl border border-brand-gold/20 bg-brand-beige/50 px-4 py-3 flex items-start gap-2.5">
            <ShieldCheck className="h-4 w-4 text-brand-gold shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-[11px] font-bold text-brand-brown">Dado de saúde é dado sensível</p>
              <p className="text-[11px] text-brand-brown/70 leading-relaxed">
                Este módulo é fechado para o perfil comercial, cada leitura de documento assinado fica
                registrada nos logs do sistema, e o conteúdo nunca é servido por link direto — só por
                rota autenticada. A exportação dos dados de um paciente também é registrada.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

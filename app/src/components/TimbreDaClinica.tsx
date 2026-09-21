/**
 * O timbre da clínica — o cabeçalho e o rodapé de todo documento impresso.
 *
 * Três campos, preenchidos uma vez. Eles saem no rodapé de toda receita,
 * atestado, anamnese e termo que a clínica imprimir, e são carimbados no
 * documento no momento em que ele é congelado: mudar o endereço aqui amanhã não
 * reescreve o papel de ontem.
 *
 * A prévia ao lado não é enfeite. Endereço é o tipo de campo que a pessoa
 * digita e só descobre que ficou torto quando a paciente já levou o papel para
 * o trabalho — ver como vai imprimir, na hora de digitar, é o que evita isso.
 */
import { useEffect, useState } from "react";
import { Building2, Check, AlertTriangle } from "lucide-react";
import { papelDoToken } from "../lib/api";

interface Timbre {
  nome: string;
  documento: string;
  endereco: string;
  telefone: string;
  email: string;
  contato: string;
}

const VAZIO: Timbre = { nome: "", documento: "", endereco: "", telefone: "", email: "", contato: "" };

export default function TimbreDaClinica() {
  const podeEditar = papelDoToken() === "admin" || papelDoToken() === "gerente";
  const [t, setT] = useState<Timbre>(VAZIO);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  useEffect(() => {
    fetch("/api/clinica")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setT({ ...VAZIO, ...d }))
      .catch(() => setAviso({ tipo: "erro", texto: "Não foi possível carregar os dados da clínica." }))
      .finally(() => setCarregando(false));
  }, []);

  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await fetch("/api/clinica", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endereco: t.endereco, telefone: t.telefone, email: t.email, contato: t.contato,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setAviso({ tipo: "erro", texto: d.error || "Não foi possível salvar." });
      setT({ ...VAZIO, ...d });
      setAviso({ tipo: "ok", texto: "Timbre salvo. Já vale para o próximo documento impresso." });
      window.setTimeout(() => setAviso(null), 6000);
    } finally {
      setSalvando(false);
    }
  };

  const rotulo = "block text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold mb-1";
  const campo =
    "w-full bg-white border border-brand-gold/30 rounded px-3 py-2 text-xs text-brand-brown focus:outline-none focus:border-brand-brown transition-colors disabled:bg-brand-beige/40";

  if (carregando) {
    return <p className="text-[11px] font-mono uppercase tracking-widest text-brand-brown/60 p-6">Carregando...</p>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-serif font-bold text-brand-brown flex items-center gap-2">
          <Building2 className="w-4 h-4" />
          Timbre da clínica
        </h3>
        <p className="text-xs text-brand-brown/70 mt-1">
          Sai no rodapé de todo documento impresso — receita, atestado, anamnese e termo.
        </p>
      </div>

      {aviso && (
        <div
          className={`rounded-xl px-4 py-3 text-xs border flex items-start gap-2 ${
            aviso.tipo === "ok"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-700"
          }`}
        >
          {aviso.tipo === "ok" ? <Check className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />}
          <p>{aviso.texto}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <label className={rotulo}>Nome da clínica</label>
            <input className={campo} value={t.nome} disabled />
            <p className="text-[10px] text-brand-brown/50 mt-1">
              O nome identifica a clínica na plataforma inteira e já aparece em documentos
              emitidos — trocá-lo é pedido à Mulino, para ficar registrado quem mudou.
            </p>
          </div>
          <div>
            <label className={rotulo}>Endereço</label>
            <input
              className={campo}
              value={t.endereco}
              disabled={!podeEditar}
              onChange={(e) => setT({ ...t, endereco: e.target.value })}
              placeholder="Rua Alegre, 123 — São Paulo, SP"
            />
          </div>
          <div>
            <label className={rotulo}>E-mail</label>
            <input
              className={campo}
              value={t.email}
              disabled={!podeEditar}
              onChange={(e) => setT({ ...t, email: e.target.value })}
              placeholder="contato@suaclinica.com.br"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={rotulo}>Telefone</label>
              <input
                className={campo}
                value={t.telefone}
                disabled={!podeEditar}
                onChange={(e) => setT({ ...t, telefone: e.target.value })}
                placeholder="(11) 3456-7890"
              />
            </div>
            <div>
              <label className={rotulo}>Site ou @</label>
              <input
                className={campo}
                value={t.contato}
                disabled={!podeEditar}
                onChange={(e) => setT({ ...t, contato: e.target.value })}
                placeholder="@suaclinica"
              />
            </div>
          </div>
          {podeEditar ? (
            <button
              onClick={salvar}
              disabled={salvando}
              className="bg-brand-brown hover:bg-brand-brown/95 disabled:opacity-60 text-brand-beige px-5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest cursor-pointer"
            >
              {salvando ? "Salvando..." : "Salvar timbre"}
            </button>
          ) : (
            <p className="text-[11px] text-brand-brown/60">
              Só administração e gerência editam o timbre.
            </p>
          )}
        </div>

        {/* A prévia usa a mesma tipografia serifada do documento impresso. */}
        <div>
          <p className={rotulo}>Como vai sair no papel</p>
          <div className="bg-white border border-brand-gold/25 rounded-xl p-5 font-serif text-brand-brown">
            <div className="flex justify-between items-start gap-4 pb-6 border-b border-dashed border-brand-gold/25">
              <div>
                <p className="text-base font-bold leading-tight">Dra. Fulana de Tal</p>
                <p className="text-[9px] uppercase tracking-[0.2em] text-brand-brown/60 mt-1 font-sans">
                  Função — vem do cadastro em Usuários
                </p>
              </div>
              <p className="text-sm text-brand-brown/55">Atestado</p>
            </div>
            <p className="text-[11px] text-brand-brown/45 py-8 text-center italic">o documento</p>
            <div className="pt-3 border-t border-brand-gold/25 text-[10px] text-brand-brown/65 leading-relaxed tracking-wide">
              {t.endereco || <span className="text-brand-brown/35">endereço da clínica</span>}
              <br />
              {t.telefone || t.email || t.contato ? (
                [t.telefone, t.email, t.contato].filter(Boolean).join(" - ")
              ) : (
                <span className="text-brand-brown/35">telefone - e-mail - contato</span>
              )}
            </div>
          </div>
          <p className="text-[10px] text-brand-brown/55 mt-2">
            O nome e a função do alto são de <strong>quem emite</strong>, e vêm da tela de
            Usuários. O rodapé é da clínica, e é o que você preenche aqui.
          </p>
          <p className="text-[10px] text-brand-brown/55 mt-1.5">
            No <strong>receituário</strong> esses mesmos dados saem numa faixa centralizada no
            pé da folha (<em>Contato: telefone ou e-mail</em>, e o endereço abaixo), deixando o
            miolo livre para a prescrição. No atestado eles ficam logo abaixo da assinatura.
          </p>
        </div>
      </div>
    </div>
  );
}

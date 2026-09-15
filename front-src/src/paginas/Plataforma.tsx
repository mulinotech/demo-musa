/**
 * A TELA DA PLATAFORMA (M3.1, 14/09) — cadastrar clínica sem console.
 *
 * ==================================================== POR QUE ELA É SEPARADA DO CRM
 *
 * Porque quem entra aqui **não é de clínica nenhuma**. Ela não tem a barra
 * lateral do CRM, não tem menu de paciente e não tem como chegar a um: o token
 * desta sessão é recusado em toda rota de clínica, no servidor, por lista.
 *
 * A tela reflete isso em vez de esconder: o que ela mostra são clínicas, com
 * **contagens**. Quantas pacientes, quantos acessos, quantos leads. Nunca quem.
 *
 * ============================================== O QUE ELA FAZ COM A SENHA NOVA
 *
 * Nada. A senha do primeiro acesso da clínica é digitada aqui, vai no pedido e
 * **não volta em resposta nenhuma** — a rota devolve o e-mail e a conferência do
 * que nasceu, nunca a senha. Depois de criada, a tela mostra a senha uma única
 * vez, na própria caixa onde ela foi digitada, porque quem cadastra precisa
 * entregá-la a alguém; ao sair da tela ela some, e não há de onde recuperá-la.
 */
import { useState, useEffect, FormEvent } from "react";
import {
  lerTokenPlataforma, salvarTokenPlataforma, limparTokenPlataforma, entrarEmSuporte
} from "../lib/plataforma";
import {
  Building2, LogOut, Plus, ShieldCheck, Users, UserPlus, TrendingUp, Loader2,
  AlertCircle, Check, Copy, KeyRound, Eye
} from "lucide-react";

interface ClinicaDaLista {
  id: string;
  nome: string;
  status: string;
  criada_em: string;
  chave_captacao: string | null;
  pacientes: number;
  acessos: number;
  leads: number;
  agendamentos: number;
  ultimoAgendamento: string | null;
  suporteAte: string | null;
}

interface Nascida {
  clinica: string;
  nome: string;
  chaveCaptacao: string;
  administrador: { email: string };
  conferencia: { ok: boolean; faltas: string[]; categoriasFinanceiras: number };
  senhaMostradaUmaVez: string;
}

const CAIXA = "bg-white border border-brand-gold/15 rounded-2xl";
const CAMPO = "w-full bg-white border border-brand-gold/30 rounded px-3 py-2.5 text-xs " +
              "text-brand-brown focus:outline-none focus:border-brand-brown transition-colors";
const ROTULO = "text-[10px] uppercase tracking-widest text-brand-brown/65 font-bold block mb-1";

export default function Plataforma() {
  const [token, setToken] = useState<string>(lerTokenPlataforma());
  const [clinicas, setClinicas] = useState<ClinicaDaLista[]>([]);
  const [carregando, setCarregando] = useState<boolean>(false);
  const [erro, setErro] = useState<string>("");
  const [abrindoForm, setAbrindoForm] = useState<boolean>(false);
  const [nascida, setNascida] = useState<Nascida | null>(null);

  useEffect(() => {
    const cair = () => { setToken(""); setClinicas([]); };
    window.addEventListener("musa:plataforma-expirada", cair);
    return () => window.removeEventListener("musa:plataforma-expirada", cair);
  }, []);

  async function carregar() {
    setCarregando(true);
    setErro("");
    try {
      const r = await fetch("/api/plataforma/clinicas");
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Falha ao listar.");
      const d = await r.json();
      setClinicas(d.clinicas || []);
    } catch (e: any) {
      setErro(e.message || "Falha ao listar as clinicas.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { if (token) carregar(); }, [token]);

  if (!token) return <Entrada aoEntrar={(t) => { salvarTokenPlataforma(t); setToken(t); }} />;

  return (
    <div className="min-h-screen bg-brand-beige">
      <header className="bg-brand-brown text-brand-beige">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-brand-gold" />
            <div>
              <p className="text-xs font-bold uppercase tracking-widest">Plataforma Musa</p>
              <p className="text-[10px] text-brand-beige/70">
                administração das clínicas · sem acesso a dado de paciente
              </p>
            </div>
          </div>
          <button
            onClick={() => { limparTokenPlataforma(); setToken(""); }}
            className="flex items-center gap-1.5 text-[11px] font-semibold hover:text-brand-gold cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" /> Sair
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-sm font-serif font-bold text-brand-brown uppercase tracking-wider">
            Clínicas nesta instalação {clinicas.length > 0 && (
              <span className="text-brand-brown/50 font-sans normal-case tracking-normal">
                · {clinicas.length}
              </span>
            )}
          </h1>
          <button
            onClick={() => { setAbrindoForm(!abrindoForm); setNascida(null); }}
            className="flex items-center gap-1.5 bg-brand-brown hover:bg-brand-brown/95 text-brand-beige px-4 py-2 rounded-xl text-[11px] font-bold shadow-sm border border-brand-gold/20 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-brand-gold" />
            {abrindoForm ? "Fechar" : "Cadastrar clínica"}
          </button>
        </div>

        {abrindoForm && !nascida && (
          <FormularioDeClinica aoNascer={(n) => { setNascida(n); carregar(); }} />
        )}

        {nascida && <ClinicaNasceu dados={nascida} aoFechar={() => { setNascida(null); setAbrindoForm(false); }} />}

        {erro && (
          <p className="flex items-center gap-2 text-[11px] text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {erro}
          </p>
        )}

        {carregando && clinicas.length === 0 && (
          <p className="flex items-center gap-2 text-[11px] text-brand-brown/60">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> carregando…
          </p>
        )}

        <div className="space-y-3">
          {clinicas.map((c) => <LinhaDaClinica key={c.id} c={c} />)}
        </div>

        <p className="text-[10px] text-brand-brown/50 leading-relaxed pt-4 border-t border-brand-gold/15">
          Esta tela mostra <strong>contagens</strong>, e nunca conteúdo: quantas pacientes cada
          clínica tem é informação da plataforma; quem são elas, não. O acesso desta sessão é
          recusado em toda rota de paciente, documento e agenda — pelo servidor, não por esta tela.
        </p>
      </main>
    </div>
  );
}

function LinhaDaClinica({ c }: { c: ClinicaDaLista }) {
  const [copiada, setCopiada] = useState(false);
  const nascimento = c.criada_em ? new Date(c.criada_em).toLocaleDateString("pt-BR") : "—";
  const cor = c.status === "ativa"
    ? "text-emerald-700 bg-emerald-50 border-emerald-200"
    : "text-amber-700 bg-amber-50 border-amber-200";

  return (
    <div className={CAIXA + " p-4 space-y-3"}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Building2 className="w-3.5 h-3.5 text-brand-gold" />
            <p className="text-xs font-serif font-bold text-brand-brown">{c.nome}</p>
            <span className={"text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full border " + cor}>
              {c.status}
            </span>
          </div>
          <p className="text-[10px] text-brand-brown/55">
            {c.id} · desde {nascimento}
          </p>
        </div>
        {c.chave_captacao && (
          <button
            onClick={() => {
              navigator.clipboard?.writeText(c.chave_captacao || "");
              setCopiada(true);
              setTimeout(() => setCopiada(false), 2000);
            }}
            title="A chave de captação do site desta clínica. Não é senha."
            className="flex items-center gap-1.5 text-[10px] text-brand-brown/70 hover:text-brand-brown border border-brand-gold/25 rounded-lg px-2.5 py-1.5 cursor-pointer"
          >
            {copiada ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
            <code>{c.chave_captacao}</code>
          </button>
        )}
      </div>

      {c.suporteAte && <BotaoDeSuporte clinica={c} />}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Numero icone={<Users className="w-3 h-3" />} rotulo="pacientes" valor={c.pacientes} />
        <Numero icone={<UserPlus className="w-3 h-3" />} rotulo="acessos" valor={c.acessos} />
        <Numero icone={<TrendingUp className="w-3 h-3" />} rotulo="leads" valor={c.leads} />
        <Numero icone={<Building2 className="w-3 h-3" />} rotulo="atendimentos" valor={c.agendamentos} />
      </div>
    </div>
  );
}

/** Só aparece quando a clínica autorizou. Não há botão de "pedir acesso": quem
 *  concede é o dono do dado, na tela dele. */
function BotaoDeSuporte({ clinica }: { clinica: ClinicaDaLista }) {
  const [erro, setErro] = useState("");
  const [indo, setIndo] = useState(false);
  const ate = clinica.suporteAte ? new Date(clinica.suporteAte).toLocaleString("pt-BR") : "";

  async function entrar() {
    setErro("");
    setIndo(true);
    try {
      const r = await fetch("/api/plataforma/clinicas/" + clinica.id + "/entrar", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Falha ao entrar.");
      entrarEmSuporte(d.token, clinica.nome, d.expiraEm);
      window.location.href = "/crm";
    } catch (e: any) {
      setErro(e.message || "Falha ao entrar.");
      setIndo(false);
    }
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 space-y-1.5">
      <p className="text-[10px] text-amber-900">
        Esta clínica autorizou suporte até <strong>{ate}</strong> — leitura, sem ficha de paciente
        nem documento clínico. A entrada fica registrada na trilha dela.
      </p>
      {erro && <p className="text-[10px] text-red-600 font-semibold">{erro}</p>}
      <button onClick={entrar} disabled={indo}
        className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-amber-950 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded cursor-pointer">
        <Eye className="w-3 h-3" /> {indo ? "Entrando…" : "Entrar para suporte"}
      </button>
    </div>
  );
}

function Numero({ icone, rotulo, valor }: { icone: any; rotulo: string; valor: number }) {
  return (
    <div className="bg-brand-beige/60 rounded-xl px-3 py-2">
      <p className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-brand-brown/55 font-bold">
        {icone} {rotulo}
      </p>
      <p className="text-sm font-bold text-brand-brown">{valor}</p>
    </div>
  );
}

function FormularioDeClinica({ aoNascer }: { aoNascer: (n: Nascida) => void }) {
  const [nome, setNome] = useState("");
  const [adminNome, setAdminNome] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminSenha, setAdminSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setEnviando(true);
    try {
      const r = await fetch("/api/plataforma/clinicas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, adminNome, adminEmail, adminSenha })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Falha ao cadastrar a clínica.");
      aoNascer({ ...d, senhaMostradaUmaVez: adminSenha });
    } catch (e: any) {
      setErro(e.message || "Falha ao cadastrar a clínica.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className={CAIXA + " p-5 space-y-4"}>
      <p className="text-[11px] text-brand-brown/70 leading-relaxed">
        A clínica nasce <strong>inteira ou não nasce</strong>: primeiro acesso, 16 categorias
        financeiras, configuração de preço, programa de pontos e os dois modelos de documento, tudo
        numa transação só. E nasce <strong>vazia</strong> — sem paciente, lead ou estoque de
        ninguém.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className={ROTULO}>Nome da clínica *</label>
          <input className={CAMPO} required value={nome} onChange={(e) => setNome(e.target.value)}
                 placeholder="Ex: Clínica Bella Pele" />
        </div>
        <div>
          <label className={ROTULO}>Quem vai administrar *</label>
          <input className={CAMPO} required value={adminNome}
                 onChange={(e) => setAdminNome(e.target.value)} placeholder="Nome completo" />
        </div>
        <div>
          <label className={ROTULO}>E-mail do primeiro acesso *</label>
          <input className={CAMPO} required type="email" value={adminEmail}
                 onChange={(e) => setAdminEmail(e.target.value)} placeholder="nome@clinica.com.br" />
        </div>
        <div className="sm:col-span-2">
          <label className={ROTULO}>Senha do primeiro acesso * (ao menos 10 caracteres)</label>
          <input className={CAMPO} required type="password" value={adminSenha}
                 onChange={(e) => setAdminSenha(e.target.value)} />
          <p className="text-[10px] text-brand-brown/50 mt-1">
            Ela é mostrada uma vez, logo abaixo, para você entregar a quem vai usar — e não fica
            guardada em lugar nenhum que possa devolvê-la depois.
          </p>
        </div>
      </div>

      {erro && (
        <p className="flex items-center gap-2 text-[11px] text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {erro}
        </p>
      )}

      <button type="submit" disabled={enviando}
        className="w-full bg-brand-brown hover:bg-brand-brown/90 disabled:opacity-60 text-brand-beige font-extrabold uppercase text-[10px] tracking-widest py-2.5 rounded cursor-pointer transition-colors">
        {enviando ? "Criando…" : "Criar clínica"}
      </button>
    </form>
  );
}

function ClinicaNasceu({ dados, aoFechar }: { dados: Nascida; aoFechar: () => void }) {
  const c = dados.conferencia;
  return (
    <div className={CAIXA + " p-5 space-y-4 border-emerald-300"}>
      <div className="flex items-center gap-2">
        {c.ok
          ? <Check className="w-4 h-4 text-emerald-600" />
          : <AlertCircle className="w-4 h-4 text-amber-600" />}
        <p className="text-xs font-serif font-bold text-brand-brown">
          {c.ok ? "A clínica nasceu completa." : "A clínica foi criada, MAS está incompleta."}
        </p>
      </div>

      {!c.ok && (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          Faltou: {c.faltas.join("; ")}. Não coloque ninguém para trabalhar nela antes de resolver.
        </p>
      )}

      <dl className="text-[11px] text-brand-brown/80 space-y-1.5">
        <Linha rotulo="Clínica" valor={dados.nome + " (" + dados.clinica + ")"} />
        <Linha rotulo="Entra com" valor={dados.administrador.email} />
        <Linha rotulo="Senha" valor={dados.senhaMostradaUmaVez} destaque />
        <Linha rotulo="Chave de captação do site" valor={dados.chaveCaptacao} />
        <Linha rotulo="Categorias financeiras" valor={String(c.categoriasFinanceiras)} />
      </dl>

      <p className="flex items-start gap-2 text-[10px] text-brand-brown/60 leading-relaxed">
        <KeyRound className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-brand-gold" />
        <span>
          Anote a senha agora: ela não é guardada em texto em lugar nenhum, então nem eu nem você
          conseguimos vê-la de novo depois que esta caixa fechar. Quem entrar pode trocá-la na tela
          de Usuários. O <strong>WhatsApp</strong> da clínica se conecta na tela de Integração, com
          a instância dela — nunca herdando a de outra.
        </span>
      </p>

      <button onClick={aoFechar}
        className="text-[11px] font-semibold text-brand-brown/70 hover:text-brand-brown cursor-pointer">
        Fechar
      </button>
    </div>
  );
}

function Linha({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="flex gap-2 flex-wrap">
      <dt className="text-brand-brown/55 uppercase tracking-widest text-[9px] font-bold pt-0.5 w-40">
        {rotulo}
      </dt>
      <dd className={destaque
        ? "font-mono bg-brand-beige px-2 py-0.5 rounded border border-brand-gold/25"
        : "font-mono"}>{valor}</dd>
    </div>
  );
}

function Entrada({ aoEntrar }: { aoEntrar: (t: string) => void }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [entrando, setEntrando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setEntrando(true);
    try {
      const r = await fetch("/api/plataforma/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.token) throw new Error(d.error || "E-mail ou senha incorretos.");
      aoEntrar(d.token);
    } catch (e: any) {
      setErro(e.message || "Falha ao entrar.");
    } finally {
      setEntrando(false);
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-brand-beige p-6">
      <form onSubmit={enviar} className="w-full max-w-sm flex flex-col items-center space-y-5 text-center">
        <ShieldCheck className="w-10 h-10 text-brand-brown" />
        <div className="space-y-1.5">
          <p className="text-xs font-bold text-brand-brown uppercase tracking-widest">
            Plataforma Musa
          </p>
          <p className="text-[11px] text-brand-brown/70 font-light leading-relaxed">
            Este é o acesso da <strong>Mulino</strong>, e não o de uma clínica. Se você veio
            trabalhar no CRM de um consultório, a porta é a <a href="/login" className="underline">
            tela de entrada do CRM</a>.
          </p>
        </div>

        <div className="w-full space-y-3">
          <input className={CAMPO + " text-center"} type="email" required placeholder="E-mail"
                 value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={CAMPO + " text-center"} type="password" required placeholder="Senha"
                 value={senha} onChange={(e) => setSenha(e.target.value)} />
        </div>

        {erro && <p className="text-[10px] text-red-600 font-semibold">{erro}</p>}

        <button type="submit" disabled={entrando}
          className="w-full bg-brand-brown hover:bg-brand-brown/90 disabled:opacity-60 text-brand-beige font-extrabold uppercase text-[10px] tracking-widest py-2.5 rounded cursor-pointer transition-colors">
          {entrando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}

/**
 * Gestao de usuarios (T0.5).
 *
 * Ate aqui criar um acesso era tarefa de terminal: SSH, ativar o Node, montar
 * um POST na mao. Agora e uma tela.
 *
 * Consome GET/POST/PATCH /api/users, que a tabela REGRAS_DE_PAPEL restringe a
 * `admin`. A tela nao decide permissao - ela so evita mostrar botao que o
 * servidor vai recusar.
 */
import { useEffect, useState } from "react";
import { UserPlus, KeyRound, Power, ShieldCheck, RefreshCw } from "lucide-react";
import { papelDoToken } from "../../lib/api";

interface Usuario {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  last_login_at: string | null;
  created_at: string;
}

const PAPEIS = [
  { valor: "admin", rotulo: "Administrador", ajuda: "Acesso total, inclusive usuários e logs." },
  { valor: "gerente", rotulo: "Gerente", ajuda: "Tudo menos a gestão de usuários." },
  { valor: "profissional", rotulo: "Profissional", ajuda: "Operação clínica, sem cadastros sensíveis." },
  { valor: "vendedor", rotulo: "Vendedor", ajuda: "Só funil, pacientes e atendimento." },
];

const rotuloPapel = (v: string) => PAPEIS.find((p) => p.valor === v)?.rotulo || v;

function dataCurta(v: string | null) {
  if (!v) return "nunca";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export default function Usuarios() {
  const meuPapel = papelDoToken();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [salvando, setSalvando] = useState<string>("");

  // formulário de criação
  const [abrirNovo, setAbrirNovo] = useState(false);
  const [novo, setNovo] = useState({ name: "", email: "", password: "", role: "vendedor" });

  // troca de senha
  const [trocandoSenhaDe, setTrocandoSenhaDe] = useState<string>("");
  const [novaSenha, setNovaSenha] = useState("");

  const mostrar = (tipo: "ok" | "erro", texto: string) => {
    setAviso({ tipo, texto });
    window.setTimeout(() => setAviso(null), 6000);
  };

  const carregar = async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/users");
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        mostrar("erro", e.error || "Não foi possível carregar a lista de usuários.");
        setUsuarios([]);
        return;
      }
      setUsuarios(await r.json());
    } catch {
      mostrar("erro", "Erro de conexão ao carregar os usuários.");
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const criar = async () => {
    if (!novo.name.trim() || !novo.email.trim()) return mostrar("erro", "Nome e e-mail são obrigatórios.");
    if (novo.password.length < 10) return mostrar("erro", "A senha precisa ter ao menos 10 caracteres.");
    setSalvando("novo");
    try {
      const r = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(novo),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return mostrar("erro", d.error || "Não foi possível criar o usuário.");
      mostrar("ok", "Usuário " + novo.name + " criado. Peça para trocar a senha no primeiro acesso.");
      setNovo({ name: "", email: "", password: "", role: "vendedor" });
      setAbrirNovo(false);
      carregar();
    } catch {
      mostrar("erro", "Erro de conexão ao criar o usuário.");
    } finally {
      setSalvando("");
    }
  };

  const alterar = async (u: Usuario, mudanca: Record<string, string>, descricao: string) => {
    setSalvando(u.id);
    try {
      const r = await fetch("/api/users/" + u.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mudanca),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return mostrar("erro", d.error || "Não foi possível salvar a alteração.");
      mostrar("ok", descricao);
      carregar();
    } catch {
      mostrar("erro", "Erro de conexão ao salvar.");
    } finally {
      setSalvando("");
    }
  };

  const trocarSenha = async (u: Usuario) => {
    if (novaSenha.length < 10) return mostrar("erro", "A senha precisa ter ao menos 10 caracteres.");
    await alterar(u, { password: novaSenha }, "Senha de " + u.name + " trocada.");
    setNovaSenha("");
    setTrocandoSenhaDe("");
  };

  const adminsAtivos = usuarios.filter((u) => u.role === "admin" && u.status === "active").length;

  if (meuPapel !== "admin") {
    return (
      <div className="bg-white border border-brand-gold/15 rounded-2xl p-8 text-center">
        <p className="text-xs text-brand-brown/70">Esta área é exclusiva de administradores.</p>
      </div>
    );
  }

  const rotuloCampo = "block text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold mb-1";
  const campo =
    "w-full bg-white border border-brand-gold/30 rounded px-3 py-2 text-xs text-brand-brown focus:outline-none focus:border-brand-brown transition-colors";

  return (
    <div className="space-y-5">
      {aviso && (
        <div
          className={`rounded-xl px-4 py-3 text-xs border ${
            aviso.tipo === "ok"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-700"
          }`}
        >
          {aviso.texto}
        </div>
      )}

      <div className="bg-white border border-brand-gold/15 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h3 className="text-xs font-serif font-bold text-brand-brown uppercase tracking-wider">
            Usuários do sistema
          </h3>
          <p className="text-[10px] text-brand-brown/65">
            {usuarios.length} conta{usuarios.length === 1 ? "" : "s"} · {adminsAtivos} administrador
            {adminsAtivos === 1 ? "" : "es"} ativo{adminsAtivos === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={carregar}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold text-brand-brown/75 hover:bg-brand-beige transition-colors cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar
          </button>
          <button
            onClick={() => setAbrirNovo((v) => !v)}
            className="flex items-center gap-1.5 bg-brand-brown hover:bg-brand-brown/95 text-brand-beige px-4 py-2 rounded-xl text-[11px] font-bold transition-all shadow-sm border border-brand-gold/20 cursor-pointer"
          >
            <UserPlus className="h-3.5 w-3.5 text-brand-gold" />
            {abrirNovo ? "Cancelar" : "Novo usuário"}
          </button>
        </div>
      </div>

      {abrirNovo && (
        <div className="bg-white border border-brand-gold/15 rounded-2xl p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={rotuloCampo}>Nome</label>
              <input
                className={campo}
                value={novo.name}
                onChange={(e) => setNovo({ ...novo, name: e.target.value })}
                placeholder="Nome completo"
              />
            </div>
            <div>
              <label className={rotuloCampo}>E-mail</label>
              <input
                className={campo}
                type="email"
                value={novo.email}
                onChange={(e) => setNovo({ ...novo, email: e.target.value })}
                placeholder="pessoa@inpyx.com"
              />
            </div>
            <div>
              <label className={rotuloCampo}>Senha inicial (mínimo 10 caracteres)</label>
              <input
                className={campo}
                type="text"
                value={novo.password}
                onChange={(e) => setNovo({ ...novo, password: e.target.value })}
                placeholder="senha provisória"
                autoComplete="off"
              />
            </div>
            <div>
              <label className={rotuloCampo}>Papel</label>
              <select className={campo} value={novo.role} onChange={(e) => setNovo({ ...novo, role: e.target.value })}>
                {PAPEIS.map((p) => (
                  <option key={p.valor} value={p.valor}>
                    {p.rotulo}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-brand-brown/55 mt-1">
                {PAPEIS.find((p) => p.valor === novo.role)?.ajuda}
              </p>
            </div>
          </div>

          <button
            onClick={criar}
            disabled={salvando === "novo"}
            className="bg-brand-brown hover:bg-brand-brown/95 disabled:opacity-60 text-brand-beige px-5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest cursor-pointer transition-colors"
          >
            {salvando === "novo" ? "Criando..." : "Criar acesso"}
          </button>
        </div>
      )}

      <div className="bg-white border border-brand-gold/15 rounded-2xl overflow-hidden">
        {carregando ? (
          <p className="p-8 text-center text-[11px] font-mono uppercase tracking-widest text-brand-brown/60">
            Carregando...
          </p>
        ) : usuarios.length === 0 ? (
          <p className="p-8 text-center text-xs text-brand-brown/60">Nenhum usuário para mostrar.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-brand-beige/60">
                <tr className="text-[10px] uppercase tracking-widest text-brand-brown/60">
                  <th className="px-4 py-3 font-bold">Pessoa</th>
                  <th className="px-4 py-3 font-bold">Papel</th>
                  <th className="px-4 py-3 font-bold">Situação</th>
                  <th className="px-4 py-3 font-bold">Último acesso</th>
                  <th className="px-4 py-3 font-bold text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u) => {
                  const ultimoAdmin = u.role === "admin" && u.status === "active" && adminsAtivos <= 1;
                  const ocupado = salvando === u.id;
                  return (
                    <tr key={u.id} className="border-t border-brand-gold/10 align-top">
                      <td className="px-4 py-3">
                        <p className="text-xs font-semibold text-brand-brown">{u.name}</p>
                        <p className="text-[11px] text-brand-brown/55">{u.email}</p>
                        {ultimoAdmin && (
                          <p className="text-[10px] text-amber-700 mt-1 flex items-center gap-1">
                            <ShieldCheck className="h-3 w-3" />
                            único administrador ativo
                          </p>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <select
                          className="bg-white border border-brand-gold/30 rounded px-2 py-1.5 text-[11px] text-brand-brown cursor-pointer disabled:opacity-50"
                          value={u.role}
                          disabled={ocupado || ultimoAdmin}
                          onChange={(e) =>
                            alterar(u, { role: e.target.value }, u.name + " agora é " + rotuloPapel(e.target.value) + ".")
                          }
                        >
                          {PAPEIS.map((p) => (
                            <option key={p.valor} value={p.valor}>
                              {p.rotulo}
                            </option>
                          ))}
                        </select>
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            u.status === "active"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-neutral-100 text-neutral-500 border border-neutral-200"
                          }`}
                        >
                          {u.status === "active" ? "ativo" : "inativo"}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-[11px] text-brand-brown/65 whitespace-nowrap">
                        {dataCurta(u.last_login_at)}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex flex-col items-end gap-2">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setTrocandoSenhaDe(trocandoSenhaDe === u.id ? "" : u.id);
                                setNovaSenha("");
                              }}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold text-brand-brown/75 hover:bg-brand-beige transition-colors cursor-pointer"
                            >
                              <KeyRound className="h-3 w-3" />
                              Senha
                            </button>

                            <button
                              disabled={ocupado || ultimoAdmin}
                              onClick={() =>
                                alterar(
                                  u,
                                  { status: u.status === "active" ? "inactive" : "active" },
                                  u.name + (u.status === "active" ? " foi inativado." : " foi reativado."),
                                )
                              }
                              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                                u.status === "active"
                                  ? "text-red-600 hover:bg-red-50"
                                  : "text-emerald-700 hover:bg-emerald-50"
                              }`}
                            >
                              <Power className="h-3 w-3" />
                              {u.status === "active" ? "Inativar" : "Reativar"}
                            </button>
                          </div>

                          {trocandoSenhaDe === u.id && (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                autoComplete="off"
                                value={novaSenha}
                                onChange={(e) => setNovaSenha(e.target.value)}
                                placeholder="nova senha (10+)"
                                className="bg-white border border-brand-gold/30 rounded px-2 py-1.5 text-[11px] text-brand-brown w-44 focus:outline-none focus:border-brand-brown"
                              />
                              <button
                                onClick={() => trocarSenha(u)}
                                disabled={ocupado}
                                className="bg-brand-brown text-brand-beige px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider cursor-pointer disabled:opacity-60"
                              >
                                Salvar
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[10px] text-brand-brown/50 leading-relaxed">
        O papel definido aqui é o que vale para o acesso. A equipe cadastrada em <strong>Cadastros</strong> é conteúdo
        de demonstração do CRM e não concede login.
      </p>
    </div>
  );
}

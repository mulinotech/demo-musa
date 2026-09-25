/**
 * Tela de entrada do CRM (T0.5).
 *
 * Saiu de dentro do CrmDashboard para virar a rota /login. Ganha com isso um
 * endereco proprio para onde mandar quem chegou sem token ou cuja sessao
 * expirou, e o CrmDashboard deixa de carregar 700 KB de console para desenhar
 * um formulario de duas linhas.
 */
import { useState, FormEvent } from "react";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { salvarToken, papelDoToken } from "../lib/api";

export default function TelaLogin() {
  const navigate = useNavigate();
  const local = useLocation();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  const parametros = new URLSearchParams(local.search);
  const expirada = parametros.get("expirada") === "1";
  const destino = (local.state as any)?.de || parametros.get("destino") || "/crm";

  // Ja autenticado nao precisa ver o formulario.
  if (papelDoToken()) return <Navigate to={destino} replace />;

  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setErro("");
    try {
      const resposta = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: senha }),
      });
      const dados = await resposta.json();
      if (!resposta.ok) {
        setErro(dados.error || "E-mail ou senha incorretos.");
        return;
      }
      salvarToken(dados.token || "");
      localStorage.setItem("userRole", dados.role);
      if (dados.salespersonName) {
        localStorage.setItem("salespersonName", dados.salespersonName);
      } else if (dados.role === "admin") {
        localStorage.setItem("salespersonName", "Dra. Musa (Proprietaria)");
      }
      if (dados.salespersonId) {
        localStorage.setItem("salespersonId", dados.salespersonId);
      } else {
        localStorage.removeItem("salespersonId");
      }
      navigate(destino, { replace: true });
    } catch {
      setErro("Erro ao conectar com o servidor.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-beige p-6">
      <div className="w-full max-w-sm flex flex-col items-center space-y-6 text-center">
        <Lock className="w-10 h-10 text-brand-brown" />

        <div className="space-y-2">
          <h4 className="text-xs font-bold text-brand-brown uppercase tracking-widest">
            Acesso de altissima seguranca
          </h4>
          <p className="text-[11px] text-brand-brown/70 font-light leading-relaxed">
            Entre com seu e-mail e senha para acessar os prontuarios, fichas de anamnese e logs do CRM.
          </p>
        </div>

        {expirada && (
          <p className="w-full text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 leading-relaxed">
            Sua sessao expirou por inatividade. Entre novamente para continuar.
          </p>
        )}

        <form onSubmit={entrar} className="w-full space-y-3.5">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Seu e-mail"
            autoComplete="username"
            autoFocus
            className="w-full bg-white border border-brand-gold/30 rounded px-4 py-2.5 text-center text-xs text-brand-brown focus:outline-none focus:border-brand-brown transition-colors"
          />
          <input
            type="password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="Sua senha"
            autoComplete="current-password"
            className="w-full bg-white border border-brand-gold/30 rounded px-4 py-2.5 text-center text-xs text-brand-brown focus:outline-none focus:border-brand-brown transition-colors"
          />
          {erro && <p className="text-[10px] text-red-600 font-semibold">{erro}</p>}
          <button
            type="submit"
            disabled={enviando}
            className="w-full bg-brand-brown hover:bg-brand-brown/90 disabled:opacity-60 text-brand-beige font-extrabold uppercase text-[10px] tracking-widest py-2.5 rounded cursor-pointer transition-colors"
          >
            {enviando ? "Verificando..." : "Desbloquear painel"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => navigate("/")}
          className="text-[10px] uppercase tracking-widest text-brand-brown/50 hover:text-brand-brown transition-colors cursor-pointer"
        >
          Voltar ao site
        </button>
      </div>
    </div>
  );
}

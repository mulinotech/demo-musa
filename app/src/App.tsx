/**
 * Roteador da aplicacao (T0.5).
 *
 * Ate aqui o CRM era um modal dentro da pagina publica, aberto por uma flag em
 * localStorage. Duas consequencias: nao existia URL para uma tela do CRM, e o
 * visitante do site baixava o console inteiro (1 MB de JavaScript) so para ler
 * a pagina de captacao.
 *
 * Agora o site e a rota "/", o CRM e "/crm/*" e cada tela do console e um
 * pedaco separado, carregado sob demanda. Tela nova de modulo entra como uma
 * linha aqui e um arquivo em src/paginas/crm/.
 */
import { Suspense, lazy, useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import PaginaSite from "./paginas/PaginaSite";
import TelaLogin from "./paginas/TelaLogin";
import RotaProtegida from "./paginas/RotaProtegida";

const ConsoleCrm = lazy(() => import("./components/CrmDashboard"));
const VisaoGeral = lazy(() => import("./paginas/crm/VisaoGeral"));
const Funil = lazy(() => import("./paginas/crm/Funil"));
const Pacientes = lazy(() => import("./paginas/crm/Pacientes"));
const Atendimento = lazy(() => import("./paginas/crm/Atendimento"));
const IntegracaoWhatsApp = lazy(() => import("./paginas/crm/IntegracaoWhatsApp"));
const Cadastros = lazy(() => import("./paginas/crm/Cadastros"));
const Logs = lazy(() => import("./paginas/crm/Logs"));
const Usuarios = lazy(() => import("./paginas/crm/Usuarios"));
const Precificacao = lazy(() => import("./paginas/crm/Precificacao"));

function CarregandoConsole() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-brand-beige space-y-3">
      <div className="h-8 w-8 rounded-full border-2 border-brand-gold border-t-transparent animate-spin" />
      <p className="text-[11px] font-mono uppercase tracking-widest text-brand-brown">
        Carregando o console...
      </p>
    </div>
  );
}

/**
 * O interceptador de fetch em lib/api.ts derruba a sessao quando o servidor
 * responde 401 e dispara "musa:sessao-expirada". Ate a T0.5 ninguem escutava:
 * a tela simplesmente parava de atualizar, sem explicacao. Agora leva ao login
 * com aviso e guarda o endereco para voltar depois de entrar.
 */
function AvisoDeSessaoExpirada() {
  const navigate = useNavigate();
  useEffect(() => {
    const aoExpirar = () => {
      const aqui = window.location.pathname + window.location.search;
      if (aqui.indexOf("/crm") !== 0) return;
      navigate("/login?expirada=1&destino=" + encodeURIComponent(aqui), { replace: true });
    };
    window.addEventListener("musa:sessao-expirada", aoExpirar);
    return () => window.removeEventListener("musa:sessao-expirada", aoExpirar);
  }, [navigate]);
  return null;
}

function ConsoleProtegido() {
  const navigate = useNavigate();
  return (
    <RotaProtegida>
      <Suspense fallback={<CarregandoConsole />}>
        <ConsoleCrm onClose={() => navigate("/", { replace: true })} />
      </Suspense>
    </RotaProtegida>
  );
}

export default function App() {
  return (
    <>
      <AvisoDeSessaoExpirada />
      <Routes>
        <Route path="/" element={<PaginaSite />} />
        <Route path="/login" element={<TelaLogin />} />

        <Route path="/crm" element={<ConsoleProtegido />}>
          <Route index element={<VisaoGeral />} />
          <Route path="funil" element={<Funil />} />
          <Route path="pacientes" element={<Pacientes />} />
          <Route path="atendimento" element={<Atendimento />} />
          <Route path="whatsapp" element={<IntegracaoWhatsApp />} />
          <Route path="cadastros" element={<Cadastros />} />
          <Route
            path="precificacao"
            element={
              <RotaProtegida papeis={["admin", "gerente"]}>
                <Precificacao />
              </RotaProtegida>
            }
          />
          <Route path="logs" element={<Logs />} />
          <Route
            path="usuarios"
            element={
              <RotaProtegida papeis={["admin"]}>
                <Usuarios />
              </RotaProtegida>
            }
          />
          {/* Caminho desconhecido dentro do CRM volta para a visao geral. */}
          <Route path="*" element={<Navigate to="/crm" replace />} />
        </Route>

        {/* Qualquer outro caminho volta para o site em vez de mostrar tela branca. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

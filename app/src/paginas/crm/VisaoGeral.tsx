/**
 * A Visão Geral não recebe mais as listas do contexto (M5.8).
 *
 * Ela buscava leads, pacientes, tratamentos e catálogo para somar tudo no
 * navegador. A conta foi para o servidor — `/api/dashboard/visao-geral` e
 * `/api/dashboard/dinheiro` — e com ela foram os quatro `props`.
 *
 * Efeito colateral bem-vindo: a tela de abertura deixou de depender do
 * carregamento de quatro listas inteiras para desenhar cinco números.
 */
import DashboardOverview from "../../components/DashboardOverview";

export default function VisaoGeral() {
  return <DashboardOverview />;
}

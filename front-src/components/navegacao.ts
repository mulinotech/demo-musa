/**
 * O mapa de navegação do console, em um lugar só.
 *
 * Antes esta lista morava dentro da barra de topo. Ela saiu de lá porque agora
 * duas coisas precisam dela: a barra lateral, que desenha os itens, e a barra
 * de topo, que descobre o nome da tela aberta para escrever no cabeçalho. Duas
 * cópias divergiriam no primeiro módulo novo.
 *
 * Os grupos são por FREQUÊNCIA DE USO, não por ordem de criação: a recepção
 * vive em cinco telas o dia inteiro e abre as outras de vez em quando. Módulo
 * novo entra em `GESTAO`, a não ser que seja de uso diário.
 *
 * `papeis: []` significa "todo mundo que está logado". A lista aqui é só para
 * não mostrar o que a pessoa não usa — quem barra o acesso de fato é
 * RotaProtegida no front e REGRAS_DE_PAPEL no servidor.
 */
import {
  MessageSquare, Users, Calendar, Settings, LayoutDashboard,
  MessageCircle, ShieldCheck, UserCog, Calculator, Wallet, CalendarDays,
  Boxes, Award, FileText,
} from "lucide-react";
import { GESTAO as PAPEIS_DE_GESTAO, DINHEIRO } from "../lib/papeis.mjs";

/* ===================================== OS PAPÉIS ESTREITOS NO MENU (M6.7)
 *
 * `papeis: []` continua querendo dizer "todo mundo que está logado" — e é
 * justamente por isso que os papéis novos precisam aparecer aqui nomeados.
 * Com a lista vazia, a Agenda apareceria para o contador; ele clicaria, e o
 * servidor devolveria 403 numa tela que não sabe explicar 403.
 *
 * Quando um item vale para "todo mundo MENOS os estreitos", a lista é escrita
 * por inteiro. Fica mais comprida e diz a verdade. */
const CLINICA = ["admin", "gerente", "gerente_admin", "gerente_comercial", "profissional", "vendedor"];
const RECEPCAO = CLINICA.concat(["secretaria"]);

export interface ItemDeMenu {
  to: string;
  fim: boolean;
  label: string;
  icon: typeof Users;
  papeis: string[];
}

export const DIA_A_DIA: ItemDeMenu[] = [
  { to: "/crm",             fim: true,  label: "Visão Geral",         icon: LayoutDashboard, papeis: PAPEIS_DE_GESTAO.concat(["profissional"], DINHEIRO) },
  { to: "/crm/agenda",      fim: false, label: "Agenda",              icon: CalendarDays,    papeis: RECEPCAO },
  { to: "/crm/pacientes",   fim: false, label: "Pacientes",           icon: Users,           papeis: RECEPCAO },
  { to: "/crm/atendimento", fim: false, label: "Atendimento",         icon: MessageSquare,   papeis: RECEPCAO },
  { to: "/crm/funil",       fim: false, label: "Funil & Leads",       icon: Calendar,        papeis: RECEPCAO },
];

export const GESTAO: ItemDeMenu[] = [
  { to: "/crm/financeiro",  fim: false, label: "Financeiro",          icon: Wallet,          papeis: DINHEIRO },
  // Precificação mostra margem e custo por hora: é a estrutura da clínica, e o
  // contador é leitura do que já aconteceu. Por isso este item não usa DINHEIRO.
  { to: "/crm/precificacao",fim: false, label: "Precificação",        icon: Calculator,      papeis: ["admin", "gerente", "gerente_admin", "financeiro"] },
  { to: "/crm/estoque",     fim: false, label: "Estoque",             icon: Boxes,           papeis: ["admin", "gerente", "gerente_admin", "gerente_comercial", "profissional", "financeiro"] },
  { to: "/crm/fidelidade",  fim: false, label: "Fidelidade",          icon: Award,           papeis: ["admin", "gerente", "gerente_admin", "gerente_comercial", "profissional"] },
  { to: "/crm/documentos",  fim: false, label: "Documentos",          icon: FileText,        papeis: ["admin", "gerente", "gerente_admin", "gerente_comercial", "profissional"] },
  { to: "/crm/cadastros",   fim: false, label: "Cadastros",           icon: Settings,        papeis: PAPEIS_DE_GESTAO.concat(["profissional"]) },
  { to: "/crm/whatsapp",    fim: false, label: "Integração WhatsApp", icon: MessageCircle,   papeis: PAPEIS_DE_GESTAO.concat(["profissional", "secretaria"]) },
  { to: "/crm/usuarios",    fim: false, label: "Usuários",            icon: UserCog,         papeis: ["admin"] },
  { to: "/crm/logs",        fim: false, label: "Logs do Sistema",     icon: ShieldCheck,     papeis: PAPEIS_DE_GESTAO.concat(["profissional"]) },
];

export const TODOS_OS_ITENS = DIA_A_DIA.concat(GESTAO);

export const visivelPara = (papel: string) => (i: ItemDeMenu) =>
  i.papeis.length === 0 || i.papeis.includes(papel);

/** Nome da tela aberta, para o cabeçalho. O mais específico ganha: `/crm/agenda`
 *  casa com "/crm" e com "/crm/agenda", e quem vale é o segundo. */
export const telaDaRota = (caminho: string): ItemDeMenu | null => {
  let achado: ItemDeMenu | null = null;
  for (const i of TODOS_OS_ITENS) {
    const casa = i.fim ? caminho === i.to : caminho === i.to || caminho.startsWith(i.to + "/");
    if (casa && (!achado || i.to.length > achado.to.length)) achado = i;
  }
  return achado;
};

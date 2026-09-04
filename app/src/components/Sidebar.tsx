/**
 * Barra lateral do console.
 *
 * Substitui as abas no topo, que tinham chegado a treze itens e obrigado a
 * esconder metade do sistema atrás de um menu suspenso. Vertical, o espaço é
 * praticamente ilimitado: **tudo fica visível ao mesmo tempo**, agrupado por
 * frequência de uso, e ninguém precisa lembrar em qual gaveta está o estoque.
 *
 * Três comportamentos, um por tamanho de tela:
 *
 * - **Desktop**: fixa à esquerda. Pode ser recolhida para só os ícones, e a
 *   escolha fica guardada no navegador — quem trabalha em notebook de 13"
 *   ganha 12 rem de largura útil e não quer refazer isso todo dia.
 * - **Tablet e celular**: sai do fluxo e vira gaveta, aberta pelo botão de
 *   menu na barra de topo, com fundo escurecido atrás.
 * - **Sempre**: trocar de tela fecha a gaveta. Deixá-la aberta por cima da
 *   tela nova esconde justamente o que a pessoa acabou de pedir.
 *
 * A paleta é a mesma do resto: fundo branco, texto `brand-brown`, ícone
 * `brand-gold`, item ativo em marrom cheio com o texto em bege.
 */
import { useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LogOut, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { DIA_A_DIA, GESTAO, ItemDeMenu, visivelPara } from "./navegacao";
import { papelDoToken } from "../lib/api";
import logoMusa from "../assets/logo-musa-crm.png";

const ROTULO_DO_PAPEL: Record<string, string> = {
  admin: "Administração",
  gerente: "Gerência",
  profissional: "Profissional",
  vendedor: "Comercial",
};

export default function Sidebar(p: {
  aberta: boolean;
  recolhida: boolean;
  aoFechar: () => void;
  aoRecolher: () => void;
  onSair?: () => void;
}) {
  const papel = papelDoToken();
  const local = useLocation();
  const filtro = visivelPara(papel);
  const diaADia = DIA_A_DIA.filter(filtro);
  const gestao = GESTAO.filter(filtro);

  // Navegou? A gaveta fecha. No desktop ela não é gaveta, então isto é inócuo.
  useEffect(() => {
    p.aoFechar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local.pathname]);

  // Esc fecha a gaveta. Sem isso, quem abriu sem querer fica preso atrás do
  // fundo escurecido, clicando em coisas que não respondem.
  useEffect(() => {
    if (!p.aberta) return;
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === "Escape") p.aoFechar(); };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [p.aberta, p]);

  const largura = p.recolhida ? "lg:w-[4.5rem]" : "lg:w-60";

  const item = (i: ItemDeMenu) => {
    const Icone = i.icon;
    return (
      <NavLink
        key={i.to}
        to={i.to}
        end={i.fim}
        title={p.recolhida ? i.label : undefined}
        className={({ isActive }) =>
          "group flex items-center gap-2.5 rounded-xl text-xs font-semibold transition-all duration-200 " +
          (p.recolhida ? "lg:justify-center lg:px-0 px-3 py-2.5" : "px-3 py-2.5") + " " +
          (isActive
            ? "bg-brand-brown text-brand-beige shadow-sm"
            : "text-brand-brown/80 hover:bg-brand-beige hover:text-brand-brown")
        }
      >
        {({ isActive }) => (
          <>
            <Icone className={"h-4 w-4 shrink-0 " + (isActive ? "text-brand-gold" : "text-brand-gold/80")} />
            <span className={"whitespace-nowrap " + (p.recolhida ? "lg:hidden" : "")}>{i.label}</span>
          </>
        )}
      </NavLink>
    );
  };

  const grupo = (titulo: string, itens: ItemDeMenu[]) =>
    itens.length === 0 ? null : (
      <div className="space-y-1">
        <p
          className={
            "text-[9px] uppercase tracking-[0.14em] font-bold text-brand-brown/40 px-3 pt-3 pb-1 " +
            (p.recolhida ? "lg:text-center lg:px-0 lg:tracking-normal" : "")
          }
        >
          {p.recolhida ? <span className="hidden lg:inline">·</span> : null}
          <span className={p.recolhida ? "lg:hidden" : ""}>{titulo}</span>
        </p>
        {itens.map(item)}
      </div>
    );

  return (
    <>
      {/* Fundo escurecido — só existe enquanto a gaveta está aberta no celular */}
      {p.aberta && (
        <div
          onClick={p.aoFechar}
          className="fixed inset-0 z-[60] bg-brand-brown/40 backdrop-blur-sm lg:hidden"
          aria-hidden
        />
      )}

      <aside
        className={
          "fixed inset-y-0 left-0 z-[61] w-64 bg-white border-r border-brand-gold/20 flex flex-col " +
          "transition-transform duration-300 lg:static lg:translate-x-0 lg:transition-[width] " +
          largura + " " +
          (p.aberta ? "translate-x-0" : "-translate-x-full")
        }
      >
        {/* marca */}
        <div className="flex items-center gap-2.5 px-4 h-20 shrink-0 border-b border-brand-gold/15">
          <div className="bg-brand-brown text-brand-beige p-2 rounded-full shadow-inner flex items-center justify-center shrink-0">
            <img src={logoMusa} alt="Musa CRM" className="h-6 w-6 object-contain" />
          </div>
          <div className={"min-w-0 " + (p.recolhida ? "lg:hidden" : "")}>
            <h1 className="text-sm font-serif font-semibold tracking-wide text-brand-brown leading-tight truncate">
              Dra. Musa Estética
            </h1>
            <p className="text-[9px] font-sans tracking-widest uppercase text-brand-gold font-medium truncate">
              CRM Concierge &amp; Skin AI
            </p>
          </div>
          <button
            onClick={p.aoFechar}
            className="ml-auto p-2 rounded-full text-brand-brown/60 hover:bg-brand-beige cursor-pointer lg:hidden"
            aria-label="Fechar menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* navegação */}
        <nav className="flex-1 overflow-y-auto px-2.5 pb-3">
          {grupo("Dia a dia", diaADia)}
          {grupo("Gestão", gestao)}
        </nav>

        {/* rodapé */}
        <div className="shrink-0 border-t border-brand-gold/15 p-2.5 space-y-1">
          <div className={"px-3 py-1 " + (p.recolhida ? "lg:hidden" : "")}>
            <p className="text-[9px] uppercase tracking-widest text-brand-brown/40 font-bold">Acesso</p>
            <p className="text-[11px] text-brand-brown/70">{ROTULO_DO_PAPEL[papel] || papel || "—"}</p>
          </div>

          <button
            onClick={p.aoRecolher}
            className={
              "hidden lg:flex items-center gap-2.5 w-full rounded-xl px-3 py-2 text-[11px] font-semibold " +
              "text-brand-brown/60 hover:bg-brand-beige hover:text-brand-brown cursor-pointer transition-colors " +
              (p.recolhida ? "justify-center px-0" : "")
            }
            title={p.recolhida ? "Expandir menu" : "Recolher menu"}
          >
            {p.recolhida ? <PanelLeftOpen className="h-4 w-4 shrink-0" /> : <PanelLeftClose className="h-4 w-4 shrink-0" />}
            <span className={p.recolhida ? "hidden" : ""}>Recolher menu</span>
          </button>

          {p.onSair && (
            <button
              onClick={p.onSair}
              className={
                "flex items-center gap-2.5 w-full rounded-xl px-3 py-2 text-[11px] font-semibold " +
                "text-brand-brown/70 hover:bg-red-50 hover:text-red-700 cursor-pointer transition-colors " +
                (p.recolhida ? "lg:justify-center lg:px-0" : "")
              }
              title="Sair do console"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              <span className={p.recolhida ? "lg:hidden" : ""}>Sair</span>
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

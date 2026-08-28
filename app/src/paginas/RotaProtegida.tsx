/**
 * Guarda de rota (T0.5).
 *
 * Fonte de verdade e o token, lido por papelDoToken() - nunca uma flag em
 * localStorage. Sem token, manda para /login guardando o destino, para a pessoa
 * cair na tela que pediu depois de entrar.
 *
 * Isto e conforto de navegacao, nao seguranca: quem manda de verdade e a tabela
 * REGRAS_DE_PAPEL no servidor. Nao troque uma coisa pela outra.
 */
import { ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { papelDoToken } from "../lib/api";

interface Props {
  children: ReactElement;
  papeis?: string[];
}

export default function RotaProtegida({ children, papeis }: Props) {
  const local = useLocation();
  const papel = papelDoToken();

  if (!papel) {
    return <Navigate to="/login" replace state={{ de: local.pathname + local.search }} />;
  }

  if (papeis && papeis.length && !papeis.includes(papel)) {
    return <Navigate to="/crm" replace />;
  }

  return children;
}

/**
 * A SESSÃO DA PLATAFORMA — separada da do CRM, de propósito (M3.1, 14/09).
 *
 * ============================================== POR QUE DUAS CHAVES NO NAVEGADOR
 *
 * Porque são duas identidades diferentes, e não dois perfis da mesma. A mesma
 * pessoa pode ser administradora da Musa **e** operadora da plataforma; são dois
 * acessos, com duas senhas, e dois tokens que não se substituem.
 *
 * Guardar os dois na mesma chave faria a última entrada derrubar a anterior: ao
 * entrar na plataforma, o CRM aberto na outra aba começaria a mandar um token
 * sem clínica e receberia 401 a cada clique — um "sua sessão expirou" que
 * ninguém conseguiria explicar.
 *
 * ==================================================== E O QUE ELA NÃO GUARDA
 *
 * Nada além do token. O que o operador alcança é decidido no servidor, por lista
 * de rotas; qualquer coisa que esta tela guardasse sobre permissão seria uma
 * segunda verdade, e a errada.
 */

const CHAVE = 'musa_token_plataforma';

export function salvarTokenPlataforma(token: string): void {
  try { if (token) localStorage.setItem(CHAVE, token); } catch { /* aba anônima */ }
}

export function lerTokenPlataforma(): string {
  try { return localStorage.getItem(CHAVE) || ''; } catch { return ''; }
}

export function limparTokenPlataforma(): void {
  try { localStorage.removeItem(CHAVE); } catch { /* aba anônima */ }
}

/** O endereço é o que decide qual token vai. Uma função só, para o
 *  interceptador e a tela nunca discordarem sobre o que é "da plataforma". */
export function ehChamadaDaPlataforma(url: string): boolean {
  return url.indexOf('/api/plataforma/') !== -1;
}

/* ===================== MODO SUPORTE (M3.1b)
 *
 * O operador entra numa clínica que o autorizou e recebe uma sessão de LEITURA.
 * Ela NÃO substitui a sessão do CRM: fica em chave própria, com um sinalizador.
 * Sem isso, entrar em suporte deslogaria a pessoa do consultório dela — e a dona
 * da Mulino é as duas coisas. */
const CHAVE_SUPORTE = 'musa_token_suporte';
const CHAVE_MODO = 'musa_modo_suporte';

export function entrarEmSuporte(token: string, clinica: string, expiraEm: string): void {
  try {
    localStorage.setItem(CHAVE_SUPORTE, token);
    localStorage.setItem(CHAVE_MODO, JSON.stringify({ clinica, expiraEm }));
  } catch { /* aba anônima */ }
}

export function sairDoSuporte(): void {
  try {
    localStorage.removeItem(CHAVE_SUPORTE);
    localStorage.removeItem(CHAVE_MODO);
  } catch { /* aba anônima */ }
}

export function lerTokenDeSuporte(): string {
  try { return localStorage.getItem(CHAVE_SUPORTE) || ''; } catch { return ''; }
}

export function modoSuporte(): { clinica: string; expiraEm: string } | null {
  try {
    const cru = localStorage.getItem(CHAVE_MODO);
    if (!cru || !lerTokenDeSuporte()) return null;
    return JSON.parse(cru);
  } catch { return null; }
}

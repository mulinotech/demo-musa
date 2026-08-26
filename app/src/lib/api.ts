/**
 * Camada de autenticação do front (T0.3 etapa 2).
 *
 * O CRM tem 51 chamadas fetch espalhadas por 11 componentes. Em vez de editar
 * uma a uma, instalamos um interceptador no window.fetch que injeta o
 * Authorization em qualquer chamada para /api. Um ponto único, um lugar para
 * mudar quando a autenticação evoluir.
 */

const CHAVE_TOKEN = 'musa_token';

export function salvarToken(token: string): void {
  if (token) localStorage.setItem(CHAVE_TOKEN, token);
}

export function lerToken(): string {
  try {
    return localStorage.getItem(CHAVE_TOKEN) || '';
  } catch {
    return '';
  }
}

export function limparToken(): void {
  localStorage.removeItem(CHAVE_TOKEN);
  localStorage.removeItem('musa_crm_auth');
  localStorage.removeItem('userRole');
  localStorage.removeItem('salespersonId');
  localStorage.removeItem('salespersonName');
}

/** Papel do usuário lido do token, não do localStorage. */
export function papelDoToken(): string {
  const t = lerToken();
  if (!t) return '';
  try {
    const carga = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (carga.exp && carga.exp * 1000 < Date.now()) return '';
    return carga.papel || '';
  } catch {
    return '';
  }
}

let instalado = false;

export function instalarInterceptador(): void {
  if (instalado) return;
  instalado = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof entrada === 'string' ? entrada
      : entrada instanceof URL ? entrada.href
      : (entrada as Request).url;

    const ehApi = url.indexOf('/api/') !== -1;
    const ehLogin = url.indexOf('/api/auth/login') !== -1;

    if (ehApi && !ehLogin) {
      const token = lerToken();
      if (token) {
        const headers = new Headers(
          (init && init.headers) || (entrada instanceof Request ? entrada.headers : undefined)
        );
        if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
        init = Object.assign({}, init, { headers });
      }
    }

    const resposta = await originalFetch(entrada as RequestInfo, init);

    // Token expirado ou revogado: derruba a sessão em vez de deixar a tela vazia sem explicação.
    if (resposta.status === 401 && ehApi && !ehLogin) {
      limparToken();
      window.dispatchEvent(new CustomEvent('musa:sessao-expirada'));
    }

    return resposta;
  };
}

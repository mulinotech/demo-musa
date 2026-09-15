/**
 * Camada de autenticação do front (T0.3 etapa 2).
 *
 * O CRM tem 51 chamadas fetch espalhadas por 11 componentes. Em vez de editar
 * uma a uma, instalamos um interceptador no window.fetch que injeta o
 * Authorization em qualquer chamada para /api. Um ponto único, um lugar para
 * mudar quando a autenticação evoluir.
 */

import { lerTokenPlataforma, limparTokenPlataforma, ehChamadaDaPlataforma,
         lerTokenDeSuporte, modoSuporte, sairDoSuporte } from './plataforma';

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

/** Papel do usuário lido do token, não do localStorage.
 *
 *  Em MODO SUPORTE o papel sai do token de suporte: o operador da Mulino não tem
 *  sessão de clínica nenhuma, e sem isto o guarda de rota o mandaria para a tela
 *  de login — a tela de entrada de um CRM onde ele não tem acesso. */
export function papelDoToken(): string {
  const t = modoSuporte() ? lerTokenDeSuporte() : lerToken();
  if (!t) return '';
  try {
    const carga = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (carga.exp && carga.exp * 1000 < Date.now()) return '';
    return carga.papel || '';
  } catch {
    return '';
  }
}

/* ==================== ABRIR E BAIXAR COISAS DA API SEM LINK COMUM
 *
 * Um `<a href="/api/documents/x/view">` NÃO funciona, e o motivo é este:
 * navegação do navegador não passa pelo interceptador de `fetch` logo abaixo,
 * então a requisição sai **sem** `Authorization` e o porteiro responde
 * `{"error":"Sessao nao autenticada ou expirada."}`. Foi o que aconteceu com
 * "Abrir / imprimir" e "Exportar dados" — e nunca tinha funcionado: o link
 * estava errado desde que foi escrito.
 *
 * (Detalhe que explica por que a sessão dela continuou de pé: esse 401 vem de
 * uma NAVEGAÇÃO, não de um `fetch`, então o `limparToken()` daqui não roda. O
 * sintoma é uma aba com JSON de erro, e não um logout.)
 *
 * **O token não vai na URL.** Seria a correção de uma linha, e é a errada: o
 * endereço fica no histórico do navegador, no log de acesso do servidor e no
 * `Referer` de qualquer coisa que a página carregar depois. Token é
 * credencial; credencial anda em cabeçalho.
 *
 * A aba é aberta ANTES da busca, de propósito. `window.open` chamado depois de
 * um `await` já não está na pilha do clique, e bloqueador de pop-up barra —
 * calado, que é o pior jeito de falhar. */

/** Abre um endereço da API (que responde HTML) numa aba nova.
 *  Devolve '' se deu certo, ou a mensagem de erro para a tela mostrar. */
export async function abrirDaApi(url: string): Promise<string> {
  const aba = window.open('', '_blank');
  if (!aba) return 'O navegador bloqueou a nova aba. Libere o pop-up deste site e tente de novo.';
  aba.document.write('<p style="font:14px system-ui;padding:24px">Abrindo…</p>');
  try {
    const r = await fetch(url);
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      aba.close();
      return e.error || 'Não foi possível abrir o documento.';
    }
    const html = await r.text();
    aba.document.open();
    aba.document.write(html);
    aba.document.close();
    return '';
  } catch {
    aba.close();
    return 'Falha de rede ao abrir o documento.';
  }
}

/** Baixa um endereço da API (que responde JSON) como arquivo. */
export async function baixarDaApi(url: string, nomeArquivo: string): Promise<string> {
  try {
    const r = await fetch(url);
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      return e.error || 'Não foi possível exportar os dados.';
    }
    const texto = JSON.stringify(await r.json(), null, 2);
    const endereco = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = endereco;
    link.download = nomeArquivo;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Sem isto o blob fica na memória da aba até ela ser fechada.
    setTimeout(() => URL.revokeObjectURL(endereco), 10000);
    return '';
  } catch {
    return 'Falha de rede ao exportar os dados.';
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
    /* As DUAS portas de entrada ficam de fora da injeção: mandar um token para
     * a rota que existe justamente para obter um seria, no mínimo, confuso — e,
     * no caso da plataforma, faria a tentativa de entrada carregar a credencial
     * de outra identidade. */
    const ehLogin = url.indexOf('/api/auth/login') !== -1 ||
                    url.indexOf('/api/plataforma/login') !== -1;

    /* QUAL TOKEN VAI DEPENDE DO ENDEREÇO (M3.1, 14/09).
     *
     * A plataforma e o CRM são identidades diferentes, guardadas em chaves
     * diferentes. Mandar o token do CRM para `/api/plataforma/*` renderia 403 em
     * toda chamada da tela nova; mandar o da plataforma para o CRM renderia 403
     * em tudo — e o `limparToken()` lá embaixo derrubaria a sessão certa por
     * causa da errada. */
    const daPlataforma = ehChamadaDaPlataforma(url);

    if (ehApi && !ehLogin) {
      /* Em modo suporte, as chamadas de CLÍNICA levam o token de suporte — e a
       * sessão do CRM fica intacta na chave dela. As da plataforma continuam
       * levando a da plataforma. */
      const token = daPlataforma ? lerTokenPlataforma()
                  : (modoSuporte() ? lerTokenDeSuporte() : lerToken());
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
      if (daPlataforma) {
        limparTokenPlataforma();
        window.dispatchEvent(new CustomEvent('musa:plataforma-expirada'));
      } else if (modoSuporte()) {
        // A sessão de suporte caiu (expirou ou a clínica revogou). Só ela cai.
        sairDoSuporte();
        window.dispatchEvent(new CustomEvent('musa:suporte-encerrado'));
      } else {
        limparToken();
        window.dispatchEvent(new CustomEvent('musa:sessao-expirada'));
      }
    }

    return resposta;
  };
}

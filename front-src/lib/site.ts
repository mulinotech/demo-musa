/**
 * O que o site público sabe da clínica dele (relatório de QA de 15/10).
 *
 * BUG-01: o formulário e o quiz postavam `/api/leads` sem a chave de captação,
 * recebiam 503 e mostravam "Sua mensagem foi enviada!" assim mesmo — dez envios,
 * zero leads. BUG-02: os botões de WhatsApp levavam a `wa.me/5511900000000`.
 *
 * As duas respostas vêm de `GET /api/site` (server/routes/site-publico.js),
 * buscada uma vez por visita e repartida entre os componentes.
 */
import { useEffect, useState } from "react";

export interface DadosDoSite {
  clinica: string;
  whatsapp: string | null;
  telefone: string;
  captacao: string;
  procedimentos: { id: string; nome: string; duracao: string }[];
}

let pedido: Promise<DadosDoSite | null> | null = null;

export function carregarSite(): Promise<DadosDoSite | null> {
  if (!pedido) {
    pedido = fetch("/api/site")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return pedido;
}

export function useSite(): DadosDoSite | null {
  const [dados, setDados] = useState<DadosDoSite | null>(null);
  useEffect(() => {
    let vivo = true;
    carregarSite().then((d) => { if (vivo) setDados(d); });
    return () => { vivo = false; };
  }, []);
  return dados;
}

/** Link de WhatsApp com a mensagem pronta. Sem número cadastrado, leva ao
 *  formulário de contato — melhor do que um número que não existe. */
export function linkWhatsApp(site: DadosDoSite | null, texto: string): string {
  if (site && site.whatsapp) {
    return "https://wa.me/" + site.whatsapp + "?text=" + encodeURIComponent(texto);
  }
  return "#contato";
}

/** Abre o link num botão (quando o componente navega por `window.open`). */
export function abrirWhatsApp(site: DadosDoSite | null, texto: string): void {
  const url = linkWhatsApp(site, texto);
  if (url.charAt(0) === "#") {
    const alvo = document.getElementById("contato");
    if (alvo) alvo.scrollIntoView({ behavior: "smooth" });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** O nome do catálogo que corresponde a um nome de vitrine ("Ultraformer MPT -
 *  Lifting 3D" → "Ultraformer MPT"). BUG-15: o funil recebia nomes que não
 *  existem no catálogo, e a Agenda e o Financeiro não reconheciam o lead. */
export function nomeDoCatalogo(site: DadosDoSite | null, nome: string): string {
  if (!site || !site.procedimentos.length) return nome;
  const n = normalizar(nome);
  const exato = site.procedimentos.find((p) => normalizar(p.nome) === n);
  if (exato) return exato.nome;
  // o nome de catálogo mais longo contido no nome de vitrine (ou vice-versa)
  const candidatos = site.procedimentos
    .filter((p) => { const c = normalizar(p.nome); return c && (n.indexOf(c) !== -1 || c.indexOf(n) !== -1); })
    .sort((a, b) => b.nome.length - a.nome.length);
  return candidatos.length ? candidatos[0].nome : nome;
}

function normalizar(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/^protocolo\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface LeadDoSite {
  name: string;
  whatsapp: string;
  email?: string;
  treatment: string;
  message?: string;
  scoreResult?: string;
}

/** Grava o lead. Só devolve `ok` com 201 — qualquer outra resposta é erro, e a
 *  tela tem de dizer isso e oferecer o WhatsApp. O id e a data saem do
 *  servidor, não do navegador. */
export async function enviarLead(lead: LeadDoSite): Promise<{ ok: boolean; erro?: string }> {
  const site = await carregarSite();
  const url = "/api/leads" + (site && site.captacao ? "?captacao=" + encodeURIComponent(site.captacao) : "");
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({}, lead, { source: "site", status: "novo" })),
    });
    if (r.status === 201) return { ok: true };
    const corpo = await r.json().catch(() => ({} as any));
    return { ok: false, erro: corpo.error || "Não foi possível enviar agora." };
  } catch {
    return { ok: false, erro: "Sem conexão com a clínica agora." };
  }
}

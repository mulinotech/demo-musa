/**
 * O endereço que o formulário do site precisa usar — a chave de captação.
 *
 * ========================================================= POR QUE ISTO EXISTE
 *
 * `POST /api/leads` é a única gravação sem sessão: o formulário do site posta
 * ali de fora, sem ninguém logado. Até 11/09 ele não tinha como dizer de qual
 * clínica era o contato — e a rota gravava na única que existia, recusando com
 * 503 se houvesse mais de uma. A saída escolhida foi a **chave pública por
 * clínica**, e esta tela é onde ela aparece.
 *
 * Sem esta tela a chave não serviria para nada: ela nasce numa migration, e
 * ninguém vai pedir o valor de uma coluna toda vez que mexer no site.
 *
 * ============================================ E ELA PODE APARECER NA TELA
 *
 * A chave vive no código da página de quem a usa — qualquer visitante do site
 * da clínica a lê apertando Ctrl+U. Mostrá-la a quem administra a própria
 * clínica não revela nada de novo. O que ela permite é **criar um lead naquela
 * clínica**, e nada mais: não lê paciente, não lê agenda, não lê nada.
 *
 * O texto da tela diz isso em voz alta, e o motivo é concreto: chamada de
 * "chave", ela seria guardada como senha, e alguém acabaria achando que colá-la
 * no site foi um vazamento.
 */
import { useEffect, useState } from "react";
import { Link2, Copy, Check, ChevronDown, ChevronUp } from "lucide-react";
import { papelDoToken } from "../lib/api";

interface Captacao {
  chave: string | null;
  url: string | null;
  exemplo: string | null;
}

export default function CaptacaoCard() {
  const [dados, setDados] = useState<Captacao | null>(null);
  const [aberto, setAberto] = useState(false);
  const [copiado, setCopiado] = useState("");

  const ehGestao = ["admin", "gerente"].includes(papelDoToken());

  useEffect(() => {
    if (!ehGestao) return;
    // A rota é de admin/gerente. Para os outros papéis o cartão nem é buscado —
    // e um 403 aqui não vira erro em tela: quem não pode ver simplesmente não vê.
    fetch("/api/leads/captacao")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setDados(d))
      .catch(() => {});
  }, [ehGestao]);

  if (!ehGestao || !dados || !dados.chave) return null;

  const copiar = (texto: string, qual: string) => {
    navigator.clipboard.writeText(texto).then(
      () => {
        setCopiado(qual);
        window.setTimeout(() => setCopiado(""), 2000);
      },
      () => setCopiado("erro"),
    );
  };

  return (
    <div className="mx-4 mt-4 rounded-2xl border border-brand-gold/20 bg-white">
      <button
        onClick={() => setAberto(!aberto)}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 cursor-pointer"
      >
        <span className="flex items-center gap-2 text-xs font-bold text-brand-brown">
          <Link2 className="h-4 w-4 text-brand-gold" />
          Formulário do site
          <span className="font-normal text-brand-brown/55">
            — o endereço para onde o seu site manda os contatos
          </span>
        </span>
        {aberto ? (
          <ChevronUp className="h-4 w-4 text-brand-brown/50 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-brand-brown/50 shrink-0" />
        )}
      </button>

      {aberto && (
        <div className="px-4 pb-4 space-y-3 border-t border-brand-gold/15 pt-3">
          <p className="text-[11px] text-brand-brown/70 leading-relaxed">
            O formulário do seu site deve enviar para o endereço abaixo. É ele que diz ao sistema
            que o contato é <strong>desta clínica</strong> — sem ele, quando houver mais de uma
            clínica cadastrada, o envio é recusado em vez de ser arquivado na clínica errada.
          </p>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-brown/60 mb-1">
              Endereço de envio
            </label>
            <div className="flex items-stretch gap-2">
              <code className="flex-1 min-w-0 bg-brand-beige/60 border border-brand-gold/20 rounded-lg px-2.5 py-2 text-[10px] font-mono text-brand-brown overflow-x-auto whitespace-nowrap">
                {dados.url}
              </code>
              <button
                onClick={() => copiar(dados.url || "", "url")}
                className="shrink-0 flex items-center gap-1 px-3 rounded-lg text-[10px] font-bold uppercase tracking-wider text-brand-brown/80 border border-brand-gold/30 hover:border-brand-brown cursor-pointer"
              >
                {copiado === "url" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copiado === "url" ? "Copiado" : "Copiar"}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-brown/60 mb-1">
              Formulário pronto, para quem faz o site
            </label>
            <div className="flex items-stretch gap-2">
              <pre className="flex-1 min-w-0 bg-brand-beige/60 border border-brand-gold/20 rounded-lg px-2.5 py-2 text-[10px] font-mono text-brand-brown overflow-x-auto">
                {dados.exemplo}
              </pre>
              <button
                onClick={() => copiar(dados.exemplo || "", "html")}
                className="shrink-0 flex items-center gap-1 px-3 rounded-lg text-[10px] font-bold uppercase tracking-wider text-brand-brown/80 border border-brand-gold/30 hover:border-brand-brown cursor-pointer"
              >
                {copiado === "html" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copiado === "html" ? "Copiado" : "Copiar"}
              </button>
            </div>
          </div>

          {/* Dito em voz alta de propósito. Chamada de "chave", ela seria
            * guardada como senha — e alguém concluiria que colá-la no site foi
            * um vazamento. */}
          <p className="text-[10px] text-brand-brown/55 leading-relaxed border-t border-brand-gold/15 pt-2.5">
            <strong>Este endereço não é uma senha.</strong> Ele fica visível no código da página do
            seu site, e é assim que tem de ser. O que ele permite é criar um contato nesta clínica —
            nada além disso: não dá acesso a paciente, agenda, financeiro ou qualquer outra tela.
          </p>
        </div>
      )}
    </div>
  );
}

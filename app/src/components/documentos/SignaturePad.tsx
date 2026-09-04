/**
 * Campo de assinatura (T4.4).
 *
 * FUNCIONA COM O DEDO, e isso não é detalhe: quem assina é a paciente, num
 * tablet, e um canvas que só escuta evento de mouse produz uma tela em que
 * nada acontece quando ela desenha. Aqui os eventos são de *pointer*, que
 * cobrem dedo, caneta e mouse com o mesmo código, e o `touch-action: none`
 * impede o navegador de interpretar o traço como rolagem da página.
 *
 * A resolução do canvas acompanha o `devicePixelRatio` — sem isso o traço sai
 * serrilhado no PDF e na impressão.
 *
 * O AVISO SOBRE O TIPO DE ASSINATURA FICA AQUI, junto ao campo, e o texto é
 * deliberado: assinatura eletrônica **simples**, com validade entre as partes
 * pela MP 2.200-2/2001 e pela Lei 14.063/2020 porque há registro de autoria e
 * integridade — e **não** assinatura digital qualificada com certificado
 * ICP-Brasil. Chamar de "assinatura digital certificada" seria afirmação falsa
 * sobre o valor probatório do documento.
 */
import { useEffect, useRef, useState } from "react";
import { Eraser, PenLine } from "lucide-react";

export default function SignaturePad(p: {
  aoMudar: (dataUrl: string | null) => void;
  altura?: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const desenhando = useRef(false);
  /* `tracou` é ref, e não estado, DE PROPÓSITO.
   *
   * O handler que finaliza o traço é criado no render e enxerga o valor de
   * estado daquele momento. Com `useState`, `setTemTraco(true)` durante o
   * movimento não muda o valor que o `onPointerUp` já capturou — ele continua
   * lendo `false` e devolve `null` ao formulário. Resultado: a paciente assina,
   * levanta o dedo, e a assinatura é descartada em silêncio. Ref não tem esse
   * problema porque é sempre o valor atual.
   *
   * O estado continua existindo, mas só para a interface (mostrar o "Limpar" e
   * esconder a instrução). */
  const tracou = useRef(false);
  const [temTraco, setTemTraco] = useState(false);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const escala = window.devicePixelRatio || 1;
    const largura = c.parentElement ? c.parentElement.clientWidth : 320;
    const altura = p.altura || 150;
    c.width = largura * escala;
    c.height = altura * escala;
    c.style.width = largura + "px";
    c.style.height = altura + "px";
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(escala, escala);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#2b1c12";
  }, [p.altura]);

  const ponto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const comecar = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    // Captura o ponteiro: sem isto, arrastar para fora do canvas e voltar
    // produz um traço partido.
    ref.current!.setPointerCapture(e.pointerId);
    desenhando.current = true;
    const { x, y } = ponto(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const mover = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!desenhando.current) return;
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = ponto(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!tracou.current) {
      tracou.current = true;
      setTemTraco(true);
    }
  };

  const terminar = () => {
    if (!desenhando.current) return;
    desenhando.current = false;
    const c = ref.current;
    if (!c) return;
    p.aoMudar(tracou.current ? c.toDataURL("image/png") : null);
  };

  const limpar = () => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    tracou.current = false;
    setTemTraco(false);
    p.aoMudar(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-widest text-brand-brown/60 font-bold flex items-center gap-1.5">
          <PenLine className="h-3 w-3" />
          Assinatura
        </p>
        {temTraco && (
          <button
            onClick={limpar}
            className="flex items-center gap-1 text-[10px] font-semibold text-brand-brown/60 hover:text-brand-brown cursor-pointer"
          >
            <Eraser className="h-3 w-3" />
            Limpar
          </button>
        )}
      </div>

      <div className="bg-white border-2 border-dashed border-brand-gold/40 rounded-xl overflow-hidden">
        <canvas
          ref={ref}
          onPointerDown={comecar}
          onPointerMove={mover}
          onPointerUp={terminar}
          onPointerLeave={terminar}
          onPointerCancel={terminar}
          style={{ touchAction: "none", display: "block", cursor: "crosshair" }}
        />
      </div>

      {!temTraco && (
        <p className="text-[10px] text-brand-brown/45 text-center">
          Assine no campo acima — com o dedo, caneta ou mouse.
        </p>
      )}

      <p className="text-[10px] text-brand-brown/60 leading-relaxed bg-white/70 border border-brand-gold/20 rounded px-3 py-2">
        <strong>Assinatura eletrônica simples.</strong> Ficam registrados o traço, a data, a hora, o
        endereço de rede e um código de integridade do conteúdo — elementos que comprovam autoria e
        integridade, e dão validade entre as partes (MP 2.200-2/2001 e Lei 14.063/2020). <strong>Não
        é</strong> assinatura digital qualificada com certificado ICP-Brasil.
      </p>
    </div>
  );
}

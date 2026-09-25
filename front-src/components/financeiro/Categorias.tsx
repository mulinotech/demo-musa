/**
 * Categorias do Financeiro — criar, renomear, aposentar, e marcar captação.
 *
 * ================================================== POR QUE ESTA ABA NASCEU
 *
 * Duas coisas se juntaram aqui.
 *
 * A primeira é a M5.8: o Custo por Lead precisa saber **o que a clínica
 * considera investimento em captação**, e essa decisão precisa de um lugar onde
 * seja tomada e revista. O CPL soma as despesas do período nas categorias
 * marcadas. Antes ele era `R$ 18,50` escrito no código.
 *
 * A segunda apareceu na primeira vez que a Silvia abriu esta tela, em 18/09: as
 * **16 categorias vêm de fábrica** e entre as de despesa existe só *Marketing* —
 * não existe "Anúncios" nem "Agência". E **não havia tela nenhuma para criar
 * categoria**: a rota estava no servidor desde a T2.4 e nunca teve botão.
 *
 * Isso importa justamente para o CPL. Com tudo dentro de *Marketing* — agência,
 * anúncio, material impresso, brinde, patrocínio —, o cartão responde "quanto
 * custou o marketing inteiro por lead", e não "quanto custou atrair um lead",
 * que era a pergunta do time comercial. Separar as linhas é o que torna o número
 * utilizável.
 *
 * ============================================ AS TRÊS REGRAS DESTA TELA
 *
 * 1. **Só DESPESA pode ser captação.** O servidor recusa o resto mesmo que a
 *    tela peça: marcar uma categoria de receita faria o CPL somar faturamento
 *    como se fosse gasto com anúncio.
 * 2. **Desativar não apaga.** O lançamento de março continua apontando para a
 *    categoria, e o relatório de março continua com o nome dela. Aposentar só a
 *    tira das listas de escolha daqui para a frente.
 * 3. **Categoria aposentada continua visível AQUI**, numa lista à parte. Se
 *    estiver marcada como captação, ela continua contando no CPL dos períodos em
 *    que houve gasto — e esconder isso deixaria a clínica com uma marcação que
 *    ela não tem como desmarcar.
 */
import { useCallback, useEffect, useState } from "react";
import { Megaphone, Check, AlertTriangle, Plus, Pencil, Archive, RotateCcw, X } from "lucide-react";
import { Categoria } from "./comum";

type Tipo = "RECEITA" | "DESPESA";

export default function Categorias(p: { aoMudar: () => void }) {
  const [lista, setLista] = useState<Categoria[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [ocupada, setOcupada] = useState<string>("");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");

  const [novoNome, setNovoNome] = useState("");
  const [novoTipo, setNovoTipo] = useState<Tipo>("DESPESA");
  const [criando, setCriando] = useState(false);

  const [editando, setEditando] = useState<string>("");
  const [nomeEditado, setNomeEditado] = useState("");

  /* Esta tela pede as INATIVAS junto; as outras telas do Financeiro continuam
     recebendo só as ativas, que é o que uma lista de escolha deve mostrar. */
  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/finance/categories?incluirInativas=1");
      if (r.ok) setLista(await r.json());
      else setErro("Não foi possível carregar as categorias.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const avisar = (texto: string) => {
    setOk(texto);
    window.setTimeout(() => setOk(""), 5000);
  };

  /* Erro apaga o aviso de sucesso anterior. Os dois na tela ao mesmo tempo
     fazem a pessoa ler "criada" e "ja existe" lado a lado, sem saber qual das
     duas frases e' sobre o que ela acabou de fazer. */
  const falhar = (texto: string) => { setOk(""); setErro(texto); };

  const recarregar = async () => {
    await carregar();
    p.aoMudar();           // as listas de lançamento também precisam saber
  };

  const criar = async () => {
    const nome = novoNome.trim();
    if (!nome) return;
    setCriando(true);
    setErro("");
    try {
      const r = await fetch("/api/finance/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nome, type: novoTipo }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return falhar(d.error || "Não foi possível criar a categoria.");
      setNovoNome("");
      await recarregar();
      avisar(`Categoria "${nome}" criada.`);
    } finally {
      setCriando(false);
    }
  };

  const alterar = async (c: Categoria, campos: Record<string, unknown>, aviso: string) => {
    setOcupada(c.id);
    setErro("");
    try {
      const r = await fetch("/api/finance/categories/" + c.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campos),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        return falhar(d.error || "Não foi possível salvar.");
      }
      await recarregar();
      avisar(aviso);
    } finally {
      setOcupada("");
    }
  };

  const despesas = lista.filter((c) => c.type === "DESPESA" && c.ativa !== false);
  const receitas = lista.filter((c) => c.type === "RECEITA" && c.ativa !== false);
  const inativas = lista.filter((c) => c.ativa === false);
  const marcadas = lista.filter((c) => c.contaNoCpl).length;

  const campo =
    "bg-white border border-brand-gold/30 rounded-xl px-3 py-2 text-xs text-brand-brown focus:outline-none focus:border-brand-brown transition-colors";
  const botaoLeve =
    "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold bg-brand-brown/5 text-brand-brown/70 hover:bg-brand-beige cursor-pointer disabled:opacity-50";

  const linha = (c: Categoria, opcoes?: { inativa?: boolean }) => (
    <li key={c.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
      {editando === c.id ? (
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <input
            className={campo + " flex-1"}
            value={nomeEditado}
            autoFocus
            onChange={(e) => setNomeEditado(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && nomeEditado.trim()) {
                setEditando("");
                alterar(c, { name: nomeEditado.trim() }, "Nome atualizado.");
              }
              if (e.key === "Escape") setEditando("");
            }}
          />
          <button
            onClick={() => { setEditando(""); alterar(c, { name: nomeEditado.trim() }, "Nome atualizado."); }}
            disabled={!nomeEditado.trim()}
            className="bg-brand-brown text-brand-beige px-3 py-1.5 rounded-xl text-[11px] font-bold cursor-pointer disabled:opacity-50"
          >
            Salvar
          </button>
          <button onClick={() => setEditando("")} className={botaoLeve} title="Cancelar">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <span className={"text-sm " + (opcoes?.inativa ? "text-brand-brown/45 line-through" : "text-brand-brown")}>
          {c.name}
        </span>
      )}

      {editando !== c.id && (
        <div className="flex items-center gap-2">
          {c.type === "DESPESA" && (
            <button
              onClick={() => alterar(c, { contaNoCpl: !c.contaNoCpl },
                c.contaNoCpl ? `"${c.name}" saiu do CPL.` : `"${c.name}" passou a contar no CPL.`)}
              disabled={ocupada === c.id}
              className={
                "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-all cursor-pointer disabled:opacity-50 " +
                (c.contaNoCpl
                  ? "bg-brand-brown text-brand-beige"
                  : "bg-brand-brown/5 text-brand-brown/70 hover:bg-brand-beige")
              }
            >
              {c.contaNoCpl && <Check className="h-3.5 w-3.5 text-brand-gold" />}
              {c.contaNoCpl ? "Conta no CPL" : "Marcar como captação"}
            </button>
          )}

          {!opcoes?.inativa && (
            <button
              onClick={() => { setEditando(c.id); setNomeEditado(c.name); }}
              className={botaoLeve}
              title="Renomear"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}

          <button
            onClick={() => alterar(c, { active: !!opcoes?.inativa },
              opcoes?.inativa ? `"${c.name}" voltou para a lista.` : `"${c.name}" foi aposentada. Nenhum lançamento foi alterado.`)}
            disabled={ocupada === c.id}
            className={botaoLeve}
            title={opcoes?.inativa ? "Reativar" : "Aposentar (não apaga nada)"}
          >
            {opcoes?.inativa ? <RotateCcw className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}
    </li>
  );

  const bloco = (titulo: string, itens: Categoria[], rodape?: string, inativa?: boolean) => (
    <div className="bg-white border border-brand-gold/15 rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-brand-gold/15 flex items-center justify-between gap-3">
        <span className="text-[10px] uppercase tracking-widest font-bold text-brand-brown/60">{titulo}</span>
        {rodape && <span className="text-[11px] text-brand-brown/60">{rodape}</span>}
      </div>
      {itens.length === 0 ? (
        <p className="px-5 py-6 text-xs text-brand-brown/60">Nenhuma por aqui.</p>
      ) : (
        <ul className="divide-y divide-brand-gold/10">{itens.map((c) => linha(c, { inativa }))}</ul>
      )}
    </div>
  );

  if (carregando) {
    return <p className="text-[11px] font-mono uppercase tracking-widest text-brand-brown/60">Carregando...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-brand-gold/15 rounded-2xl p-5 space-y-2">
        <h3 className="text-sm font-serif font-bold text-brand-brown flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-brand-gold" />
          Investimento em captação
        </h3>
        <p className="text-xs text-brand-brown/70 leading-relaxed">
          Marque as categorias de despesa que são <strong>dinheiro gasto para atrair paciente</strong> —
          anúncios, agência, influenciadoras, impulsionamento. O <strong>Custo por Lead</strong> da
          Visão Geral soma essas despesas no período e divide pelos leads que chegaram nele.
        </p>
        <p className="text-[11px] text-brand-brown/55">
          O sistema nasce com uma categoria <em>Marketing</em> só. Se a clínica lançar agência,
          anúncio e material impresso todos nela, o CPL responde <em>“quanto custou o marketing
          inteiro por lead”</em> — que é outra pergunta. Separar em categorias próprias é o que deixa
          o número utilizável.
        </p>
        <p className="text-[11px] text-brand-brown/55">
          Aluguel, insumos e folha ficam de fora de propósito: são custo de operar, não de captar.
          Enquanto nenhuma categoria estiver marcada, o cartão de CPL não mostra número — um CPL
          chutado vira promessa na hora da venda.
        </p>
      </div>

      {erro && (
        <div className="rounded-xl px-4 py-3 text-xs border bg-red-50 border-red-200 text-red-700 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <p>{erro}</p>
        </div>
      )}
      {ok && (
        <div className="rounded-xl px-4 py-3 text-xs border bg-emerald-50 border-emerald-200 text-emerald-800 flex items-start gap-2">
          <Check className="h-4 w-4 shrink-0 mt-0.5" />
          <p>{ok}</p>
        </div>
      )}

      <div className="bg-white border border-brand-gold/15 rounded-2xl p-5">
        <p className="text-[10px] uppercase tracking-widest font-bold text-brand-brown/60 mb-3">
          Nova categoria
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={campo + " flex-1 min-w-[220px]"}
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") criar(); }}
            placeholder="Ex.: Anúncios (Meta e Google)"
          />
          <select className={campo} value={novoTipo} onChange={(e) => setNovoTipo(e.target.value as Tipo)}>
            <option value="DESPESA">Despesa</option>
            <option value="RECEITA">Receita</option>
          </select>
          <button
            onClick={criar}
            disabled={criando || !novoNome.trim()}
            className="flex items-center gap-1.5 bg-brand-brown hover:bg-brand-brown/95 disabled:opacity-50 text-brand-beige px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 text-brand-gold" />
            {criando ? "Criando..." : "Criar"}
          </button>
        </div>
        <p className="text-[10px] text-brand-brown/50 mt-2">
          Depois de criar, lance a despesa nela no Financeiro — o CPL lê os lançamentos, não a
          categoria vazia.
        </p>
      </div>

      {bloco("Categorias de despesa", despesas,
        marcadas === 0 ? "nenhuma marcada como captação" : `${marcadas} marcada(s) como captação`)}

      {bloco("Categorias de receita", receitas, "captação é despesa: não há o que marcar aqui")}

      {inativas.length > 0 && bloco("Aposentadas", inativas,
        "continuam nos relatórios de meses passados", true)}
    </div>
  );
}

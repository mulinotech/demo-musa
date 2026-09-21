/**
 * Os equipamentos da clínica (M5.11, 21/09).
 *
 * ===================================================== POR QUE ESTA TELA EXISTE
 *
 * Item 5 do PDF de 19/09. Na janela de lançar sessão, "Equipamentos Utilizados"
 * era caixa de texto aberta — e equipamento digitado à mão nunca soma: depois de
 * seis meses, `Ultraformer`, `ultraformer` e `Ultraformer MPT` são três coisas
 * diferentes para qualquer relatório, e as três existem de verdade, então nada
 * parece errado.
 *
 * ========================================= POR QUE INATIVAR, E NÃO EXCLUIR
 *
 * O equipamento aparece em sessão já lançada. Apagá-lo faria a sessão de março
 * apontar para nada, e prontuário que perde o "com o quê" perde justamente a
 * parte que interessa se alguém precisar responder por aquele atendimento.
 * Inativar tira da lista de escolha e deixa o passado intacto — e a tela diz
 * isso, em vez de deixar a pessoa descobrir depois.
 */
import { useEffect, useState } from 'react';
import { Plus, RotateCcw, Check, X, Pencil, Wrench, EyeOff } from 'lucide-react';
import { motion } from 'motion/react';

type Equipamento = { id: string; name: string; active: number };

export default function Equipamentos({ podeGerenciar }: { podeGerenciar: boolean }) {
  const [lista, setLista] = useState<Equipamento[] | null>(null);
  const [novo, setNovo] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [nomeEditado, setNomeEditado] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = async () => {
    try {
      const r = await fetch('/api/equipments?todos=1');
      setLista(r.ok ? await r.json() : []);
    } catch {
      setLista([]);
      setAviso('Não foi possível carregar os equipamentos.');
    }
  };
  useEffect(() => { carregar(); }, []);

  const chamar = async (caminho: string, metodo: string, corpo?: unknown) => {
    setSalvando(true); setAviso('');
    try {
      const r = await fetch(caminho, {
        method: metodo,
        headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
        body: corpo ? JSON.stringify(corpo) : undefined
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        setAviso(e.error || 'Não foi possível salvar.');
        return false;
      }
      await carregar();
      return true;
    } finally {
      setSalvando(false);
    }
  };

  const ativos = (lista || []).filter((e) => e.active);
  const inativos = (lista || []).filter((e) => !e.active);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div>
        <h3 className="text-lg font-serif font-bold text-brand-brown">Equipamentos</h3>
        <p className="text-xs text-brand-brown/70">
          Os aparelhos que a clínica usa nas sessões. Cadastrados aqui, viram lista de escolha
          na hora de lançar a evolução — em vez de cada pessoa digitar o nome do seu jeito.
          Aparelho que sai de uso é <strong>inativado</strong>, nunca apagado: ele some da lista
          de escolha e as sessões já lançadas com ele continuam como estão.
        </p>
      </div>

      {podeGerenciar && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!novo.trim() || salvando) return;
            if (await chamar('/api/equipments', 'POST', { name: novo.trim() })) setNovo('');
          }}
          className="flex gap-2"
        >
          <input
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            placeholder="Ex: Ultraformer MPT"
            className="flex-1 px-4 py-2.5 rounded-xl border border-brand-gold/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
          />
          <button
            type="submit"
            disabled={salvando || !novo.trim()}
            className="flex items-center gap-2 bg-brand-brown hover:bg-brand-brown/90 disabled:opacity-40 text-brand-beige px-4 py-2.5 rounded-xl text-sm font-medium shadow-md"
          >
            <Plus className="h-4 w-4 text-brand-gold" />
            <span>Cadastrar</span>
          </button>
        </form>
      )}

      {aviso && (
        <p className="text-xs font-semibold text-red-600 bg-red-50 border border-red-150 py-2 px-3 rounded-lg">
          {aviso}
        </p>
      )}

      {lista === null ? (
        <p className="text-xs text-brand-brown/50">Carregando…</p>
      ) : ativos.length === 0 ? (
        <div className="border border-dashed border-brand-gold/30 rounded-xl p-6 text-center">
          <Wrench className="h-6 w-6 text-brand-gold/60 mx-auto mb-2" />
          <p className="text-xs text-brand-brown/70">
            Nenhum equipamento cadastrado ainda.
            {podeGerenciar
              ? ' Cadastre os aparelhos da clínica no campo acima.'
              : ' Peça a um gerente para cadastrar os aparelhos da clínica.'}
          </p>
          <p className="text-[10px] text-brand-brown/50 mt-1">
            Enquanto a lista estiver vazia, o campo da sessão continua aceitando texto digitado.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {ativos.map((eq) => (
            <div
              key={eq.id}
              className="flex items-center justify-between border border-brand-gold/20 rounded-xl px-4 py-3 bg-white"
            >
              {editando === eq.id ? (
                <input
                  value={nomeEditado}
                  onChange={(e) => setNomeEditado(e.target.value)}
                  autoFocus
                  className="flex-1 mr-3 px-3 py-1.5 rounded-lg border border-brand-gold/40 text-sm text-brand-brown focus:outline-none focus:ring-2 focus:ring-brand-gold"
                />
              ) : (
                <span className="text-sm text-brand-brown">{eq.name}</span>
              )}

              {podeGerenciar && (
                <div className="flex items-center gap-1 shrink-0">
                  {editando === eq.id ? (
                    <>
                      <button
                        title="Salvar"
                        onClick={async () => {
                          if (!nomeEditado.trim()) return;
                          if (await chamar('/api/equipments/' + eq.id, 'PATCH', { name: nomeEditado.trim() })) {
                            setEditando(null);
                          }
                        }}
                        className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-md"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        title="Cancelar"
                        onClick={() => setEditando(null)}
                        className="p-1.5 text-brand-brown/50 hover:bg-brand-beige rounded-md"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      {/* OS DOIS BOTOES TEM TEXTO, E ISSO E CORRECAO DE 21/09.
                        *
                        * A primeira versao usava so icones: um lapis e uma
                        * LIXEIRA. A Silvia leu a lixeira como "excluir", nao
                        * achou onde inativar, e por isso nao conseguiu nem
                        * testar o passo seguinte.
                        *
                        * Lixeira promete apagar e esta acao NAO apaga -- ela
                        * tira da lista e deixa o passado intacto. Icone que
                        * promete uma coisa e faz outra e' o defeito desta
                        * semana inteira, agora em forma de desenho. */}
                      <button
                        onClick={() => { setEditando(eq.id); setNomeEditado(eq.name); }}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-brand-brown/80 hover:bg-brand-beige rounded-lg"
                      >
                        <Pencil className="h-3.5 w-3.5 text-brand-gold" />
                        <span>Renomear</span>
                      </button>
                      <button
                        title="Some da lista de escolha. As sessões já lançadas com ele continuam como estão."
                        onClick={() => chamar('/api/equipments/' + eq.id, 'DELETE')}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 border border-amber-200 rounded-lg"
                      >
                        <EyeOff className="h-3.5 w-3.5" />
                        <span>Inativar</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {inativos.length > 0 && (
        <div className="space-y-2 pt-2">
          <h4 className="text-[10px] font-mono font-bold text-brand-brown/50 uppercase tracking-wider">
            Inativos — não aparecem na hora de lançar a sessão
          </h4>
          {inativos.map((eq) => (
            <div
              key={eq.id}
              className="flex items-center justify-between border border-brand-gold/10 rounded-xl px-4 py-2.5 bg-brand-beige/30"
            >
              <span className="text-sm text-brand-brown/50 line-through">{eq.name}</span>
              {podeGerenciar && (
                <button
                  title="Reativar"
                  onClick={() => chamar('/api/equipments/' + eq.id, 'PATCH', { active: true })}
                  className="flex items-center gap-1.5 text-xxs font-medium text-brand-brown/70 hover:text-brand-brown px-2 py-1 rounded-md hover:bg-white"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-brand-gold" />
                  <span>Reativar</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

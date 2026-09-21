/**
 * Os campos da sessão que deixaram de ser texto livre (M5.11, 21/09).
 *
 * A regra de o-que-aparece-na-lista mora em `src/lib/selecao.mjs`, que é testada
 * pela suíte. Aqui é só a tela — e ela tem duas obrigações que não são óbvias:
 *
 * 1. **Lista vazia não vira campo morto.** Clínica que ainda não cadastrou
 *    equipamento nenhum precisa conseguir lançar a sessão hoje. Então o campo
 *    cai para texto digitado e diz, embaixo, onde se cadastra. Campo que exige
 *    um cadastro que ninguém fez ainda trava o trabalho de quem atende.
 *
 * 2. **O que foi digitado antes aparece marcado**, com o rótulo dizendo que veio
 *    de digitação. Sem isso, abrir a janela e salvar apagaria o equipamento da
 *    sessão de março sem ninguém pedir — ver o cabeçalho de `selecao.mjs`.
 */
import { useMemo, useState } from 'react';
import { opcoesDeEscolha, opcoesDeMarcar, juntarItens, separarItens, mesmoNome } from '../lib/selecao.mjs';

const OUTRO = '__outro__';

const rotuloClasse = 'block text-xxs font-bold text-brand-brown uppercase mb-1';
const campoClasse =
  'w-full px-4 py-2 rounded-xl border border-brand-gold/30 bg-white text-xs ' +
  'focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown';

type Props = {
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  cadastrados: string[];
  ondeCadastrar: string;
  placeholder?: string;
};

/** Um valor só: profissional responsável, equipamento. */
export function SeletorUnico({ rotulo, valor, aoMudar, cadastrados, ondeCadastrar, placeholder }: Props) {
  const opcoes = useMemo(() => opcoesDeEscolha(valor, cadastrados), [valor, cadastrados]);
  const [digitando, setDigitando] = useState(false);

  if (cadastrados.length === 0) {
    return (
      <div>
        <label className={rotuloClasse}>{rotulo}</label>
        <input
          type="text"
          value={valor}
          placeholder={placeholder}
          onChange={(e) => aoMudar(e.target.value)}
          className={campoClasse}
        />
        <p className="text-[10px] text-brand-brown/50 mt-1">{ondeCadastrar}</p>
      </div>
    );
  }

  return (
    <div>
      <label className={rotuloClasse}>{rotulo}</label>
      {digitando ? (
        <>
          <input
            type="text"
            autoFocus
            value={valor}
            placeholder={placeholder}
            onChange={(e) => aoMudar(e.target.value)}
            className={campoClasse}
          />
          <button
            type="button"
            onClick={() => { setDigitando(false); aoMudar(''); }}
            className="text-[10px] text-brand-brown/60 hover:text-brand-brown mt-1 underline"
          >
            voltar para a lista
          </button>
        </>
      ) : (
        <select
          value={opcoes.some((o) => mesmoNome(o.valor, valor)) ? valor : ''}
          onChange={(e) => {
            if (e.target.value === OUTRO) { setDigitando(true); aoMudar(''); return; }
            aoMudar(e.target.value);
          }}
          className={campoClasse}
        >
          <option value="">— selecione —</option>
          {opcoes.map((o) => (
            <option key={o.valor} value={o.valor}>{o.rotulo}</option>
          ))}
          <option value={OUTRO}>Outro (digitar)</option>
        </select>
      )}
    </div>
  );
}

/** Vários valores: insumos aplicados. */
export function SeletorMultiplo({ rotulo, valor, aoMudar, cadastrados, ondeCadastrar, placeholder }: Props) {
  const { opcoes, marcados } = useMemo(() => opcoesDeMarcar(valor, cadastrados), [valor, cadastrados]);
  const [extra, setExtra] = useState('');

  if (cadastrados.length === 0) {
    return (
      <div>
        <label className={rotuloClasse}>{rotulo}</label>
        <input
          type="text"
          value={valor}
          placeholder={placeholder}
          onChange={(e) => aoMudar(e.target.value)}
          className={campoClasse}
        />
        <p className="text-[10px] text-brand-brown/50 mt-1">{ondeCadastrar}</p>
      </div>
    );
  }

  const alternar = (item: string) => {
    const atuais = separarItens(valor);
    const jaTem = atuais.some((a) => mesmoNome(a, item));
    /* Desmarcar tira só aquele item e NÃO remonta a lista pela ordem da tela:
       ordem de insumo pode ser ordem de aplicação. Ver `selecao.mjs`. */
    const novos = jaTem ? atuais.filter((a) => !mesmoNome(a, item)) : atuais.concat([item]);
    aoMudar(juntarItens(novos));
  };

  return (
    <div>
      <label className={rotuloClasse}>{rotulo}</label>
      <div className="border border-brand-gold/30 rounded-xl bg-white p-2 max-h-36 overflow-y-auto space-y-1">
        {opcoes.map((o) => {
          const marcado = marcados.some((m) => mesmoNome(m, o.valor));
          return (
            <label
              key={o.valor}
              className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-brand-cream/50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={marcado}
                onChange={() => alternar(o.valor)}
                className="accent-brand-brown"
              />
              <span className={`text-xs ${o.legado ? 'text-brand-brown/60 italic' : 'text-brand-brown'}`}>
                {o.rotulo}
              </span>
            </label>
          );
        })}
      </div>

      <div className="flex gap-2 mt-2">
        <input
          type="text"
          value={extra}
          placeholder="Outro insumo, não cadastrado"
          onChange={(e) => setExtra(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (!extra.trim()) return;
            aoMudar(juntarItens(separarItens(valor).concat([extra.trim()])));
            setExtra('');
          }}
          className={campoClasse + ' flex-1'}
        />
        <button
          type="button"
          onClick={() => {
            if (!extra.trim()) return;
            aoMudar(juntarItens(separarItens(valor).concat([extra.trim()])));
            setExtra('');
          }}
          className="px-3 py-2 rounded-xl bg-brand-brown/10 hover:bg-brand-brown hover:text-brand-beige text-brand-brown text-xs font-medium transition-colors"
        >
          Incluir
        </button>
      </div>
    </div>
  );
}

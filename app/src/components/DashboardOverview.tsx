/**
 * Visão Geral — os cartões de abertura do CRM (M5.8, 18/09).
 *
 * ======================================================== O QUE MUDOU, E POR QUÊ
 *
 * Esta tela montava os próprios números a partir das listas que já tinha em mãos.
 * Na primeira apresentação ao time comercial, quatro deles não sobreviveram a
 * uma pergunta:
 *
 *   "+12% vs período anterior"   era TEXTO FIXO, impresso ao lado de qualquer
 *                                número — inclusive de "Total de Leads: 0"
 *   "R$ 18,50" de Custo por Lead era TEXTO FIXO, com um comentário no código
 *                                dizendo que um dia viria da API de anúncios
 *   "LTV Médio"                  dividia a receita HISTÓRICA inteira por todas
 *                                as pacientes cadastradas e não mudava com o
 *                                filtro de período — num painel cuja fileira
 *                                toda promete um período
 *   "156" no meio da rosca       aparecia quando a clínica não tinha lead nenhum
 *
 * E havia um quinto, que ninguém tinha visto: o filtro de período **não
 * filtrava**. A tela lia `lead.createdAt`; a API devolve a coluna `date`. Sem o
 * campo, o código caía em `new Date()` e datava todo lead como hoje — "7 Dias" e
 * "30 Dias" mostravam exatamente a mesma coisa.
 *
 * O conserto dos cinco é o mesmo, e é estrutural: **a conta saiu do navegador**.
 * O servidor lê, `services/visao-geral.js` calcula, e esta tela só desenha. Nada
 * aqui dentro pode mais discordar do Financeiro, porque nada aqui dentro soma
 * dinheiro.
 *
 * ================================================= AS TRÊS REGRAS DESTA TELA
 *
 * 1. Percentual só aparece quando existe. Sem período anterior, a tela escreve
 *    "sem base de comparação" — não "+0%", não "+12%".
 * 2. Cartão sem configuração diz ONDE configurar. O CPL sem categoria marcada
 *    manda a pessoa ao Financeiro, em vez de mostrar um número bonito.
 * 3. Quem não vê dinheiro no resto do sistema não vê aqui. A profissional
 *    mantém a tela e perde os três cartões de dinheiro — o mesmo recorte que ela
 *    já tem em Financeiro e Precificação.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import { TrendingUp, Users, DollarSign, Target, Ticket, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { papelDoToken } from '../lib/api';

/* ------------------------------------------------------------------- tipos */

interface Par {
  valor: number | null;
  anterior: number | null;
  variacaoPct: number | null;
}

interface Painel {
  periodo: { de: string; ate: string; dias: number; base: string };
  periodoAnterior: { de: string; ate: string };
  leads: Par;
  conversao: Par & { fechados: number; total: number };
  funil: { total: number; fechados: number; emNegociacao: number; novos: number; perdidos: number };
  serieDeLeads: { data: string; leads: number }[];
}

interface Dinheiro {
  faturamento: Par & { sessoes: number; sessoesAnterior: number };
  ticketMedio: Par & { pacientes: number };
  custoPorLead: Par & { investimento: number | null; leads: number; categoriasMarcadas: number };
}

type Faixa = '7days' | '30days' | 'month' | 'custom';

/* ------------------------------------------------------------------ formato */

const hojeIso = () => new Date().toISOString().slice(0, 10);

function somarDias(iso: string, n: number) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "Últimos 7 dias" é hoje e os 6 anteriores — foi assim que o time comercial
 *  definiu, e é assim que o servidor conta. */
function janelaDaFaixa(faixa: Faixa, de: string, ate: string) {
  const hoje = hojeIso();
  if (faixa === '7days') return { from: somarDias(hoje, -6), to: hoje };
  if (faixa === '30days') return { from: somarDias(hoje, -29), to: hoje };
  if (faixa === 'month') return { from: hoje.slice(0, 8) + '01', to: hoje };
  return { from: de, to: ate };
}

const dinheiro = (n: number | null) =>
  n === null ? '—' : `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const dataCurta = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7);

/** A frase de comparação. `null` NÃO vira número: vira a frase honesta. */
function comparacao(p: Par | undefined, anteriorFormatado?: (v: number) => string) {
  if (!p || p.variacaoPct === null || p.variacaoPct === undefined) {
    return { texto: 'sem base de comparação', direcao: 'neutro' as const };
  }
  // Zero contra zero é 0% de variação, e é verdade — mas "0% vs período
  // anterior (antes 0)" soa a conta feita sobre nada. A frase diz o que houve.
  if (p.valor === 0 && p.anterior === 0) {
    return { texto: 'sem movimento nos dois períodos', direcao: 'neutro' as const };
  }
  const v = p.variacaoPct;
  const sinal = v > 0 ? '+' : '';
  const antes = p.anterior !== null && p.anterior !== undefined
    ? ` (antes ${anteriorFormatado ? anteriorFormatado(p.anterior) : p.anterior})`
    : '';
  return {
    texto: `${sinal}${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs período anterior${antes}`,
    direcao: v > 0 ? ('sobe' as const) : v < 0 ? ('desce' as const) : ('igual' as const)
  };
}

/* ------------------------------------------------------------------- cartão */

interface Cartao {
  title: string;
  value: string;
  icon: typeof Users;
  rodape: { texto: string; direcao: 'sobe' | 'desce' | 'igual' | 'neutro' };
  /** Bom é subir? No CPL, não: gastar mais por lead é piora. */
  subirEBom?: boolean;
  nota?: string;
}

function CartaoKpi({ c, idx }: { c: Cartao; idx: number }) {
  const { direcao } = c.rodape;
  const bom = c.subirEBom === false ? direcao === 'desce' : direcao === 'sobe';
  const ruim = c.subirEBom === false ? direcao === 'sobe' : direcao === 'desce';
  const cor = direcao === 'neutro'
    ? 'text-brand-brown/60 bg-brand-beige'
    : bom ? 'text-emerald-600 bg-emerald-50'
    : ruim ? 'text-red-600 bg-red-50'
    : 'text-brand-brown/70 bg-brand-beige';
  const Seta = direcao === 'sobe' ? ArrowUpRight : direcao === 'desce' ? ArrowDownRight : Minus;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.08 }}
      className="bg-white rounded-xl p-5 border border-brand-gold/20 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group"
    >
      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity transform group-hover:scale-110 group-hover:rotate-12 duration-500">
        <c.icon className="w-16 h-16 text-brand-gold" />
      </div>
      <div className="flex justify-between items-start mb-4 relative z-10">
        <div className="p-2 bg-brand-beige rounded-lg">
          <c.icon className="w-5 h-5 text-brand-brown" />
        </div>
      </div>
      <div className="relative z-10">
        <h3 className="text-sm font-medium text-brand-brown/70 mb-1">{c.title}</h3>
        <p className="text-2xl font-serif font-bold text-brand-brown mb-2">{c.value}</p>
        <div className={`flex items-center gap-1 text-[11px] font-medium w-fit px-2 py-0.5 rounded-full ${cor}`}>
          {direcao !== 'neutro' && <Seta className="w-3 h-3" />}
          <span>{c.rodape.texto}</span>
        </div>
        {c.nota && <p className="text-[10px] text-brand-brown/55 mt-2 leading-snug">{c.nota}</p>}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------- a tela */

export default function DashboardOverview() {
  const veDinheiro = ['admin', 'gerente'].includes(papelDoToken());

  const [filterRange, setFilterRange] = useState<Faixa>('7days');
  const [startDate, setStartDate] = useState<string>(somarDias(hojeIso(), -6));
  const [endDate, setEndDate] = useState<string>(hojeIso());

  const [painel, setPainel] = useState<Painel | null>(null);
  const [caixa, setCaixa] = useState<Dinheiro | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const janela = useMemo(
    () => janelaDaFaixa(filterRange, startDate, endDate),
    [filterRange, startDate, endDate]
  );

  /* ================= O FILTRO DESTA TELA VAI PARA A URL (M6.4)
   *
   * O botão que gera o PDF vive no `CrmDashboard`, que é o pai desta tela e não
   * enxerga este estado. Até aqui o PDF consolidava sempre o mês, e a faixa da
   * tela avisava isso — duas respostas para a mesma pergunta, e a impressa era
   * a que ia para a reunião.
   *
   * A URL é o lugar onde os dois se encontram sem levantar o estado para o pai
   * nem criar um contexto só para duas datas. De quebra, uma Visão Geral
   * filtrada vira um link que se manda para alguém.
   *
   * `replace` e não `push`: cada clique no filtro viraria uma entrada no
   * histórico, e o botão "voltar" do navegador andaria filtro a filtro em vez
   * de sair da tela. */
  useEffect(() => {
    if (!janela.from || !janela.to) return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('de') === janela.from && url.searchParams.get('ate') === janela.to) return;
      url.searchParams.set('de', janela.from);
      url.searchParams.set('ate', janela.to);
      window.history.replaceState(null, '', url.toString());
    } catch { /* sem URL utilizável, o PDF segue consolidando o mês */ }
  }, [janela]);

  useEffect(() => {
    if (!janela.from || !janela.to) return;
    let vivo = true;
    setCarregando(true);
    setErro('');
    const q = `?from=${janela.from}&to=${janela.to}`;

    const geral = fetch('/api/dashboard/visao-geral' + q).then((r) =>
      r.ok ? r.json() : Promise.reject(new Error('geral')));
    // A profissional não chama a rota de dinheiro: ela responderia 403, e um 403
    // esperado no console parece defeito para quem for investigar outra coisa.
    const money = veDinheiro
      ? fetch('/api/dashboard/dinheiro' + q).then((r) => (r.ok ? r.json() : null))
      : Promise.resolve(null);

    Promise.all([geral, money])
      .then(([g, m]) => {
        if (!vivo) return;
        setPainel(g);
        setCaixa(m);
      })
      .catch(() => vivo && setErro('Não foi possível carregar os números do período.'))
      .finally(() => vivo && setCarregando(false));

    return () => { vivo = false; };
  }, [janela, veDinheiro]);

  const cards: Cartao[] = useMemo(() => {
    if (!painel) return [];
    const lista: Cartao[] = [
      {
        title: 'Total de Leads',
        value: String(painel.leads.valor ?? 0),
        icon: Users,
        rodape: comparacao(painel.leads)
      },
      {
        title: 'Taxa de Conversão',
        value: `${(painel.conversao.valor ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`,
        icon: Target,
        rodape: comparacao(painel.conversao, (v) => `${v}%`),
        nota: `${painel.conversao.fechados} de ${painel.conversao.total} leads em Venda Fechada.`
      }
    ];
    if (!caixa) return lista;

    lista.push({
      title: 'Faturamento Real',
      value: dinheiro(caixa.faturamento.valor),
      icon: DollarSign,
      rodape: comparacao(caixa.faturamento, dinheiro),
      nota: `${caixa.faturamento.sessoes} atendimento(s) concluído(s) no período. Mesma fonte do Financeiro.`
    });
    lista.push({
      title: 'Ticket Médio',
      value: dinheiro(caixa.ticketMedio.valor),
      icon: Ticket,
      rodape: comparacao(caixa.ticketMedio, dinheiro),
      nota: `Faturamento ÷ ${caixa.ticketMedio.pacientes} paciente(s) atendida(s) no período.`
    });
    lista.push({
      title: 'Custo por Lead (CPL)',
      value: caixa.custoPorLead.valor === null ? '—' : dinheiro(caixa.custoPorLead.valor),
      icon: TrendingUp,
      subirEBom: false,
      rodape: caixa.custoPorLead.categoriasMarcadas === 0
        ? { texto: 'nenhuma categoria marcada', direcao: 'neutro' }
        : comparacao(caixa.custoPorLead, dinheiro),
      nota: caixa.custoPorLead.categoriasMarcadas === 0
        ? 'Marque em Financeiro > Categorias quais são investimento em captação (anúncios, agência). O CPL soma as despesas dessas categorias no período.'
        : `${dinheiro(caixa.custoPorLead.investimento)} investidos ÷ ${caixa.custoPorLead.leads} lead(s).`
    });
    return lista;
  }, [painel, caixa]);

  const rosca = useMemo(() => {
    const f = painel?.funil;
    return [
      { name: 'Fechados', value: f?.fechados ?? 0, color: '#0E7FA6' },
      { name: 'Em Negociação', value: f?.emNegociacao ?? 0, color: '#5A6478' },
      { name: 'Novos', value: f?.novos ?? 0, color: '#EDF2F8' },
      { name: 'Perdidos', value: f?.perdidos ?? 0, color: '#7A62F2' }
    ];
  }, [painel]);

  const serie = useMemo(
    () => (painel?.serieDeLeads || []).map((p) => ({ name: dataCurta(p.data), leads: p.leads })),
    [painel]
  );

  const botao = (f: Faixa, rotulo: string) => (
    <button
      onClick={() => setFilterRange(f)}
      className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
        filterRange === f
          ? 'bg-brand-beige text-brand-brown shadow-sm'
          : 'text-brand-brown/60 hover:text-brand-brown hover:bg-brand-beige/50'
      }`}
    >
      {rotulo}
    </button>
  );

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-serif font-bold text-brand-brown">Visão Geral</h2>
          <p className="text-sm text-brand-brown/70 mt-1">
            Acompanhe o desempenho comercial da sua clínica.
          </p>
          {painel && (
            /* O período comparado fica ESCRITO. Era a pergunta do time comercial
               — "comparado com o quê?" — e a resposta não pode morar só no
               código. */
            <p className="text-[11px] text-brand-brown/55 mt-1 font-mono">
              {dataCurta(painel.periodo.de)} a {dataCurta(painel.periodo.ate)} ({painel.periodo.dias} dias)
              {' · comparado com '}
              {dataCurta(painel.periodoAnterior.de)} a {dataCurta(painel.periodoAnterior.ate)}
            </p>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-3 items-end sm:items-center">
          {filterRange === 'custom' && (
            <div className="flex items-center gap-2 bg-white border border-brand-gold/20 rounded-lg p-1 text-xs">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-transparent text-brand-brown focus:outline-none px-2 font-mono"
              />
              <span className="text-brand-brown/40">até</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-transparent text-brand-brown focus:outline-none px-2 font-mono"
              />
            </div>
          )}
          <div className="flex bg-white border border-brand-gold/20 rounded-lg p-1">
            {botao('7days', '7 Dias')}
            {botao('30days', '30 Dias')}
            {botao('month', 'Mês Atual')}
            {botao('custom', 'Período')}
          </div>
        </div>
      </div>

      {erro && (
        <div className="rounded-xl px-4 py-3 text-xs border bg-red-50 border-red-200 text-red-700">{erro}</div>
      )}

      {carregando && !painel ? (
        <p className="text-[11px] font-mono uppercase tracking-widest text-brand-brown/60">
          Carregando os números do período...
        </p>
      ) : (
        <>
          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${veDinheiro ? 'lg:grid-cols-5' : 'lg:grid-cols-2'}`}>
            {cards.map((c, i) => <CartaoKpi key={c.title} c={c} idx={i} />)}
          </div>

          {!veDinheiro && (
            <p className="text-[11px] text-brand-brown/55">
              Faturamento, ticket médio e custo por lead ficam com a administração e a gerência,
              como no Financeiro.
            </p>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-xl p-6 border border-brand-gold/20 shadow-sm">
              <div className="mb-6">
                <h3 className="text-lg font-serif font-bold text-brand-brown">Volume de Leads</h3>
                <p className="text-xs text-brand-brown/60">
                  Novos contatos por data no período selecionado
                  {painel && painel.periodo.dias > 45 ? ' (agrupado por semana)' : ''}.
                </p>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={serie} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EDF2F8" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#5A6478' }} dy={10} interval="preserveStartEnd" />
                    <YAxis axisLine={false} tickLine={false} allowDecimals={false} tick={{ fontSize: 13.5, fill: '#5A6478' }} />
                    <RechartsTooltip
                      cursor={{ fill: '#EDF2F8', opacity: 0.4 }}
                      contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #DCE6F0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    />
                    <Bar dataKey="leads" fill="#0E7FA6" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-xl p-6 border border-brand-gold/20 shadow-sm flex flex-col">
              <div className="mb-2">
                <h3 className="text-lg font-serif font-bold text-brand-brown">Status do Funil</h3>
                <p className="text-xs text-brand-brown/60">Leads que entraram no período.</p>
              </div>
              <div className="flex-1 min-h-[220px] relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={rosca} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none">
                      {rosca.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #DCE6F0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      itemStyle={{ color: '#141E33' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  {/* Zero é zero. Aqui havia `leads.length || '156'`: clínica sem
                      lead nenhum lia 156 no meio do gráfico. */}
                  <span className="text-2xl font-serif font-bold text-brand-brown">{painel?.funil.total ?? 0}</span>
                  <span className="text-[10px] uppercase tracking-widest text-brand-brown/60">Total</span>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 mt-4">
                {rosca.map((e, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full border border-brand-gold/30" style={{ backgroundColor: e.color }} />
                      <span className="text-xs text-brand-brown/80 font-medium">{e.name}</span>
                    </div>
                    <span className="text-xs font-bold text-brand-brown">{e.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

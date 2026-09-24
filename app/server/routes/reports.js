'use strict';
/** Relatórios do painel — convertido para a camada por clínica na M1.2.
 *
 *  ================================== POR QUE ESTE ARQUIVO É O MAIS PERIGOSO
 *
 *  Todas as consultas daqui são `SUM` e `COUNT`. Uma listagem sem filtro mostra
 *  a linha da vizinha e alguém estranha o nome; uma **soma** sem filtro devolve
 *  um número maior, e número não tem nome. "Faturamento total: R$ 184.320" com
 *  o dinheiro de duas clínicas somado é indistinguível de um mês bom — até
 *  alguém conferir com o extrato do banco, semanas depois.
 *
 *  Por isso aqui não há junção sem filtro em NENHUMA das tabelas: onde a
 *  consulta cruza paciente, plano e sessão, as três filtram.
 *
 *  ============================== E POR QUE ELE FOI REESCRITO NA M6.4
 *
 *  Auditando as consultas, seis dos números impressos **não eram medidos**:
 *  tempo de conversão (3,5 dias fixos), tempo de resposta ('12 minutos'),
 *  satisfação ('4,9 / 5,0' — e não existe pesquisa de satisfação no sistema
 *  inteiro), taxa de retorno com reserva em 24%, horário de pico com reserva
 *  às 14h, e uma lista de ANIVERSÁRIOS de pacientes reais calculada a partir
 *  da posição delas na lista, numa tabela que não tem data de nascimento.
 *
 *  Três viraram medição de verdade (`services/relatorio.js`); três saíram da
 *  folha. A regra que ficou: **número que não dá para medir volta `null`, e o
 *  papel diz por quê** — nunca um valor plausível.
 *
 *  ==================================== O FATURAMENTO VEM DO RAZÃO (M6.4)
 *
 *  Ele somava `treatment_sessions.price` das sessões REALIZADAS. A Visão Geral
 *  soma o RAZÃO (`cash_entries`), que é o mesmo lugar de onde sai o Financeiro.
 *  São duas contas diferentes: sessão realizada e não paga entra numa e não na
 *  outra; receita lançada à mão (produto vendido, pacote pago adiantado) entra
 *  na outra e não nesta. A tela mostrava um número e o papel impresso mostrava
 *  outro, sem nada avisar — e o papel é o que vai para a reunião.
 *
 *  Agora os dois leem o mesmo razão, pela mesma função. Quando divergirem, será
 *  porque o dado divergiu, não porque a conta era outra.
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');
const rel = require('../services/relatorio');
const fin = require('../services/financeiro');

/** O razão da clínica — a mesma leitura de `routes/dashboard.js`. */
async function lerRazao(db) {
  const [r] = await db.q(
    'SELECT id, type, amount, entry_date, paid_at, due_date, category_id' +
    ' FROM cash_entries WHERE clinica_id = :clinica');
  return r;
}

const dia = (d) => d.getFullYear() + '-' +
  String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

router.post('/api/reports/generate', async function (req, res) {
  const db = escopo(req);
  const { aba, periodo } = req.body || {};

  const now = new Date();
  const start = periodo && periodo.inicio ? new Date(periodo.inicio)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = periodo && periodo.fim ? new Date(periodo.fim)
    : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  /* O PDF passa a seguir o filtro da tela quando ela manda um (M6.4). Sem
     período no corpo, continua consolidando o mês — e `seguiuOFiltro` diz qual
     dos dois aconteceu, para o papel não precisar adivinhar. */
  const seguiuOFiltro = !!(periodo && periodo.inicio && periodo.fim);

  try {
    /* O NOME DA CLÍNICA VEM DA CLÍNICA (M6.4).
     *
     * As seis ocorrências de "Dra. Musa Estética de Elite" estavam escritas no
     * HTML do relatório — no título da aba, no cabeçalho de cada página e no
     * rodapé. Num SaaS de 50 clínicas, a segunda clínica imprimiria o relatório
     * DELA com o nome da primeira e levaria aquele papel para a reunião.
     *
     * É o mesmo vazamento que a M1.6 corrigiu nos modelos de documento, e pelo
     * mesmo motivo: nome de clínica é dado da clínica, não constante do código. */
    const clinica = await db.minhaClinica();
    const cabecalho = (nome) => ({
      aba: nome,
      clinica: (clinica && clinica.nome) || 'Clínica',
      periodo: { inicio: start.toISOString(), fim: end.toISOString(), seguiuOFiltro: seguiuOFiltro }
    });

    const tabName = String(aba).toUpperCase();

    if (tabName === 'DASHBOARD' || tabName === 'VISÃO GERAL') {
      const razao = await lerRazao(db);
      const resumo = fin.resumo(razao, { de: dia(start), ate: dia(end), base: 'competencia' });

      /* O TICKET MÉDIO divide por PACIENTES DISTINTAS, e não por sessões — a
         mesma definição da Visão Geral desde a M5.8. Dividir por sessões faz a
         paciente de pacote de dez baixar o ticket da clínica inteira. */
      const [at] = await db.q(
        "SELECT COUNT(*) AS sessoes, COUNT(DISTINCT client_id) AS pacientes" +
        ' FROM appointments WHERE clinica_id = :clinica' +
        " AND status = 'REALIZADO' AND DATE(starts_at) BETWEEN ? AND ?",
        [dia(start), dia(end)]);
      const pacientesAtendidas = Number((at[0] || {}).pacientes || 0);
      const ticketMedio = pacientesAtendidas
        ? Math.round((resumo.receitaTotal / pacientesAtendidas) * 100) / 100 : null;

      const [leads] = await db.q(
        'SELECT id, status, date, converted_at AS convertedAt FROM leads' +
        ' WHERE clinica_id = :clinica AND date BETWEEN ? AND ?', [start, end]);
      const conversao = rel.taxaDeConversao(leads);

      const [plansAct] = await db.q(
        "SELECT COUNT(DISTINCT client_id) AS count FROM treatment_plans" +
        " WHERE clinica_id = :clinica AND status = 'ATIVO'");

      /* O TOP 3 continua saindo das SESSÕES, e é a resposta certa para a
         pergunta "o que mais rodou": o razão não sabe qual procedimento gerou
         cada receita. O rótulo no papel diz de onde ele vem, para ninguém
         somá-lo com o faturamento acima e estranhar a diferença. */
      const [topProcs] = await db.q(
        'SELECT session_type AS procedureName, SUM(price) AS total, COUNT(*) AS sessoes' +
        ' FROM treatment_sessions WHERE clinica_id = :clinica' +
        " AND status = 'REALIZADA' AND session_date BETWEEN ? AND ?" +
        ' GROUP BY session_type ORDER BY total DESC LIMIT 3', [start, end]);

      return res.json(Object.assign(cabecalho('VISÃO GERAL'), {
        data: {
          faturamentoTotal: resumo.receitaTotal,
          faturamentoFonte: 'razão do Financeiro (competência)',
          ticketMedio: ticketMedio,
          pacientesAtendidas: pacientesAtendidas,
          taxaConversao: conversao.pct,
          conversaoDetalhe: conversao,
          totalPacientesAtivos: Number((plansAct[0] || {}).count || 0),
          top3ProcedimentosPorFaturamento: topProcs.map((p) => ({
            nome: String(p.procedureName).replace(/_/g, ' '),
            faturamento: Number(p.total || 0),
            sessoes: Number(p.sessoes || 0)
          }))
        }
      }));
    }

    if (tabName === 'PIPELINE' || tabName === 'FUNIL' || tabName === 'FUNIL & LEADS') {
      const [leads] = await db.q(
        'SELECT id, status, source, date, converted_at AS convertedAt FROM leads' +
        ' WHERE clinica_id = :clinica AND date BETWEEN ? AND ?', [start, end]);

      const porEstagio = new Map();
      const porCanal = new Map();
      for (const l of leads) {
        const s = l.status || 'sem estagio';
        porEstagio.set(s, (porEstagio.get(s) || 0) + 1);
        const c = l.source || 'Site/Quiz';
        if (!porCanal.has(c)) porCanal.set(c, { leads: 0, fechados: 0 });
        const linha = porCanal.get(c);
        linha.leads++;
        if (String(l.status) === rel.FECHADO) linha.fechados++;
      }

      const tempo = rel.tempoDeConversao(leads);

      return res.json(Object.assign(cabecalho('FUNIL'), {
        data: {
          distribuicaoPorEstagio: Array.from(porEstagio.entries())
            .map(([estagio, quantidade]) => ({ estagio, quantidade })),
          /* Era 3.5 fixo, com o comentário "tempo padrão simulado". Agora é a
             MEDIANA de `date` até `converted_at`, e a amostra vai junto: a
             M5.10 não preencheu `converted_at` para trás, então em clínica
             antiga a amostra é pequena e o papel precisa dizer isso. */
          tempoMedioConversaoEmDias: tempo.dias,
          tempoConversaoAmostra: tempo.amostra,
          performancePorCanal: Array.from(porCanal.entries()).map(([nome, v]) => ({
            nome: nome, leads: v.leads, convertidos: v.fechados
          }))
        }
      }));
    }

    if (tabName === 'CLIENTS' || tabName === 'PACIENTES') {
      const [retPlan] = await db.q(
        'SELECT COUNT(DISTINCT client_id) AS count FROM treatment_plans WHERE clinica_id = :clinica');
      // O filtro vai DENTRO da subconsulta: no lado de fora ele nem está na
      // projeção. É o lugar mais fácil de esquecer, e o resultado sai maior sem
      // nada dar erro.
      const [retPlanMulti] = await db.q(
        'SELECT COUNT(*) AS count FROM (SELECT client_id FROM treatment_plans' +
        ' WHERE clinica_id = :clinica GROUP BY client_id HAVING COUNT(*) > 1) t');
      const retorno = rel.taxaDeRetorno(
        (retPlan[0] || {}).count, (retPlanMulti[0] || {}).count);

      // Três tabelas, três filtros -- e os dois dos LEFT JOIN ficam no ON, não
      // no WHERE: no WHERE eles virariam INNER JOIN e a paciente que NUNCA fez
      // sessão desapareceria da lista de inativas. Ela é a mais inativa que há.
      const [inativos] = await db.q(
        `SELECT c.id, c.name, c.phone, MAX(s.session_date) AS lastSessionDate
         FROM clients c
         LEFT JOIN treatment_plans p ON c.id = p.client_id AND p.clinica_id = :clinica
         LEFT JOIN treatment_sessions s ON p.id = s.plan_id AND s.clinica_id = :clinica
         WHERE c.clinica_id = :clinica
         GROUP BY c.id
         HAVING lastSessionDate IS NULL OR lastSessionDate < DATE_SUB(NOW(), INTERVAL 60 DAY)
         ORDER BY lastSessionDate ASC LIMIT 10`);

      const [investidores] = await db.q(
        `SELECT c.id, c.name, SUM(s.price) AS totalInvestido
         FROM clients c
         JOIN treatment_plans p ON c.id = p.client_id AND p.clinica_id = :clinica
         JOIN treatment_sessions s ON p.id = s.plan_id AND s.clinica_id = :clinica
         WHERE c.clinica_id = :clinica AND s.status = "REALIZADA"
           AND s.session_date BETWEEN ? AND ?
         GROUP BY c.id
         ORDER BY totalInvestido DESC LIMIT 10`, [start, end]);

      return res.json(Object.assign(cabecalho('PACIENTES'), {
        data: {
          taxaRetorno: retorno.pct,
          retornoDetalhe: retorno,
          listaInativos: inativos.map((i) => ({
            nome: i.name,
            telefone: i.phone,
            ultimoAtendimento: i.lastSessionDate
              ? new Date(i.lastSessionDate).toLocaleDateString('pt-BR') : 'Nunca'
          })),
          top10MaioresInvestidores: investidores.map((inv) => ({
            nome: inv.name, totalInvestido: Number(inv.totalInvestido || 0)
          }))
          /* `alertasAniversario` SAIU (M6.4). `clients` não tem data de
             nascimento -- a coluna não existe --, e a lista era calculada a
             partir da posição da paciente no resultado. O papel trazia nomes e
             telefones REAIS ao lado de datas inventadas. */
        }
      }));
    }

    if (tabName === 'CHAT' || tabName === 'ATENDIMENTO') {
      const [msgs] = await db.q(
        'SELECT client_id AS clientId, direction,' +
        " DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS createdAt" +
        ' FROM interactions WHERE clinica_id = :clinica AND created_at BETWEEN ? AND ?',
        [start, end]);

      const resposta = rel.tempoDeResposta(msgs);
      const pico = rel.horarioDePico(msgs);

      return res.json(Object.assign(cabecalho('ATENDIMENTO'), {
        data: {
          totalMensagens: msgs.length,
          recebidas: msgs.filter((m) => m.direction === 'in').length,
          enviadas: msgs.filter((m) => m.direction === 'out').length,
          /* Era '12 minutos' escrito no código. Agora é a MEDIANA do intervalo
             entre a mensagem recebida e a resposta seguinte. */
          tempoMedioResposta: resposta.minutos,
          respostaAmostra: resposta.amostra,
          conversasSemResposta: resposta.semResposta,
          horarioPico: pico ? pico.faixa : null,
          horarioPicoMensagens: pico ? pico.mensagens : 0
          /* `satisfacaoMedia` SAIU (M6.4): era '4.9 / 5.0' fixo, e não existe
             pesquisa de satisfação em lugar nenhum deste sistema. */
        }
      }));
    }

    return res.status(400).json({ error: 'Aba não reconhecida para geração de relatórios.' });
  } catch (error) {
    console.error('[relatorios]', error && error.message);
    res.status(500).json({ error: 'Erro ao compilar dados do relatório' });
  }
});

module.exports = router;

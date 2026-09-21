'use strict';
/** A camada de acesso por clínica — a 1ª barreira (M0.4).
 *
 *  ==================================================== O QUE ELA RESOLVE
 *
 *  São 220 consultas. Escrever `WHERE clinica_id = ?` em todas e confiar que
 *  ninguém esquece a 221ª não é plano, é esperança. Aqui o esquecimento vira
 *  **erro na cara**, não linha da clínica errada aparecendo em silêncio.
 *
 *  ======================================================= COMO SE ESCREVE
 *
 *      const db = escopo(req);
 *      const [linhas] = await db.q(
 *        'SELECT * FROM clients WHERE clinica_id = :clinica AND status = ?', ['ativo']);
 *
 *  A marca `:clinica` é **obrigatória**. Consulta sem ela é recusada antes de
 *  chegar ao banco. O valor sai de `req.usuario.clinicaId` — nunca do endereço,
 *  do corpo ou de um cabeçalho, senão bastaria trocar um número na requisição
 *  para ler a clínica do vizinho.
 *
 *  A marca pode aparecer em qualquer posição, quantas vezes precisar; os
 *  parâmetros `?` continuam na ordem em que você os escreveu.
 *
 *  ================================================== O QUE ELA NÃO RESOLVE
 *
 *  Sendo honesto sobre o alcance, porque camada que promete demais é pior que
 *  camada nenhuma:
 *
 *  - Ela confere que a marca ESTÁ na consulta, não que ela filtra a coisa
 *    certa. `SELECT ... FROM appointments a JOIN clients c ON c.id = a.client_id
 *    WHERE a.clinica_id = :clinica` passa aqui — e ainda pode trazer paciente de
 *    outra clínica pela junção, se `c.clinica_id` também não for amarrado.
 *  - Junção esquecida é exatamente o que a **2ª barreira** pega: o teste com
 *    duas clínicas semeadas com dados parecidos (M4.1).
 *  - E o que passar pelas duas, a **3ª** contém: chaves compostas no banco
 *    (M1.8).
 *
 *  Três barreiras porque nenhuma delas sozinha basta.
 *
 *  ========================================== A SAÍDA PARA TODAS AS CLÍNICAS
 *
 *  Existe, tem nome feio de propósito, e exige justificativa escrita:
 *
 *      escopo.todasAsClinicas('varredura de lembretes percorre todas')
 *            .q('SELECT ... FROM appointments WHERE ...', []);
 *
 *  Quem pode usar: as duas varreduras do cron e o painel da plataforma. Nada
 *  mais. Há teste conferindo a lista de quem chama.
 */

const { pool } = require('../db');

const MARCA = ':clinica';

/* ------------------------------------------------------------- o analisador
 *
 * Percorre a SQL uma vez, pulando literais de texto e comentários, e devolve:
 *
 *   sql     — com `:clinica` trocada por `?`
 *   marcas  — a ordem em que `?` e `:clinica` aparecem, para montar os
 *             parâmetros na posição certa
 *   codigo  — a mesma SQL com o CONTEÚDO de literais e comentários apagado,
 *             para as conferências não caírem em `SELECT 'clinica_id'`
 *
 * Por que pular literais: uma consulta pode ter `?` ou dois-pontos dentro de
 * texto (`DATE_FORMAT(x, '%H:%i')` é o caso real deste projeto). Contar esses
 * como parâmetro desalinharia todos os valores seguintes — e o desalinhamento
 * não dá erro de sintaxe: dá resultado errado.
 */
function fimDoLiteral(sql, i) {
  const aspas = sql[i];
  let j = i + 1;
  while (j < sql.length) {
    if (sql[j] === '\\' && aspas !== '`') { j += 2; continue; }   // \' e \"
    if (sql[j] === aspas) {
      if (sql[j + 1] === aspas) { j += 2; continue; }             // '' e `` duplicados
      return j + 1;
    }
    j += 1;
  }
  return sql.length;                                             // literal sem fim
}

function ehLetra(c) {
  return !!c && /[A-Za-z0-9_]/.test(c);
}

function analisar(sql) {
  const marcas = [];
  let saida = '';
  let codigo = '';
  let i = 0;

  while (i < sql.length) {
    const c = sql[i];

    if (c === "'" || c === '"' || c === '`') {
      const fim = fimDoLiteral(sql, i);
      const pedaco = sql.slice(i, fim);
      saida += pedaco;
      codigo += ' '.repeat(pedaco.length);        // some do olhar das conferências
      i = fim;
      continue;
    }

    if (c === '-' && sql[i + 1] === '-') {
      const fim = sql.indexOf('\n', i);
      const ate = fim === -1 ? sql.length : fim;
      saida += sql.slice(i, ate);
      codigo += ' '.repeat(ate - i);
      i = ate;
      continue;
    }

    if (c === '/' && sql[i + 1] === '*') {
      const fim = sql.indexOf('*/', i + 2);
      const ate = fim === -1 ? sql.length : fim + 2;
      saida += sql.slice(i, ate);
      codigo += ' '.repeat(ate - i);
      i = ate;
      continue;
    }

    if (c === '?') {
      marcas.push('param');
      saida += '?';
      codigo += '?';
      i += 1;
      continue;
    }

    if (sql.startsWith(MARCA, i) && !ehLetra(sql[i + MARCA.length])) {
      marcas.push('clinica');
      saida += '?';                                // o banco só entende `?`
      codigo += MARCA;
      i += MARCA.length;
      continue;
    }

    saida += c;
    codigo += c;
    i += 1;
  }

  return { sql: saida, marcas: marcas, codigo: codigo };
}

/** Monta a SQL e os parâmetros na ordem certa. Pura, e é o coração da camada. */
function preparar(sql, params, clinicaId) {
  const a = analisar(sql);
  const valores = [];
  let k = 0;

  for (const m of a.marcas) {
    if (m === 'clinica') valores.push(clinicaId);
    else valores.push(params[k++]);
  }

  // Conferência de brinde, e ela vale: parâmetro a mais ou a menos vira erro do
  // MySQL que não diz onde está o problema. Aqui diz.
  if (k !== params.length) {
    throw new Error(
      'escopo: a consulta tem ' + k + ' parametro(s) `?` e voce passou ' +
      params.length + '. Lembre que `' + MARCA + '` NAO conta como parametro -- o ' +
      'valor dela vem da sessao.'
    );
  }

  return { sql: a.sql, params: valores, codigo: a.codigo };
}

/** As duas conferências que fazem o esquecimento virar erro. */
function exigirFiltro(sql) {
  const a = analisar(sql);

  if (a.marcas.indexOf('clinica') === -1) {
    throw new Error(
      'escopo: consulta sem `' + MARCA + '`.\n' +
      'Toda consulta de rota filtra por clinica. Escreva, por exemplo:\n' +
      "  WHERE clinica_id = " + MARCA + "\n" +
      'Se esta consulta PRECISA atravessar clinicas (so as varreduras do cron e o ' +
      'painel da plataforma), use escopo.todasAsClinicas(motivo) e explique o motivo.\n' +
      'SQL: ' + sql.slice(0, 160)
    );
  }

  // `SELECT :clinica AS x FROM clients` passaria pela conferencia de cima sem
  // filtrar nada. Exigir que a coluna apareca no codigo fecha esse atalho.
  if (!/\bclinica_id\b/.test(a.codigo)) {
    throw new Error(
      'escopo: a consulta usa `' + MARCA + '` mas nao menciona a coluna `clinica_id`.\n' +
      'A marca sozinha nao filtra -- ela e so o valor. Compare a coluna com ela.\n' +
      'SQL: ' + sql.slice(0, 160)
    );
  }
}

/* ------------------------------------------------------------------ o escopo */

function fazerEscopo(clinicaId, executor, identidade) {
  if (!clinicaId) {
    throw new Error('escopo: sem clinica na sessao. O porteiro deveria ter barrado antes.');
  }

  const quem = identidade || {};

  const eu = {
    clinicaId: clinicaId,

    /** Quem está fazendo, e de onde. Vem do token e do socket, nunca do corpo
     *  da requisição — cabeçalho de autor enviado pelo cliente é assinatura
     *  falsificável, e trilha que aceita autor falsificado não é trilha. */
    autor: quem.autor || 'Sistema',
    ip: quem.ip || null,

    /** Uma consulta, com o filtro obrigatório. */
    q: async function (sql, params) {
      exigirFiltro(sql);
      const p = preparar(sql, params || [], clinicaId);
      return executor.query(p.sql, p.params);
    },

    /** A linha da PRÓPRIA clínica, em `clinicas`.
     *
     *  ===================================== POR QUE ISTO E UM METODO, E NAO SQL
     *
     *  `clinicas` é a única tabela de dado que **não tem** coluna `clinica_id`
     *  — ela É a lista de clínicas. Então `db.q` recusa qualquer leitura dela,
     *  e com razão: a conferência exige a coluna, e a coluna não existe.
     *
     *  Sem esta porta, quem precisa do nome ou da instância da própria clínica
     *  cairia em `todasAsClinicas` — que não filtra nada — para ler uma linha
     *  que é dela. Seria abrir a exceção mais larga do sistema para o caso mais
     *  estreito que existe.
     *
     *  Aqui não há como pedir a clínica errada: o `id` vem do escopo, e não de
     *  argumento. É segura por construção, e não por conferência. */
    minhaClinica: async function () {
      const [r] = await executor.query(
        'SELECT * FROM clinicas WHERE id = ? LIMIT 1', [clinicaId]);
      return r[0] || null;
    },

    /** Gravar no cadastro da PRÓPRIA clínica — e só nos campos do timbre.
     *
     *  ============================ POR QUE A LISTA DE COLUNAS É FECHADA AQUI
     *
     *  `clinicas` guarda três coisas que **não** são da clínica decidir:
     *  `status` (quem suspende é a plataforma), `chave_captacao` (trocá-la
     *  desliga o formulário do site) e `evolution_instance` (apontar para a
     *  instância da vizinha faria mensagem de paciente cair na clínica errada).
     *
     *  Uma porta genérica de gravação em `clinicas` deixaria qualquer rota
     *  futura alcançar essas três por descuido. Então a porta nasce estreita: o
     *  `id` vem do escopo, e o conjunto de colunas vem daqui — não de quem
     *  chama. Acrescentar campo é acrescentar uma linha NESTA lista, que é
     *  exatamente o momento em que alguém pensa duas vezes.
     */
    atualizarMinhaClinica: async function (campos) {
      const PERMITIDAS = ['nome', 'documento', 'endereco', 'telefone', 'contato', 'email'];
      const sets = [], valores = [];
      for (const coluna of PERMITIDAS) {
        if (campos && Object.prototype.hasOwnProperty.call(campos, coluna)) {
          sets.push('`' + coluna + '` = ?');
          const v = campos[coluna];
          valores.push(v === '' || v == null ? null : String(v));
        }
      }
      if (!sets.length) return 0;
      valores.push(clinicaId);
      const [r] = await executor.query(
        'UPDATE clinicas SET ' + sets.join(', ') + ' WHERE id = ?', valores);
      return r.affectedRows;
    },

    /** Uma transação inteira dentro da mesma clínica.
     *
     *  A função recebe um escopo igual a este, amarrado à conexão da transação.
     *  Não há como pegar a conexão crua daqui: seria um buraco permanente na
     *  camada, aberto "só para o caso de". Quando a M1 precisar encaixar os
     *  serviços que hoje recebem `conn`, a camada cresce -- a exceção não.
     *
     *  ================================ POR QUE A CONEXÃO VEM DO `executor`
     *
     *  A primeira versão chamava `pool.getConnection()` -- o pool do módulo,
     *  não o executor deste escopo. Dois defeitos, e o segundo é grave:
     *
     *  1. Escopo montado sobre um executor de mentira (os testes de serviço,
     *     que não encostam no MySQL) abria conexão de verdade e travava a
     *     suíte. Já aconteceu duas vezes neste projeto.
     *
     *  2. **Transação dentro de transação rodaria FORA da transação de fora.**
     *     O escopo de dentro pegaria outra conexão do pool, e um rollback lá
     *     fora não desfaria nada do que ela gravou. Silencioso: nenhum erro,
     *     metade do efeito aplicada. Agora isto é recusado alto -- escopo
     *     amarrado a conexão não tem `getConnection`. */
    transacao: async function (fn) {
      if (!executor || typeof executor.getConnection !== 'function') {
        throw new Error(
          'escopo: transacao dentro de transacao (ou executor sem getConnection).\n' +
          'Este escopo ja esta amarrado a uma conexao. Abrir outra faria as gravacoes ' +
          'de dentro rodarem FORA da transacao de fora, e um rollback nao as desfaria.\n' +
          'Passe adiante o `tx` que voce ja recebeu, em vez de abrir outra transacao.'
        );
      }
      const conn = await executor.getConnection();
      try {
        await conn.beginTransaction();
        const dentro = fazerEscopo(clinicaId, conn, quem);
        const r = await fn(dentro);
        await conn.commit();
        return r;
      } catch (e) {
        try { await conn.rollback(); } catch (e2) { /* a conexao ja morreu */ }
        throw e;
      } finally {
        conn.release();
      }
    }
  };

  return eu;
}

/** O escopo de uma requisição. A clínica sai da SESSÃO, e de nenhum outro
 *  lugar — é o que impede trocar um número na requisição para ler a clínica do
 *  vizinho. */
function escopo(req) {
  const clinicaId = req && req.usuario && req.usuario.clinicaId;
  if (!clinicaId) {
    throw new Error(
      'escopo: requisicao sem clinica na sessao. Se esta rota e publica ou de ' +
      'servico, ela nao deveria estar usando escopo(req).'
    );
  }
  return fazerEscopo(clinicaId, pool, {
    autor: (req.usuario && req.usuario.nome) || 'Sistema',
    ip: req.ip || null
  });
}

/** A saída para quem PRECISA atravessar clínicas. Exige motivo escrito, e o
 *  motivo aparece na mensagem de qualquer erro que a consulta produzir — quem
 *  for depurar isso daqui a um ano descobre por que a consulta é assim. */
escopo.todasAsClinicas = function (motivo) {
  if (typeof motivo !== 'string' || motivo.trim().length < 15) {
    throw new Error(
      'escopo.todasAsClinicas exige um motivo escrito de pelo menos 15 caracteres. ' +
      'Atravessar clinicas e excecao; excecao sem justificativa vira regra.'
    );
  }
  /** O executor cru, com o motivo colado em qualquer erro. `executor` e o pool
   *  ou uma conexao de transacao. */
  function cruCom(executor) {
    return {
      motivo: motivo,
      q: async function (sql, params) {
        // Sem exigirFiltro, de proposito: e o unico caminho do sistema em que a
        // ausencia do filtro e deliberada.
        try {
          return await executor.query(sql, params || []);
        } catch (e) {
          e.message = '[todasAsClinicas: ' + motivo + '] ' + e.message;
          throw e;
        }
      },

      /** ============================ POR QUE A TRAVESSIA TAMBEM PRECISA DISTO
       *
       *  Acrescentado em 11/09, no nascimento de uma clinica (M2.4) -- e a falta
       *  apareceu do jeito mais direto: `cru.transacao is not a function`.
       *
       *  A operacao que mais precisa de "tudo ou nada" e justamente a que
       *  atravessa clinicas. Criar uma clinica grava em seis tabelas (a clinica,
       *  o primeiro acesso, as categorias, preco, pontos, modelos) e **meia
       *  clinica gravada e pior do que nenhuma**: a pessoa entra, encontra telas
       *  que funcionam e telas que recusam, e ninguem sabe dizer o que faltou.
       *
       *  A alternativa seria abrir a transacao por fora e passar a conexao
       *  adiante -- que e exatamente o que a camada existe para nao precisar. */
      transacao: async function (fn) {
        if (!executor || typeof executor.getConnection !== 'function') {
          throw new Error(
            '[todasAsClinicas: ' + motivo + '] transacao dentro de transacao.\n' +
            'Este executor ja esta amarrado a uma conexao. Abrir outra faria as gravacoes ' +
            'de dentro rodarem FORA da transacao de fora, e um rollback nao as desfaria.'
          );
        }
        const conn = await executor.getConnection();
        try {
          await conn.beginTransaction();
          const r = await fn(cruCom(conn));
          await conn.commit();
          return r;
        } catch (e) {
          try { await conn.rollback(); } catch (e2) { /* a conexao ja morreu */ }
          throw e;
        } finally {
          conn.release();
        }
      }
    };
  }

  return cruCom(pool);
};

/** O escopo de uma clínica conhecida, SEM requisição.
 *
 *  Existe para os caminhos que sabem de quem é o trabalho, mas não têm sessão
 *  de onde tirar: o webhook do WhatsApp (a clínica sai da instância que recebeu
 *  a mensagem) e, na M2.3, as varreduras automáticas (que descobrem a clínica
 *  de cada linha que processam).
 *
 *  ============================================ POR QUE ISTO E MELHOR QUE O POOL
 *
 *  Antes destes casos, quem não tinha sessão importava `pool` e falava com o
 *  banco direto — e por isso ficava na catraca, indistinguível de código que
 *  ainda não foi convertido. Com esta porta, "não tenho sessão" deixa de
 *  significar "não uso a camada": a consulta continua obrigada a filtrar, e o
 *  arquivo sai da lista de exceções.
 *
 *  Não é uma saída para atravessar clínicas — para isso existe
 *  `todasAsClinicas`, que exige motivo escrito. Aqui a clínica é UMA, e quem
 *  chama tem de saber dizer qual. */
escopo.paraClinica = function (clinicaId, identidade) {
  if (!clinicaId) {
    throw new Error(
      'escopo.paraClinica exige a clinica. Se voce nao sabe de quem e o trabalho, ' +
      'nao invente: ou descubra antes, ou use escopo.todasAsClinicas com o motivo escrito.'
    );
  }
  return fazerEscopo(clinicaId, pool, identidade);
};

escopo.MARCA = MARCA;
escopo.analisar = analisar;
escopo.preparar = preparar;
escopo.exigirFiltro = exigirFiltro;
escopo.fazerEscopo = fazerEscopo;

module.exports = escopo;

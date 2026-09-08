'use strict';
/** 020 — conserto da 018: `clinica_id` volta a aceitar vazio.
 *
 *  ==================================================== O QUE ACONTECEU
 *
 *  A 018 criou `clinica_id` como NOT NULL **sem valor padrão**, e o sistema
 *  tem 45 comandos `INSERT` que não nomeiam a coluna. Em modo estrito o MySQL
 *  recusa cada um deles: *Field 'clinica_id' doesn't have a default value*.
 *
 *  Resultado em produção: leitura funcionando, **escrita inteira parada** —
 *  criar paciente, marcar consulta, lançar receita, dar entrada em estoque,
 *  gerar documento, cadastrar usuário. A verificação que fizemos depois da 018
 *  só exercitou rotas de leitura, e por isso passou.
 *
 *  ==================================================== O ERRO DE SEQUÊNCIA
 *
 *  Numa alteração dessas há três passos, nesta ordem:
 *
 *    1. EXPANDIR — a coluna passa a existir, aceitando vazio.
 *    2. MIGRAR   — o código passa a preenchê-la em toda gravação.
 *    3. APERTAR  — a coluna passa a ser obrigatória.
 *
 *  A 018 fez 1 e 3 juntos, antes do 2. Esta migration desfaz o aperto e o
 *  devolve para o fim da fase M1, quando as gravações já informarem a clínica.
 *
 *  ================================== POR QUE VAZIO, E NÃO UM VALOR PADRÃO
 *
 *  A tentação é `DEFAULT 'cl_1'`: resolve na hora e ninguém mais vê erro. É a
 *  escolha errada, e por um motivo que vale escrever.
 *
 *  **Vazio falha fechado. Valor padrão falha aberto.**
 *
 *  Com padrão, uma gravação que esqueça a clínica depois da M1 arquiva o dado
 *  da clínica X debaixo da clínica 1 — em silêncio, sem erro, e a próxima tela
 *  mostra a linha para o inquilino errado. É exatamente a classe de defeito
 *  que este projeto inteiro está tentando impedir.
 *
 *  Com vazio, essa mesma gravação produz uma linha que nenhuma consulta
 *  filtrada por clínica devolve. A linha *desaparece* da vista de quem a criou
 *  — vira um defeito visível, reclamado no mesmo dia, e nunca um vazamento.
 *
 *  Hoje existe UMA clínica, então preencher o que ficar vazio é inequívoco: é
 *  tudo da `cl_1`. A migration de aperto, no fim da M1, faz esse preenchimento
 *  antes de exigir a coluna.
 *
 *  ================================================== O QUE FICA MANTIDO
 *
 *  Os índices continuam. As unicidades da 019 continuam. As duas tabelas que já
 *  aceitavam vazio (`system_settings`, `system_logs`) não são tocadas — para
 *  elas o vazio sempre teve outro significado: "é da instalação, não de clínica
 *  nenhuma".
 */

const L = require('./018_clinicas.js').LISTAS;

async function tabelasDoBanco(conn) {
  const [r] = await conn.query(
    `SELECT TABLE_NAME AS t FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`
  );
  return r.map((x) => x.t);
}

/** As que hoje exigem a coluna. Lidas do banco, não presumidas. */
async function exigemAColuna(conn, tabelas) {
  const exigem = [];
  for (const t of tabelas) {
    const [r] = await conn.query(
      `SELECT IS_NULLABLE AS nulavel FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'clinica_id'`,
      [t]
    );
    if (r.length && r[0].nulavel === 'NO') exigem.push(t);
  }
  return exigem;
}

module.exports = async function up(conn) {
  const doBanco = await tabelasDoBanco(conn);
  const alvo = L.OBRIGATORIA.filter((t) => doBanco.indexOf(t) !== -1);
  const exigem = await exigemAColuna(conn, alvo);

  if (!exigem.length) {
    console.log('   = nenhuma tabela exigia clinica_id; nada a afrouxar');
    return;
  }

  for (const t of exigem) {
    await conn.query('ALTER TABLE `' + t + '` MODIFY clinica_id VARCHAR(50) NULL');
  }
  console.log('   ~ ' + exigem.length + ' tabela(s) voltaram a aceitar clinica_id vazio');
  console.log('   i EXPANDIR feito. MIGRAR e a fase M1. APERTAR volta no fim dela (M1.7).');

  // Conferência: nenhuma das 26 exige mais a coluna.
  const aindaExigem = await exigemAColuna(conn, alvo);
  if (aindaExigem.length) {
    throw new Error('020: ainda exigem clinica_id: ' + aindaExigem.join(', '));
  }

  // E o índice continua onde estava -- afrouxar a coluna não pode ter derrubado
  // o que a 018 e a 019 construíram.
  const semIndice = [];
  for (const t of alvo) {
    const [r] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = 'idx_clinica'`,
      [t]
    );
    if (!Number(r[0].n)) semIndice.push(t);
  }
  if (semIndice.length) {
    throw new Error('020: o indice idx_clinica desapareceu de ' + semIndice.join(', '));
  }
  console.log('   = os ' + alvo.length + ' indices idx_clinica seguem no lugar');
};

module.exports.exigemAColuna = exigemAColuna;

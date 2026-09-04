'use strict';
/**
 * 012_descricao_lancamento_migrado.js — rastro da 010
 *
 * A 010 corrigiu o título dos compromissos que vieram do histórico
 * ("SESSAO_TRATAMENTO" era um código, não o nome do procedimento). Só que a
 * receita desses atendimentos já tinha sido lançada antes, com a descrição
 * copiada do mesmo campo errado — e lançamento no razão não muda sozinho
 * quando a origem muda.
 *
 * Resultado visível: o extrato financeiro da clínica lista
 * "SESSAO_TRATAMENTO - Ana Beatriz" onde deveria ler o nome do procedimento.
 * Não erra nenhum valor; só torna o relatório ilegível, que é o suficiente
 * para alguém deixar de usá-lo.
 *
 * UMA ARMADILHA DE COLLATION, PARA NÃO SE REPETIR
 *
 * O filtro óbvio seria "descrição em maiúsculas": `x = UPPER(x)`. Não funciona.
 * As tabelas usam `utf8mb4_unicode_ci`, que é *case-insensitive* — 'Bumbum Max'
 * é igual a 'BUMBUM MAX' para o banco, e a condição passa para TODA linha. Um
 * filtro assim renomearia lançamento de verdade.
 *
 * Por isso o recorte aqui é por procedência, não por aparência: só lançamentos
 * cuja origem é um compromisso que a 009 marcou como migrado do histórico.
 */

module.exports = async function up(conn) {
  // Com nome de paciente: "CODIGO - Fulana" -> "Procedimento - Fulana".
  const [comCliente] = await conn.query(`
    UPDATE cash_entries e
      JOIN appointments a ON a.id = e.source_id
       SET e.description = CONCAT(a.title, SUBSTRING(e.description, LOCATE(' - ', e.description)))
     WHERE e.source = 'APPOINTMENT'
       AND a.notes LIKE 'Migrado do historico%'
       AND LOCATE(' - ', e.description) > 1
       AND e.description <> CONCAT(a.title, SUBSTRING(e.description, LOCATE(' - ', e.description)))
  `);

  // Sem nome de paciente: a descrição é só o título.
  const [semCliente] = await conn.query(`
    UPDATE cash_entries e
      JOIN appointments a ON a.id = e.source_id
       SET e.description = a.title
     WHERE e.source = 'APPOINTMENT'
       AND a.notes LIKE 'Migrado do historico%'
       AND LOCATE(' - ', e.description) = 0
       AND e.description <> a.title
  `);

  console.log('   + ' + (comCliente.affectedRows + semCliente.affectedRows) +
              ' descricao(oes) de lancamento corrigida(s)');
};

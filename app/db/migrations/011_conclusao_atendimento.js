'use strict';
/**
 * 011_conclusao_atendimento.js — Fase 1, T1.4
 *
 * O PROBLEMA QUE ESTA MIGRATION RESOLVE
 *
 * A T2.5 lançou a receita dos atendimentos antes de a agenda existir, e usou
 * como origem o id da SESSÃO clínica: (source='APPOINTMENT', source_id=ts_xxx).
 * Agora a agenda existe e o contexto 02 define a origem como o id do
 * COMPROMISSO: (source='APPOINTMENT', source_id=ap_xxx).
 *
 * Duas chaves para o mesmo fato é o começo de uma divergência de saldo: ao
 * concluir um atendimento migrado, o serviço olharia por `ap_xxx`, não acharia
 * nada, e lançaria a receita de novo — a clínica veria o mesmo procedimento
 * faturado duas vezes e ninguém saberia explicar por quê.
 *
 * Aqui a chave antiga é reescrita para a nova. Não é apagar histórico: é o
 * mesmo lançamento, com o nome certo da origem.
 *
 * TAMBÉM: `completions` e o carimbo dos migrados.
 *
 * `completions` conta quantas vezes o compromisso já foi concluído, e é o que
 * dá nome à chave quando alguém estorna e conclui de novo. Os compromissos que
 * vieram do histórico já REALIZADOS precisam nascer com `completed_at`
 * preenchido — sem isso, mudar o status pela tela dispararia os efeitos de um
 * atendimento de abril como se tivesse acabado de acontecer.
 */

async function temColuna(conn, tabela, coluna) {
  const [r] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [tabela, coluna]
  );
  return r.length > 0;
}

module.exports = async function up(conn) {
  if (!(await temColuna(conn, 'appointments', 'completions'))) {
    await conn.query('ALTER TABLE appointments ADD COLUMN completions INT NOT NULL DEFAULT 0 AFTER completed_at');
    console.log('   + appointments.completions');
  }

  // 1) chave antiga (id da sessão) -> chave nova (id do compromisso)
  const [reescritos] = await conn.query(`
    UPDATE cash_entries e
      JOIN treatment_sessions s ON s.id = e.source_id
       SET e.source_id = s.appointment_id
     WHERE e.source = 'APPOINTMENT'
       AND s.appointment_id IS NOT NULL
  `);
  console.log('   + ' + reescritos.affectedRows + ' lancamento(s) reapontado(s) para o compromisso');

  // 2) compromisso já realizado precisa do carimbo de conclusão
  const [carimbados] = await conn.query(`
    UPDATE appointments
       SET completed_at = starts_at
     WHERE status = 'REALIZADO' AND completed_at IS NULL
  `);
  console.log('   + ' + carimbados.affectedRows + ' compromisso(s) realizado(s) carimbado(s)');

  // 3) quem já tem receita lançada está na conclusão numero 1
  const [contados] = await conn.query(`
    UPDATE appointments a
      JOIN cash_entries e ON e.source = 'APPOINTMENT' AND e.source_id = a.id AND e.type = 'RECEITA'
       SET a.completions = 1
     WHERE a.completions = 0
  `);
  console.log('   + ' + contados.affectedRows + ' compromisso(s) marcado(s) como conclusao 1');

  // 4) realizado sem receita também já foi concluído uma vez (só não faturou)
  const [resto] = await conn.query(`
    UPDATE appointments SET completions = 1 WHERE status = 'REALIZADO' AND completions = 0
  `);
  console.log('   + ' + resto.affectedRows + ' realizado(s) sem receita marcado(s) como conclusao 1');
};

'use strict';
/**
 * 010_titulo_compromisso_migrado.js — correção da 009
 *
 * A 009 usou `treatment_sessions.session_type` como título do compromisso.
 * Parecia o campo certo pelo nome, mas o conteúdo real é um código —
 * "SESSAO_TRATAMENTO" —, não o nome do procedimento. Na agenda a recepção lia
 * seis blocos idênticos escritos em maiúsculas, sem saber o que era cada um.
 *
 * O nome legível está no plano de tratamento ("Protocolo Lavien BB Laser").
 * Esta migration troca o título dos compromissos migrados que ficaram com cara
 * de código, e só deles: qualquer compromisso criado depois pela tela tem
 * título escolhido por gente e não deve ser tocado.
 *
 * O reconhecimento é conservador de propósito — TÍTULO EM MAIÚSCULAS COM
 * UNDERSCORE, e apenas entre os que a 009 marcou como migrados. Um filtro
 * genérico do tipo "títulos curtos" acabaria renomeando compromisso de
 * verdade.
 */

module.exports = async function up(conn) {
  const [r] = await conn.query(`
    UPDATE appointments a
      JOIN treatment_sessions s ON s.appointment_id = a.id
      JOIN treatment_plans p ON p.id = s.plan_id
       SET a.title = p.title
     WHERE a.notes LIKE 'Migrado do historico%'
       AND a.title = UPPER(a.title)
       AND a.title LIKE '%\\_%'
       AND p.title IS NOT NULL
       AND p.title <> ''
  `);
  console.log('   + titulo corrigido em ' + r.affectedRows + ' compromisso(s) migrado(s)');
};

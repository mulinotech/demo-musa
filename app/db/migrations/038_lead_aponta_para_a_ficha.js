'use strict';
/** O lead passa a apontar para a ficha da paciente (M5.10, 21/09).
 *
 *  ====================================================== O QUE FALTAVA AQUI
 *
 *  A coluna "Venda Fechada" do funil escrevia **"Convertido em cliente"** desde
 *  sempre, e o banco não guardava nenhum vínculo entre o lead fechado e a ficha
 *  de paciente. Pelo banco, ninguém conseguia responder nenhuma das duas
 *  perguntas que o comercial faz toda semana:
 *
 *      "de onde veio esta paciente?"        (da ficha para o lead)
 *      "este lead virou paciente mesmo?"    (do lead para a ficha)
 *
 *  Duas colunas fecham as duas. `client_id` é o vínculo; `converted_at` é
 *  quando ele nasceu — e é ele que separa "fechada hoje" de "fechada em março",
 *  coisa que `leads.date` (a data da CAPTAÇÃO) nunca soube dizer.
 *
 *  ================================ POR QUE `client_id`, E NÃO OUTRO NOME
 *
 *  Neste sistema `client` é **paciente** e `clinica_id` é o inquilino. A coluna
 *  aponta para `clients.id`, então `client_id` é o nome certo e é o mesmo que
 *  `interactions`, `appointments` e `treatment_sessions` já usam. Trocar o nome
 *  aqui só para evitar a confusão com `clinica_id` deixaria esta tabela
 *  diferente de todas as outras — e a confusão voltaria por outro lado.
 *
 *  ========================================== POR QUE NÃO HÁ CHAVE ESTRANGEIRA
 *
 *  Pelo mesmo motivo das outras 22 relações mapeadas na M1.9: a chave de
 *  `clients` é composta (`clinica_id`, `id`) desde a 027, e uma FK aqui teria de
 *  ser composta também. Isso entra junto com as outras na M1.9, de uma vez, com
 *  a conferência de órfãos que aquela tarefa já prevê — e não de véspera, numa
 *  migration que só precisa acrescentar coluna.
 *
 *  O índice, esse entra agora: a tela da ficha vai perguntar "qual lead deu
 *  origem a esta paciente?", e sem índice essa pergunta varre a tabela inteira.
 *
 *  ===================================================== O QUE ELA NÃO FAZ
 *
 *  **Não preenche nada retroativamente.** Os leads já fechados ficam com
 *  `client_id` vazio, e é honesto que fiquem: a conversão deles rodou no
 *  navegador, comparando telefone como texto cru, e adivinhar agora qual ficha
 *  pertence a qual lead antigo seria inventar vínculo — exatamente o erro que a
 *  regra nova se recusa a cometer. Lead antigo reaberto e fechado de novo passa
 *  pela regra nova e se vincula ali.
 */

module.exports = async function up(conn) {
  const [r] = await conn.query(
    'SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS' +
    " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads'");
  const tem = r.map((x) => x.c);
  const criadas = [];

  if (tem.indexOf('client_id') === -1) {
    await conn.query('ALTER TABLE leads ADD COLUMN client_id VARCHAR(50) DEFAULT NULL');
    criadas.push('leads.client_id');
  }
  if (tem.indexOf('converted_at') === -1) {
    await conn.query('ALTER TABLE leads ADD COLUMN converted_at DATETIME DEFAULT NULL');
    criadas.push('leads.converted_at');
  }

  /* Aqui o indice e' procurado pelo NOME, e nao pelas colunas como fez a 019:
     la o indice tinha sido criado pelo MySQL com nome automatico, e nome
     automatico muda entre versoes. Este nasce aqui, com nome nosso. */
  const [idx] = await conn.query(
    "SELECT INDEX_NAME AS n FROM information_schema.STATISTICS" +
    " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads'" +
    " AND INDEX_NAME = 'idx_leads_client' LIMIT 1");
  if (idx.length === 0) {
    await conn.query('CREATE INDEX idx_leads_client ON leads (clinica_id, client_id)');
    criadas.push('indice idx_leads_client');
  }

  await conn.query(
    'INSERT INTO system_logs (id, action_type, description, author) VALUES (?, ?, ?, ?)',
    ['lg_038_' + Date.now().toString(36), 'MIGRATION',
     'Migration 038: leads.client_id e leads.converted_at, o vinculo entre o lead ' +
     'fechado e a ficha da paciente. Nenhum lead antigo foi vinculado ' +
     'retroativamente -- vinculo adivinhado e vinculo errado.', 'Sistema']);

  return {
    colunasCriadas: criadas,
    apagou: 'nada -- so acrescenta colunas nulas e um indice'
  };
};

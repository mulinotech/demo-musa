'use strict';
/** O e-mail da clínica, para a faixa de contato do receituário (M5.7, 17/09).
 *
 *  A 035 trouxe endereço, telefone e `contato` (site ou @). O receituário pede
 *  a linha no formato que a paciente leva para a farmácia e para casa:
 *
 *      Contato: (11) 3456-7890 ou contato@clinica.com.br
 *      Rua Alegre, 123 — São Paulo, SP
 *
 *  Sem uma coluna própria, o e-mail teria de disputar o campo `contato` com o
 *  site — e a clínica que tem os dois perderia um deles. Uma coluna resolve, e
 *  o carimbo no documento acompanha pela mesma razão das outras: a clínica troca
 *  de e-mail, e a receita do ano passado continua dizendo o e-mail de então.
 */

async function acrescentar(conn, tabela, lista) {
  const [r] = await conn.query(
    'SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS' +
    ' WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [tabela]);
  const tem = r.map((x) => x.c);
  const feitas = [];
  for (const [nome, tipo] of lista) {
    if (tem.indexOf(nome) === -1) {
      await conn.query('ALTER TABLE `' + tabela + '` ADD COLUMN `' + nome + '` ' + tipo);
      feitas.push(tabela + '.' + nome);
    }
  }
  return feitas;
}

module.exports = async function up(conn) {
  const criadas = [];
  criadas.push(...await acrescentar(conn, 'clinicas', [['email', 'VARCHAR(160) NULL']]));
  criadas.push(...await acrescentar(conn, 'client_documents', [['timbre_email', 'VARCHAR(160) NULL']]));

  await conn.query(
    'INSERT INTO system_logs (id, action_type, description, author) VALUES (?, ?, ?, ?)',
    ['lg_036_' + Date.now().toString(36), 'MIGRATION',
     'Migration 036: clinicas.email e client_documents.timbre_email, para a faixa de ' +
     'contato no pe do receituario.', 'Sistema']);

  return { colunasCriadas: criadas, apagou: 'nada -- so acrescenta duas colunas' };
};

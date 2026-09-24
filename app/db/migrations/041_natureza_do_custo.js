'use strict';
/** Custo fixo separado de custo recorrente (M6.3, 24/09).
 *
 *  ===================================================== POR QUE ESTA COLUNA
 *
 *  A aba de Custos fixos soma tudo o que está nela e divide pelas horas
 *  produtivas. Esse número entra em todo preço que a clínica calcula.
 *
 *  O time comercial relatou em 19/09 que lançam ali também o que é **recorrente
 *  por atendimento** — insumo, comissão, taxa de cartão. Esses já entram no
 *  preço por outra porta (a ficha técnica e os percentuais da calculadora), e
 *  somá-los aqui os conta duas vezes no mesmo preço, sem que a tela mostre
 *  nada de errado.
 *
 *  A regra que decide qual soma vive em `services/custos-fixos.js`, em função
 *  pura e com teste. Esta migration só abre o lugar onde a resposta mora.
 *
 *  ========================================= TODA LINHA EXISTENTE NASCE `FIXO`
 *
 *  E isso é deliberado: `FIXO` é exatamente como cada uma vinha sendo contada.
 *  O custo por hora da clínica **não muda** no dia desta migration — nenhum
 *  preço, nenhuma margem e nenhuma simulação guardada passam a dizer outra
 *  coisa por causa dela.
 *
 *  Reclassificar pelo nome ("Ácido" parece insumo, "Aluguel" não") seria
 *  reescrever o preço de 50 clínicas com base em palpite sobre texto livre.
 *  É a mesma recusa da 039 com equipamento, e pelo mesmo motivo: o que está
 *  escrito é de quem escreveu.
 */

async function colunas(conn, tabela) {
  const [r] = await conn.query(
    'SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS' +
    ' WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [tabela]);
  return r.map((x) => x.c);
}

module.exports = async function up(conn) {
  const criadas = [];
  const tem = await colunas(conn, 'fixed_costs');

  if (tem.indexOf('natureza') === -1) {
    await conn.query(
      "ALTER TABLE fixed_costs ADD COLUMN natureza VARCHAR(20) NOT NULL DEFAULT 'FIXO'" +
      " COMMENT 'FIXO entra no custo por hora; VARIAVEL e recorrente por atendimento'");
    criadas.push('fixed_costs.natureza');
  }

  const [quantas] = await conn.query(
    "SELECT COUNT(*) AS n FROM fixed_costs WHERE natureza = 'FIXO'");

  await conn.query(
    'INSERT INTO system_logs (id, action_type, description, author) VALUES (?, ?, ?, ?)',
    ['lg_041_' + Date.now().toString(36), 'MIGRATION',
     'Migration 041: natureza do custo (FIXO x VARIAVEL). As ' + quantas[0].n +
     ' linha(s) existentes nasceram FIXO, que e exatamente como vinham sendo ' +
     'contadas: nenhum custo por hora mudou. Nenhuma linha foi reclassificada ' +
     'pelo nome.', 'Sistema']);

  return {
    criadas: criadas,
    apagou: 'nada',
    naoTocou: quantas[0].n + ' custo(s) ja lancado(s) -- todos seguem FIXO e o ' +
              'custo por hora da clinica e o mesmo de ontem'
  };
};

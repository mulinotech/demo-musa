'use strict';
/** A marcação "esta categoria é investimento em captação" (M5.8, 18/09).
 *
 *  ======================================== POR QUE UMA COLUNA E NÃO UM CADASTRO
 *
 *  O Custo por Lead precisa de um número que o sistema não tem: quanto a clínica
 *  gastou para atrair paciente no período. A tela antiga resolvia isso escrevendo
 *  **R$ 18,50** no código, com um comentário dizendo que um dia viria da API de
 *  anúncios. Número ilustrativo em tela de gestão vira promessa na hora da venda,
 *  e foi exatamente o que aconteceu na apresentação ao time comercial.
 *
 *  A alternativa óbvia — uma tela nova de "investimento em marketing por mês" —
 *  faria a clínica digitar duas vezes: ela JÁ lança "Agência de Marketing" e
 *  anúncios no Financeiro. Dois lugares com o mesmo número é um lugar para eles
 *  divergirem.
 *
 *  Então o que entra é uma marcação numa categoria que já existe. A clínica diz
 *  uma vez quais categorias são captação, e o CPL passa a somar as DESPESAS do
 *  período nessas categorias. Nada digitado duas vezes, e o número do cartão é
 *  rastreável até o lançamento que o produziu.
 *
 *  ================================================== POR QUE O PADRÃO É ZERO
 *
 *  Nenhuma categoria nasce marcada, de propósito. Zero categoria marcada faz o
 *  CPL responder `null`, e a tela escreve onde marcar em vez de mostrar número.
 *  Chutar que "cat_marketing" é captação para todas as 50 clínicas seria repetir
 *  o defeito original com outra roupa: um número que ninguém conferiu.
 *
 *  A chave de `finance_categories` é composta (`clinica_id`, `id`) desde a 030 —
 *  cada clínica marca as suas, e a marcação de uma não alcança a outra.
 */

module.exports = async function up(conn) {
  const [r] = await conn.query(
    'SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS' +
    " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'finance_categories'");
  const tem = r.map((x) => x.c);
  const criadas = [];

  if (tem.indexOf('conta_no_cpl') === -1) {
    await conn.query(
      'ALTER TABLE finance_categories ADD COLUMN conta_no_cpl TINYINT(1) NOT NULL DEFAULT 0');
    criadas.push('finance_categories.conta_no_cpl');
  }

  await conn.query(
    'INSERT INTO system_logs (id, action_type, description, author) VALUES (?, ?, ?, ?)',
    ['lg_037_' + Date.now().toString(36), 'MIGRATION',
     'Migration 037: finance_categories.conta_no_cpl, a marcacao que alimenta o ' +
     'Custo por Lead da Visao Geral. Nenhuma categoria nasce marcada.', 'Sistema']);

  return {
    colunasCriadas: criadas,
    apagou: 'nada -- so acrescenta uma coluna, com padrao 0'
  };
};

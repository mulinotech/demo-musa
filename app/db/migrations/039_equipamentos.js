'use strict';
/** O cadastro de equipamentos da clínica (M5.11, 21/09).
 *
 *  ===================================================== POR QUE ISTO EXISTE
 *
 *  Item 5 do bloco de Pacientes do PDF de 19/09: na janela de lançar a sessão,
 *  **Profissional**, **Equipamentos** e **Insumos** eram três caixas de texto
 *  livre. Profissional e insumo já tinham de onde vir — `users` e `products`.
 *  Equipamento não tinha de lugar nenhum: a única menção a equipamento no banco
 *  inteiro era a categoria de despesa `cat_equipamentos`, do Financeiro.
 *
 *  ======================================== POR QUE TEXTO LIVRE NÃO SERVE AQUI
 *
 *  Não é pela digitação errada — é porque **texto livre nunca soma**. A pergunta
 *  que a clínica faz depois de seis meses é "quantas sessões o Ultraformer
 *  rodou?", e com texto livre a resposta depende de `Ultraformer`,
 *  `ultraformer`, `Ultraformer MPT` e `ultra former` serem a mesma coisa — que
 *  não são, para o `GROUP BY`. O relatório sai com quatro linhas e nenhuma
 *  certa, e ninguém percebe que está errado, porque cada linha existe mesmo.
 *
 *  É o mesmo defeito da M5.10 em outro campo: comparar texto cru onde deveria
 *  haver identidade.
 *
 *  ============================================= O QUE ESTA MIGRATION NÃO FAZ
 *
 *  **Não converte o que já está escrito nas sessões.** `equipments_used` segue
 *  sendo texto e segue aparecendo na tela; o seletor grava por cima quando
 *  alguém editar a sessão. Adivinhar que `ultra former` é o `Ultraformer MPT`
 *  cadastrado seria reescrever prontuário por palpite — e prontuário reescrito
 *  por palpite é pior do que prontuário desorganizado.
 *
 *  **Não cadastra equipamento nenhum.** Nem a Musa. Semear "Ultraformer MPT"
 *  nas 50 clínicas poria na tela de cada uma um equipamento que ela talvez não
 *  tenha — e a lista vazia, com o aviso de onde cadastrar, é honesta.
 */

module.exports = async function up(conn) {
  const [existe] = await conn.query(
    "SELECT TABLE_NAME AS t FROM information_schema.TABLES" +
    " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'equipments'");

  const criadas = [];

  if (existe.length === 0) {
    /* A chave é COMPOSTA desde o nascimento — `(clinica_id, id)`, como as oito
       tabelas que a 027 converteu. Tabela nova com chave só de `id` seria uma
       nona conversão marcada para depois, e "depois" foi o que custou a M1.6:
       id único no banco inteiro deixa uma clínica alcançar a linha da outra só
       por ter o número na mão. */
    await conn.query(`
      CREATE TABLE equipments (
        clinica_id VARCHAR(50) NOT NULL,
        id VARCHAR(50) NOT NULL,
        name VARCHAR(160) NOT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (clinica_id, id),
        UNIQUE KEY uq_equipamento_nome (clinica_id, name),
        INDEX idx_clinica (clinica_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    criadas.push('tabela equipments');
  }

  await conn.query(
    'INSERT INTO system_logs (id, action_type, description, author) VALUES (?, ?, ?, ?)',
    ['lg_039_' + Date.now().toString(36), 'MIGRATION',
     'Migration 039: cadastro de equipamentos por clinica, chave composta ' +
     '(clinica_id, id) desde o inicio. Nenhum equipamento foi semeado e nenhum ' +
     'texto livre ja gravado nas sessoes foi convertido.', 'Sistema']);

  return {
    criadas: criadas,
    apagou: 'nada -- so cria a tabela, vazia',
    naoTocou: 'treatment_sessions.equipments_used segue como texto'
  };
};

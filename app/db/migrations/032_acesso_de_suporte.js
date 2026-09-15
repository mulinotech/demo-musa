'use strict';
/** Acesso de suporte: a clínica CONCEDE, com prazo, e revoga quando quiser (M3.1b).
 *
 *  O operador da plataforma não tem acesso permanente a dado de clínica nenhuma
 *  (M3.1). Esta tabela é a única coisa capaz de alargar aquela lista — por tempo
 *  determinado, a pedido de quem é dono do dado.
 *
 *  `clinica_id` é NOT NULL e tem chave estrangeira: uma concessão sem clínica não
 *  quer dizer nada, e concessão apontando para clínica apagada seria acesso a um
 *  fantasma.
 */
module.exports = async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS acessos_de_suporte (
      id VARCHAR(50) PRIMARY KEY,
      clinica_id VARCHAR(50) NOT NULL,
      concedido_por VARCHAR(190) NOT NULL COMMENT 'quem, na clinica, autorizou',
      motivo VARCHAR(255) NULL,
      concedido_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expira_em DATETIME NOT NULL,
      revogado_em DATETIME NULL,
      CONSTRAINT fk_suporte_clinica FOREIGN KEY (clinica_id) REFERENCES clinicas(id),
      INDEX idx_suporte_valido (clinica_id, revogado_em, expira_em)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [n] = await conn.query('SELECT COUNT(*) AS n FROM acessos_de_suporte');

  await conn.query(
    'INSERT INTO system_logs (id, action_type, description, author) VALUES (?, ?, ?, ?)',
    ['lg_032_' + Date.now().toString(36), 'MIGRATION',
     'Migration 032: tabela `acessos_de_suporte`. A partir daqui, a Mulino so entra numa clinica ' +
     'se a clinica conceder, com prazo, e o acesso e de LEITURA e sem prontuario. Concessoes ' +
     'existentes: ' + n[0].n + '.',
     'Sistema']);

  return {
    concessoesExistentes: Number(n[0].n),
    observacao: 'Nenhum acesso e concedido por esta migration. Quem concede e o administrador da ' +
                'clinica, na tela de Usuarios, e o prazo e dele.'
  };
};

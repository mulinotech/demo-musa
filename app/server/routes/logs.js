'use strict';
/** A tela "Logs do Sistema" — a trilha de auditoria que cada clínica vê.
 *
 *  ================================================= O QUE A M1.6 MUDOU AQUI
 *
 *  A consulta era `SELECT ... FROM system_logs ORDER BY created_at DESC LIMIT
 *  500`, sem filtro nenhum. Com uma clínica, era a trilha dela. Com 50, seria
 *  a trilha de todas na tela de qualquer uma — e o pior é o conteúdo: a
 *  descrição do log carrega o nome, o telefone e o tratamento do lead que a
 *  vizinha excluiu, o valor do lançamento que ela baixou, o nome da paciente
 *  cujo prontuário ela exportou. É o vazamento mais completo do sistema,
 *  justamente porque a trilha existe para dizer o que aconteceu com detalhe.
 *
 *  ================================================ POR QUE OS "DA INSTALACAO"
 *                                                       NAO APARECEM AQUI
 *
 *  Há registros com `clinica_id` vazio, e são de dois tipos:
 *
 *  - os ANTIGOS, gravados antes desta tarefa, quando a coluna não era
 *    preenchida. Ficam sem dono de propósito: adivinhar dono de log retroativo
 *    é inventar uma afirmação sobre quem fez o quê, e log é exatamente o lugar
 *    onde isso não se faz;
 *  - os DELIBERADOS, de `logs.daInstalacao` — cron, migration, falha de
 *    inicialização —, que são da instalação inteira e não de uma clínica.
 *
 *  Os dois somem desta tela, e é o certo: mostrá-los a uma clínica seria
 *  mostrar atividade que pode não ser dela. Quem precisa vê-los é a Mulino, e
 *  a visão da plataforma é a **M3**. Enquanto ela não existe, esses registros
 *  ficam no banco, íntegros, sem tela — melhor do que aparecerem na tela
 *  errada.
 *
 *  A trilha continua só de leitura: não há rota de editar nem de apagar log, e
 *  não deve haver.
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');

router.get('/api/logs', async function (req, res) {
  const db = escopo(req);
  try {
    const [rows] = await db.q(`
      SELECT
        id,
        action_type AS actionType,
        description,
        author,
        ip_address AS ipAddress,
        created_at AS createdAt
      FROM system_logs
      WHERE clinica_id = :clinica
      ORDER BY created_at DESC
      LIMIT 500
    `);
    res.json(rows);
  } catch (error) {
    // `details: error.message` saiu daqui: a mensagem crua do MySQL descreve a
    // estrutura da tabela para quem estiver sondando, e nao ajuda quem opera.
    console.error('[logs]', error && error.message);
    res.status(500).json({ error: 'Erro ao buscar logs do sistema' });
  }
});

module.exports = router;

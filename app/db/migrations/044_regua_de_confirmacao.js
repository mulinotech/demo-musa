'use strict';
/** A régua de confirmação: três disparos, e o terceiro cancela.
 *
 *  Até aqui havia UM lembrete, 24 h antes, marcado por `reminder_sent_at`.
 *  A clínica pediu três:
 *
 *    1º  26 h antes  — "confirme, remarque ou cancele"
 *    2º  +2 h        — "ainda não recebemos resposta; há uma profissional
 *                       reservada exclusivamente para você"
 *    3º  +4 h        — "sem confirmação, o horário está cancelado"
 *
 *  ========================================== POR QUE `reminder_sent_at` FICA
 *
 *  Duas colunas novas bastariam (`reminder_stage`, `reminder_last_at`), e a
 *  tentação é reaproveitar `reminder_sent_at` como "a última". Não dá: o
 *  webhook procura o compromisso da resposta com `reminder_sent_at IS NOT NULL`
 *  ("já recebeu lembrete, então esta mensagem é resposta"), e há um índice em
 *  `(starts_at, reminder_sent_at)`. `reminder_sent_at` continua sendo **quando
 *  saiu o primeiro**, que é o que aquelas duas coisas perguntam.
 *
 *  ================================ O BACKFILL NÃO É DETALHE, É O RISCO INTEIRO
 *
 *  Em produção existem compromissos com `reminder_sent_at` preenchido. Se eles
 *  nascessem com `reminder_stage = 0`, a régua concluiria "nunca mandei nada",
 *  mandaria o primeiro de novo, e duas horas depois o segundo — e quatro horas
 *  depois **cancelaria horários de pacientes que já tinham confirmado por
 *  telefone**. Envio não tem desfazer; cancelamento automático, menos ainda.
 *
 *  Por isso o UPDATE abaixo roda ANTES de qualquer coisa ligar: quem já recebeu
 *  entra na etapa 1, com `reminder_last_at` igual ao envio que de fato houve.
 *  A partir daí a régua continua de onde parou, em vez de recomeçar.
 *
 *  E `reminder_reply_at` nasce preenchida para quem **já respondeu**: todo
 *  compromisso `CONFIRMADO` que recebeu lembrete respondeu, por definição. Sem
 *  isso, a primeira passada cobraria quem já tinha confirmado.
 */

async function temColuna(conn, tabela, coluna) {
  const [r] = await conn.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()' +
    ' AND TABLE_NAME = ? AND COLUMN_NAME = ?', [tabela, coluna]);
  return r.length > 0;
}

module.exports = async function up(conn) {
  const relatorio = {};

  if (!await temColuna(conn, 'appointments', 'reminder_stage')) {
    await conn.query(
      'ALTER TABLE appointments' +
      ' ADD COLUMN reminder_stage TINYINT NOT NULL DEFAULT 0,' +
      ' ADD COLUMN reminder_last_at DATETIME DEFAULT NULL,' +
      ' ADD COLUMN reminder_reply_at DATETIME DEFAULT NULL');
    relatorio.colunas = ['reminder_stage', 'reminder_last_at', 'reminder_reply_at'];
  } else {
    relatorio.colunas = 'ja existiam';
  }

  /* QUEM JÁ RECEBEU ESTÁ NA ETAPA 1. A condição `reminder_stage = 0` deixa a
   * migration repetível sem desfazer uma régua em andamento.
   *
   * ============================ E O RELÓGIO DA ESCALADA COMEÇA AGORA, NÃO ANTES
   *
   * `reminder_last_at = NOW()`, e não `= reminder_sent_at`. A diferença
   * aparece na primeira passada depois do deploy, e é grande:
   *
   * Com `reminder_sent_at`, a espera de 2 h já teria vencido para todo
   * compromisso lembrado há mais de duas horas. A primeira passada dispararia a
   * cobrança para TODOS eles de uma vez, e quatro horas depois cancelaria o
   * lote inteiro — dezenas de pacientes desmarcadas na mesma hora, com a única
   * mensagem que elas chegaram a ver sendo a antiga, que não avisava que não
   * responder cancela.
   *
   * Com `NOW()`, a escalada começa a contar do deploy: cada uma recebe a
   * cobrança duas horas depois, dentro da janela civilizada, e a clínica tem
   * esse intervalo para ver a régua funcionando antes de ela desmarcar
   * qualquer coisa. Ninguém é cobrado por um silêncio anterior à existência da
   * régua. */
  const [r1] = await conn.query(
    'UPDATE appointments SET reminder_stage = 1, reminder_last_at = NOW()' +
    ' WHERE reminder_sent_at IS NOT NULL AND reminder_stage = 0');
  relatorio.jaLembrados = r1.affectedRows;
  relatorio.relogioDaEscalada = 'conta a partir desta migration, nao do envio antigo';

  /* QUEM CONFIRMOU JÁ RESPONDEU. `confirmed_at` é preenchido tanto pela
   * resposta no WhatsApp quanto pela recepção clicando na agenda — e os dois
   * casos são "esta paciente não precisa ser cobrada". */
  const [r2] = await conn.query(
    "UPDATE appointments SET reminder_reply_at = COALESCE(confirmed_at, reminder_sent_at)" +
    " WHERE reminder_reply_at IS NULL AND reminder_sent_at IS NOT NULL" +
    "   AND status = 'CONFIRMADO'");
  relatorio.jaConfirmados = r2.affectedRows;

  /* A ANTECEDÊNCIA GRAVADA POR CLÍNICA TAMBÉM MUDA.
   *
   * `lembrete_antecedencia_h` nasceu em 24 e algumas clínicas têm a linha
   * gravada com esse valor. Deixar como está faria a régua nova rodar com a
   * antecedência velha nessas clínicas — o pedido era 26 h, e ninguém
   * descobriria a diferença olhando a tela, que mostraria "24" como se fosse
   * escolha. Só o valor PADRÃO é atualizado: quem escolheu 48 h continua com 48. */
  const [r3] = await conn.query(
    "UPDATE clinica_settings SET valor = '26'" +
    " WHERE chave = 'lembrete_antecedencia_h' AND valor = '24'");
  relatorio.antecedenciaAtualizada = r3.affectedRows;

  return relatorio;
};

'use strict';
/** A ficha da paciente deixa de sumir sozinha (M6.5, 24/09).
 *
 *  ============================================== O QUE ESTA MIGRATION CONSERTA
 *
 *  A 027 (M1.8) pôs a terceira barreira no banco e deixou escrito, no próprio
 *  relatório dela, que 22 relações seguiam sem chave estrangeira — e por quê:
 *
 *      "criar chave estrangeira nelas muda o que acontece num DELETE, e isso é
 *       uma decisão por relação, não um lote."
 *
 *  Esta migration toma UMA dessas decisões — a que tem consequência jurídica —
 *  e deixa as outras nomeadas no relatório, com a regra proposta para cada uma.
 *
 *  ======================================== O BURACO, MEDIDO E NOMEADO
 *
 *  Apagar uma paciente fazia duas coisas erradas ao mesmo tempo:
 *
 *    CASCATEAVA (sumia junto, em silêncio)
 *      client_documents      ← receitas, atestados e TERMOS ASSINADOS
 *      treatment_plans → treatment_sessions
 *      treatments
 *      loyalty_transactions
 *
 *    DEIXAVA ÓRFÃO (apontando para quem não existe mais)
 *      appointments, interactions, cash_entries
 *
 *  **Destruía o que tem prazo legal de guarda e preservava o que um pedido de
 *  exclusão quer alcançar.** `docs/LGPD.md` já dizia, antes desta tarefa, que a
 *  exclusão em registro de saúde "não deve ser automática" — e o banco estava
 *  configurado para fazê-la automaticamente.
 *
 *  ================================================ O QUE MUDA, EM UMA LINHA
 *
 *  As quatro chaves que cascateavam a partir de `clients` passam a **RESTRICT**:
 *  o banco RECUSA apagar uma paciente que tem prontuário. A recusa com frase
 *  legível vive em `routes/clients.js`; esta é a barreira embaixo dela, para o
 *  caso de alguém apagar por fora da rota.
 *
 *  `appointments.client_id` ganha chave composta RESTRICT — ela não tinha
 *  nenhuma, e é a agenda da paciente.
 *
 *  ===================================== O QUE ESTA MIGRATION SE RECUSA A FAZER
 *
 *  **Não apaga nada, e não cria chave onde há linha órfã.** Se uma relação já
 *  tem linha cruzada hoje, criar a chave falharia no meio do ALTER — ou, pior,
 *  passaria por acidente se o banco estivesse com a conferência afrouxada. Ela
 *  MEDE antes, pula a relação suja e a devolve no relatório com a contagem.
 *  Linha órfã é dado para alguém olhar, não obstáculo para contornar.
 *
 *  **Não toca em `interactions.client_id`.** A 027 a listou como ponteiro para
 *  `clients` e ela não é: o Atendimento trata lead e paciente como "contato" e
 *  grava os dois ids na mesma coluna. Uma chave ali recusaria toda conversa de
 *  lead. Ela é POLIMÓRFICA, como `cash_entries.source_id`, e o relatório passa
 *  a dizer isso — a classificação errada é que era o defeito.
 */

const RESTRICT = 'RESTRICT';

/** As chaves que hoje CASCATEIAM a partir de `clients` e passam a recusar.
 *  Cada uma com o motivo pelo qual o dado dela não pode sumir por um clique. */
const RECLASSIFICAR = [
  { tab: 'client_documents', col: 'client_id', nome: 'fk_client_documents_client_id_clinica',
    porque: 'receita, atestado e termo ASSINADO são prova de ato profissional' },
  { tab: 'treatment_plans', col: 'client_id', nome: 'fk_treatment_plans_client_id_clinica',
    porque: 'o plano é o prontuário do tratamento, e leva as sessões junto' },
  { tab: 'treatments', col: 'client_id', nome: 'fk_treatments_client_id_clinica',
    porque: 'procedimento aplicado é registro clínico com prazo de guarda' },
  { tab: 'loyalty_transactions', col: 'client_id', nome: 'fk_loyalty_transactions_client_id_clinica',
    porque: 'ponto creditado e resgatado é histórico de relação comercial' }
];

/** A chave que faltava por inteiro. */
const CRIAR = [
  { tab: 'appointments', col: 'client_id', pai: 'clients', regra: RESTRICT,
    nome: 'fk_appointments_client_id_clinica',
    porque: 'a agenda da paciente é histórico de atendimento' }
];

/** As que seguem sem chave, com a regra proposta — para a próxima passada não
 *  recomeçar a análise. Escrever a regra aqui é barato; redescobri-la não. */
const AINDA_SEM_CHAVE = {
  'appointments.catalog_id -> treatment_catalog': 'SET NULL (serviço sai do catálogo; o compromisso que já aconteceu fica)',
  'appointments.professional_id -> users': 'RESTRICT (não se apaga quem atendeu)',
  'cash_entries.category_id -> finance_categories': 'SET NULL (categoria removida não pode apagar dinheiro lançado)',
  'cash_entries.client_id -> clients': 'SET NULL (a receita fica, o vínculo some; apagar mudaria mês fechado)',
  'cash_entries.professional_id -> users': 'SET NULL (idem)',
  'client_documents.appointment_id -> appointments': 'SET NULL (documento emitido sobrevive ao compromisso)',
  'client_documents.template_id -> document_templates': 'RESTRICT (o modelo é a prova de qual versão gerou o papel)',
  'document_templates.catalog_id -> treatment_catalog': 'SET NULL',
  'finance_categories.parent_id -> finance_categories': 'RESTRICT (apagar o pai deixaria a filha órfã na árvore)',
  'interactions.client_id': 'NENHUMA -- e polimorfica (id de lead OU de paciente). A 027 a classificou errado.',
  'leads.salesperson_id -> salespeople': 'SET NULL (vendedor sai da equipe, o lead fica)',
  'loyalty_rewards.catalog_id -> treatment_catalog': 'SET NULL',
  'loyalty_rewards.product_id -> products': 'SET NULL',
  'loyalty_transactions.reward_id -> loyalty_rewards': 'RESTRICT (o resgate prova que aquele prêmio foi dado)',
  'pricing_simulations.catalog_id -> treatment_catalog': 'SET NULL (a simulação guardada é decisão histórica)',
  'professional_availability.professional_id -> users': 'CASCADE (grade de horário não existe sem a pessoa)',
  'recurring_expenses.category_id -> finance_categories': 'SET NULL',
  'service_supplies.catalog_id -> treatment_catalog': 'CASCADE (ficha técnica não existe sem o serviço)',
  'stock_movements.batch_id -> stock_batches': 'RESTRICT (o movimento é o histórico do lote)',
  'treatment_sessions.appointment_id -> appointments': 'SET NULL (a sessão continua na ficha)',
  'users.salesperson_id -> salespeople': 'SET NULL',
  'OBSERVACAO': 'As de SET NULL pedem chave de UMA coluna: numa chave composta, ' +
    'o SET NULL zeraria tambem `clinica_id`, que e NOT NULL -- e o proprio banco ' +
    'recusa cria-la. Sao outra tarefa, e a decisao esta escrita aqui para nao ' +
    'precisar ser redescoberta.'
};

async function chaveExiste(conn, tabela, nome) {
  const [r] = await conn.query(
    'SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS' +
    " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?" +
    " AND CONSTRAINT_TYPE = 'FOREIGN KEY'", [tabela, nome]);
  return r.length > 0;
}

async function regraDeApagar(conn, nome) {
  const [r] = await conn.query(
    'SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS' +
    ' WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = ?', [nome]);
  return r.length ? r[0].DELETE_RULE : null;
}

/** Linhas que apontam para um pai que não existe NESTA clínica. */
async function orfas(conn, tab, col, pai) {
  const [r] = await conn.query(
    'SELECT COUNT(*) AS n FROM `' + tab + '` x' +
    ' LEFT JOIN `' + pai + '` p ON p.id = x.`' + col + '` AND p.clinica_id = x.clinica_id' +
    ' WHERE x.`' + col + '` IS NOT NULL AND p.id IS NULL');
  return Number(r[0].n);
}

async function tabelaExiste(conn, t) {
  const [r] = await conn.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES' +
    ' WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [t]);
  return r.length > 0;
}

module.exports = async function up(conn) {
  const trocadas = [], criadas = [], puladas = [];

  /* 1. AS QUATRO QUE CASCATEAVAM PASSAM A RECUSAR.
   *
   *    Trocar a regra de uma chave é APAGAR e RECRIAR: o MySQL não tem ALTER
   *    para isso. A recriação usa as mesmas colunas da chave antiga, lidas do
   *    banco -- escrevê-las aqui à mão seria uma segunda versão da verdade. */
  for (const alvo of RECLASSIFICAR) {
    if (!(await tabelaExiste(conn, alvo.tab))) { puladas.push(alvo.tab + ': tabela nao existe'); continue; }
    if (!(await chaveExiste(conn, alvo.tab, alvo.nome))) {
      puladas.push(alvo.tab + '.' + alvo.col + ': a chave ' + alvo.nome + ' nao existe neste banco');
      continue;
    }
    const regra = await regraDeApagar(conn, alvo.nome);
    if (regra === RESTRICT) { continue; }        // já está como deve estar

    const [cols] = await conn.query(
      'SELECT COLUMN_NAME AS c, REFERENCED_COLUMN_NAME AS r, ORDINAL_POSITION AS o' +
      ' FROM information_schema.KEY_COLUMN_USAGE' +
      ' WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?' +
      ' ORDER BY ORDINAL_POSITION', [alvo.tab, alvo.nome]);
    if (!cols.length) { puladas.push(alvo.nome + ': nao deu para ler as colunas da chave'); continue; }

    const filhas = cols.map((x) => '`' + x.c + '`').join(', ');
    const pais = cols.map((x) => '`' + x.r + '`').join(', ');
    const [ref] = await conn.query(
      'SELECT REFERENCED_TABLE_NAME AS t FROM information_schema.KEY_COLUMN_USAGE' +
      ' WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? LIMIT 1',
      [alvo.tab, alvo.nome]);

    await conn.query('ALTER TABLE `' + alvo.tab + '` DROP FOREIGN KEY `' + alvo.nome + '`');
    await conn.query(
      'ALTER TABLE `' + alvo.tab + '` ADD CONSTRAINT `' + alvo.nome + '`' +
      ' FOREIGN KEY (' + filhas + ') REFERENCES `' + ref[0].t + '` (' + pais + ')' +
      ' ON DELETE RESTRICT ON UPDATE RESTRICT');
    trocadas.push(alvo.tab + '.' + alvo.col + ': CASCADE -> RESTRICT (' + alvo.porque + ')');
  }

  /* 2. A CHAVE QUE FALTAVA -- e só onde não há linha órfã. */
  for (const nova of CRIAR) {
    if (!(await tabelaExiste(conn, nova.tab))) { puladas.push(nova.tab + ': tabela nao existe'); continue; }
    if (await chaveExiste(conn, nova.tab, nova.nome)) continue;

    const cruzadas = await orfas(conn, nova.tab, nova.col, nova.pai);
    if (cruzadas > 0) {
      /* NÃO cria, e NÃO apaga a linha órfã. Ela é dado para alguém olhar: um
         compromisso apontando para paciente inexistente é atendimento que
         sumiu da ficha de alguém, e a resposta certa é investigar. */
      puladas.push(nova.tab + '.' + nova.col + ': ' + cruzadas + ' linha(s) ja apontam para ' +
                   nova.pai + ' inexistente. A chave NAO foi criada e NADA foi apagado.');
      continue;
    }
    await conn.query(
      'ALTER TABLE `' + nova.tab + '` ADD CONSTRAINT `' + nova.nome + '`' +
      ' FOREIGN KEY (`clinica_id`, `' + nova.col + '`) REFERENCES `' + nova.pai + '` (`clinica_id`, `id`)' +
      ' ON DELETE ' + nova.regra + ' ON UPDATE RESTRICT');
    criadas.push(nova.tab + '.' + nova.col + ' -> ' + nova.pai + ' ON DELETE ' + nova.regra +
                 ' (' + nova.porque + ')');
  }

  console.log('   = ' + trocadas.length + ' chave(s) deixaram de CASCATEAR a partir de clients');
  console.log('   = ' + criadas.length + ' chave(s) nova(s)');
  console.log('   i apagar paciente com prontuario passa a ser RECUSADO -- pela rota, com ' +
              'frase legivel, e pelo banco, por baixo dela.');
  if (puladas.length) {
    console.log('   ! ' + puladas.length + ' pulada(s): ' + puladas.join('; '));
  }

  await conn.query(
    'INSERT INTO system_logs (id, action_type, description, author) VALUES (?, ?, ?, ?)',
    ['lg_042_' + Date.now().toString(36), 'MIGRATION',
     'Migration 042 (M6.5): apagar paciente com prontuario passa a ser recusado. ' +
     trocadas.length + ' chave(s) foram de CASCADE para RESTRICT a partir de clients ' +
     '(documentos, planos, procedimentos e pontos deixam de sumir junto) e ' +
     criadas.length + ' chave(s) nova(s) entraram. Nenhuma linha foi apagada e ' +
     'nenhuma chave foi criada onde havia linha orfa.', 'Sistema']);

  return {
    trocadas: trocadas,
    criadas: criadas,
    puladas: puladas,
    aindaSemChave: AINDA_SEM_CHAVE,
    apagou: 'nada -- esta migration nao apaga linha nenhuma',
    observacao:
      'O que mudou de comportamento: uma ficha com documento, plano, procedimento ' +
      'ou ponto NAO e mais apagada. A recusa tem frase propria em routes/clients.js ' +
      'e diz o que existe. Ficha vazia -- a duplicata criada por engano -- continua ' +
      'sendo apagada num clique.'
  };
};

module.exports.RECLASSIFICAR = RECLASSIFICAR;
module.exports.CRIAR = CRIAR;
module.exports.AINDA_SEM_CHAVE = AINDA_SEM_CHAVE;

'use strict';
/** Devolve à clínica 1 os registros de auditoria que ficaram sem clínica entre
 *  04/09 e 09/09 — e lê de volta o relatório da 022, que ninguém pôde ver.
 *
 *  ================================================ A JANELA QUE FICOU CEGA
 *
 *  Três datas explicam tudo:
 *
 *  - **04/09** — a migration 018 acrescentou `clinica_id`. Nas duas tabelas
 *    null-áveis (`system_settings` e `system_logs`) ela **preencheu as linhas
 *    existentes** com a clínica 1, com o raciocínio escrito no próprio código:
 *    "o que existe hoje é da clínica 1; o vazio fica reservado para o que
 *    nascer depois pertencendo à plataforma". Então tudo o que era anterior a
 *    04/09 está carimbado e visível.
 *  - **04/09 a 09/09** — `logSystemEvent` continuou gravando **sem** a coluna.
 *    Enquanto nada filtrava, invisível e inofensivo.
 *  - **09/09** — a M1.6a fez a tela de Logos filtrar por clínica. Nesse
 *    instante, tudo o que foi gravado nessa janela **desapareceu da tela**.
 *
 *  É exatamente o mesmo defeito que a 021 consertou nas tabelas de dado, e que
 *  eu não repeti aqui porque a 021 excluiu `system_logs` de propósito — ali
 *  vazio significa "da instalação". O que eu não vi é que, **naquele momento,
 *  vazio ainda não significava nada**: `logs.daInstalacao` só passou a existir
 *  na M1.6a, horas depois. Até ali, toda linha vazia era da clínica 1.
 *
 *  ==================================== POR QUE `MIGRATION` FICA DE FORA
 *
 *  Os registros de `action_type = 'MIGRATION'` são os únicos vazios que são
 *  legitimamente da instalação: DDL não pertence a clínica nenhuma. Eles ficam
 *  vazios, e ganham tela na M3.3.
 *
 *  Isso inclui o relatório da 022 — que é justamente o que ninguém conseguiu
 *  ler. Esta migration **devolve o texto dele na resposta**, para a Silvia
 *  finalmente ver quantas senhas em texto puro existiam no banco.
 *
 *  ============================================================= FALHA FECHADO
 *
 *  Aborta se houver mais de uma clínica, como a 021: ali "de quem é esta linha?"
 *  deixa de ter resposta, e chutar arquiva a auditoria de uma clínica debaixo de
 *  outra. Numa tabela de auditoria isso é pior do que em qualquer outra.
 */

module.exports = async function up(conn) {
  const [clinicas] = await conn.query('SELECT id FROM clinicas ORDER BY id');
  if (clinicas.length !== 1) {
    throw new Error(
      '023 PAROU: ' + clinicas.length + ' clinica(s) cadastrada(s). Esta migration ' +
      'atribui os registros orfaos a UNICA clinica que existe -- com duas ou mais, ' +
      '"de quem e este registro?" nao tem resposta, e chutar arquiva a auditoria de ' +
      'uma clinica debaixo de outra. Se voce chegou aqui com mais de uma clinica, a ' +
      'janela cega ja passou: deixe os registros como estao e de tela a eles na M3.3.'
    );
  }
  const clinica = clinicas[0].id;

  // O relatorio da 022, que nasceu vazio e ninguem conseguiu ler.
  const [relato022] = await conn.query(
    "SELECT description, DATE_FORMAT(created_at, '%d/%m/%Y %H:%i') AS quando" +
    " FROM system_logs WHERE action_type = 'MIGRATION' AND description LIKE 'Migration 022:%'" +
    ' ORDER BY created_at DESC LIMIT 1');

  const [antes] = await conn.query(
    "SELECT COUNT(*) AS n FROM system_logs" +
    " WHERE clinica_id IS NULL AND action_type <> 'MIGRATION'");
  const orfaos = Number(antes[0].n);

  if (orfaos === 0) {
    console.log('   = nenhum registro de auditoria sem clinica (fora os de MIGRATION)');
  } else {
    console.log('   ! ' + orfaos + ' registro(s) de auditoria sem clinica');
    const [r] = await conn.query(
      "UPDATE system_logs SET clinica_id = ?" +
      " WHERE clinica_id IS NULL AND action_type <> 'MIGRATION'", [clinica]);

    // A CONFERENCIA VEM DEPOIS, e ela e o que separa "rodou sem erro" de
    // "funcionou". Os dois numeros tem de bater e nao pode sobrar linha.
    const [depois] = await conn.query(
      "SELECT COUNT(*) AS n FROM system_logs" +
      " WHERE clinica_id IS NULL AND action_type <> 'MIGRATION'");
    if (Number(depois[0].n) !== 0) {
      throw new Error(
        '023: sobraram ' + depois[0].n + ' registro(s) sem clinica depois do UPDATE. ' +
        'Alguem gravou durante a migration. Rode de novo -- ela e idempotente.');
    }
    if (r.affectedRows !== orfaos) {
      throw new Error(
        '023: contei ' + orfaos + ' registro(s) orfao(s) e mexi em ' + r.affectedRows +
        '. Os dois numeros tem de bater; se nao batem, alguem gravou no meio.');
    }
    console.log('   = ' + orfaos + ' registro(s) agora pertencem a ' + clinica);
  }

  const [instalacao] = await conn.query(
    "SELECT COUNT(*) AS n FROM system_logs WHERE clinica_id IS NULL");
  console.log('   i ' + instalacao[0].n + ' registro(s) seguem sem clinica: sao os de ' +
              'MIGRATION, que sao da instalacao. Ganham tela na M3.3.');

  return {
    registrosDevolvidos: orfaos,
    clinica: clinica,
    seguemDaInstalacao: Number(instalacao[0].n),
    relatorioDa022: relato022[0]
      ? relato022[0].quando + ' -- ' + relato022[0].description
      : 'nao encontrado: a 022 pode nao ter rodado nesta instalacao',
    observacao: orfaos
      ? 'A janela cega ia de 04/09 (quando a coluna nasceu) a 09/09 (quando a tela ' +
        'passou a filtrar). Os registros nunca sairam do banco; agora voltam a aparecer.'
      : 'nada a devolver.'
  };
};

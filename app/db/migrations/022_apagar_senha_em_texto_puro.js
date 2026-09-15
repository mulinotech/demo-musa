'use strict';
/** Apaga as senhas em TEXTO PURO que restaram em `salespeople.password`.
 *
 *  ============================================================ O QUE ERA
 *
 *  A coluna nasceu na migration 002, quando o login era pela tabela
 *  `salespeople`. Guardava a senha como o usuário a digitou, sem hash. A
 *  migration 004 transformou essas senhas em hash bcrypt dentro de
 *  `users.password_hash` e o login passou a ser por `users` — mas **ninguém
 *  apagou o original**. Ele ficou lá, legível, por meses.
 *
 *  Duas portas ainda estavam abertas quando a M1.6a chegou nesse arquivo:
 *
 *  - `GET /api/salespeople` fazia `SELECT *`, ou seja devolvia a senha em texto
 *    ao navegador. E essa rota não tem regra de papel: qualquer sessão
 *    autenticada a alcança, **inclusive um `vendedor`** — que passava a ler a
 *    senha dos colegas e a da própria gerente;
 *  - `POST` e `PATCH` continuavam gravando senha em texto puro na coluna, a
 *    partir do corpo da requisição.
 *
 *  As duas foram fechadas na rota, e há teste fixando isso. Esta migration
 *  fecha a terceira: **o que já estava gravado.** Sem ela, a senha continua
 *  inalcançável pela API e presente em qualquer backup do banco.
 *
 *  ================================================== POR QUE NULL, E NAO HASH
 *
 *  Não faz sentido guardar hash aqui: esta coluna não autentica nada. O hash de
 *  verdade vive em `users.password_hash`, e é ele que o login confere. Manter
 *  qualquer derivado da senha nesta coluna seria guardar segredo sem uso —
 *  risco sem benefício.
 *
 *  **A coluna em si não é derrubada**, de propósito. `DROP COLUMN` é
 *  irreversível e esta migration roda em produção sem ensaio de banco
 *  disponível (o `.env` do servidor tem credencial velha). Esvaziar é
 *  suficiente para o risco, e reversível. Derrubar a coluna fica para quando a
 *  M1.7 tiver backup de verdade no fluxo.
 *
 *  ============================================ O RELATORIO VAI PARA O BANCO
 *
 *  Regra nova desde a 021: o que a migration fez é gravado em `system_logs`,
 *  com `clinica_id` vazio (é da instalação inteira). O console do Node não é
 *  guardado em arquivo nenhum nesta instalação — a 021 contou quantas linhas
 *  preencheu e essa contagem foi perdida.
 */

module.exports = async function up(conn) {
  const [antes] = await conn.query(
    "SELECT COUNT(*) AS n FROM salespeople WHERE password IS NOT NULL AND password <> ''");
  const quantas = Number(antes[0].n);

  if (quantas === 0) {
    console.log('   = nenhuma senha em texto puro em salespeople.password');
  } else {
    console.log('   ! ' + quantas + ' senha(s) em TEXTO PURO em salespeople.password');
    await conn.query(
      "UPDATE salespeople SET password = NULL WHERE password IS NOT NULL AND password <> ''");

    // Conferencia depois, e nao antes: se sobrar uma, a migration para. Sem
    // isto, "rodou sem erro" nao seria a mesma coisa que "a coluna esta limpa"
    // -- e e essa diferenca que este projeto ja pagou sete vezes.
    const [depois] = await conn.query(
      "SELECT COUNT(*) AS n FROM salespeople WHERE password IS NOT NULL AND password <> ''");
    if (Number(depois[0].n) !== 0) {
      throw new Error(
        '022: ainda ha ' + depois[0].n + ' senha(s) em texto puro depois do UPDATE. ' +
        'Alguem gravou durante a migration, ou ha trigger/coluna gerada. Rode de ' +
        'novo -- ela e idempotente.'
      );
    }
    console.log('   = ' + quantas + ' senha(s) apagada(s). A coluna continua existindo, vazia.');
  }

  const id = 'lg_022_' + Date.now().toString(36);
  await conn.query(
    'INSERT INTO system_logs (id, action_type, description, author, created_at, clinica_id)' +
    ' VALUES (?, ?, ?, ?, NOW(), NULL)',
    [id, 'MIGRATION',
     'Migration 022: ' + quantas + ' senha(s) em texto puro apagada(s) de ' +
     'salespeople.password (coluna legada, nao autentica desde a migration 004). ' +
     'A coluna nao foi derrubada.',
     'Sistema']
  );

  console.log('   i relatorio gravado em system_logs (clinica vazia = da instalacao)');

  // DEVOLVIDO tambem, e nao so gravado. O registro em `system_logs` nasce sem
  // clinica -- e desde a M1.6a a tela de logs filtra por clinica, entao esse
  // registro nao aparece para ninguem ate a M3.3 dar tela aos logs da
  // instalacao. Sem este retorno, o relatorio existiria e continuaria ilegivel:
  // exatamente o problema que a regra da 021 dizia ter resolvido.
  return {
    senhasApagadas: quantas,
    coluna: 'salespeople.password',
    observacao: quantas
      ? quantas + ' senha(s) em texto puro apagada(s). Se alguma delas for senha ' +
        'reutilizada em outro servico, troque naquele servico: ela esteve legivel ' +
        'em qualquer backup do banco anterior a esta migration.'
      : 'nenhuma senha em texto puro encontrada.'
  };
};

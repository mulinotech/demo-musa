'use strict';
/** Os papéis que faltavam: secretária, financeiro, contador, e a gerência em duas.
 *
 *  ===================================================== POR QUE `gerente` FICA
 *
 *  A clínica pediu para dividir `gerente` em **Gerente Comercial** e **Gerente
 *  Administrativo**. A tentação é renomear a linha antiga e acabar: um
 *  `UPDATE users SET role = 'gerente_admin' WHERE role = 'gerente'` é uma
 *  linha, roda em milissegundos e deixa o ENUM limpo.
 *
 *  Não faço isso, e o motivo é que **eu não sei qual das duas cada pessoa é**.
 *  Um gerente que hoje existe pode ser o comercial da clínica; convertê-lo em
 *  administrativo daria a ele o financeiro, a precificação e o custo — sem que
 *  ninguém tenha decidido isso e sem que nada apareça na tela. O contrário
 *  seria menos grave e igualmente errado: tiraria o acesso de alguém no meio do
 *  expediente, sem aviso.
 *
 *  Então `gerente` continua sendo um valor válido do ENUM, com o alcance que
 *  sempre teve, e a tela passa a mostrá-lo como **"Gerente (modelo antigo)"**.
 *  Quem decide para qual dos dois cada pessoa vai é a clínica, uma a uma, na
 *  tela de Usuários. Migration não adivinha organograma.
 *
 *  ================================================= O QUE ESTE ALTER NÃO FAZ
 *
 *  Ele **não** dá permissão a ninguém. Acrescentar um valor ao ENUM só faz a
 *  coluna aceitar a palavra; quem decide o que cada papel alcança é
 *  `server/middleware/autorizacao.js`, em duas tabelas que este arquivo não
 *  toca. Um papel novo que chegasse aqui sem entrar lá herdaria toda rota sem
 *  regra — é exatamente o risco que o ALCANCE_DO_PAPEL veio fechar.
 */

const NOVOS = ['gerente_comercial', 'gerente_admin', 'secretaria', 'financeiro', 'contador'];

const ENUM_NOVO =
  "ENUM('admin','gerente','gerente_comercial','gerente_admin','profissional'," +
  "'secretaria','financeiro','contador','vendedor')";

module.exports = async function up(conn) {
  const [col] = await conn.query(
    "SELECT COLUMN_TYPE AS tipo FROM information_schema.COLUMNS" +
    " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'");

  const antes = col.length ? String(col[0].tipo) : '(coluna ausente)';
  const faltando = NOVOS.filter((p) => antes.indexOf("'" + p + "'") === -1);

  if (!col.length) return { aviso: 'tabela users sem coluna role; nada a fazer' };
  if (!faltando.length) return { tipoAntes: antes, jaTinha: true };

  await conn.query(
    'ALTER TABLE users MODIFY role ' + ENUM_NOVO + " NOT NULL DEFAULT 'vendedor'");

  /* A CONTAGEM ENTRA NO RELATÓRIO, e não no console: este servidor não guarda
   * `console.log` em arquivo nenhum (ver db/run-migrations.js). Sem ela, "o
   * ALTER rodou" é tudo o que se sabe, e ninguém consegue conferir depois que
   * nenhuma linha perdeu o papel na conversão do ENUM. */
  const [contagem] = await conn.query(
    'SELECT role, COUNT(*) AS n FROM users GROUP BY role ORDER BY role');

  return {
    tipoAntes: antes,
    acrescentados: faltando,
    porPapel: contagem.map((r) => r.role + ': ' + r.n),
    naoConvertido: 'nenhuma linha mudou de papel; quem era gerente continua gerente'
  };
};

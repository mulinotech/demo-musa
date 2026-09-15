'use strict';
/** Preenche `clinica_id` nas linhas que nasceram vazias. É a primeira metade da
 *  M1.7 — o "MIGRAR" do expandir-migrar-apertar. **Não** aperta nada.
 *
 *  ======================================================= POR QUE ELA EXISTE
 *
 *  A migration 020 (04/09) devolveu `clinica_id` para "aceita vazio", depois do
 *  incidente em que a coluna obrigatória parou todas as gravações. Desde então,
 *  **toda linha gravada por código ainda não convertido nasce com a clínica
 *  vazia** — sem erro, sem aviso.
 *
 *  Enquanto nada filtrava, isso era invisível e inofensivo. A partir da M1.1 as
 *  rotas passaram a filtrar, e aí a linha vazia deixa de aparecer para quem a
 *  criou: ela não é da clínica 1 nem de clínica nenhuma. Uma paciente
 *  cadastrada em 05/09, uma despesa lançada em 06/09, a receita de um
 *  atendimento concluído em 07/09 — tudo isso **desaparece da tela** no dia em
 *  que o módulo é convertido.
 *
 *  Não é perda de dado: a linha está no banco, íntegra. É pior de diagnosticar
 *  do que perda, porque não há erro nenhum — só um número menor e uma lista mais
 *  curta, e ninguém decora número que muda todo dia.
 *
 *  ==================================================== POR QUE ELA É SEGURA
 *
 *  Enquanto existe **uma** clínica, "de quem é esta linha?" tem resposta
 *  inequívoca. A migration **para** se achar mais de uma clínica cadastrada:
 *  ali `cl_1` deixaria de ser um fato e passaria a ser um chute, e um chute
 *  arquiva o dado de uma clínica debaixo de outra.
 *
 *  Ela também não toca `system_settings` nem `system_logs`. Nessas duas o vazio
 *  **significa** "é da instalação, não de clínica nenhuma" — preencher ali faria
 *  o token do cron aparecer na configuração de alguém.
 *
 *  ================================================= O QUE ELA NÃO FAZ
 *
 *  Não torna a coluna obrigatória. Esse é o "APERTAR", e ele só pode acontecer
 *  quando a catraca (`server/db/nao-convertidos.js`) estiver vazia — enquanto
 *  houver módulo gravando sem carimbar a clínica, a coluna obrigatória volta a
 *  quebrar a gravação, que foi exatamente o incidente de 04/09.
 */

const { LISTAS } = require('./018_clinicas.js');

/** As 26 tabelas em que vazio é defeito. Vem da 018 de propósito: duas listas
 *  da mesma coisa divergem na terceira semana. */
const ALVOS = LISTAS.OBRIGATORIA;

async function contarVazias(conn, tabela) {
  const [r] = await conn.query(
    'SELECT COUNT(*) AS n FROM `' + tabela + '` WHERE clinica_id IS NULL');
  return Number(r[0].n);
}

module.exports = async function (conn) {
  console.log('   i preencher clinica_id vazio -- o MIGRAR da M1.7');

  /* ------------------------------------------------- uma clinica, ou nada */

  const [clinicas] = await conn.query('SELECT id FROM clinicas ORDER BY id');
  if (clinicas.length === 0) {
    throw new Error(
      '021: nao ha clinica nenhuma cadastrada. A migration 018 devia ter criado ' +
      '`cl_1`. Rode as migrations em ordem.'
    );
  }
  if (clinicas.length > 1) {
    throw new Error(
      '021: ha ' + clinicas.length + ' clinicas cadastradas (' +
      clinicas.map((c) => c.id).join(', ') + ').\n' +
      'Com mais de uma clinica, "de quem e esta linha vazia?" nao tem resposta ' +
      'inequivoca -- e preencher no chute arquiva o dado de uma clinica debaixo ' +
      'de outra, em silencio.\n' +
      'Se ainda ha linha vazia neste estado, ela precisa ser resolvida a mao, ' +
      'olhando a origem de cada uma.'
    );
  }
  const clinica = clinicas[0].id;
  console.log('   = clinica unica: ' + clinica);

  /* ---------------------------------------------- antes: quantas e onde */

  const antes = {};
  let totalAntes = 0;
  for (const tabela of ALVOS) {
    const [existe] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [tabela]);
    if (!Number(existe[0].n)) { console.log('   ! ' + tabela + ' nao existe; pulando'); continue; }
    const n = await contarVazias(conn, tabela);
    antes[tabela] = n;
    totalAntes += n;
    if (n) console.log('   ~ ' + tabela + ': ' + n + ' linha(s) sem clinica');
  }

  if (!totalAntes) {
    console.log('   = nenhuma linha vazia. Nada a preencher.');
    return;
  }
  console.log('   ~ TOTAL a preencher: ' + totalAntes + ' linha(s)');

  /* ------------------------------------------------------------ preencher */

  let preenchidas = 0;
  for (const tabela of Object.keys(antes)) {
    if (!antes[tabela]) continue;
    const [r] = await conn.query(
      'UPDATE `' + tabela + '` SET clinica_id = ? WHERE clinica_id IS NULL', [clinica]);
    preenchidas += Number(r.affectedRows);
    console.log('   + ' + tabela + ': ' + r.affectedRows + ' preenchida(s)');
  }

  /* --------------------------------------------------------- e conferir */

  // A conferencia e o critério de aprovacao, e ela roda aqui dentro: se sobrou
  // linha vazia, a migration ABORTA em vez de terminar dizendo que deu tudo
  // certo. Contagem que ninguem compara nao e conferencia.
  let sobraram = 0;
  for (const tabela of Object.keys(antes)) {
    const n = await contarVazias(conn, tabela);
    if (n) { sobraram += n; console.log('   ! ' + tabela + ': AINDA ' + n + ' vazia(s)'); }
  }
  if (sobraram) {
    throw new Error(
      '021: sobraram ' + sobraram + ' linha(s) com clinica vazia depois do ' +
      'preenchimento. Alguem gravou durante a migration, ou ha coluna gerada. ' +
      'Rode de novo -- ela e idempotente.'
    );
  }

  if (preenchidas !== totalAntes) {
    throw new Error(
      '021: contei ' + totalAntes + ' linha(s) vazia(s) e preenchi ' + preenchidas +
      '. Os dois numeros tem de bater; se nao batem, alguem gravou no meio.'
    );
  }

  console.log('   = ' + preenchidas + ' linha(s) agora pertencem a ' + clinica);
  console.log('   i system_settings e system_logs NAO foram tocadas, de proposito:');
  console.log('     ali vazio significa "e da instalacao", nao "esqueceram".');
  console.log('   i APERTAR (coluna obrigatoria) continua sendo a M1.7, e so');
  console.log('     depois de a catraca esvaziar.');
};

module.exports.ALVOS = ALVOS;

'use strict';
/** O logo no timbre (M6.2, 24/09).
 *
 *  ===================================================== POR QUE ISTO EXISTE
 *
 *  Item do bloco de Cadastros do PDF de 19/09: *"logo no timbre"*. O cabeçalho
 *  da M5.6 identifica **a pessoa** que assina e o rodapé identifica o endereço.
 *  A marca da clínica não aparece em lugar nenhum — e é ela que o balcão da
 *  farmácia e o RH reconhecem antes de ler qualquer linha.
 *
 *  ============================== POR QUE A IMAGEM FICA NO BANCO, E NÃO EM DISCO
 *
 *  Arquivo em disco exigiria uma pasta gravável, uma rota que serve arquivo e
 *  uma resposta para "de quem é este arquivo?" — porque `/uploads/logo-3.png`
 *  não tem `clinica_id`, e qualquer pessoa com o endereço leria o logo de outra
 *  clínica. Mais grave: nesta hospedagem o deploy troca a pasta do código, e um
 *  arquivo gravado ali some no deploy seguinte sem que ninguém perceba, até
 *  alguém imprimir uma receita sem logo.
 *
 *  A coluna resolve os três de uma vez: vive dentro da linha da clínica, é
 *  alcançada pela mesma porta estreita do resto do timbre (`minhaClinica`), e
 *  atravessa deploy como qualquer outro dado.
 *
 *  O preço é tamanho, e por isso ele é limitado na entrada — `services/
 *  timbre-logo.js` recusa acima de 250 KB, e a tela reduz a imagem antes de
 *  enviar. MEDIUMTEXT (16 MB) é folga deliberada: o limite que vale é o da
 *  regra, que tem teste, e não o do tipo da coluna, que só produziria um erro
 *  de SQL ilegível.
 *
 *  ======================================== E O LOGO TAMBÉM É CARIMBADO
 *
 *  `client_documents.timbre_logo` existe pela mesma razão das outras cinco
 *  `timbre_*`: a clínica troca de marca, e o atestado do ano passado tem de
 *  continuar saindo com a marca com que foi emitido. Ler o logo por junção com
 *  `clinicas` reescreveria o passado no dia da troca.
 */

async function colunas(conn, tabela) {
  const [r] = await conn.query(
    'SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS' +
    ' WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [tabela]);
  return r.map((x) => x.c);
}

async function acrescentar(conn, tabela, lista) {
  const tem = await colunas(conn, tabela);
  const feitas = [];
  for (const [nome, tipo] of lista) {
    if (tem.indexOf(nome) === -1) {
      await conn.query('ALTER TABLE `' + tabela + '` ADD COLUMN `' + nome + '` ' + tipo);
      feitas.push(tabela + '.' + nome);
    }
  }
  return feitas;
}

module.exports = async function up(conn) {
  const criadas = [];

  criadas.push(...await acrescentar(conn, 'clinicas', [
    ['logo', "MEDIUMTEXT NULL COMMENT 'data URL da imagem; o limite real esta em services/timbre-logo.js'"]
  ]));

  criadas.push(...await acrescentar(conn, 'client_documents', [
    ['timbre_logo', 'MEDIUMTEXT NULL']
  ]));

  await conn.query(
    'INSERT INTO system_logs (id, action_type, description, author) VALUES (?, ?, ?, ?)',
    ['lg_040_' + Date.now().toString(36), 'MIGRATION',
     'Migration 040: logo do timbre. clinicas.logo guarda a imagem da clinica e ' +
     'client_documents.timbre_logo carimba a que valia na emissao. Nenhuma clinica ' +
     'ganhou logo: a coluna nasce vazia e so a propria clinica a preenche.', 'Sistema']);

  return {
    criadas: criadas,
    apagou: 'nada',
    naoTocou: 'nenhum documento ja emitido -- timbre_logo nasce NULL e documento ' +
              'antigo continua saindo como saiu'
  };
};

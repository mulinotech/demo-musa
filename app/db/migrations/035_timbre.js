'use strict';
/** O timbre: o papel passa a se identificar sozinho (M5.6, 17/09).
 *
 *  ============================================== O QUE FALTAVA, E POR QUE DÓI
 *
 *  A receita e o atestado da M5.5 saíam corretos e **anônimos no alto**: o nome
 *  de quem emitiu aparecia só embaixo, junto da linha de assinatura, e o papel
 *  não trazia endereço nem telefone em lugar nenhum. Quem recebe um atestado —
 *  o RH, a farmácia, a escola — lê o cabeçalho antes de ler o texto, e um
 *  documento sem cabeçalho parece rascunho por mais correto que esteja.
 *
 *  ================================= DE ONDE VEM CADA PEDAÇO, E POR QUE ASSIM
 *
 *  O timbre tem dois donos diferentes, e misturá-los seria erro de modelagem:
 *
 *      da PESSOA   → nome, função ("Médico Clínico Geral"), conselho/nº/UF
 *      da CLÍNICA  → endereço, telefone, contato (site ou @)
 *
 *  Três profissionais na mesma clínica assinam com o **mesmo** endereço e com
 *  o **próprio** registro. Por isso `funcao` entra em `users` (ao lado do
 *  conselho, que já mora lá desde a 034) e endereço/telefone/contato entram em
 *  `clinicas`.
 *
 *  Nada disso é digitado a cada documento: número de conselho redigitado é
 *  número de conselho errado de vez em quando, e um dígito trocado invalida o
 *  papel no balcão da farmácia.
 *
 *  ================================== E O TIMBRE É CARIMBADO NA EMISSÃO
 *
 *  As cinco colunas `timbre_*` em `client_documents` existem pela mesma razão
 *  das `emitido_por_*` da 034: a clínica muda de endereço, e a receita do ano
 *  passado tem de continuar dizendo o endereço de onde ela foi emitida. Ler o
 *  timbre por junção com `clinicas` reescreveria o passado toda vez que alguém
 *  corrigisse um telefone.
 *
 *  ============================== OS CORPOS DOS MODELOS PERDEM O CABEÇALHO
 *
 *  O título ("Atestado") e o nome da clínica saíam **dentro** do texto, porque
 *  não havia cabeçalho. Agora há, e mantê-los no corpo imprimiria tudo duas
 *  vezes. Os dois corpos são reescritos — mas **só onde ainda estão idênticos
 *  ao original da 034**. Clínica que já editou o texto dela fica com o texto
 *  dela: a migration não tem o direito de sobrescrever conteúdo clínico escrito
 *  por outra pessoa.
 */

/* Os corpos NOVOS, sem o título e sem o nome da clínica — os dois passam a
 * viver no cabeçalho, desenhado por `paginaCompleta`. */
const CORPO_RECEITA = `
Paciente: **{{paciente}}**
Data: {{data}}

### Prescrição

{{campo.prescricao}}

{{se campo.orientacoes}}
### Orientações

{{campo.orientacoes}}
{{/se}}
`.trim();

const CORPO_ATESTADO = `
Atesto, para os devidos fins, que **{{paciente}}** esteve sob atendimento profissional nesta clínica no dia **{{campo.atendimento_data}}**, às **{{campo.atendimento_hora}}**.

{{se campo.afastamento_dias}}
Recomendo afastamento de suas atividades habituais pelo período de **{{campo.afastamento_dias}}** dia(s), a contar da data acima.
{{/se}}
{{se campo.cid}}
CID: **{{campo.cid}}** — registrado mediante autorização expressa da paciente, nos termos da Resolução CFM 1.658/2002.
{{/se}}
{{se campo.observacoes}}
{{campo.observacoes}}
{{/se}}

Emitido em {{data}}.
`.trim();

const ANTIGOS = require('./034_receita_e_atestado.js');

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

  // 1. A FUNÇÃO da pessoa, ao lado do conselho que a 034 trouxe.
  criadas.push(...await acrescentar(conn, 'users', [
    ['funcao', "VARCHAR(120) NULL COMMENT 'Medico Clinico Geral, Biomedica Esteta...'"]
  ]));

  // 2. O ENDEREÇO da clínica. `clinicas` é a única tabela sem `clinica_id` --
  //    ela É a lista de clínicas --, então estas colunas são lidas e gravadas
  //    pela porta estreita do escopo (`minhaClinica`), nunca por SQL solto.
  criadas.push(...await acrescentar(conn, 'clinicas', [
    ['endereco', 'VARCHAR(255) NULL'],
    ['telefone', 'VARCHAR(40) NULL'],
    ['contato', "VARCHAR(120) NULL COMMENT 'site, @instagram ou e-mail'"]
  ]));

  // 3. O CARIMBO do timbre no documento, pela mesma razão das `emitido_por_*`.
  criadas.push(...await acrescentar(conn, 'client_documents', [
    ['emitido_por_funcao', 'VARCHAR(120) NULL'],
    ['timbre_clinica', 'VARCHAR(160) NULL'],
    ['timbre_endereco', 'VARCHAR(255) NULL'],
    ['timbre_telefone', 'VARCHAR(40) NULL'],
    ['timbre_contato', 'VARCHAR(120) NULL']
  ]));

  /* 4. OS CORPOS, só onde ainda são o original da 034.
   *
   *    A comparação é com o texto exato que a 034 semeou. Diferente de uma
   *    letra, a clínica mexeu, e o texto dela fica. */
  const [modelos] = await conn.query(
    "SELECT id, type, clinica_id, body_markdown FROM document_templates" +
    " WHERE type IN ('RECEITA','ATESTADO')");
  const trocados = [], preservados = [];
  for (const m of modelos) {
    const original = m.type === 'RECEITA' ? ANTIGOS.CORPO_RECEITA : ANTIGOS.CORPO_ATESTADO;
    const novo = m.type === 'RECEITA' ? CORPO_RECEITA : CORPO_ATESTADO;
    if (String(m.body_markdown || '').trim() === original.trim()) {
      await conn.query('UPDATE document_templates SET body_markdown = ? WHERE id = ?',
        [novo, m.id]);
      trocados.push(m.type + ' / ' + m.clinica_id);
    } else {
      preservados.push(m.type + ' / ' + m.clinica_id);
    }
  }

  const [semEndereco] = await conn.query(
    "SELECT COUNT(*) AS n FROM clinicas WHERE endereco IS NULL OR endereco = ''");

  await conn.query(
    'INSERT INTO system_logs (id, action_type, description, author) VALUES (?, ?, ?, ?)',
    ['lg_035_' + Date.now().toString(36), 'MIGRATION',
     'Migration 035: o timbre. users.funcao; clinicas ganhou endereco, telefone e contato; ' +
     'client_documents carimba o timbre na emissao. ' + trocados.length + ' corpo(s) de modelo ' +
     'atualizado(s), ' + preservados.length + ' preservado(s) por terem sido editados.',
     'Sistema']);

  return {
    colunasCriadas: criadas,
    modelosAtualizados: trocados,
    modelosPreservadosPorEdicao: preservados,
    clinicasSemEnderecoPreenchido: semEndereco[0].n,
    apagou: 'nada -- acrescenta colunas e reescreve so o corpo que ainda era o original'
  };
};

/* Para o nascimento de uma clínica nova semear já com o corpo novo. As
 * PERGUNTAS continuam vindo da 034 (elas não mudaram); só os corpos vêm daqui,
 * e cada migration segue sendo o registro fiel do seu próprio momento. */
module.exports.CORPO_RECEITA = CORPO_RECEITA;
module.exports.CORPO_ATESTADO = CORPO_ATESTADO;

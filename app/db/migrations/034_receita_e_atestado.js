'use strict';
/** Receituário e Atestado (M5.5, 16/09).
 *
 *  ===================================== POR QUE NÃO É UM MÓDULO NOVO
 *
 *  Receita e atestado são documentos clínicos, e o sistema já tem um motor de
 *  documento que faz o que eles precisam: congela o texto, calcula SHA-256,
 *  guarda versão do modelo, registra quem leu e recusa edição depois de
 *  emitido. Escrever um módulo separado significaria reescrever essas cinco
 *  coisas — e a quinta (a trilha de leitura) é a que a LGPD cobra.
 *
 *  Então entram como dois TIPOS dentro do motor existente. O que muda é uma
 *  coisa só, e é a que importa:
 *
 *      anamnese e termo   → quem assina é a PACIENTE  → AGUARDANDO_ASSINATURA
 *      receita e atestado → quem assina é a PROFISSIONAL → EMITIDO
 *
 *  Mandar uma receita para a fila de "aguardando assinatura" seria pedir que a
 *  paciente assinasse a própria prescrição. Daí o status novo.
 *
 *  =================================== O QUE O SISTEMA NÃO PASSA A FAZER
 *
 *  Não assina pela profissional. Não emite receita de controlado (Portaria
 *  344/98 exige receituário próprio, numerado e retido na farmácia). Não
 *  substitui certificado ICP-Brasil. O papel sai identificado, com linha para
 *  assinatura de próprio punho e um aviso dizendo exatamente isso — porque um
 *  documento que se apresenta como assinado sem estar é pior que um documento
 *  em branco.
 *
 *  ================================================ O CID TEM DONO
 *
 *  A Resolução CFM 1.658/2002 é clara: o diagnóstico só vai no atestado com
 *  AUTORIZAÇÃO EXPRESSA da paciente. Por isso o campo do CID só aparece depois
 *  que a caixa de autorização é marcada (`showIf`), e a linha do CID some do
 *  papel quando não houver. Não é detalhe de tela: é o atestado dizendo ao
 *  empregador uma informação de saúde que ninguém autorizou a contar.
 */

/* ------------------------------------------------------------ os modelos */

const RECEITA = {
  sections: [{
    title: 'Prescrição',
    fields: [
      { key: 'prescricao', label: 'Prescrição', type: 'textarea', required: true,
        help: 'Um item por linha: medicamento, concentração, forma, quantidade e posologia.' },
      { key: 'orientacoes', label: 'Orientações à paciente', type: 'textarea' }
    ]
  }]
};

/* O corpo usa `{{campo.x}}` — a substituição de UMA resposta dentro da frase,
 * que entrou junto com esta migration. A tabela de `{{respostas}}` não serve
 * aqui: receita se lê como receita, não como formulário respondido. */
const CORPO_RECEITA = `
## Receituário

**{{clinica}}**

Paciente: **{{paciente}}**
Data: {{data}}

### Prescrição

{{campo.prescricao}}

{{se campo.orientacoes}}
### Orientações

{{campo.orientacoes}}
{{/se}}
`.trim();

const ATESTADO = {
  sections: [
    {
      title: 'Atendimento',
      fields: [
        { key: 'atendimento_data', label: 'Dia do atendimento', type: 'date', required: true },
        { key: 'atendimento_hora', label: 'Hora do atendimento', type: 'text', required: true,
          help: 'Ex.: 14:30' },
        { key: 'afastamento_dias', label: 'Afastamento recomendado (dias)', type: 'number',
          help: 'Deixe em branco para atestado de comparecimento.' }
      ]
    },
    {
      title: 'Diagnóstico',
      fields: [
        { key: 'cid_autorizado', type: 'boolean',
          label: 'A paciente autoriza expressamente que o CID conste no atestado' },
        { key: 'cid', label: 'CID', type: 'text',
          showIf: { field: 'cid_autorizado', equals: true } }
      ]
    },
    {
      title: 'Observações',
      fields: [{ key: 'observacoes', label: 'Observações', type: 'textarea' }]
    }
  ]
};

const CORPO_ATESTADO = `
## Atestado

**{{clinica}}**

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

/* ---------------------------------------------------------------- a subida */

const TIPOS_SQL = "'ANAMNESE','TERMO_CONSENTIMENTO','ORIENTACAO','RECEITA','ATESTADO','OUTRO'";

async function colunas(conn, tabela) {
  const [r] = await conn.query(
    'SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS' +
    ' WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [tabela]);
  return r.map((x) => x.c);
}

module.exports = async function up(conn) {
  /* 1. OS DOIS TIPOS NOVOS. O ENUM é reescrito INTEIRO, com os quatro antigos
   *    na mesma ordem: ENUM guarda o índice, e trocar a ordem reescreveria o
   *    tipo de todo documento já gravado. */
  await conn.query(
    'ALTER TABLE document_templates MODIFY COLUMN type ENUM(' + TIPOS_SQL + ') NOT NULL');
  await conn.query(
    'ALTER TABLE client_documents MODIFY COLUMN type ENUM(' + TIPOS_SQL + ') NOT NULL');

  /* 2. O STATUS NOVO, pelo mesmo cuidado. `EMITIDO` entra no fim. */
  await conn.query(
    "ALTER TABLE client_documents MODIFY COLUMN status" +
    " ENUM('RASCUNHO','AGUARDANDO_ASSINATURA','ASSINADO','EMITIDO','CANCELADO')" +
    " NOT NULL DEFAULT 'RASCUNHO'");

  /* 3. O REGISTRO PROFISSIONAL fica no cadastro da pessoa, e não é digitado a
   *    cada receita: digitar de novo é errar de vez em quando, e um número de
   *    conselho errado invalida o papel na farmácia. */
  const cu = await colunas(conn, 'users');
  if (cu.indexOf('conselho') === -1) {
    await conn.query("ALTER TABLE users ADD COLUMN conselho VARCHAR(20) NULL" +
      " COMMENT 'CRM, CRO, CRBM, COREN, CRF...'");
  }
  if (cu.indexOf('conselho_numero') === -1) {
    await conn.query('ALTER TABLE users ADD COLUMN conselho_numero VARCHAR(30) NULL');
  }
  if (cu.indexOf('conselho_uf') === -1) {
    await conn.query('ALTER TABLE users ADD COLUMN conselho_uf CHAR(2) NULL');
  }

  /* 4. E é CARIMBADO no documento na hora da emissão — cópia, não junção.
   *
   *    Se o documento apenas apontasse para o usuário, trocar o número no
   *    cadastro (ou desativar a profissional) mudaria retroativamente o que a
   *    receita do ano passado diz. O papel tem de continuar afirmando o que era
   *    verdade quando foi emitido. É a mesma razão pela qual o HTML é
   *    congelado em vez de re-renderizado. */
  const cd = await colunas(conn, 'client_documents');
  const novas = [
    ['emitido_por_nome', 'VARCHAR(255) NULL'],
    ['emitido_por_conselho', 'VARCHAR(20) NULL'],
    ['emitido_por_numero', 'VARCHAR(30) NULL'],
    ['emitido_por_uf', 'CHAR(2) NULL'],
    ['emitido_por_id', "VARCHAR(50) NULL COMMENT 'users.id de quem emitiu'"],
    ['emitido_em', 'DATETIME NULL']
  ];
  for (const [nome, tipo] of novas) {
    if (cd.indexOf(nome) === -1) {
      await conn.query('ALTER TABLE client_documents ADD COLUMN ' + nome + ' ' + tipo);
    }
  }

  /* 5. OS MODELOS, UM PAR POR CLÍNICA. Cada clínica tem os seus porque ela pode
   *    editar o texto — e o texto editado por uma não pode aparecer na outra. */
  const [clinicas] = await conn.query('SELECT id, nome FROM clinicas');
  const semeadas = [];
  for (const c of clinicas) {
    for (const [tipo, nome, def, corpo] of [
      ['RECEITA', 'Receituário', RECEITA, CORPO_RECEITA],
      ['ATESTADO', 'Atestado', ATESTADO, CORPO_ATESTADO]
    ]) {
      const [ja] = await conn.query(
        'SELECT id FROM document_templates WHERE clinica_id = ? AND type = ? LIMIT 1',
        [c.id, tipo]);
      if (ja.length) continue;
      await conn.query(
        'INSERT INTO document_templates (id, name, type, version, fields_json, body_markdown,' +
        ' clinica_id) VALUES (?, ?, ?, 1, ?, ?, ?)',
        ['tpl_' + tipo.toLowerCase().slice(0, 8) + '_' +
           Math.random().toString(36).slice(2, 8), nome, tipo,
         JSON.stringify(def), corpo, c.id]);
      semeadas.push(c.nome + ' / ' + tipo);
    }
  }

  /* 6. Quem já tem registro profissional no cadastro. Zero aqui é o esperado
   *    no dia da subida, e é justamente o que a Silvia precisa ver: sem isto
   *    preenchido, a rota de emissão recusa com a frase que diz onde preencher. */
  const [comConselho] = await conn.query(
    "SELECT COUNT(*) AS n FROM users WHERE conselho IS NOT NULL AND conselho <> ''");

  await conn.query(
    'INSERT INTO system_logs (id, action_type, description, author) VALUES (?, ?, ?, ?)',
    ['lg_034_' + Date.now().toString(36), 'MIGRATION',
     'Migration 034: RECEITA e ATESTADO entraram como tipos de documento, com o status EMITIDO. ' +
     'users ganhou conselho/numero/UF e client_documents carimba o emissor. ' +
     semeadas.length + ' modelo(s) semeado(s). O sistema NAO assina pela profissional.',
     'Sistema']);

  return {
    modelosSemeados: semeadas,
    clinicas: clinicas.length,
    usuariosComRegistroProfissional: comConselho[0].n,
    apagou: 'nada -- esta migration acrescenta colunas, valores de ENUM e modelos'
  };
};

/* Exportados para o nascimento de uma clínica semear os MESMOS dois modelos,
 * no estado original — mesma razão da 016: copiar de uma clínica que já existe
 * levaria o texto clínico dela para dentro da clínica nova. */
module.exports.RECEITA = RECEITA;
module.exports.CORPO_RECEITA = CORPO_RECEITA;
module.exports.ATESTADO = ATESTADO;
module.exports.CORPO_ATESTADO = CORPO_ATESTADO;

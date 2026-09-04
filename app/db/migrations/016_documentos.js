'use strict';
/**
 * 016_documentos.js — Fase 4, T4.1
 *
 * O QUE ESTE MÓDULO É, DITO SEM ROMANTIZAR
 *
 * O Musa já coletava informação clínica: `clients.anamnese` é texto livre e
 * `clients.laudo` vem da IA. O que faltava não era coletar — era **forma
 * jurídica**: pergunta estruturada, termo de consentimento, conteúdo congelado,
 * assinatura e trilha.
 *
 * A COLUNA ANTIGA NÃO É APAGADA.
 *
 * A anamnese em texto livre é copiada para o novo modelo como `texto_livre`, e
 * `clients.anamnese` fica intacta por pelo menos um ciclo de produção. Se a
 * migração precisar rodar de novo — e migração de dado clínico é justamente o
 * tipo que se roda de novo — o original ainda está lá. Apagar na primeira
 * passada transforma um erro recuperável em perda definitiva de prontuário.
 *
 * SOBRE OS MODELOS SEMEADOS
 *
 * As perguntas abaixo são um PONTO DE PARTIDA clínico plausível para estética,
 * não uma anamnese validada. Gestação, isotretinoína, alergia, anticoagulante,
 * marca-passo e queloide estão marcados como alerta porque são contraindicações
 * reais e frequentes em procedimentos estéticos. Quem decide a lista final é a
 * profissional — o sistema entrega a estrutura e o editor.
 */

function novoId(p) {
  return p + '_' + Math.random().toString(36).slice(2, 10);
}

const ANAMNESE = {
  sections: [
    {
      title: 'Histórico de saúde',
      fields: [
        { key: 'gestante', label: 'Está gestante ou amamentando?', type: 'boolean', required: true, alert: true },
        { key: 'alergias', label: 'Possui alergia a algum medicamento, anestésico ou cosmético?', type: 'boolean', required: true, alert: true },
        { key: 'alergias_quais', label: 'Quais?', type: 'text', showIf: { field: 'alergias', equals: true } },
        { key: 'isotretinoina', label: 'Usou isotretinoína (Roacutan) nos últimos 6 meses?', type: 'boolean', required: true, alert: true },
        { key: 'anticoagulante', label: 'Usa anticoagulante ou antiagregante?', type: 'boolean', alert: true },
        { key: 'marcapasso', label: 'Tem marca-passo ou implante metálico?', type: 'boolean', alert: true },
        { key: 'queloide', label: 'Tem tendência a queloide?', type: 'boolean', alert: true },
        { key: 'autoimune', label: 'Doença autoimune diagnosticada?', type: 'boolean', alert: true },
        { key: 'oncologico', label: 'Tratamento oncológico atual ou recente?', type: 'boolean', alert: true },
        { key: 'medicamentos', label: 'Medicamentos em uso contínuo', type: 'textarea' },
        { key: 'cirurgias', label: 'Cirurgias ou procedimentos estéticos anteriores', type: 'textarea' }
      ]
    },
    {
      title: 'Pele e hábitos',
      fields: [
        { key: 'fototipo', label: 'Fototipo (Fitzpatrick)', type: 'select', options: ['I', 'II', 'III', 'IV', 'V', 'VI'] },
        { key: 'exposicao_solar', label: 'Exposição solar frequente sem proteção?', type: 'boolean' },
        { key: 'fumante', label: 'Fumante?', type: 'boolean' },
        { key: 'agua', label: 'Litros de água por dia', type: 'number' },
        { key: 'sono', label: 'Horas de sono por noite', type: 'number' },
        { key: 'dor', label: 'Sensibilidade à dor (0 a 10)', type: 'scale', min: 0, max: 10 },
        { key: 'queixa', label: 'Queixa principal e expectativa', type: 'textarea', required: true }
      ]
    }
  ]
};

const TERMO = {
  sections: [
    {
      title: 'Confirmações',
      fields: [
        { key: 'entendi_procedimento', label: 'Recebi explicação sobre o procedimento, suas etapas e a quantidade de sessões previstas.', type: 'boolean', required: true },
        { key: 'entendi_riscos', label: 'Fui informada dos riscos, efeitos esperados e possíveis reações adversas.', type: 'boolean', required: true },
        { key: 'entendi_resultado', label: 'Compreendo que o resultado varia entre pessoas e não pode ser garantido.', type: 'boolean', required: true },
        { key: 'entendi_cuidados', label: 'Recebi as orientações de cuidado antes e depois do procedimento.', type: 'boolean', required: true },
        { key: 'informacoes_verdadeiras', label: 'Declaro que as informações da minha anamnese são verdadeiras e completas.', type: 'boolean', required: true },
        { key: 'autorizo_imagem', label: 'Autorizo o registro fotográfico do meu tratamento para acompanhamento clínico.', type: 'boolean' },
        { key: 'autorizo_divulgacao', label: 'Autorizo o uso das minhas imagens para divulgação da clínica.', type: 'boolean' },
        { key: 'observacoes', label: 'Observações', type: 'textarea' }
      ]
    }
  ]
};

/* O corpo do termo. As variáveis entre chaves duplas são preenchidas na
 * renderização. A finalidade e o prazo de retenção estão AQUI, no texto, e não
 * em código, porque são definição da clínica com o jurídico dela — o sistema
 * entrega o campo, não a política. */
const CORPO_TERMO = `
## Termo de Consentimento Livre e Esclarecido

Eu, **{{paciente}}**, portadora do CPF {{cpf}}, declaro que fui devidamente
esclarecida sobre o procedimento **{{procedimento}}**, a ser realizado em
{{data}} nesta clínica.

Declaro que:

- recebi explicação sobre a técnica, as etapas e o número de sessões previstas;
- fui informada dos riscos, dos efeitos esperados e das possíveis reações adversas;
- compreendo que o resultado estético varia de pessoa para pessoa e não pode ser garantido;
- recebi as orientações de cuidado anteriores e posteriores ao procedimento;
- prestei informações verdadeiras e completas na minha anamnese, ciente de que
  omissões podem comprometer minha segurança.

### Tratamento dos meus dados

Autorizo o tratamento dos meus dados pessoais e de saúde para a finalidade de
prestação do atendimento estético, elaboração de prontuário e cumprimento de
obrigações legais da clínica. Fui informada de que:

- dados de saúde são dados pessoais sensíveis, protegidos pela Lei 13.709/2018 (LGPD);
- o prazo de retenção do meu prontuário é o definido pela legislação sanitária aplicável;
- posso solicitar acesso, correção ou portabilidade dos meus dados a qualquer momento;
- o acesso aos meus documentos clínicos é registrado pelo sistema.

{{respostas}}

_Assinado eletronicamente. Ver o rodapé deste documento para os dados de
integridade e autoria._
`.trim();

module.exports = async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS document_templates (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      type ENUM('ANAMNESE','TERMO_CONSENTIMENTO','ORIENTACAO','OUTRO') NOT NULL,
      catalog_id VARCHAR(50) NULL,
      version INT NOT NULL DEFAULT 1,
      fields_json JSON NOT NULL,
      body_markdown TEXT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_by VARCHAR(50),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_tpl_type (type, active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS client_documents (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50) NOT NULL,
      template_id VARCHAR(50) NULL,
      template_version INT NULL,
      appointment_id VARCHAR(50) NULL,
      type ENUM('ANAMNESE','TERMO_CONSENTIMENTO','ORIENTACAO','OUTRO') NOT NULL,
      title VARCHAR(255) NOT NULL,
      answers_json JSON NULL,
      rendered_html MEDIUMTEXT NULL,
      content_hash CHAR(64) NULL,
      pdf_path VARCHAR(500) NULL,
      status ENUM('RASCUNHO','AGUARDANDO_ASSINATURA','ASSINADO','CANCELADO') NOT NULL DEFAULT 'RASCUNHO',
      signer_name VARCHAR(255) NULL,
      signer_document VARCHAR(30) NULL,
      signature_image MEDIUMTEXT NULL,
      signed_at DATETIME NULL,
      signed_ip VARCHAR(45) NULL,
      signed_user_agent VARCHAR(255) NULL,
      cancelled_reason VARCHAR(255) NULL,
      created_by VARCHAR(50),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      INDEX idx_doc_client (client_id, type),
      INDEX idx_doc_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // ------------------------------------------------- modelos semeados
  const [temTpl] = await conn.query('SELECT COUNT(*) AS n FROM document_templates');
  if (temTpl[0].n === 0) {
    await conn.query(
      `INSERT INTO document_templates (id, name, type, version, fields_json, body_markdown)
       VALUES (?,?,?,1,?,?)`,
      ['tpl_anamnese_geral', 'Anamnese estética geral', 'ANAMNESE',
       JSON.stringify(ANAMNESE),
       '## Anamnese estética\n\nPaciente: **{{paciente}}**\nData: {{data}}\n\n{{respostas}}']
    );
    await conn.query(
      `INSERT INTO document_templates (id, name, type, version, fields_json, body_markdown)
       VALUES (?,?,?,1,?,?)`,
      ['tpl_termo_geral', 'Termo de consentimento — procedimento estético', 'TERMO_CONSENTIMENTO',
       JSON.stringify(TERMO), CORPO_TERMO]
    );
    console.log('   + 2 modelo(s) de documento (anamnese e termo)');
  }

  // ------------------------------------- migracao da anamnese antiga
  const [colunas] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' AND COLUMN_NAME = 'anamnese'`
  );
  if (!colunas.length) {
    console.log('   = clients.anamnese nao existe: nada a migrar');
    return;
  }

  const [antigas] = await conn.query(`
    SELECT c.id, c.name, c.anamnese,
           DATE_FORMAT(COALESCE(c.updated_at, c.created_at, NOW()), '%Y-%m-%d %H:%i:%s') AS quando
      FROM clients c
     WHERE c.anamnese IS NOT NULL AND TRIM(c.anamnese) <> ''
       AND NOT EXISTS (
         SELECT 1 FROM client_documents d
          WHERE d.client_id = c.id AND d.type = 'ANAMNESE'
            AND d.title LIKE 'Anamnese (migrada%'
       )
  `);

  let criados = 0;
  for (const c of antigas) {
    await conn.query(
      `INSERT INTO client_documents
        (id, client_id, type, title, answers_json, status, created_at)
       VALUES (?,?, 'ANAMNESE', ?, ?, 'RASCUNHO', ?)`,
      [novoId('doc'), c.id, 'Anamnese (migrada do cadastro anterior)',
       JSON.stringify({ texto_livre: String(c.anamnese) }), c.quando]
    );
    criados += 1;
  }
  console.log('   + ' + criados + ' anamnese(s) migrada(s) como rascunho; clients.anamnese PRESERVADA');
};

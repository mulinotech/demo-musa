'use strict';
/** A configuração DE UMA CLÍNICA: a instância de WhatsApp e o lembrete.
 *
 *  ======================================================== ONDE ISTO MORAVA
 *
 *  Em `system_settings`, uma linha por chave, para a instalação inteira. A
 *  migration 024 moveu para `clinica_settings` — chave primária
 *  `(clinica_id, chave)`, `clinica_id` obrigatória e com chave estrangeira. O
 *  que sobrou em `system_settings` é, por definição, da instalação: hoje só o
 *  token do cron.
 *
 *  ============================================ POR QUE `null` E `false` AQUI
 *
 *  `lerLembrete` devolve `proprio: false` quando a clínica **não tem** linha de
 *  configuração, e nesse caso apresenta o programa como **desligado** — nunca
 *  como o padrão do código.
 *
 *  É a mesma correção que a M1.4 fez na fidelidade, e pela mesma razão: lá,
 *  `fid.config(null)` devolvia `active: true`, então uma clínica sem
 *  configuração via o programa "ligado" enquanto nada creditava ponto. Duas
 *  partes do sistema discordando sobre se algo existe é pior do que qualquer
 *  uma estar errada. Aqui o preço de errar é maior: **mensagem enviada para
 *  paciente real não tem desfazer.**
 */

const lembretes = require('./lembretes');
const TEMPLATE_PADRAO = lembretes.TEMPLATE_PADRAO;
const ANTECEDENCIA_H = lembretes.ANTECEDENCIA_H;

/* As duas chaves novas (M6.7) guardam o texto da 2ª e da 3ª mensagem da régua.
 * Chaves separadas, e não um JSON numa chave só: assim a clínica pode reescrever
 * a cobrança sem risco de estragar o cancelamento, e um valor corrompido
 * derruba uma mensagem em vez das três. */
const CHAVES_LEMBRETE = [
  'lembretes_ativos', 'lembrete_antecedencia_h', 'lembrete_template',
  'lembrete_template_2', 'lembrete_template_3'
];

/** A configuração de lembrete desta clínica.
 *
 *  `db` é um escopo (de `escopo(req)` ou de `escopo.paraClinica`). O `ativo`
 *  devolvido já leva em conta a instância: **sem instância, não há como mandar,
 *  então não está ligado** — dizer "ligado" seria prometer um envio que não
 *  acontece. */
async function lerLembrete(db) {
  const [linhas] = await db.q(
    'SELECT chave, valor FROM clinica_settings WHERE clinica_id = :clinica' +
    " AND chave LIKE 'lembrete%'");

  const m = {};
  for (const l of linhas) m[l.chave] = l.valor;
  const proprio = linhas.length > 0;

  const clinica = await db.minhaClinica();
  const instancia = (clinica && clinica.evolution_instance) || null;

  return {
    proprio: proprio,
    instancia: instancia,
    // Duas condicoes, e as duas tem de ser verdade. A configuracao diz "eu
    // quero"; a instancia diz "eu tenho por onde".
    ativo: m.lembretes_ativos === '1' && !!instancia,
    ligadoNaConfiguracao: m.lembretes_ativos === '1',
    template: m.lembrete_template || TEMPLATE_PADRAO,
    templateCobranca: m.lembrete_template_2 || lembretes.TEMPLATE_COBRANCA,
    templateCancelamento: m.lembrete_template_3 || lembretes.TEMPLATE_CANCELAMENTO,
    antecedenciaH: Number(m.lembrete_antecedencia_h) || ANTECEDENCIA_H
  };
}

/** Grava as chaves de lembrete desta clínica. Só as três conhecidas passam. */
async function salvarLembrete(db, novos) {
  for (const chave of Object.keys(novos)) {
    if (CHAVES_LEMBRETE.indexOf(chave) === -1) continue;
    await db.q(
      'INSERT INTO clinica_settings (clinica_id, chave, valor) VALUES (:clinica, ?, ?)' +
      ' ON DUPLICATE KEY UPDATE valor = VALUES(valor)',
      [chave, novos[chave]]);
  }
}

/** A instância de WhatsApp desta clínica, ou `null`.
 *
 *  Quem manda mensagem chama isto e passa o resultado adiante. `null` não é
 *  "use a padrão": é **não mande**. */
async function instancia(db) {
  const clinica = await db.minhaClinica();
  return (clinica && clinica.evolution_instance) || null;
}

module.exports = {
  lerLembrete: lerLembrete,
  salvarLembrete: salvarLembrete,
  instancia: instancia,
  CHAVES_LEMBRETE: CHAVES_LEMBRETE
};

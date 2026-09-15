'use strict';
/** O NASCIMENTO DE UMA CLÍNICA (M2.4).
 *
 *  ======================================================= O QUE É "NASCER"
 *
 *  Não é inserir uma linha em `clinicas`. Uma clínica que só tem a linha existe
 *  e **não trabalha**: não lança a primeira despesa (não tem categoria), não
 *  simula preço, não credita ponto, não preenche anamnese e não recebe lead do
 *  site. Cada uma dessas coisas mora numa tabela diferente, e a clínica precisa
 *  da sua.
 *
 *  Então nascer é, numa transação só:
 *
 *      1. a clínica                        (com a chave de captação do site)
 *      2. o primeiro acesso de administrador
 *      3. as 16 categorias financeiras
 *      4. a configuração de preço
 *      5. o programa de pontos
 *      6. os dois modelos de documento (anamnese e termo)
 *
 *  **Ou nasce inteira, ou não nasce.** Uma clínica pela metade é pior do que
 *  nenhuma: a pessoa entra, encontra telas que funcionam e telas que recusam,
 *  e ninguém sabe dizer o que faltou.
 *
 *  ==================================== POR QUE `todasAsClinicas`, E NÃO O ESCOPO
 *
 *  Porque no instante em que este trabalho começa **a clínica ainda não
 *  existe** — não há sessão, não há "clínica atual", e o identificador é
 *  justamente o que está sendo criado. É o caso legítimo da camada crua, com o
 *  motivo escrito.
 *
 *  E por isso, aqui dentro, `clinica_id` vai **explícito** em cada `INSERT`, em
 *  vez do `:clinica` de sempre. Não é descuido: é a única forma de tudo correr
 *  na MESMA transação. `escopo.paraClinica` pegaria outra conexão do pool, as
 *  gravações rodariam FORA desta transação, e um erro no meio deixaria metade
 *  da clínica gravada — exatamente o que a camada avisa em `transacao`.
 *
 *  ============================ AS LISTAS SÃO IMPORTADAS, NÃO COPIADAS
 *
 *  As categorias vêm da migration 008, os modelos da 016, a chave de captação
 *  do gerador da 029. Copiar qualquer uma delas para cá criaria uma segunda
 *  versão da mesma verdade, e a clínica nova nasceria diferente da primeira na
 *  terceira semana.
 */

const bcrypt = require('bcryptjs');
const escopo = require('../db/escopo');

const CATEGORIAS = require('../../db/migrations/008_financeiro.js').CATEGORIAS;
const DOCS = require('../../db/migrations/016_documentos.js');
const novaChaveDeCaptacao = require('../../db/migrations/029_chave_de_captacao.js').novaChave;

const MOTIVO = 'nascimento de uma clinica: no inicio deste trabalho a clinica ainda nao ' +
               'existe, entao nao ha sessao nem clinica atual de onde tirar o escopo';

const SENHA_MINIMA = 10;

function novoId(prefixo) {
  return prefixo + '_' + Math.random().toString(36).slice(2, 10);
}

/** Recusa com mensagem para a tela, em vez de estourar. */
function Recusa(status, mensagem) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

/** O que falta para esta clínica poder nascer. Pura de propósito: a validação é
 *  a parte que erra, e assim ela é testável sem subir banco. */
function conferirDados(d) {
  d = d || {};
  const nome = String(d.nome || '').trim();
  const adminNome = String(d.adminNome || '').trim();
  const adminEmail = String(d.adminEmail || '').trim().toLowerCase();
  const adminSenha = String(d.adminSenha || '');

  if (!nome) return { erro: 'A clinica precisa de um nome.' };
  if (!adminNome) return { erro: 'Informe o nome de quem vai administrar a clinica.' };
  if (!adminEmail || adminEmail.indexOf('@') === -1) {
    return { erro: 'Informe um e-mail valido para o primeiro acesso.' };
  }
  if (adminSenha.length < SENHA_MINIMA) {
    return { erro: 'A senha precisa ter ao menos ' + SENHA_MINIMA + ' caracteres.' };
  }
  return { nome: nome, adminNome: adminNome, adminEmail: adminEmail, adminSenha: adminSenha };
}

/** Cria a clínica inteira. Devolve o que quem chamou precisa mostrar na tela. */
async function criarClinica(dados) {
  const d = conferirDados(dados);
  if (d.erro) throw Recusa(400, d.erro);

  const cru = escopo.todasAsClinicas(MOTIVO);
  const clinicaId = novoId('cl');
  const chave = novaChaveDeCaptacao();
  const adminId = novoId('u');

  try {
    await cru.transacao(async function (tx) {
      // 1. a clinica
      await tx.q(
        'INSERT INTO clinicas (id, nome, status, chave_captacao) VALUES (?, ?, ?, ?)',
        [clinicaId, d.nome, 'ativa', chave]);

      // 2. o primeiro acesso. `password_hash`, nunca a senha -- e ela nao e
      //    guardada, nem registrada, nem devolvida.
      await tx.q(
        'INSERT INTO users (id, name, email, password_hash, role, status, clinica_id)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?)',
        [adminId, d.adminNome, d.adminEmail, bcrypt.hashSync(d.adminSenha, 10),
         'admin', 'active', clinicaId]);

      // 3. as 16 categorias financeiras, com os MESMOS ids fixos da clinica 1.
      //    Sao fixos porque o codigo lanca a receita do atendimento em
      //    `cat_procedimentos` pelo nome -- e desde a migration 030 cada clinica
      //    pode ter o seu.
      for (const [id, nome, tipo] of CATEGORIAS) {
        await tx.q(
          'INSERT INTO finance_categories (id, name, type, clinica_id) VALUES (?, ?, ?, ?)',
          [id, nome, tipo, clinicaId]);
      }

      // 4 e 5. a configuracao de preco e a de pontos, nos padroes do esquema.
      await tx.q('INSERT INTO pricing_settings (id, clinica_id) VALUES (?, ?)',
        ['default', clinicaId]);
      await tx.q('INSERT INTO loyalty_settings (id, clinica_id) VALUES (?, ?)',
        ['default', clinicaId]);

      // 6. os dois modelos de documento, no estado ORIGINAL da migration 016 --
      //    e nao copiados de outra clinica, que levaria as edicoes clinicas
      //    dela para dentro desta.
      await tx.q(
        'INSERT INTO document_templates (id, name, type, version, fields_json, body_markdown,' +
        ' clinica_id) VALUES (?, ?, ?, 1, ?, ?, ?)',
        [novoId('tpl'), 'Anamnese estetica geral', 'ANAMNESE',
         JSON.stringify(DOCS.ANAMNESE),
         '## Anamnese estética\n\nPaciente: **{{paciente}}**\nData: {{data}}\n\n{{respostas}}',
         clinicaId]);
      await tx.q(
        'INSERT INTO document_templates (id, name, type, version, fields_json, body_markdown,' +
        ' clinica_id) VALUES (?, ?, ?, 1, ?, ?, ?)',
        [novoId('tpl'), 'Termo de consentimento — procedimento estetico', 'TERMO_CONSENTIMENTO',
         JSON.stringify(DOCS.TERMO), DOCS.CORPO_TERMO, clinicaId]);
    });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      // `users.email` e unico na plataforma inteira (decisao de 04/09). A
      // recusa nao diz "ja existe": isso contaria a quem esta cadastrando que
      // aquele endereco esta em uso em alguma clinica -- informacao de um
      // cliente escapando para outro. Mesma frase da rota de usuarios, e ha
      // teste fixando as duas.
      throw Recusa(409, 'Este e-mail nao esta disponivel. Use outro endereco.');
    }
    throw e;
  }

  return {
    clinicaId: clinicaId,
    nome: d.nome,
    chaveCaptacao: chave,
    administrador: { id: adminId, nome: d.adminNome, email: d.adminEmail },
    categoriasFinanceiras: CATEGORIAS.length,
    modelosDeDocumento: 2
  };
}

/** O que uma clínica precisa ter para trabalhar — e o que falta, se faltar.
 *
 *  Existe porque "criou sem erro" não é "funciona": a M1.7 ensinou isso da pior
 *  forma. Quem cria chama isto em seguida e mostra o resultado. */
async function conferirClinica(clinicaId) {
  const db = escopo.paraClinica(clinicaId);
  const faltas = [];

  const clinica = await db.minhaClinica();
  if (!clinica) return { ok: false, faltas: ['a clinica nao existe'] };
  if (!clinica.chave_captacao) faltas.push('chave de captacao (o site nao consegue mandar lead)');

  const contar = async function (tabela, oQueFalta, minimo) {
    const [r] = await db.q('SELECT COUNT(*) AS n FROM `' + tabela + '` WHERE clinica_id = :clinica');
    if (Number(r[0].n) < minimo) faltas.push(oQueFalta + ' (tem ' + r[0].n + ', esperado ' + minimo + ')');
    return Number(r[0].n);
  };

  const admins = await (async function () {
    const [r] = await db.q(
      "SELECT COUNT(*) AS n FROM users WHERE clinica_id = :clinica AND role = 'admin'" +
      " AND status = 'active'");
    if (Number(r[0].n) < 1) faltas.push('nenhum administrador ativo (ninguem consegue entrar)');
    return Number(r[0].n);
  })();

  const categorias = await contar('finance_categories', 'categorias financeiras', CATEGORIAS.length);
  const precos = await contar('pricing_settings', 'configuracao de preco', 1);
  const pontos = await contar('loyalty_settings', 'programa de pontos', 1);
  const modelos = await contar('document_templates', 'modelos de documento', 1);

  return {
    ok: faltas.length === 0,
    faltas: faltas,
    clinica: clinica.id,
    nome: clinica.nome,
    administradoresAtivos: admins,
    categoriasFinanceiras: categorias,
    configuracaoDePreco: precos,
    programaDePontos: pontos,
    modelosDeDocumento: modelos
  };
}

module.exports = {
  criarClinica: criarClinica,
  conferirClinica: conferirClinica,
  conferirDados: conferirDados,
  SENHA_MINIMA: SENHA_MINIMA,
  MOTIVO: MOTIVO
};

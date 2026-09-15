'use strict';
/** Cadastro de clínica — a operação de plataforma (M2.4, e o começo da M3.2).
 *
 *  ===================================== QUEM PODE FAZER ISTO, HOJE E DEPOIS
 *
 *  **Hoje: `admin`.** E isso é interino, está escrito aqui para não virar
 *  permanente por esquecimento.
 *
 *  Criar clínica é operação da **plataforma**, não de um inquilino: quem
 *  administra a Clínica A não deveria poder criar a Clínica C. O papel certo —
 *  um operador da plataforma que administra sem ler prontuário de ninguém — é a
 *  M3.1, e ainda não existe.
 *
 *  O risco de deixar em `admin` enquanto isso: um administrador de clínica cria
 *  uma clínica a mais. **Não vaza dado nenhum** — a clínica nova nasce vazia, e
 *  o acesso dela é do e-mail que foi informado, não de quem criou. É ruído, não
 *  é furo. Com uma clínica cadastrada, o conjunto de quem pode fazer isso é a
 *  própria dona do sistema.
 *
 *  Quando a M3.1 chegar, esta linha da tabela de papéis muda e o comentário sai.
 *
 *  ================================== POR QUE A RESPOSTA TRAZ UMA CONFERÊNCIA
 *
 *  Porque "criou sem erro" não é "funciona" — foi o que a M1.7 ensinou da pior
 *  forma, em 04/09: a conferência chamou cinco rotas de leitura e declarou a
 *  tarefa pronta com o sistema incapaz de inserir uma linha.
 *
 *  Então a rota cria e **em seguida lê de volta**, contando o que a clínica
 *  nova tem: administrador ativo, 16 categorias, preço, pontos, modelos. É essa
 *  contagem que vai para a tela, e não um "ok".
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');
const logs = require('../services/logs');
const nascimento = require('../services/nascimento-clinica');

router.post('/api/clinicas', express.json({ limit: '1mb' }), async function (req, res) {
  try {
    const nova = await nascimento.criarClinica(req.body || {});
    const conferencia = await nascimento.conferirClinica(nova.clinicaId);

    /* O registro vai para a INSTALAÇÃO, e não para a clínica de quem criou.
     *
     * Nascimento de clínica é fato da plataforma: não é trabalho da clínica A,
     * e a trilha dela não é lugar para contar que a clínica B passou a existir.
     * Ganha tela na M3.3. */
    await logs.daInstalacao(nascimento.MOTIVO, 'CLINICA_CRIADA',
      'Clinica "' + nova.nome + '" (' + nova.clinicaId + ') criada por ' +
      (req.usuario && req.usuario.email ? req.usuario.email : 'desconhecido') +
      '. Primeiro acesso: ' + nova.administrador.email + '. ' +
      (conferencia.ok ? 'Nasceu completa.' : 'ATENCAO, faltou: ' + conferencia.faltas.join('; ')),
      req.usuario && req.usuario.email, req.ip);

    res.status(201).json({
      clinica: nova.clinicaId,
      nome: nova.nome,
      chaveCaptacao: nova.chaveCaptacao,
      administrador: nova.administrador,
      conferencia: conferencia,
      observacao: conferencia.ok
        ? 'A clinica nasceu completa: administrador, 16 categorias financeiras, configuracao de ' +
          'preco, programa de pontos e os dois modelos de documento. Entre com o e-mail e a senha ' +
          'informados. O WhatsApp dela se conecta na tela de Integracao.'
        : 'A clinica foi criada MAS esta incompleta -- ver `conferencia.faltas`. Nao coloque ' +
          'ninguem para trabalhar nela antes de resolver.'
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('[clinicas]', e && e.message);
    res.status(500).json({ error: 'Falha ao criar a clinica.' });
  }
});

/** A conferência de uma clínica que já existe. Serve para olhar a clínica 1
 *  também — ela nasceu de migrations, e não deste caminho. */
router.get('/api/clinicas/:id/conferencia', async function (req, res) {
  try {
    res.json(await nascimento.conferirClinica(req.params.id));
  } catch (e) {
    console.error('[clinicas]', e && e.message);
    res.status(500).json({ error: 'Falha ao conferir a clinica.' });
  }
});

module.exports = router;

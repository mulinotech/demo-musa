'use strict';
/** AS ROTAS DA PLATAFORMA — a administração das 50, por quem não é de nenhuma.
 *
 *  ============================================= O QUE SAIU DAQUI PARA ENTRAR AQUI
 *
 *  `POST /api/clinicas` existia desde 11/09 com papel `admin`, e o cabeçalho
 *  daquele arquivo dizia, em letras grandes, que era **interino**: criar clínica
 *  é operação de plataforma, e quem administra a Clínica A não deveria poder
 *  criar a Clínica C.
 *
 *  Hoje o papel certo existe, então a rota mudou de casa e a antiga **foi
 *  apagada** — não desativada, não comentada. Há teste fixando que ela não
 *  voltou, porque rota interina que sobrevive ao interino é como aviso em
 *  documento: não barra ninguém.
 *
 *  ============================================== CONTAGEM SIM, CONTEÚDO NÃO
 *
 *  A listagem devolve **números**: quantas pacientes, quantos acessos, quantos
 *  leads, quando foi o último atendimento. Não devolve uma linha sequer de
 *  paciente, documento ou agenda.
 *
 *  A fronteira é essa e vale a pena dizer por quê: *"quantas pacientes a Clínica
 *  B tem"* é informação de plataforma — é a conta do mês, é o dimensionamento do
 *  servidor, é o suporte sabendo se a clínica começou a usar. ***"Quem são
 *  elas"* não é.** Uma é o negócio da Mulino; a outra é o prontuário de gente
 *  que nunca ouviu falar da Mulino.
 *
 *  ================================================ POR QUE `todasAsClinicas` AQUI
 *
 *  Porque este é o caso legítimo da camada crua, com o motivo escrito: o
 *  operador **não tem clínica**, e a pergunta que ele faz é justamente sobre o
 *  conjunto. Não há `:clinica` que caiba — e é por isso que o que ele pode
 *  perguntar está limitado por lista de rotas, e não por filtro.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const router = express.Router();

const escopo = require('../db/escopo');
const logs = require('../services/logs');
const plataforma = require('../middleware/plataforma');
const nascimento = require('../services/nascimento-clinica');
const suporte = require('./suporte');

/** A senha do operador e mais longa que a de administrador de clinica (10):
 *  ela nao abre uma clinica, abre a lista de todas elas. Mesmo numero do
 *  `scripts/criar-operador.js`, e ha teste cobrando que os dois nao divirjam. */
const SENHA_MINIMA_DO_OPERADOR = 12;

const MOTIVO = 'administracao da plataforma: o operador nao pertence a clinica nenhuma, e as ' +
               'perguntas dele sao sobre o conjunto das clinicas -- nunca sobre o conteudo de uma';

/** O limite da porta de entrada, e ele é mais apertado que o do CRM de
 *  propósito: esta é a credencial que enxerga as 50 clínicas. Dez tentativas por
 *  minuto por endereço é folgado para quem erra a senha e inviável para quem
 *  tenta adivinhá-la — e, desde que `trust proxy` foi declarado em 11/09, o
 *  endereço é o de quem tentou, e não o do nginx. */
const limiteDeEntrada = rateLimit({
  windowMs: 60000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Espere um minuto.' }
});

router.post('/api/plataforma/login', limiteDeEntrada, express.json(), async function (req, res) {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const senha = String((req.body && req.body.senha) || (req.body && req.body.password) || '');
  if (!email || !senha) return res.status(400).json({ error: 'Informe e-mail e senha.' });

  try {
    const cru = escopo.todasAsClinicas(MOTIVO);
    const [r] = await cru.q(
      "SELECT id, nome, email, password_hash FROM operadores WHERE email = ? AND status = 'ativo'",
      [email]);

    /* A MESMA RECUSA para e-mail que não existe e para senha errada, e a mesma
     * para operador inativo. Distinguir contaria a quem está tentando que aquele
     * endereço é de um operador da plataforma -- que é justamente a informação
     * que transforma um chute em um alvo. */
    const ok = r.length && bcrypt.compareSync(senha, r[0].password_hash);
    if (!ok) {
      await logs.daInstalacao(MOTIVO, 'PLATAFORMA_LOGIN_RECUSADO',
        'Tentativa de entrada na plataforma recusada para "' + email.slice(0, 60) + '".',
        'Sistema (Plataforma)', req.ip);
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    await cru.q('UPDATE operadores SET ultimo_acesso = NOW() WHERE id = ?', [r[0].id]);
    await logs.daInstalacao(MOTIVO, 'PLATAFORMA_LOGIN',
      'Operador "' + r[0].nome + '" (' + r[0].email + ') entrou na plataforma.',
      r[0].email, req.ip);

    res.json({
      token: plataforma.gerarToken(r[0]),
      nome: r[0].nome,
      email: r[0].email,
      validade: plataforma.EXPIRACAO
    });
  } catch (e) {
    console.error('[plataforma] login:', e && e.message);
    res.status(500).json({ error: 'Falha ao entrar.' });
  }
});

/** O PRIMEIRO OPERADOR — e só o primeiro (14/09).
 *
 *  ===================================================== O PROBLEMA DO OVO
 *
 *  A tela da plataforma exige estar dentro da plataforma, e a tabela nasce
 *  vazia. Alguém tem de criar o primeiro de fora, e há dois caminhos:
 *
 *   1. `node scripts/criar-operador.js`, no servidor. É o preferido: a senha é
 *      digitada num terminal, sem eco, e nada além do hash sai dali.
 *   2. **Esta rota**, para quando o console do servidor não consegue falar com o
 *      banco — que é o caso desta instalação, onde o `.env` tem credencial
 *      antiga e as migrations rodam pela aplicação, e não por SQL.
 *
 *  ================================================ POR QUE ELA NÃO É UM BURACO
 *
 *  Três travas, e a primeira é a que importa:
 *
 *   - **ela se fecha sozinha.** Havendo UM operador, ela recusa para sempre. Não
 *     é uma porta que fica aberta: é uma que só existe antes de a casa ter dono;
 *   - exige `admin` autenticado, pela tabela de papéis de sempre;
 *   - grita na trilha da instalação, com o e-mail de quem usou.
 *
 *  O risco que sobra, escrito para ninguém descobri-lo sozinho depois: numa
 *  instalação com várias clínicas e nenhum operador, o administrador de
 *  qualquer clínica poderia ser o primeiro a usá-la. Nesta instalação a janela
 *  são os minutos entre a migration e o primeiro acesso, e o único `admin`
 *  existente é a dona do sistema. Quando a M3.2 trouxer o cadastro de
 *  operadores pela tela, esta rota sai. */
router.post('/api/primeiro-operador', express.json(), async function (req, res) {
  try {
    const cru = escopo.todasAsClinicas(MOTIVO);
    const [quantos] = await cru.q('SELECT COUNT(*) AS n FROM operadores');

    if (Number(quantos[0].n) > 0) {
      await logs.daInstalacao(MOTIVO, 'PLATAFORMA_PRIMEIRO_RECUSADO',
        'Tentativa de usar a rota do PRIMEIRO operador com a plataforma ja povoada (' +
        quantos[0].n + ' operador(es)), por ' +
        ((req.usuario && req.usuario.email) || (req.usuario && req.usuario.nome) || 'desconhecido') +
        '. Recusada.',
        (req.usuario && req.usuario.nome) || 'Sistema', req.ip);
      return res.status(409).json({
        error: 'A plataforma ja tem operador. Esta rota so funciona uma vez, e ja foi usada.'
      });
    }

    const nome = String((req.body && req.body.nome) || '').trim();
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const senha = String((req.body && req.body.senha) || '');

    if (!nome) return res.status(400).json({ error: 'O operador precisa de um nome.' });
    if (!email || email.indexOf('@') === -1) {
      return res.status(400).json({ error: 'Informe um e-mail valido.' });
    }
    if (senha.length < SENHA_MINIMA_DO_OPERADOR) {
      return res.status(400).json({
        error: 'A senha precisa ter ao menos ' + SENHA_MINIMA_DO_OPERADOR + ' caracteres. ' +
               'Ela abre a lista de TODAS as clinicas.'
      });
    }

    const id = 'op_' + Math.random().toString(36).slice(2, 10);
    await cru.q('INSERT INTO operadores (id, nome, email, password_hash) VALUES (?, ?, ?, ?)',
      [id, nome, email, bcrypt.hashSync(senha, 10)]);

    await logs.daInstalacao(MOTIVO, 'PLATAFORMA_OPERADOR_CRIADO',
      'PRIMEIRO operador da plataforma criado: "' + nome + '" (' + email + '), por ' +
      ((req.usuario && req.usuario.nome) || 'desconhecido') +
      '. A rota do primeiro operador esta fechada a partir de agora.',
      (req.usuario && req.usuario.nome) || 'Sistema', req.ip);

    // A senha NAO volta, nem aqui nem em lugar nenhum: quem a digitou ja a tem.
    res.status(201).json({
      operador: id,
      nome: nome,
      email: email,
      observacao: 'Entre em /plataforma com este e-mail e a senha que voce informou. Esta rota ' +
                  'acabou de se fechar: ela so funciona com a plataforma vazia.'
    });
  } catch (e) {
    console.error('[plataforma] primeiro operador:', e && e.message);
    res.status(500).json({ error: 'Falha ao criar o primeiro operador.' });
  }
});

/** Quem sou eu. Serve para a tela saber se o token ainda vale sem ter de pedir a
 *  lista inteira das clínicas só para descobrir isso. */
router.get('/api/plataforma/eu', function (req, res) {
  res.json({ nome: req.usuario.nome, email: req.usuario.email, plataforma: true });
});

/** As clínicas da instalação, com contagens. Nunca com conteúdo. */
router.get('/api/plataforma/clinicas', async function (req, res) {
  try {
    const cru = escopo.todasAsClinicas(MOTIVO);

    /* As subconsultas contam por clínica. É mais lento que juntar tudo numa
     * varredura só, e é o certo aqui: com 50 clínicas isto roda uma vez a cada
     * abertura de tela, e a forma é legível para quem for auditar o que a
     * plataforma enxerga. Cada linha desta consulta é um NÚMERO -- se um dia
     * alguém acrescentar aqui um `nome` de paciente, a revisão vai ver. */
    const [linhas] = await cru.q(`
      SELECT
        c.id, c.nome, c.status, c.criada_em, c.chave_captacao,
        (SELECT COUNT(*) FROM clients     WHERE clinica_id = c.id) AS pacientes,
        (SELECT COUNT(*) FROM users       WHERE clinica_id = c.id AND status = 'active') AS acessos,
        (SELECT COUNT(*) FROM leads       WHERE clinica_id = c.id) AS leads,
        (SELECT COUNT(*) FROM appointments WHERE clinica_id = c.id) AS agendamentos,
        -- starts_at, e nao date: a coluna "date" nao existe em appointments, e
        -- a primeira versao desta consulta quebrou a tela inteira com 500. Quem
        -- escreve consulta para tabela que nao usa todo dia confere o esquema.
        (SELECT MAX(starts_at) FROM appointments WHERE clinica_id = c.id) AS ultimoAgendamento,
        (SELECT MAX(expira_em) FROM acessos_de_suporte
          WHERE clinica_id = c.id AND revogado_em IS NULL AND expira_em > NOW()) AS suporteAte
      FROM clinicas c
      ORDER BY c.criada_em ASC, c.id ASC
    `);

    res.json({
      clinicas: linhas,
      total: linhas.length,
      ativas: linhas.filter(function (c) { return c.status === 'ativa'; }).length
    });
  } catch (e) {
    console.error('[plataforma] clinicas:', e && e.message);
    res.status(500).json({ error: 'Falha ao listar as clinicas.' });
  }
});

/** Cadastrar clínica. O motor é o mesmo da M2.4, provado em produção em 11/09 —
 *  o que mudou é quem tem a chave da porta, e que agora há uma tela. */
router.post('/api/plataforma/clinicas', express.json({ limit: '1mb' }), async function (req, res) {
  try {
    const nova = await nascimento.criarClinica(req.body || {});
    const conferencia = await nascimento.conferirClinica(nova.clinicaId);

    await logs.daInstalacao(MOTIVO, 'CLINICA_CRIADA',
      'Clinica "' + nova.nome + '" (' + nova.clinicaId + ') criada por ' +
      (req.usuario && req.usuario.email ? req.usuario.email : 'operador desconhecido') +
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
          'preco, programa de pontos e os dois modelos de documento. O WhatsApp dela se conecta ' +
          'na tela de Integracao, com a instancia dela.'
        : 'A clinica foi criada MAS esta incompleta -- ver `conferencia.faltas`. Nao coloque ' +
          'ninguem para trabalhar nela antes de resolver.'
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('[plataforma] criar clinica:', e && e.message);
    res.status(500).json({ error: 'Falha ao criar a clinica.' });
  }
});

/** A conferência de uma clínica que já existe — inclusive a primeira, que nasceu
 *  de migrations e não deste caminho. */
router.get('/api/plataforma/clinicas/:id/conferencia', async function (req, res) {
  try {
    res.json(await nascimento.conferirClinica(req.params.id));
  } catch (e) {
    console.error('[plataforma] conferencia:', e && e.message);
    res.status(500).json({ error: 'Falha ao conferir a clinica.' });
  }
});

/** ENTRAR NUMA CLINICA PARA DAR SUPORTE (M3.1b).
 *
 *  So funciona se a clinica tiver concedido, e o que volta e uma sessao de
 *  LEITURA, sem prontuario, valida por 30 minutos -- com a concessao conferida
 *  no banco a CADA requisicao, para revogar ter efeito na hora.
 *
 *  O registro vai para a trilha da CLINICA, e nao para a da instalacao: quem
 *  precisa saber que a Mulino entrou e quem e dono do dado. */
router.post('/api/plataforma/clinicas/:id/entrar', async function (req, res) {
  const clinicaId = req.params.id;
  try {
    const db = escopo.paraClinica(clinicaId, {
      autor: 'Suporte Mulino (' + req.usuario.nome + ')', ip: req.ip });

    const viva = await suporte.concessaoViva(db);
    if (!viva) {
      return res.status(403).json({
        error: 'Esta clinica nao autorizou acesso de suporte, ou a autorizacao expirou. ' +
               'Peca ao administrador dela para liberar, com prazo, na tela de Usuarios.'
      });
    }

    await logs.registrar(db, 'SUPORTE_ENTROU',
      'A Mulino (' + req.usuario.email + ') entrou para dar suporte, com a autorizacao de ' +
      viva.concedido_por + ' que vale ate ' + new Date(viva.expira_em).toISOString() +
      '. Acesso de leitura, sem ficha de paciente nem documento clinico.');

    res.json({
      token: plataforma.gerarTokenDeSuporte(req.usuario, clinicaId),
      clinica: clinicaId,
      expiraEm: viva.expira_em,
      leitura: true,
      observacao: 'Sessao de leitura. Ficha de paciente, anamnese e documentos clinicos ficam ' +
                  'fora mesmo com autorizacao. A clinica pode revogar a qualquer momento, e a ' +
                  'revogacao vale na requisicao seguinte.'
    });
  } catch (e) {
    console.error('[plataforma] entrar:', e && e.message);
    res.status(500).json({ error: 'Falha ao entrar na clinica.' });
  }
});

module.exports = router;

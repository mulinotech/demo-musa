'use strict';
/** Porteiro unico da API: exige JWT em tudo, exceto as rotas publicas.
 *
 *  O 401 NAO leva cabecalho WWW-Authenticate de proposito: com ele, o navegador
 *  abre o dialogo nativo de usuario e senha por cima da tela de login do CRM.
 *
 *  Alem da sessao de pessoa, ha MAIS DUAS identidades, e as duas existem pelo
 *  mesmo motivo: nao tem clinica, e por isso nao cabem no caminho normal.
 *
 *    1. O OPERADOR DA PLATAFORMA (`./plataforma.js`), que administra as 50 sem
 *       pertencer a nenhuma. Conferido primeiro, e limitado por LISTA DE ROTAS.
 *    2. O TOKEN DE SERVICO DO CRON (`./cron.js`), que vale para duas rotas de
 *       varredura e mais nada. Conferido por ultimo porque toca o banco: nao ha
 *       por que gastar consulta em quem nem mandou o cabecalho dele.
 *
 *  As tres sao conferidas DEPOIS das rotas publicas, que nao exigem credencial.
 *
 *  O que as duas identidades sem clinica tem em comum, e que e a regra deste
 *  arquivo: **o alcance delas e uma lista escrita, e nao um papel**. Papel novo
 *  herda toda rota que ainda nao tem linha na tabela de permissoes -- inclusive
 *  a ficha das pacientes. Lista que nega por padrao nao tem esse buraco.
 */
const auth = require('../../auth');
const cron = require('./cron');
const plataforma = require('./plataforma');

const ROTAS_PUBLICAS = [
  { metodo: 'POST', caminho: '/api/leads' },
  { metodo: 'POST', caminho: '/api/auth/login' },
  { metodo: 'POST', caminho: '/api/plataforma/login' },
  { metodo: 'GET',  caminho: '/api/config' },
  { metodo: 'POST', caminho: '/api/webhook/whatsapp' }
];

function ehRotaPublica(metodo, caminho) {
  return ROTAS_PUBLICAS.some(function (r) {
    return r.metodo === metodo && r.caminho === caminho;
  });
}

async function porteiro(req, res, next) {
  res.set('X-Trava-Musa', 'v62');
  const caminho = req.originalUrl.split('?')[0];
  if (ehRotaPublica(req.method, caminho)) return next();

  /* A SEGUNDA IDENTIDADE: O OPERADOR DA PLATAFORMA (M3.1, 14/09).
   *
   * Conferida ANTES do token de pessoa, e o motivo e o mesmo do cron: o token
   * dela NAO tem clinica, entao o bloco de baixo a recusaria com "Sessao sem
   * clinica" -- mensagem certa para um usuario de CRM e errada para esta, que
   * nunca teve clinica nenhuma e nao pode ter.
   *
   * O QUE ELA ALCANCA E UMA LISTA, NAO ESTE `if`. Token valido em rota fora da
   * lista e recusado aqui mesmo, com 403 e mensagem propria -- e nao com 401,
   * que o front leria como sessao expirada e mandaria a pessoa entrar de novo
   * para receber a mesma recusa. O 403 diz a verdade: a credencial e boa, o
   * alcance dela e que nao chega ali. */
  const daPlataforma = plataforma.cargaDaRequisicao(req);
  if (daPlataforma) {
    if (!plataforma.ehRotaDaPlataforma(req.method, caminho)) {
      return res.status(403).json({
        error: 'Este acesso e da plataforma e nao alcanca dados de clinica.'
      });
    }
    req.usuario = plataforma.identidade(daPlataforma);
    return next();
  }

  /* A SESSAO DE SUPORTE (M3.1b). Vem ANTES do caminho normal, e isto e a regra 26
   * aplicada: o token de suporte TEM clinica, entao o bloco de baixo o aceitaria
   * como usuario comum -- e, sem regra de papel para 'suporte', `exigirPapel`
   * diria "sem regra, pode" e ele alcancaria o CRM inteiro, prontuario incluso.
   *
   * Duas conferencias, e as duas precisam passar:
   *   1. a rota esta na lista de suporte (so GET, sem prontuario);
   *   2. a clinica AINDA autoriza -- conferido no banco, a cada requisicao.
   *
   * A segunda e o que faz "revogar" ter efeito imediato. Conferir so ao entrar
   * deixaria um token valido por 30 minutos depois de a clinica ter dito nao. */
  const deSuporte = plataforma.cargaDeSuporte(req);
  if (deSuporte) {
    if (!plataforma.ehRotaDeSuporte(req.method, caminho)) {
      return res.status(403).json({
        error: 'O acesso de suporte e de leitura e nao alcanca ficha de paciente nem documento clinico.'
      });
    }
    try {
      const escopo = require('../db/escopo');
      const db = escopo.paraClinica(deSuporte.clinicaId);
      const suporte = require('../routes/suporte');
      const viva = await suporte.concessaoViva(db);
      if (!viva) {
        return res.status(403).json({
          error: 'O acesso de suporte a esta clinica expirou ou foi revogado.'
        });
      }
    } catch (e) {
      console.error('[suporte] falha ao conferir a concessao:', e && e.message);
      return res.status(403).json({ error: 'Nao foi possivel conferir o acesso de suporte.' });
    }
    const situacaoSup = require('../db/situacao-clinica');
    if (!(await situacaoSup.estaAtiva(deSuporte.clinicaId))) {
      return res.status(403).json({ error: 'O acesso desta clinica esta suspenso.' });
    }
    req.usuario = {
      sub: deSuporte.sub,
      nome: 'Suporte Mulino (' + deSuporte.nome + ')',
      email: deSuporte.email,
      papel: 'suporte',
      clinicaId: deSuporte.clinicaId,
      suporte: true
    };
    return next();
  }

  const usuario = auth.usuarioDaRequisicao(req);
  if (usuario) {
    // TOKEN SEM CLINICA NAO VALE (M0.3).
    //
    // Todo token emitido antes desta versao cai aqui, e isso e deliberado:
    // aceitar sessao sem inquilino significaria consultas sem filtro rodando
    // com identidade de gente de verdade. Quem estava logado sai e entra de
    // novo; o front ja trata 401 como sessao expirada.
    //
    // A identidade de servico do cron NAO tem clinica -- as varreduras
    // percorrem todas -- e por isso ela e conferida no bloco de baixo, nunca
    // aqui. Um token de PESSOA sem clinica e defeito; a rotina sem clinica e o
    // desenho.
    if (!usuario.clinicaId) {
      return res.status(401).json({ error: 'Sessao sem clinica. Entre de novo.' });
    }

    /* E A PORTA CONTRARIA -- ACHADA PELO ENSAIO EM 14/09, NAO POR MIM.
     *
     * A primeira versao desta tarefa tratava so o caso obvio: token de
     * plataforma pedindo dado de clinica. O caminho inverso ficou aberto, e o
     * motivo e o buraco conhecido de `exigirPapel`: nao ha regra de papel para
     * /api/plataforma (nem deve haver), entao `if (!regra) return next()`
     * deixava a requisicao seguir e a ROTA RODAVA.
     *
     * O resultado medido no ensaio: a administradora da Clinica A **cadastrou
     * uma clinica** pela rota da plataforma, e recebeu 201. Quem administra um
     * consultorio criando inquilino na instalacao -- exatamente o que a M3.1
     * veio impedir, do lado que eu nao tinha olhado.
     *
     * A recusa e 403, e nao 401: a credencial e boa, o alcance dela e que nao
     * chega aqui. E quem nao mandou credencial nenhuma cai no 401 la embaixo,
     * que e a verdade para esse caso. */
    if (caminho.indexOf('/api/plataforma/') === 0) {
      return res.status(403).json({
        error: 'Esta area e da administracao da plataforma, e nao do CRM da clinica.'
      });
    }

    /* CLINICA SUSPENSA OU ENCERRADA NAO ENTRA (M3.2b) -- nem com token valido.
     *
     * Conferir so no login deixaria quem ja estava dentro trabalhando por mais
     * 12 horas depois de a Mulino suspender o acesso. O status vem de um mapa em
     * memoria recarregado a cada 15s, entao isto nao custa uma ida ao banco por
     * clique. */
    const situacao = require('../db/situacao-clinica');
    if (!(await situacao.estaAtiva(usuario.clinicaId))) {
      return res.status(403).json({
        error: 'O acesso desta clinica esta suspenso. Fale com a Mulino.'
      });
    }

    req.usuario = usuario;
    return next();
  }

  // O `require` fica aqui dentro de proposito: so quem manda o cabecalho do
  // cron toca no banco, e a suite de teste do porteiro nao precisa de pool.
  if (req.headers[cron.CABECALHO]) {
    try {
      const { pool } = require('../db');
      const servico = await cron.identidadeDeCron(pool, req, caminho);
      if (servico) { req.usuario = servico; return next(); }
    } catch (e) {
      // Banco fora do ar na conferencia do token e 401, nunca 500: para quem
      // chama, "nao autentiquei" e a verdade, e o cron tenta de novo depois.
      //
      // MAS O ERRO PRECISA APARECER EM ALGUM LUGAR. A primeira versao disto
      // engolia a excecao calada, e foi assim que `require('../db')` -- que
      // devolve { pool }, nao o pool -- passou por um 401 identico ao de token
      // errado. Meia hora procurando token invalido quando o defeito era de
      // codigo. Log de servidor nao e detalhe: e a diferenca entre uma falha
      // que se acha e uma que se persegue.
      console.error('[cron] falha ao conferir o token de servico:', e.message);
    }
  }

  return res.status(401).json({ error: 'Sessao nao autenticada ou expirada.' });
}

module.exports = { ROTAS_PUBLICAS, ehRotaPublica, porteiro };

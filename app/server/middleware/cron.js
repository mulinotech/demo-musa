'use strict';
/** Token de serviço do agendador do sistema.
 *
 *  POR QUE NÃO É UM USUÁRIO ADMINISTRADOR
 *
 *  O caminho curto seria criar um usuário `cron@clinica` com papel admin e
 *  deixar a senha num script. Uma senha de admin em arquivo de texto, num
 *  servidor compartilhado, abre o CRM inteiro — prontuário, financeiro,
 *  cadastro de usuários — se o arquivo vazar. O token daqui não é credencial
 *  de pessoa: ele vale para DUAS rotas e nada mais.
 *
 *  POR QUE A LISTA DE ROTAS FICA AQUI, E NÃO NA TABELA DE PAPÉIS
 *
 *  `exigirPapel` libera rota que não tem linha na tabela (`if (!regra) return
 *  next()`). Um papel novo chamado 'servico' herdaria, portanto, tudo que
 *  ainda não foi regrado — inclusive a ficha das pacientes. Lista de permissão
 *  explícita não tem esse buraco: o que não está escrito abaixo não passa,
 *  hoje nem quando alguém acrescentar uma rota nova amanhã.
 *
 *  AS DUAS ROTAS SÃO SEGURAS DE EXPOR A UM TOKEN
 *
 *  As duas são varreduras idempotentes: rodar dez vezes tem o efeito de rodar
 *  uma. Nenhuma devolve dado de paciente — devolvem contagens. O pior que um
 *  token vazado faz é mandar o servidor conferir se há lembrete a enviar, que
 *  é o que ele já faria sozinho. Rota nova só entra nesta lista se couber na
 *  mesma frase.
 *
 *  O valor vive em `system_settings.cron_token`, sorteado pela migration 017
 *  no próprio servidor. A comparação é em tempo constante: comparar com `===`
 *  vaza o tamanho do prefixo certo pela diferença de tempo de resposta, e um
 *  token adivinhável byte a byte não é token.
 */
const crypto = require('crypto');

const CABECALHO = 'x-musa-cron';

const ROTAS_DE_CRON = [
  { metodo: 'POST', caminho: '/api/appointments/reminders/run' },
  { metodo: 'POST', caminho: '/api/loyalty/expire' }
];

/** A identidade que as rotas enxergam. Não é pessoa: não tem `sub` de usuário
 *  e é reconhecida pela marca `servico`, nunca pelo papel. */
const IDENTIDADE = Object.freeze({
  sub: null,
  nome: 'Rotina automatica',
  papel: 'servico',
  servico: true
});

function ehRotaDeCron(metodo, caminho) {
  return ROTAS_DE_CRON.some(function (r) {
    return r.metodo === metodo && r.caminho === caminho;
  });
}

/** Comparação em tempo constante, à prova de tamanhos diferentes. */
function iguais(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  if (!x.length || x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/** Lê o token guardado. Só é chamada quando o cabeçalho veio, ou seja: uma vez
 *  por passada do cron, não uma vez por requisição do CRM. */
async function tokenGuardado(pool) {
  const [r] = await pool.query("SELECT valor FROM system_settings WHERE chave = 'cron_token'");
  return r.length ? String(r[0].valor || '') : '';
}

/** Devolve a identidade de serviço quando o cabeçalho confere E a rota está na
 *  lista. Devolve null em qualquer outro caso — inclusive token certo em rota
 *  fora da lista, que é a tentativa que interessa barrar. */
async function identidadeDeCron(pool, req, caminho) {
  const enviado = req.headers[CABECALHO];
  if (!enviado) return null;
  if (!ehRotaDeCron(req.method, caminho)) return null;

  // Erro de LIGACAO grita; erro de CREDENCIAL devolve null. Passar o modulo
  // `server/db` inteiro em vez de `db.pool` faz `pool.query` ser undefined, e
  // sem esta linha a falha sairia como 401 -- identica a de token errado, e
  // impossivel de distinguir de fora. Ja aconteceu uma vez.
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('identidadeDeCron precisa do pool do mysql2, nao do modulo server/db');
  }

  const guardado = await tokenGuardado(pool);
  if (!guardado || !iguais(enviado, guardado)) return null;
  return IDENTIDADE;
}

/** É a rotina automática falando? Usada pelos guardas de papel das rotas. */
function ehServico(req) {
  return !!(req && req.usuario && req.usuario.servico === true);
}

module.exports = {
  CABECALHO: CABECALHO,
  ROTAS_DE_CRON: ROTAS_DE_CRON,
  IDENTIDADE: IDENTIDADE,
  ehRotaDeCron: ehRotaDeCron,
  iguais: iguais,
  identidadeDeCron: identidadeDeCron,
  ehServico: ehServico
};

'use strict';
/** Monta a aplicacao Express e a exporta SEM subir servidor.
 *  Quem escuta e o server/index.js — a separacao existe para os testes
 *  poderem instanciar a API sem abrir socket. */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (e) {
  // dotenv e opcional
}

const { porteiro } = require('./middleware/autenticacao');
const { exigirPapel } = require('./middleware/autorizacao');

const app = express();

/* ================================ QUEM É O VISITANTE, DE VERDADE (11/09)
 *
 * A aplicação roda atrás de proxy, e sem esta linha o Express enxergava o
 * endereço **do proxy** em `req.ip` — para todo mundo. Medido em produção em
 * 11/09: a trilha de auditoria inteira tinha um único `ip_address`,
 * `127.0.0.1`. Quer dizer: desde sempre, "de onde veio esta ação?" não tinha
 * resposta em registro nenhum — nem em criar paciente, nem em apagar
 * lançamento, nem em trocar a senha de alguém. A coluna existia e não dizia
 * nada.
 *
 * ========================================== `'loopback'`, E NÃO UM NÚMERO
 *
 * `trust proxy` aceita um número de saltos, e seria a escolha óbvia — e a
 * errada. Um número diz "confie nos N primeiros endereços da lista", sem olhar
 * quem são; se a topologia mudar, o Express passa a acreditar num endereço que
 * o próprio visitante escreveu em `X-Forwarded-For`, e aí **qualquer um forja o
 * próprio IP** na trilha de auditoria e no limite de envios.
 *
 * `'loopback'` diz outra coisa: confie apenas em quem chega de 127.0.0.1 — que
 * é exatamente o proxy desta instalação, e isso foi medido — e tome o endereço
 * real como o último não-confiável da cadeia. Se amanhã o proxy passar a vir de
 * outro endereço, isto para de confiar sozinho, em vez de confiar demais.
 *
 * ============================================ O QUE AINDA PRECISA SER MEDIDO
 *
 * Se o nginx **não** repassar `X-Forwarded-For`, esta linha não quebra nada:
 * `req.ip` continua 127.0.0.1 e tudo segue como antes — só não melhora. A
 * confirmação é olhar o `ipAddress` de um registro NOVO da trilha depois desta
 * mudança. Enquanto ela não vier, o limite de envios da captação pública fica
 * no valor conservador (ver o cabeçalho de `routes/leads-publico.js`). */
app.set('trust proxy', 'loopback');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || 'https://demo-musa.mulinotech.com' }));
/* O teto por minuto e por endereco. O valor sai do ambiente SO para o ensaio de
 * vazamento poder afrouxa-lo: ele dispara centenas de requisicoes em segundos, e
 * em 14/09 o bloco novo empurrou a varredura para cima de 120 -- a partir dali
 * TODA conferencia passou a receber 429, inclusive as que esperavam 403. Ou
 * seja: o limite nao quebrou nada em producao e quase quebrou a MEDICAO, que e
 * pior, porque a saida vermelha apontava para o lugar errado.
 *
 * O padrao continua 120 e producao nao define a variavel; ha teste fixando que o
 * padrao nao virou "sem limite" por descuido. */
const TETO_API = parseInt(process.env.LIMITE_API_POR_MINUTO || '120', 10) || 120;
app.use('/api', rateLimit({ windowMs: 60000, max: TETO_API, standardHeaders: true, legacyHeaders: false }));

// A ordem importa: autenticar, autorizar, so entao interpretar o corpo e servir rotas.
app.use('/api', porteiro);
app.use('/api', exigirPapel);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// ---- ROTAS ----
// Cada arquivo declara os caminhos completos (/api/...), por isso montamos na raiz.
app.use(require('./routes/auth'));
app.use(require('./routes/logs'));
// `leads-publico` ANTES de `leads`: e o POST /api/leads do formulario do site,
// que chega sem sessao. Ver o cabecalho de routes/leads-publico.js.
/* A plataforma vem ANTES de tudo que e de clinica, e nao por necessidade de
 * roteamento (os caminhos nao colidem): e para quem le este arquivo encontrar,
 * no topo, a resposta para "quem administra as 50?". A rota interina
 * `POST /api/clinicas`, de papel admin, foi APAGADA em 14/09 quando esta
 * chegou -- e ha teste cobrando que ela nao volte. */
app.use(require('./routes/plataforma'));
app.use(require('./routes/suporte'));
app.use(require('./routes/leads-publico'));
app.use(require('./routes/leads'));
app.use(require('./routes/salespeople'));
app.use(require('./routes/catalog'));
app.use(require('./routes/clients'));
app.use(require('./routes/treatments'));
app.use(require('./routes/treatment-plans'));
app.use(require('./routes/interactions'));
app.use(require('./routes/gemini'));
// `webhook-whatsapp` ANTES de `evolution`: e o POST /api/webhook/whatsapp, que
// chega sem sessao. Ver o cabecalho de routes/webhook-whatsapp.js.
app.use(require('./routes/webhook-whatsapp'));
app.use(require('./routes/evolution'));
app.use(require('./routes/reports'));
app.use(require('./routes/users'));
app.use(require('./routes/pricing'));
app.use(require('./routes/finance'));
// `lembretes` ANTES de `appointments`, por precaucao de ordem: as quatro rotas
// de lembrete comecam com /api/appointments/. Ver o cabecalho de
// routes/lembretes.js.
app.use(require('./routes/lembretes'));
app.use(require('./routes/appointments'));
app.use(require('./routes/stock'));
// `expiracao-pontos` ANTES de `loyalty`, por precaucao de ordem: a rota dela
// comeca com /api/loyalty/. Ver o cabecalho de routes/expiracao-pontos.js.
app.use(require('./routes/expiracao-pontos'));
app.use(require('./routes/loyalty'));
app.use(require('./routes/documents'));
app.use(require('./routes/migrate'));

// Rota curinga do SPA React: precisa ficar DEPOIS de todas as rotas /api.
if (fs.existsSync(distPath)) {
  app.get('*', function (req, res) {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

module.exports = app;

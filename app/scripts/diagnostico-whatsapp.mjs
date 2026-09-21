/** Por que a mensagem da paciente não volta para o CRM? (18/09)
 *
 *  ===================================== POR QUE ESTE ARQUIVO EXISTE
 *
 *  O caminho de entrada do WhatsApp tem quatro pontos onde a mensagem pode se
 *  perder, e **nenhum deles aparece em tela**:
 *
 *      1. a Evolution não chama o webhook   → nada chega, e o servidor não sabe
 *      2. chega, mas a instância não é de   → vira registro DA INSTALAÇÃO, que
 *         clínica nenhuma                      desde a M1.6a não aparece em
 *                                              tela nenhuma, de propósito
 *      3. chega e é gravada                 → e aí o problema é da TELA
 *      4. a tela não pergunta de novo       → confirmado no código: o CRM não
 *                                              tem atualização automática
 *
 *  Adivinhar entre os quatro custa um dia. Este script responde em 10 segundos,
 *  e é só leitura: nenhum INSERT, nenhum UPDATE, nenhum DELETE.
 *
 *  ============================================ E ELE NÃO MOSTRA SEGREDO
 *
 *  As variáveis de ambiente aparecem como "definida" ou "AUSENTE", nunca o
 *  valor. Diagnóstico não precisa da chave para dizer se ela existe.
 *
 *  Rode assim, na pasta da aplicação:
 *      source /srv/demo-musa.2d384ff2.configr.cloud/activate
 *      node scripts/diagnostico-whatsapp.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const daqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(daqui, '..');
const require = createRequire(import.meta.url);

try { require('dotenv').config({ path: path.join(raiz, '.env') }); } catch (e) { /* opcional */ }
const mysql = require('mysql2/promise');

const linha = (t) => console.log('\n' + t + '\n' + '-'.repeat(t.length));
const sim = (v) => (v ? 'definida' : 'AUSENTE');

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || process.env.DB_PASS,
  database: process.env.DB_NAME
});

linha('1. AS VARIAVEIS DE AMBIENTE (so se existem, nunca o valor)');
console.log('EVOLUTION_API_URL      : ' + sim(process.env.EVOLUTION_API_URL));
console.log('EVOLUTION_API_KEY      : ' + sim(process.env.EVOLUTION_API_KEY));
console.log('EVOLUTION_INSTANCE_NAME: ' + sim(process.env.EVOLUTION_INSTANCE_NAME));

linha('2. A INSTANCIA DE CADA CLINICA');
const [cl] = await conn.query(
  'SELECT id, nome, status, evolution_instance FROM clinicas ORDER BY id');
for (const c of cl) {
  console.log('  ' + c.id.padEnd(10) + ' ' + String(c.nome).slice(0, 28).padEnd(30) +
    ' status=' + String(c.status).padEnd(10) +
    ' instancia=' + (c.evolution_instance || '(NENHUMA)'));
}
console.log('\n  Clinica sem instancia NAO recebe mensagem: a entrada descobre a clinica');
console.log('  pelo nome da instancia que recebeu. Isso se resolve na tela "Integracao WhatsApp".');

linha('3. AS MENSAGENS GRAVADAS (a prova de que a entrada funciona)');
const [it] = await conn.query(
  "SELECT clinica_id, direction, COUNT(*) AS n," +
  " DATE_FORMAT(MAX(created_at), '%d/%m/%Y %H:%i') AS ultima" +
  " FROM interactions WHERE type = 'whatsapp'" +
  ' GROUP BY clinica_id, direction ORDER BY clinica_id, direction');
if (!it.length) console.log('  NENHUMA mensagem de WhatsApp gravada, em direcao nenhuma.');
for (const r of it) {
  const oQue = r.direction === 'in' ? 'RECEBIDAS da paciente' : 'enviadas pela clinica';
  console.log('  ' + String(r.clinica_id || '(sem clinica)').padEnd(10) +
    ' ' + oQue.padEnd(24) + ' ' + String(r.n).padStart(5) + '   ultima: ' + r.ultima);
}
console.log('\n  LEIA ASSIM:');
console.log('  - sem linha "RECEBIDAS"      -> a Evolution NAO esta chamando o webhook (ponto 1)');
console.log('  - "RECEBIDAS" com data velha -> parou de chamar em algum momento');
console.log('  - "RECEBIDAS" de hoje        -> a entrada FUNCIONA, e o problema e a TELA (ponto 4)');

linha('4. MENSAGENS QUE CHEGARAM SEM DONO (instancia nao vinculada)');
const [semDono] = await conn.query(
  "SELECT DATE_FORMAT(created_at, '%d/%m/%Y %H:%i') AS quando, description" +
  " FROM system_logs WHERE action_type = 'WHATSAPP_SEM_CLINICA'" +
  ' ORDER BY created_at DESC LIMIT 5');
if (!semDono.length) {
  console.log('  Nenhuma. (Ou a instancia esta vinculada, ou nada chegou.)');
} else {
  console.log('  ATENCAO: chegou mensagem e o sistema nao soube de quem e.');
  for (const r of semDono) console.log('  ' + r.quando + '  ' + String(r.description).slice(0, 150));
  console.log('\n  Isto se resolve vinculando a instancia a clinica em "Integracao WhatsApp".');
}

linha('5. AS ULTIMAS 5 MENSAGENS RECEBIDAS, SE HOUVER');
const [ult] = await conn.query(
  "SELECT i.clinica_id, DATE_FORMAT(i.created_at, '%d/%m %H:%i') AS quando," +
  ' LEFT(i.content, 60) AS trecho' +
  " FROM interactions i WHERE i.type = 'whatsapp' AND i.direction = 'in'" +
  ' ORDER BY i.created_at DESC LIMIT 5');
if (!ult.length) console.log('  Nenhuma mensagem recebida, nunca.');
for (const r of ult) {
  console.log('  ' + r.quando + '  ' + String(r.clinica_id).padEnd(8) + '  ' + r.trecho);
}

linha('6. LEADS QUE NA VERDADE SAO GRUPOS (o defeito corrigido na v54)');
/* Ate a v54 o webhook tratava o id de um GRUPO como se fosse telefone: criava
 * lead e respondia no grupo. Aqui listamos o estrago que ficou no funil, para a
 * clinica poder apagar ou arquivar. Id de grupo do WhatsApp tem 15 a 20 digitos
 * e nao comeca com codigo de pais -- telefone brasileiro com DDI tem 12 ou 13. */
const [grupos] = await conn.query(
  "SELECT clinica_id, id, name, whatsapp, DATE_FORMAT(date, '%d/%m/%Y') AS quando" +
  ' FROM leads' +
  " WHERE CHAR_LENGTH(REPLACE(REPLACE(whatsapp,'+',''),' ','')) >= 15" +
  ' ORDER BY date DESC LIMIT 20');
if (!grupos.length) {
  console.log('  Nenhum. O funil nao tem lead com cara de grupo.');
} else {
  console.log('  ATENCAO: ' + grupos.length + ' lead(s) com numero longo demais para telefone.');
  for (const g of grupos) {
    console.log('  ' + String(g.clinica_id).padEnd(10) + ' ' + g.quando + '  ' +
      String(g.name).slice(0, 24).padEnd(26) + ' ' + g.whatsapp);
  }
  console.log('\n  Provavelmente vieram de mensagem de grupo. A partir da v54 isso nao');
  console.log('  acontece mais; estes aqui sao do periodo anterior e podem ser apagados');
  console.log('  no Funil. Este script NAO apaga nada.');
}

await conn.end();
console.log('\nFim. Nada foi gravado nem alterado.\n');

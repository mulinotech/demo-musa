/** A CONFERÊNCIA DO FORMULÁRIO DO SITE, NUM NAVEGADOR DE VERDADE (11/09).
 *
 *  ======================================================= POR QUE EXISTE
 *
 *  Porque as três coisas que mudaram aqui são **invisíveis ao teste de
 *  servidor**, e duas delas foram defeitos que ficaram meses no ar sem sintoma:
 *
 *   1. O envio agora leva `?captacao=`. Se essa parte sumir num refactor, o
 *      servidor responde 503 e o formulário do site para de gravar — em
 *      silêncio, do ponto de vista de quem publicou.
 *   2. A tela de sucesso só aparece DEPOIS da confirmação do servidor. Antes ela
 *      aparecia primeiro: a visitante saía "pré-agendada" e não havia lead.
 *      Essa é a que nenhuma conferência de servidor jamais pegaria — o servidor
 *      estava certo, era a página que mentia.
 *   3. A página parou de pedir `GET /api/leads` (401 a cada visita) e de gravar
 *      três leads inventados no navegador de quem visita.
 *
 *  ================================================= COMO ELA NÃO PASSA DE GRAÇA
 *
 *  Cada afirmação é medida nos dois sentidos: o envio que o servidor ACEITA tem
 *  de mostrar sucesso, e o que ele RECUSA tem de mostrar a falha. Conferir só o
 *  caminho feliz é como o `PARE` que passou verde em 04/09.
 *
 *      node scripts/conferir-captacao.mjs
 *
 *  (Roda contra o `dist` já construído; não sobe banco nem servidor de verdade —
 *  a API é interceptada, porque o que está sob medição é a página.)
 */
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(AQUI, '..', 'dist');

let passou = 0;
const falhas = [];
function conferir(oQue, verdade, detalhe) {
  if (verdade) { passou++; console.log('  ok    ' + oQue + (detalhe ? '  ->  ' + detalhe : '')); }
  else { falhas.push(oQue); console.log('  FALHA ' + oQue + (detalhe ? '  ->  ' + detalhe : '')); }
}

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
                '.json': 'application/json', '.woff2': 'font/woff2' };

/** Servidor estático do `dist`. Qualquer caminho desconhecido cai no index,
 *  porque a navegação é de uma aplicação de página única. */
function servir() {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      const limpo = decodeURIComponent(req.url.split('?')[0]);
      let alvo = path.join(DIST, limpo);
      if (!fs.existsSync(alvo) || fs.statSync(alvo).isDirectory()) alvo = path.join(DIST, 'index.html');
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(alvo)] || 'application/octet-stream' });
      res.end(fs.readFileSync(alvo));
    });
    s.listen(0, '127.0.0.1', () => ok(s));
  });
}

/** Preenche os tres campos obrigatorios do formulario. Pelos rotulos que a
 *  pessoa ve, e nao por posicao: `input` numero 1 era o e-mail, e o telefone
 *  ia parar nele -- o formulario nao enviava e a conferencia acusava o codigo
 *  novo por um erro meu. */
async function preencher(form, nome, telefone) {
  await form.locator('input[type="text"]').first().fill(nome);
  await form.locator('input[type="tel"]').first().fill(telefone);
  const combo = form.locator('select').first();
  const opcoes = await combo.locator('option').count();
  if (opcoes < 2) throw new Error('o combo de procedimentos veio vazio: sem escolha o formulario ' +
    'nao envia, e tudo abaixo falharia por falta de dado, nao por defeito');
  await combo.selectOption({ index: 1 });
}

const servidor = await servir();
const base = 'http://127.0.0.1:' + servidor.address().port;
const navegador = await chromium.launch();

try {
  console.log('\n[1] o envio leva a chave de captacao, e o sucesso espera o servidor');
  {
    const pg = await (await navegador.newContext()).newPage();
    const chamadas = [];
    await pg.route('**/api/**', async (rota) => {
      const req = rota.request();
      chamadas.push(req.method() + ' ' + new URL(req.url()).pathname + (new URL(req.url()).search || ''));
      if (req.method() === 'POST' && req.url().includes('/api/leads')) {
        return rota.fulfill({ status: 201, contentType: 'application/json',
          body: JSON.stringify({ id: 'lead_de_ensaio' }) });
      }
      // O catalogo de tratamentos do formulario; vazio serve.
      return rota.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await pg.goto(base + '/', { waitUntil: 'networkidle' });

    const leuALista = chamadas.some((c) => c.startsWith('GET /api/leads'));
    conferir('a pagina publica NAO pede a lista de leads ao carregar', !leuALista,
      leuALista ? 'pediu: ' + chamadas.filter((c) => c.startsWith('GET /api/leads')).join(', ')
                : 'chamadas no carregamento: ' + (chamadas.join(' | ') || 'nenhuma'));

    const inventados = await pg.evaluate(() => localStorage.getItem('musa_leads_v2'));
    conferir('e NAO grava leads inventados no navegador de quem visita', !inventados,
      inventados ? 'gravou: ' + inventados.slice(0, 80) + '...' : 'localStorage limpo');

    await pg.locator('#contato').scrollIntoViewIfNeeded();
    const form = pg.locator('form').filter({ hasText: 'Pré-Agendamento' }).first();
    conferir('o Formulario de Pre-Agendamento esta na pagina', await form.count() > 0,
      'se ele nao estiver aqui, todas as conferencias abaixo passariam sem medir nada');

    await preencher(form, 'Maria De Ensaio', '11999998888');
    await form.locator('button[type="submit"]').click();

    await pg.waitForTimeout(1500);
    const envio = chamadas.filter((c) => c.startsWith('POST /api/leads'))[0] || '';
    conferir('o envio aconteceu', !!envio, envio || 'NENHUM POST saiu do formulario');
    conferir('e ele leva ?captacao= na URL', /\?captacao=cap_/.test(envio),
      envio + ' -- sem a chave o servidor recusa com 503 assim que houver mais de uma clinica');
    conferir('e ele NAO vai para a rota de dentro do CRM', envio.indexOf('/manual') === -1,
      'o site nao tem sessao; a porta dele e a publica');

    /* A frase EXATA da tela de sucesso. A primeira versao desta linha aceitava
     * "contato" -- palavra que aparece na secao inteira -- e passou verde com o
     * formulario sequer enviado. Conferencia frouxa nao mede nada. */
    const textoDepois = await pg.locator('#contato').innerText();
    conferir('depois do 201, a tela de confirmacao aparece',
      /Sua mensagem foi enviada/i.test(textoDepois),
      'o caminho feliz precisa funcionar, senao a conferencia de baixo nao prova nada');
  }

  console.log('\n[2] e quando o servidor RECUSA, a pagina conta -- nao finge que deu certo');
  {
    const pg = await (await navegador.newContext()).newPage();
    await pg.route('**/api/**', async (rota) => {
      const req = rota.request();
      if (req.method() === 'POST' && req.url().includes('/api/leads')) {
        // Exatamente o que a instalacao responde hoje quando falta a chave.
        return rota.fulfill({ status: 503, contentType: 'application/json',
          body: JSON.stringify({ error: 'Cadastro indisponivel no momento.' }) });
      }
      return rota.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await pg.goto(base + '/', { waitUntil: 'networkidle' });
    await pg.locator('#contato').scrollIntoViewIfNeeded();
    const form = pg.locator('form').filter({ hasText: 'Pré-Agendamento' }).first();
    await preencher(form, 'Maria Recusada', '11999997777');
    await form.locator('button[type="submit"]').click();
    await pg.waitForTimeout(1500);

    const texto = await pg.locator('#contato').innerText();
    conferir('a recusa vira mensagem de erro na tela', /não conseguimos|nao conseguimos/i.test(texto),
      'texto visivel: ' + texto.replace(/\s+/g, ' ').slice(0, 120));
    conferir('e a tela de "recebemos seu contato" NAO aparece',
      !/Sua mensagem foi enviada/i.test(texto),
      'ESTE era o defeito: a visitante saia achando que estava pre-agendada e nao havia lead nenhum');
    const aindaTemForm = await form.locator('button[type="submit"]').count();
    conferir('e o formulario continua ali para ela tentar de novo', aindaTemForm > 0,
      'erro que apaga o formulario obriga a pessoa a recomecar do zero');
  }
} finally {
  await navegador.close();
  servidor.close();
}

console.log('\n' + (passou + falhas.length) + ' conferencia(s), ' + falhas.length + ' falha(s)');
if (falhas.length) { console.log('\n>>> PARE: ' + falhas.join(' | ')); process.exit(1); }
console.log('\n>>> a captacao do site esta ligada, e a recusa aparece <<<');

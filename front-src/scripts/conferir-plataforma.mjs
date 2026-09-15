/** A TELA DA PLATAFORMA, NUM NAVEGADOR DE VERDADE (M3.1, 14/09).
 *
 *  ================================================== O QUE SÓ SE VÊ AQUI
 *
 *  O servidor já prova, no ensaio de vazamento, que o operador não alcança dado
 *  de clínica. O que ele **não** consegue provar é a parte que mora no
 *  navegador, e que é onde as duas identidades se atrapalham:
 *
 *   1. **Qual token vai em qual chamada.** O CRM e a plataforma guardam sessões
 *      separadas. Se o interceptador mandar o token do CRM para
 *      `/api/plataforma/*`, a tela nova recebe 403 em tudo; se mandar o da
 *      plataforma para o CRM, o CRM inteiro para. Nenhum teste de servidor vê
 *      isso — do lado de lá chega um cabeçalho, e ele está certo ou errado.
 *
 *   2. **Quem cai quando um 401 acontece.** A regra antiga derrubava "a sessão"
 *      — havia uma só. Com duas, um 401 da plataforma que apagasse o token do
 *      CRM poria a pessoa para fora do consultório por causa de outra aba.
 *
 *  ============================================ COMO ELA NÃO PASSA DE GRAÇA
 *
 *  Cada afirmação tem o irmão que mede o contrário: o token certo é conferido
 *  junto com a AUSÊNCIA do errado; a queda de uma sessão é conferida junto com a
 *  sobrevivência da outra.
 *
 *      node scripts/conferir-plataforma.mjs
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

const TOKEN_FALSO_DA_PLATAFORMA = 'token-de-ensaio-da-plataforma';
const TOKEN_FALSO_DO_CRM = 'token-de-ensaio-do-crm';

const DUAS_CLINICAS = {
  total: 2, ativas: 2,
  clinicas: [
    { id: 'cl_1', nome: 'Dra. Musa Estetica de Elite', status: 'ativa',
      criada_em: '2026-09-04T10:00:00.000Z', chave_captacao: 'cap_da_musa',
      pacientes: 37, acessos: 5, leads: 128, agendamentos: 210, ultimoAgendamento: null },
    { id: 'cl_teste', nome: 'Clinica Teste', status: 'ativa',
      criada_em: '2026-09-11T18:00:00.000Z', chave_captacao: 'cap_da_teste',
      pacientes: 0, acessos: 1, leads: 0, agendamentos: 0, ultimoAgendamento: null }
  ]
};

/** Uma página da plataforma com a API de mentira montada. `aoResponder` decide o
 *  que cada chamada devolve; `chamadas` guarda o que saiu, com os cabeçalhos. */
async function abrirPlataforma(navegador, { tokenDoCrm, aoResponder }) {
  const contexto = await navegador.newContext();
  const pg = await contexto.newPage();
  const chamadas = [];

  await pg.route('**/api/**', async (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname;
    chamadas.push({
      metodo: req.method(),
      caminho,
      autorizacao: req.headers()['authorization'] || ''
    });
    const resposta = aoResponder ? aoResponder(req.method(), caminho) : null;
    if (resposta) return rota.fulfill(resposta);
    return rota.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(DUAS_CLINICAS) });
  });

  // O token do CRM tem de existir ANTES de a aplicação carregar, para medirmos
  // se ele contamina as chamadas da plataforma.
  if (tokenDoCrm) {
    await pg.addInitScript((t) => {
      try { localStorage.setItem('musa_token', t); } catch { /* aba anônima */ }
    }, tokenDoCrm);
  }

  return { pg, chamadas, contexto };
}

const servidor = await servir();
const base = 'http://127.0.0.1:' + servidor.address().port;
const navegador = await chromium.launch();

try {
  console.log('\n[1] sem sessao, a plataforma pede para entrar -- e nao mostra clinica nenhuma');
  {
    const { pg, chamadas } = await abrirPlataforma(navegador, {});
    await pg.goto(base + '/plataforma', { waitUntil: 'networkidle' });
    const texto = await pg.locator('body').innerText();

    conferir('a tela de entrada da plataforma aparece', /Plataforma Musa/i.test(texto),
      'texto: ' + texto.replace(/\s+/g, ' ').slice(0, 90));
    conferir('e ela diz que NAO e a porta do CRM da clinica', /CRM de um consult/i.test(texto),
      'quem trabalha num consultorio nao pode ficar tentando a senha na porta errada');
    conferir('nenhuma clinica e listada antes de entrar', !/Dra\. Musa Estetica/.test(texto),
      'se a lista aparecesse sem credencial, seria a pior rota publica deste projeto');
    conferir('e nem a chamada da lista chega a sair',
      !chamadas.some((c) => c.caminho === '/api/plataforma/clinicas'),
      'chamadas: ' + (chamadas.map((c) => c.caminho).join(', ') || 'nenhuma'));
  }

  console.log('\n[2] ao entrar, o token da plataforma e o que viaja -- e so ele');
  {
    const { pg, chamadas } = await abrirPlataforma(navegador, {
      tokenDoCrm: TOKEN_FALSO_DO_CRM,
      aoResponder: (metodo, caminho) => {
        if (caminho === '/api/plataforma/login') {
          return { status: 200, contentType: 'application/json',
            body: JSON.stringify({ token: TOKEN_FALSO_DA_PLATAFORMA, nome: 'Operadora' }) };
        }
        return null;
      }
    });

    await pg.goto(base + '/plataforma', { waitUntil: 'networkidle' });
    await pg.locator('input[type="email"]').fill('operadora@mulino.invalido');
    await pg.locator('input[type="password"]').fill('uma-senha-qualquer');
    await pg.locator('button[type="submit"]').click();
    await pg.waitForTimeout(1200);

    const entrada = chamadas.filter((c) => c.caminho === '/api/plataforma/login')[0];
    conferir('a entrada acontece', !!entrada, 'nenhum POST de login saiu da tela');
    conferir('e o pedido de entrada NAO leva token nenhum',
      !!entrada && entrada.autorizacao === '',
      'levou: ' + (entrada && entrada.autorizacao) + ' -- pedir um token mandando outro e confuso ' +
      'no melhor caso, e vazamento de credencial entre identidades no pior');

    const lista = chamadas.filter((c) => c.caminho === '/api/plataforma/clinicas')[0];
    conferir('a lista e pedida logo depois', !!lista, 'a tela nao chegou a listar');
    conferir('e ela leva o token DA PLATAFORMA',
      !!lista && lista.autorizacao === 'Bearer ' + TOKEN_FALSO_DA_PLATAFORMA,
      'levou: ' + (lista && lista.autorizacao));
    conferir('e NAO o token do CRM, que estava guardado no mesmo navegador',
      !!lista && lista.autorizacao.indexOf(TOKEN_FALSO_DO_CRM) === -1,
      'este e o irmao que torna a conferencia de cima significativa: havia DOIS tokens no ' +
      'localStorage, e o certo foi escolhido');

    const guardados = await pg.evaluate(() => ({
      plataforma: localStorage.getItem('musa_token_plataforma'),
      crm: localStorage.getItem('musa_token')
    }));
    conferir('o token da plataforma fica na chave dele', guardados.plataforma === TOKEN_FALSO_DA_PLATAFORMA,
      'guardou: ' + guardados.plataforma);
    conferir('e a sessao do CRM continua intacta', guardados.crm === TOKEN_FALSO_DO_CRM,
      'entrar na plataforma nao pode deslogar a pessoa do consultorio dela');

    const texto = await pg.locator('body').innerText();
    conferir('as contagens aparecem na tela', /37/.test(texto) && /128/.test(texto),
      'a Musa da semente tem 37 pacientes e 128 leads');
    conferir('e nenhum nome de paciente aparece junto', !/Maria|Joana/.test(texto),
      'a tela mostra numeros; quem sao elas nao e assunto da plataforma');
  }

  console.log('\n[3] quando a sessao da plataforma cai, e SO ela que cai');
  {
    const { pg } = await abrirPlataforma(navegador, {
      tokenDoCrm: TOKEN_FALSO_DO_CRM,
      aoResponder: (metodo, caminho) => {
        if (caminho === '/api/plataforma/login') {
          return { status: 200, contentType: 'application/json',
            body: JSON.stringify({ token: TOKEN_FALSO_DA_PLATAFORMA, nome: 'Operadora' }) };
        }
        // A sessao expirou entre a entrada e a listagem.
        return { status: 401, contentType: 'application/json',
          body: JSON.stringify({ error: 'Sessao nao autenticada ou expirada.' }) };
      }
    });

    await pg.goto(base + '/plataforma', { waitUntil: 'networkidle' });
    await pg.locator('input[type="email"]').fill('operadora@mulino.invalido');
    await pg.locator('input[type="password"]').fill('uma-senha-qualquer');
    await pg.locator('button[type="submit"]').click();
    await pg.waitForTimeout(1200);

    const guardados = await pg.evaluate(() => ({
      plataforma: localStorage.getItem('musa_token_plataforma'),
      crm: localStorage.getItem('musa_token')
    }));
    conferir('o token da plataforma e descartado', !guardados.plataforma,
      'sobrou: ' + guardados.plataforma + ' -- sessao morta guardada faz a tela tentar de novo ' +
      'a cada abertura, e falhar igual');
    conferir('e o do CRM NAO e tocado', guardados.crm === TOKEN_FALSO_DO_CRM,
      'ESTE era o risco de ter duas sessoes: um 401 da plataforma poria a pessoa para fora do ' +
      'consultorio dela, por causa de outra aba');

    const texto = await pg.locator('body').innerText();
    conferir('e a tela volta para a entrada, em vez de ficar vazia', /Plataforma Musa/i.test(texto),
      'texto: ' + texto.replace(/\s+/g, ' ').slice(0, 90));
  }
  console.log('\n[4] em modo suporte, o CRM usa o token de suporte -- e a sessao da clinica fica');
  {
    const contexto = await navegador.newContext();
    const pg = await contexto.newPage();
    const chamadas = [];
    await pg.addInitScript(() => {
      try {
        /* Tokens com carga decodificavel: o front LE o papel de dentro deles
         * (`papelDoToken`), entao uma string qualquer faria o guarda de rota
         * mandar a pagina para /login e nenhuma chamada sairia -- foi o que
         * aconteceu na primeira versao desta conferencia. */
        localStorage.setItem('musa_token', 'eyJhbGciOiAibm9uZSIsICJ0eXAiOiAiSldUIn0.eyJwYXBlbCI6ICJhZG1pbiIsICJjbGluaWNhSWQiOiAiY2xfMSIsICJub21lIjogIlNpbHZpYSIsICJleHAiOiAxNzg5NDgyMzkwfQ.assinatura-de-mentira');
        localStorage.setItem('musa_token_suporte', 'eyJhbGciOiAibm9uZSIsICJ0eXAiOiAiSldUIn0.eyJwYXBlbCI6ICJzdXBvcnRlIiwgImNsaW5pY2FJZCI6ICJjbF90ZXN0ZSIsICJzdXBvcnRlIjogdHJ1ZSwgIm5vbWUiOiAiT3BlcmFkb3JhIiwgImV4cCI6IDE3ODk0ODIzOTB9.assinatura-de-mentira');
        localStorage.setItem('musa_modo_suporte',
          JSON.stringify({ clinica: 'Clinica Teste', expiraEm: '2030-01-01T00:00:00.000Z' }));
      } catch { /* aba anônima */ }
    });
    await pg.route('**/api/**', async (rota) => {
      const req = rota.request();
      chamadas.push({ caminho: new URL(req.url()).pathname,
                      autorizacao: req.headers()['authorization'] || '' });
      return rota.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await pg.goto(base + '/crm', { waitUntil: 'networkidle' });
    await pg.waitForTimeout(800);

    const texto = await pg.locator('body').innerText();
    conferir('a faixa de modo suporte aparece', /modo suporte/i.test(texto),
      'sessao de leitura sem aviso faz quem da suporte achar que o sistema quebrou ao salvar');
    conferir('e ela diz que o prontuario esta fora', /sem ficha de paciente/i.test(texto),
      'texto: ' + texto.replace(/\s+/g, ' ').slice(0, 120));

    const deClinica = chamadas.filter((c) => c.caminho.indexOf('/api/plataforma/') !== 0);
    conferir('o CRM chegou a chamar a API', deClinica.length > 0,
      'sem chamada, as duas conferencias abaixo passariam sem medir nada');
    conferir('e as chamadas de clinica levam o token de SUPORTE',
      deClinica.every((c) => c.autorizacao === 'Bearer ' + 'eyJhbGciOiAibm9uZSIsICJ0eXAiOiAiSldUIn0.eyJwYXBlbCI6ICJzdXBvcnRlIiwgImNsaW5pY2FJZCI6ICJjbF90ZXN0ZSIsICJzdXBvcnRlIjogdHJ1ZSwgIm5vbWUiOiAiT3BlcmFkb3JhIiwgImV4cCI6IDE3ODk0ODIzOTB9.assinatura-de-mentira'),
      'levaram: ' + [...new Set(deClinica.map((c) => c.autorizacao))].join(' | '));

    const guardados = await pg.evaluate(() => localStorage.getItem('musa_token'));
    conferir('e a sessao da clinica continua guardada, intacta', guardados === 'eyJhbGciOiAibm9uZSIsICJ0eXAiOiAiSldUIn0.eyJwYXBlbCI6ICJhZG1pbiIsICJjbGluaWNhSWQiOiAiY2xfMSIsICJub21lIjogIlNpbHZpYSIsICJleHAiOiAxNzg5NDgyMzkwfQ.assinatura-de-mentira',
      'entrar em suporte nao pode deslogar quem e das duas coisas -- e a dona da Mulino e');
  }

} finally {
  await navegador.close();
  servidor.close();
}

console.log('\n' + (passou + falhas.length) + ' conferencia(s), ' + falhas.length + ' falha(s)');
if (falhas.length) { console.log('\n>>> PARE: ' + falhas.join(' | ')); process.exit(1); }
console.log('\n>>> as duas sessoes convivem, e cada token vai para a porta dele <<<');

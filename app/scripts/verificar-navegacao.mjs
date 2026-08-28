/**
 * Verificacao de navegacao do front.
 *
 * Roda um navegador de verdade sobre o dist compilado e confere o que teste de
 * unidade nao pega: se o site publico deixou de baixar o console, se cada aba
 * abre sem erro, se quem nao tem token cai no login, se vendedor e profissional
 * nao veem preco nem financeiro, se a calculadora mostra os 237,62 do caso de
 * referencia, e se competencia e caixa aparecem como numeros DIFERENTES.
 *
 * Nao e dependencia do projeto. Para rodar:
 *   npm run build
 *   npx serve -s dist -l 4173     (ou qualquer servidor com fallback de SPA)
 *   npm i --no-save playwright && npx playwright install chromium
 *   node scripts/verificar-navegacao.mjs
 *
 * As telas conversam com a API real; para rodar contra dados de fixture, use o
 * servidor de simulacao do ambiente de desenvolvimento.
 *
 * O token usado aqui e falso de proposito: papelDoToken() so decodifica o
 * payload no navegador. O servidor continua validando assinatura.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:4173';

// Token so para o front: papelDoToken() apenas decodifica o payload.
// O servidor real continua validando assinatura - isto nao abre nada.
function tokenFalso(papel) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: 'u1', nome: 'Teste', papel, exp }) + '.assinatura';
}

const nav = await chromium.launch({ args: ['--no-sandbox'] });

async function novaAba(papel) {
  const ctx = await nav.newContext();
  if (papel) {
    await ctx.addInitScript((t) => localStorage.setItem('musa_token', t), tokenFalso(papel));
  }
  const pg = await ctx.newPage();
  pg.baixados = [];
  pg.erros = [];
  pg.on('response', async (r) => {
    if (r.url().endsWith('.js')) {
      let t = 0;
      try { t = (await r.body()).length; } catch { }
      pg.baixados.push({ nome: r.url().split('/').pop(), kb: Math.round(t / 1024) });
    }
  });
  pg.on('pageerror', (e) => pg.erros.push(String(e)));
  return pg;
}

// Atencao ao comparar dinheiro: toLocaleString('pt-BR', {style:'currency'})
// separa "R$" do numero com espaco NAO-QUEBRAVEL (U+00A0). Comparar com
// 'R$ 400,00' digitado no teclado falha em silencio - use /R\$\s*400,00/.
const kb = (pg) => pg.baixados.reduce((a, b) => a + b.kb, 0);
let falhas = 0;
function conferir(rotulo, ok, detalhe) {
  if (!ok) falhas++;
  console.log((ok ? '  ok    ' : '  FALHA ') + rotulo + (detalhe ? '  ->  ' + detalhe : ''));
}

// ---------------------------------------------------------------- visitante
console.log('\n[A] Visitante do site publico');
{
  const pg = await novaAba(null);
  await pg.goto(BASE + '/', { waitUntil: 'networkidle' });
  const temCrm = pg.baixados.some((a) => /CrmDashboard|Pacientes|VisaoGeral|Atendimento/.test(a.nome));
  conferir('site carrega', (await pg.title()).includes('Musa'));
  conferir('nao baixa o console', !temCrm, pg.baixados.map((a) => a.nome + ' ' + a.kb + 'kB').join(', '));
  conferir('peso do JS abaixo de 400 kB', kb(pg) < 400, kb(pg) + ' kB');
  conferir('sem erro de pagina', pg.erros.length === 0, pg.erros.join(' | '));
  await pg.context().close();
}

// ------------------------------------------------------------ sem sessao
console.log('\n[B] Sem sessao');
{
  const pg = await novaAba(null);
  await pg.goto(BASE + '/crm/pacientes', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(500);
  conferir('/crm/pacientes manda para o login', pg.url().endsWith('/login'), pg.url());
  conferir('formulario aparece', (await pg.locator('text=Desbloquear painel').count()) > 0);
  await pg.context().close();
}

// --------------------------------------------------------------- admin
console.log('\n[C] Sessao de admin');
{
  const pg = await novaAba('admin');
  await pg.goto(BASE + '/crm', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1200);
  conferir('fica em /crm', pg.url().endsWith('/crm'), pg.url());
  const abas = await pg.locator('header nav a').allInnerTexts();
  conferir('barra com as abas de admin', abas.length === 10, abas.length + ': ' + abas.join(' | '));
  conferir('botao Sair presente', (await pg.locator('button:has-text("Sair")').count()) > 0);

  const rotas = [
    ['Funil & Leads', '/crm/funil'],
    ['Pacientes', '/crm/pacientes'],
    ['Atendimento', '/crm/atendimento'],
    ['Integração WhatsApp', '/crm/whatsapp'],
    ['Cadastros', '/crm/cadastros'],
    ['Logs do Sistema', '/crm/logs'],
    ['Visão Geral', '/crm'],
  ];
  for (const [rotulo, esperada] of rotas) {
    pg.erros.length = 0;
    await pg.locator('header nav a', { hasText: rotulo }).first().click();
    await pg.waitForTimeout(900);
    const texto = (await pg.locator('body').innerText()).trim();
    conferir(
      'aba "' + rotulo + '"',
      pg.url().endsWith(esperada) && pg.erros.length === 0 && texto.length > 200,
      pg.url() + ' texto=' + texto.length + (pg.erros.length ? ' erros: ' + pg.erros.join(' | ') : ''),
    );
  }

  await pg.goBack();
  await pg.waitForTimeout(600);
  conferir('voltar do navegador funciona', pg.url().endsWith('/crm/logs'), pg.url());
  await pg.context().close();
}

// ------------------------------------------------------------- vendedor
console.log('\n[D] Sessao de vendedor');
{
  const pg = await novaAba('vendedor');
  await pg.goto(BASE + '/crm', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1000);
  const abas = await pg.locator('header nav a').allInnerTexts();
  conferir('ve so 3 abas', abas.length === 3, abas.length + ': ' + abas.join(' | '));
  conferir('nao ve Logs', !abas.join('|').includes('Logs'));
  conferir('nao ve Usuarios', !abas.join('|').includes('Usuár'));
  await pg.context().close();
}

// -------------------------------------------------------- sessao expirada
console.log('\n[E] Sessao expirada');
{
  const pg = await novaAba('admin');
  await pg.goto(BASE + '/crm/pacientes', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(900);
  // Reproduz o que o interceptador de lib/api.ts faz ao receber 401:
  // limpa o token e so entao avisa.
  await pg.evaluate(() => {
    localStorage.removeItem('musa_token');
    window.dispatchEvent(new CustomEvent('musa:sessao-expirada'));
  });
  await pg.waitForTimeout(700);
  conferir('vai para o login com aviso', pg.url().includes('/login?expirada=1'), pg.url());
  conferir('aviso visivel', (await pg.locator('text=Sua sessao expirou').count()) > 0);
  conferir('guarda o destino', decodeURIComponent(pg.url()).includes('destino=/crm/pacientes'), pg.url());
  await pg.context().close();
}

// ------------------------------------------------------------- usuarios
console.log('\n[F] Tela de usuarios');
{
  const pg = await novaAba('admin');
  await pg.goto(BASE + '/crm/usuarios', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1200);
  conferir('rota abre', pg.url().endsWith('/crm/usuarios'), pg.url());
  const linhas = await pg.locator('tbody tr').count();
  conferir('lista as 3 contas', linhas === 3, String(linhas));
  const corpo = await pg.locator('body').innerText();
  conferir('mostra e-mails', corpo.includes('silvia@inpyx.com') && corpo.includes('rodrigo@inpyx.com'));
  conferir('mostra "2 administradores ativos"', corpo.includes('2 administrador'), corpo.slice(0, 0) || 'ver texto');
  conferir('conta inativa aparece como inativa', /inativ/i.test(corpo));
  conferir('botao de novo usuario existe', (await pg.locator('button:has-text("Novo usuário")').count()) > 0);
  conferir('sem erro de pagina', pg.erros.length === 0, pg.erros.join(' | '));
  await pg.context().close();
}

console.log('\n[G] Vendedor tentando /crm/usuarios pela URL');
{
  const pg = await novaAba('vendedor');
  await pg.goto(BASE + '/crm/usuarios', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(900);
  conferir('e devolvido para /crm', pg.url().endsWith('/crm'), pg.url());
  await pg.context().close();
}

// ---------------------------------------------------------- precificacao
console.log('\n[H] Calculadora de preco');
{
  const pg = await novaAba('admin');
  await pg.goto(BASE + '/crm/precificacao', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1500);
  conferir('rota abre', pg.url().endsWith('/crm/precificacao'), pg.url());

  // O caso de referencia, ponta a ponta: escolher o servico de 60 min com
  // R$ 45 de insumo tem de mostrar 237,62 na tela.
  await pg.selectOption('select', { label: 'Limpeza de Pele Premium' });
  await pg.waitForTimeout(1400);
  const corpo = await pg.locator('body').innerText();

  conferir('preco sugerido 237,62 na tela', corpo.includes('237,62'), corpo.match(/R\$\s*[\d.,]+/g)?.slice(0, 6).join(' | '));
  conferir('lucro liquido 71,29', corpo.includes('71,29'));
  conferir('custo por hora 75,00', corpo.includes('75,00'));
  conferir('texto do dinheiro na mesa', /deixando/i.test(corpo) && corpo.includes('57,62'));
  conferir('sem erro de pagina', pg.erros.length === 0, pg.erros.join(' | '));

  // Margem maior tem de subir o preco - e a prova de que recalcula ao vivo.
  // Localizar pelo rotulo, nao por indice: nth() muda de significado quando o
  // formulario ganha um campo, e o teste passa a medir outra coisa em silencio.
  const margem = pg.locator('label:text-is("Margem (%)") + input');
  await margem.fill('50');
  await pg.waitForTimeout(1300);
  const depois = await pg.locator('body').innerText();
  // 120 / (1 - 0,695) = 393,44
  conferir('mudar a margem recalcula sozinho', !depois.includes('237,62') && depois.includes('393,44'),
    depois.match(/R\$\s*[\d.,]+/g)?.slice(0, 4).join(' | '));

  // Guarda: soma dos percentuais em 100% nao pode mostrar preco.
  await margem.fill('90');
  await pg.waitForTimeout(1200);
  const estourado = await pg.locator('body').innerText();
  conferir('percentuais acima de 100% viram aviso, nao preco',
    /menor que 100%/.test(estourado), estourado.slice(0, 0) || 'ver aviso');

  await pg.context().close();
}

console.log('\n[I] Duracao ambigua no catalogo');
{
  const pg = await novaAba('admin');
  await pg.goto(BASE + '/crm/precificacao', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1400);
  await pg.selectOption('select', { label: 'Ultraformer MPT' });
  await pg.waitForTimeout(1200);
  const corpo = await pg.locator('body').innerText();
  conferir('pede a duracao em vez de chutar', /cadastrada como texto/.test(corpo));
  conferir('nao inventa preco sem duracao', !/Pre.o sugerido[\s\S]{0,40}R\$\s*\d/.test(corpo) || /Informe a dura/.test(corpo));
  await pg.context().close();
}

console.log('\n[J] Vendedor nao ve precificacao');
{
  const pg = await novaAba('vendedor');
  await pg.goto(BASE + '/crm/precificacao', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(900);
  conferir('e devolvido para /crm', pg.url().endsWith('/crm'), pg.url());
  const abas = await pg.locator('header nav a').allInnerTexts();
  conferir('aba nao aparece para vendedor', !abas.join('|').includes('Precifica'), abas.join(' | '));
  await pg.context().close();
}

// ----------------------------------------------------------- financeiro
console.log('\n[K] Financeiro: competencia x caixa');
{
  const pg = await novaAba('admin');
  await pg.goto(BASE + '/crm/financeiro', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1500);
  conferir('rota abre', pg.url().endsWith('/crm/financeiro'), pg.url());

  // Periodo do cenario conferido a mao: marco/2026.
  await pg.locator('input[type="date"]').first().fill('2026-03-01');
  await pg.locator('input[type="date"]').nth(1).fill('2026-03-31');
  await pg.waitForTimeout(1400);

  const comp = await pg.locator('body').innerText();
  conferir('competencia: receita 1.500,00', comp.includes('1.500,00'));
  conferir('competencia: despesa 1.100,00', comp.includes('1.100,00'));
  conferir('competencia: resultado 400,00', /R\$\s*400,00/.test(comp));
  conferir('rotula a base na tela', /por compet/i.test(comp));
  conferir('contas a pagar em destaque', comp.includes('1.000,00') && /vencido/i.test(comp));
  conferir('sem erro de pagina', pg.erros.length === 0, pg.erros.join(' | '));

  // A mesma tela, o outro criterio: numeros diferentes, os dois certos.
  await pg.locator('button:has-text("Caixa")').first().click();
  await pg.waitForTimeout(1400);
  const caixa = await pg.locator('body').innerText();
  conferir('caixa: receita 1.000,00', caixa.includes('1.000,00'));
  conferir('caixa: resultado 700,00', /R\$\s*700,00/.test(caixa));
  conferir('caixa NAO repete o resultado da competencia', !/R\$\s*400,00/.test(caixa));
  conferir('rotula a base trocada', /por caixa/i.test(caixa));

  await pg.context().close();
}

console.log('\n[L] Financeiro: lancamentos e recorrentes');
{
  const pg = await novaAba('admin');
  await pg.goto(BASE + '/crm/financeiro', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1300);
  await pg.locator('input[type="date"]').first().fill('2026-03-01');
  await pg.locator('input[type="date"]').nth(1).fill('2026-03-31');
  await pg.waitForTimeout(900);

  await pg.locator('button:has-text("Lançamentos")').first().click();
  await pg.waitForTimeout(1200);
  const linhas = await pg.locator('tbody tr').count();
  // Marco por competencia tem 4: duas receitas e duas despesas. A quinta linha
  // do razao e de fevereiro e nao pode aparecer aqui.
  conferir('lista os 4 lancamentos de marco', linhas === 4, String(linhas));
  const semFevereiro = !(await pg.locator('body').innerText()).includes('Luvas e descartaveis');
  conferir('nao vaza lancamento de fora do periodo', semFevereiro);
  const texto = await pg.locator('body').innerText();
  conferir('receita com sinal de mais', /\+\s*R\$\s*1\.000,00/.test(texto));
  conferir('despesa com sinal de menos', /−\s*R\$\s*300,00/.test(texto));
  conferir('marca o que esta em aberto', /em aberto/i.test(texto));

  await pg.locator('button:has-text("Recorrentes")').first().click();
  await pg.waitForTimeout(1000);
  const rec = await pg.locator('body').innerText();
  conferir('recorrente aparece com o dia do mes', /todo dia 10/.test(rec), rec.slice(0, 0) || 'ver texto');
  conferir('avisa que gerar duas vezes nao duplica', /n.o duplica/i.test(rec));
  conferir('sem erro de pagina', pg.erros.length === 0, pg.erros.join(' | '));
  await pg.context().close();
}

console.log('\n[M] Vendedor nao ve financeiro');
{
  const pg = await novaAba('vendedor');
  await pg.goto(BASE + '/crm/financeiro', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(900);
  conferir('e devolvido para /crm', pg.url().endsWith('/crm'), pg.url());
  const abas = await pg.locator('header nav a').allInnerTexts();
  conferir('aba nao aparece para vendedor', !abas.join('|').includes('Financeiro'), abas.join(' | '));
  await pg.context().close();
}

await nav.close();
console.log('\n' + (falhas === 0 ? '>>> TUDO PASSOU <<<' : '>>> ' + falhas + ' FALHA(S) <<<'));
process.exit(falhas === 0 ? 0 : 1);

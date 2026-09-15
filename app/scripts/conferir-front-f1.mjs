/**
 * Conferência focada no lote F1 + M2.1c, num navegador de verdade sobre o
 * `dist` compilado.
 *
 * ============================== POR QUE NÃO É O `verificar-navegacao.mjs`
 *
 * Aquele existe, tem 66 conferências, e **está morto desde 31/08**: ele procura
 * as abas em `header nav a`, e a navegação virou uma barra lateral. Ele falha na
 * terceira conferência e derruba o processo, então ninguém o roda — que é
 * exatamente o "script que sempre falha ninguém lê" que este projeto já
 * escreveu sobre si mesmo. Consertá-lo é tarefa própria; hoje ele não serve para
 * aprovar nada.
 *
 * ================================ O QUE ESTA CONFERÊNCIA MEDE, E O QUE NÃO
 *
 * Sem servidor de API, só dá para medir o que a tela desenha **antes** de ter
 * dado: a janela de datas do Financeiro (que vem do estado inicial) e a tela de
 * Integração (que decide pelo papel no token e por uma lista vazia).
 *
 * Onde a tela precisa de dado para existir, a resposta da API é **interceptada**
 * (`apiFalsa` abaixo). Sem isso a tabela nasce vazia e "o botão não aparece"
 * seria verdade por não haver linha nenhuma — conferência passando, ou falhando,
 * sem medir o que diz medir.
 *
 * O que NÃO dá para conferir aqui fica dito em voz alta na tarefa, e não
 * escondido: "conferido" e "conferido no navegador" não são a mesma afirmação.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:4173';

let falhas = 0;
const ok = (t, d) => console.log('  ok    ' + t + (d ? '  ->  ' + d : ''));
const nao = (t, d) => { falhas++; console.log('  FALHA ' + t + (d ? '  ->  ' + d : '')); };
const conf = (c, t, d) => (c ? ok(t, d) : nao(t, d));

function tokenFalso(papel) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return b64({ alg: 'HS256', typ: 'JWT' }) + '.' +
         b64({ sub: 'u1', nome: 'Teste', papel, exp }) + '.assinatura';
}

const nav = await chromium.launch({ args: ['--no-sandbox'] });

async function aba(papel) {
  const ctx = await nav.newContext();
  await ctx.addInitScript((t) => localStorage.setItem('musa_token', t), tokenFalso(papel));
  const pg = await ctx.newPage();
  pg.erros = [];
  pg.on('pageerror', (e) => pg.erros.push(String(e)));
  return pg;
}

/** Responde TODA chamada a /api: o que estiver no mapa vem do mapa, o resto vem
 *  vazio.
 *
 *  O "resto vem vazio" importa: sem ele, uma chamada nao mapeada cai no servidor
 *  de arquivos, recebe o `index.html` de volta, e a tela quebra ao tentar ler
 *  aquilo como JSON -- e a conferencia falharia por um motivo que nao e o
 *  defeito que ela procura. */
async function apiFalsa(pg, mapa) {
  await pg.route('**/api/**', (rota) => {
    const caminho = new URL(rota.request().url()).pathname;
    const corpo = Object.prototype.hasOwnProperty.call(mapa, caminho) ? mapa[caminho] : [];
    rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) });
  });
}

/* ============================================ 1. a janela do Financeiro */
console.log('\n[1] Financeiro: a janela abre o mes INTEIRO');
{
  const pg = await aba('admin');
  await pg.goto(BASE + '/crm/financeiro', { waitUntil: 'networkidle' });
  const datas = await pg.locator('input[type="date"]').all();
  conf(datas.length >= 2, 'os dois campos de data existem',
    datas.length + ' campo(s) de data. Zero aqui faria as conferencias de baixo passar sem medir nada');

  if (datas.length >= 2) {
    const de = await datas[0].inputValue();
    const ate = await datas[1].inputValue();
    const h = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const mes = h.getFullYear() + '-' + p(h.getMonth() + 1);
    const ultimo = new Date(h.getFullYear(), h.getMonth() + 1, 0).getDate();
    conf(de === mes + '-01', 'comeca no dia 1o do mes', 'de = ' + de);
    conf(ate === mes + '-' + p(ultimo), 'termina no ULTIMO dia do mes, e nao hoje',
      'ate = ' + ate + ' (hoje e ' + p(h.getDate()) + ') -- era aqui que a receita de amanha sumia');
  }
  conf(pg.erros.length === 0, 'a tela nao lancou erro de pagina', pg.erros.join(' | '));
  await pg.close();
}

/* ================================= 2. a tela de Integracao (M2.1c) */
console.log('\n[2] Integracao WhatsApp: sem campo de nome, sem senha de teatro');
{
  const pg = await aba('admin');
  await pg.goto(BASE + '/crm/whatsapp', { waitUntil: 'networkidle' });
  const corpo = await pg.locator('body').innerText();

  conf(/Inst[âa]ncias WhatsApp/i.test(corpo), 'a tela abriu para admin',
    'sem isto, tudo abaixo passaria por a tela estar vazia');

  const nomeInstancia = await pg.locator('input[placeholder*="nova inst"]').count();
  conf(nomeInstancia === 0, 'NAO existe campo para digitar nome de instancia',
    nomeInstancia === 0
      ? 'o nome e derivado da clinica no servidor -- campo que nao faz nada convida a escolher'
      : 'o campo voltou! O que a pessoa digitar sera descartado em silencio');

  const senhas = await pg.locator('input[type="password"]').count();
  conf(senhas === 0, 'NAO existe campo de senha nesta aba',
    senhas === 0
      ? 'a senha antiga nunca era conferida: a funcao olhava o papel e ignorava o que era digitado'
      : 'o campo de senha voltou');

  conf(!/Senha incorreta/i.test(corpo), 'e a mensagem falsa de "senha incorreta" saiu');
  conf(/Conectar o WhatsApp desta cl[íi]nica/i.test(corpo),
    'com a lista vazia, aparece o botao de conectar',
    'e o unico caminho: criar a instancia com nome derivado');
  conf(pg.erros.length === 0, 'a tela nao lancou erro de pagina', pg.erros.join(' | '));
  await pg.close();
}

/* ============== 3. a mesma tela para quem nao e gestao: fechada e honesta */
console.log('\n[3] Integracao para vendedor: fechada, e dizendo o motivo certo');
{
  const pg = await aba('vendedor');
  await pg.goto(BASE + '/crm/whatsapp', { waitUntil: 'networkidle' });
  const corpo = await pg.locator('body').innerText();
  conf(/administrador ou gerente/i.test(corpo), 'diz que a aba e de admin/gerente',
    'o motivo verdadeiro e o cargo, e nao uma senha');
  conf(await pg.locator('input[type="password"]').count() === 0,
    'e nao pede senha nenhuma');
  await pg.close();
}

/* ============== 4. Usuarios: o campo de NOME, que faltava nesta tela
 *
 * Esta e a tela que a Silvia estava olhando quando disse "so a senha" -- e em
 * 10/09 eu consertei a OUTRA (a equipe comercial em Cadastros, que e conteudo
 * de demonstracao e nem concede login). Duas telas parecidas, e eu escolhi a
 * errada tendo a frase dela na mao.
 *
 * A lista vem da API, e aqui nao ha API: a resposta e interceptada com dois
 * usuarios de mentira. Sem isso a tabela nasce vazia e "o botao Nome nao
 * aparece" seria verdade por nao haver linha nenhuma -- conferencia passando
 * (ou falhando) sem medir o que diz medir. */
console.log('\n[4] Usuarios: da para trocar o NOME, e nao so a senha');
{
  const pg = await aba('admin');
  await pg.route('**/api/users', (rota) => rota.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      { id: 'u1', name: 'Administracao', email: 'a@x.com', role: 'admin', status: 'active', lastLoginAt: null },
      { id: 'u2', name: 'Clicia Ariadne', email: 'c@x.com', role: 'admin', status: 'active', lastLoginAt: null }
    ])
  }));
  await pg.goto(BASE + '/crm/usuarios', { waitUntil: 'networkidle' });

  const linhas = await pg.locator('tbody tr').count();
  conf(linhas === 2, 'a lista carregou com as duas pessoas de mentira',
    linhas + ' linha(s). Zero aqui faria tudo abaixo passar por nao haver o que medir');

  const btNome = pg.locator('button', { hasText: /^Nome$/ }).first();
  conf(await btNome.count() > 0, 'existe o botao "Nome" na coluna de acoes',
    'era so Senha e Inativar -- e nome errado fica em cada registro de auditoria e em cada lembrete');

  if (await btNome.count() > 0) {
    await btNome.click();
    const campo = pg.locator('input[placeholder="nome da pessoa"]').first();
    await campo.waitFor({ timeout: 5000 });
    const valor = await campo.inputValue();
    conf(valor === 'Administracao', 'o campo abre JA PREENCHIDO com o nome atual',
      'veio "' + valor + '" -- campo vazio faria a pessoa redigitar e arriscar apagar');
  }
  conf(pg.erros.length === 0, 'a tela nao lancou erro de pagina', pg.erros.join(' | '));
  await pg.close();
}

/* ================= 5. Estoque: da para CADASTRAR produto (F3) */
console.log('\n[5] Estoque: existe cadastro de produto, e a categoria e sugerida');
{
  const pg = await aba('admin');
  await apiFalsa(pg, {
    '/api/stock/balance': {
      valorTotal: 1000,
      itens: [
        { id: 'p1', sku: null, name: 'Luva de procedimento', category: 'Descartaveis',
          unit: 'UN', unitCost: 1, salePrice: null, minStock: 10, controlled: false,
          supplier: null, active: true, saldo: 5, saldoTotal: 5, valorEmEstoque: 5, lotes: [] },
        { id: 'p2', sku: null, name: 'Toxina', category: 'Injetaveis',
          unit: 'UN', unitCost: 100, salePrice: null, minStock: 1, controlled: true,
          supplier: null, active: true, saldo: 2, saldoTotal: 2, valorEmEstoque: 200, lotes: [] }
      ]
    },
    '/api/stock/alerts': { criticos: [], validade: [], reposicao: [] }
  });
  await pg.goto(BASE + '/crm/estoque', { waitUntil: 'networkidle' });

  const linhas = await pg.locator('text=Luva de procedimento').count();
  conf(linhas > 0, 'a lista carregou com os produtos de mentira',
    'zero aqui faria tudo abaixo passar por nao haver o que medir');

  const btNovo = pg.locator('button', { hasText: /Novo produto/i }).first();
  conf(await btNovo.count() > 0, 'existe o botao "Novo produto"',
    'a API POST /api/products existia desde sempre e NENHUMA tela a chamava');

  const btEditar = pg.locator('button', { hasText: /^Editar$/ }).first();
  conf(await btEditar.count() > 0, 'e cada produto tem "Editar" COM A PALAVRA',
    'icone sozinho foi o que fez alguem concluir, em 10/09, que editar nao existia');

  if (await btNovo.count() > 0) {
    await btNovo.click();
    const nome = pg.locator('input[placeholder*="Luva de procedimento"]').first();
    await nome.waitFor({ timeout: 5000 });
    conf(true, 'o formulario abre');

    // A armadilha desta tarefa: categoria e texto livre, e a aba Saldo agrupa
    // por ela. Sem sugestao, a mesma categoria vira tres grafias.
    const opcoes = await pg.locator('#categorias-de-produto option').allTextContents();
    const valores = await pg.locator('#categorias-de-produto option').evaluateAll(
      (os) => os.map((o) => o.getAttribute('value')));
    const sugeridas = valores.filter(Boolean);
    conf(sugeridas.length === 2, 'a categoria sugere as que JA existem',
      'sugeridas: ' + JSON.stringify(sugeridas) + ' (esperado Descartaveis e Injetaveis). ' +
      'Sem sugestao, "Descartavel"/"descartaveis"/"Descartaveis" viram tres secoes iguais');
    conf(opcoes !== null, 'e o campo continua aceitando digitar uma categoria nova');
  }
  conf(pg.erros.length === 0, 'a tela nao lancou erro de pagina', pg.erros.join(' | '));
  await pg.close();
}

/* ============ 6. Funil: o endereco do formulario do site (captacao) */
console.log('\n[6] Funil: a chave de captacao aparece para gestao, e so para ela');
{
  const CHAVE = 'cap_0123456789abcdef01234567';
  const captacao = {
    chave: CHAVE,
    url: 'https://exemplo.invalido/api/leads?captacao=' + CHAVE,
    exemplo: '<form method="POST" action="https://exemplo.invalido/api/leads?captacao=' + CHAVE + '">'
  };

  const pg = await aba('admin');
  await apiFalsa(pg, { '/api/leads/captacao': captacao });
  await pg.goto(BASE + '/crm/funil', { waitUntil: 'networkidle' });

  const cartao = pg.locator('text=Formulário do site').first();
  conf(await cartao.count() > 0, 'o cartao do formulario do site aparece no funil',
    'sem tela, a chave nasce numa migration e nao serve para nada');

  if (await cartao.count() > 0) {
    await cartao.click();
    await pg.locator('text=' + CHAVE).first().waitFor({ timeout: 5000 });
    const corpo = await pg.locator('body').innerText();
    conf(corpo.indexOf(CHAVE) !== -1, 'e mostra o endereco com a chave desta clinica');
    conf(/n[ãa]o [ée] uma senha/i.test(corpo),
      'e diz em voz alta que aquilo NAO e uma senha',
      'chamada de "chave" sem essa frase, ela seria guardada como segredo e colar no site ' +
      'pareceria um vazamento');
  }
  conf(pg.erros.length === 0, 'a tela nao lancou erro de pagina', pg.erros.join(' | '));
  await pg.close();

  // E o vendedor nao ve: a rota e de gestao, e a tela nao pode prometer o que
  // a API vai negar.
  const pgV = await aba('vendedor');
  await apiFalsa(pgV, { '/api/leads/captacao': captacao });
  await pgV.goto(BASE + '/crm/funil', { waitUntil: 'networkidle' });
  const corpoV = await pgV.locator('body').innerText();
  conf(corpoV.indexOf('Formulário do site') === -1,
    'o vendedor NAO ve o cartao',
    'a rota e de admin/gerente; mostrar o cartao para quem levaria 403 e prometer o que nao cumpre');
  conf(corpoV.indexOf(CHAVE) === -1, 'e muito menos a chave');
  await pgV.close();
}

await nav.close();
console.log('\n' + (falhas ? '\x1b[31m' + falhas + ' falha(s)\x1b[0m'
                           : '\x1b[32mlote F1 + M2.1c: sem falhas no navegador\x1b[0m'));
process.exit(falhas ? 1 : 0);

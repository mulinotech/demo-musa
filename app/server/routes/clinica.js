'use strict';
/** O timbre da clínica — o cabeçalho e o rodapé de todo documento impresso.
 *
 *  ==================================== POR QUE É UM MÓDULO SÓ PARA TRÊS CAMPOS
 *
 *  Endereço, telefone e contato são a única coisa que a clínica edita na
 *  **própria linha** de `clinicas`. Tudo o mais naquela tabela — status, chave
 *  de captação, instância de WhatsApp — é decisão da plataforma ou tem tela
 *  própria, e nenhum deles pode ser alcançado por uma rota de "editar a minha
 *  clínica" que aceite o que vier no corpo.
 *
 *  Por isso a gravação passa por `db.atualizarMinhaClinica`, que tem a lista de
 *  colunas fechada dentro da camada: o `id` vem da sessão e o conjunto de campos
 *  vem do escopo, nunca de quem chama.
 *
 *  ============================================ QUEM LÊ E QUEM ESCREVE, E POR QUÊ
 *
 *  Escrever é de `admin` e `gerente` (tabela de papéis). **Ler é de todo papel
 *  autenticado**, e isso é deliberado: a profissional precisa ver o timbre que
 *  vai sair impresso ANTES de escrever a receita inteira, e o painel de emissão
 *  lê justamente daqui. Endereço de clínica não é dado sensível — está no site
 *  dela e na porta.
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');
const logs = require('../services/logs');
const timbreLogo = require('../services/timbre-logo');

function paraTela(c) {
  return {
    nome: (c && c.nome) || '',
    documento: (c && c.documento) || '',
    endereco: (c && c.endereco) || '',
    telefone: (c && c.telefone) || '',
    email: (c && c.email) || '',
    contato: (c && c.contato) || '',
    // O logo vem na mesma resposta do resto do timbre, e não numa rota própria:
    // quem lê o timbre lê para DESENHAR o cabeçalho, e um cabeçalho montado em
    // duas chamadas pisca sem a marca antes de piscar com ela.
    logo: (c && c.logo) || null
  };
}

router.get('/api/clinica', async function (req, res) {
  try {
    const c = await escopo(req).minhaClinica();
    if (!c) return res.status(404).json({ error: 'Clinica nao encontrada.' });
    res.json(paraTela(c));
  } catch (e) {
    console.error('[clinica]', e && e.message);
    res.status(500).json({ error: 'Falha ao ler os dados da clinica.' });
  }
});

router.patch('/api/clinica', express.json({ limit: '1mb' }), async function (req, res) {
  const db = escopo(req);
  const b = req.body || {};
  const campos = {};
  // O NOME fica de fora de propósito: ele identifica a clínica na plataforma
  // inteira, aparece em documento já emitido e é por ele que o suporte a acha.
  // Renomear é operação de plataforma, com registro de quem fez.
  if (b.endereco !== undefined) campos.endereco = String(b.endereco).trim().slice(0, 255);
  if (b.telefone !== undefined) campos.telefone = String(b.telefone).trim().slice(0, 40);
  if (b.email !== undefined) campos.email = String(b.email).trim().slice(0, 160);
  if (b.contato !== undefined) campos.contato = String(b.contato).trim().slice(0, 120);
  if (!Object.keys(campos).length) {
    return res.status(400).json({ error: 'Nada para atualizar.' });
  }
  try {
    await db.atualizarMinhaClinica(campos);
    await logs.registrar(db, 'CLINICA',
      'Timbre da clinica atualizado: ' + Object.keys(campos).join(', ') + '.');
    const c = await db.minhaClinica();
    res.json(paraTela(c));
  } catch (e) {
    console.error('[clinica]', e && e.message);
    res.status(500).json({ error: 'Falha ao salvar os dados da clinica.' });
  }
});

/** O LOGO do timbre (M6.2, 24/09).
 *
 *  ============================= POR QUE NÃO ENTROU NO `PATCH /api/clinica`
 *
 *  Dois motivos, e o segundo é o que decide:
 *
 *  1. O PATCH aceita 1 MB porque quatro campos de texto nunca chegam perto
 *     disso. Uma imagem chega, e subir aquele limite alargaria a porta de
 *     TODOS os campos do timbre de uma vez.
 *
 *  2. Apagar o logo é uma operação de verdade — a clínica trocou de marca e não
 *     quer nenhuma até subir a nova. Num PATCH isso teria de ser expresso por
 *     `logo: null`, que é indistinguível de "não mandei este campo" em quase
 *     todo cliente. `DELETE` diz o que é.
 *
 *  A validação vive em `services/timbre-logo.js` — em especial a recusa de SVG,
 *  que é a única entrada de HTML arbitrário que este sistema teria. */
router.put('/api/clinica/logo', express.json({ limit: '4mb' }), async function (req, res) {
  const db = escopo(req);
  const v = timbreLogo.validarLogo(req.body && req.body.dataUrl);
  if (!v.ok) return res.status(400).json({ error: v.erro });
  try {
    await db.atualizarMinhaClinica({ logo: v.dataUrl });
    await logs.registrar(db, 'CLINICA',
      'Logo do timbre atualizado (' + v.tipo + ', ' + Math.round(v.bytes / 1024) + ' KB). ' +
      'Documento ja emitido continua com o logo que tinha.');
    res.json(paraTela(await db.minhaClinica()));
  } catch (e) {
    console.error('[clinica]', e && e.message);
    res.status(500).json({ error: 'Falha ao salvar o logo.' });
  }
});

router.delete('/api/clinica/logo', async function (req, res) {
  const db = escopo(req);
  try {
    await db.atualizarMinhaClinica({ logo: null });
    await logs.registrar(db, 'CLINICA', 'Logo do timbre removido.');
    res.json(paraTela(await db.minhaClinica()));
  } catch (e) {
    console.error('[clinica]', e && e.message);
    res.status(500).json({ error: 'Falha ao remover o logo.' });
  }
});


/** O timbre PRONTO de quem está logado — o que vai sair impresso.
 *
 *  ============================================= POR QUE UMA ROTA SÓ PARA ISSO
 *
 *  O painel de emissão precisa de duas respostas antes de a profissional
 *  escrever qualquer coisa: *como vai ficar o cabeçalho* e *eu posso emitir?*.
 *
 *  A segunda é a que custou caro em 16/09: sem o conselho preenchido, a emissão
 *  é recusada — corretamente — mas a recusa só aparecia DEPOIS de escrever a
 *  receita inteira, e foi lida como "o botão de imprimir está quebrado". Agora
 *  a tela sabe disso antes, e avisa antes.
 *
 *  Montar o mesmo dado no navegador exigiria `/api/users` (que é só de admin) —
 *  ou seja, a profissional não conseguiria ver o próprio timbre. Aqui ela lê o
 *  dela, e só o dela: o `id` vem do token.
 */
router.get('/api/meu-timbre', async function (req, res) {
  const db = escopo(req);
  try {
    const id = req.usuario && req.usuario.sub;
    if (!id) return res.status(401).json({ error: 'Sessao nao autenticada.' });
    const [u] = await db.q(
      'SELECT name, funcao, conselho, conselho_numero, conselho_uf' +
      ' FROM users WHERE clinica_id = :clinica AND id = ?', [id]);
    const c = await db.minhaClinica();
    const eu = u[0] || {};
    res.json({
      nome: eu.name || '',
      funcao: eu.funcao || '',
      conselho: eu.conselho || '',
      conselhoNumero: eu.conselho_numero || '',
      conselhoUf: eu.conselho_uf || '',
      // A tela não deduz isto de três campos: a regra de quem pode emitir vive
      // no servidor (`podeEmitir`), e a resposta vem de lá para não haver duas
      // versões dela.
      podeEmitir: !!(String(eu.conselho || '').trim() && String(eu.conselho_numero || '').trim()),
      clinica: paraTela(c)
    });
  } catch (e) {
    console.error('[meu-timbre]', e && e.message);
    res.status(500).json({ error: 'Falha ao ler o timbre.' });
  }
});

module.exports = router;

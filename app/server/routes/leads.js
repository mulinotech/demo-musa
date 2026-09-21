'use strict';
/** Os leads — o topo do funil, dentro do CRM.
 *
 *  ================================================= O QUE A M1.6 MUDOU AQUI
 *
 *  Nenhuma das consultas filtrava, e `leads.id` é único no banco inteiro. Com o
 *  id na mão — e ele aparece na listagem — uma clínica **editava** e **excluía**
 *  lead da outra. Pior: as rotas de gravação registram na trilha de auditoria o
 *  nome, o WhatsApp e o tratamento do lead, então o log da vizinha passava a
 *  contar quem era a pessoa.
 *
 *  ================================== A CAPTACAO PUBLICA SAIU DESTE ARQUIVO
 *
 *  `POST /api/leads` é rota pública (o formulário do site posta sem sessão) e
 *  foi para `routes/leads-publico.js`. Ela não pode usar `escopo(req)`, e
 *  ficando aqui prendia o módulo inteiro na catraca — o mesmo recorte que a
 *  agenda fez com as rotas de lembrete.
 *
 *  **O arquivo novo tem de ser montado ANTES deste** em `app.js`. Há teste
 *  fixando a ordem: foi assim que a tela de lembretes ficou respondendo
 *  "compromisso nao encontrado" em 08/09, e o defeito não deu erro nenhum.
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');
const logs = require('../services/logs');
const conversao = require('../services/conversao-de-lead');

const primeiroNome = (nome) => (nome || '').trim().split(' ')[0] || nome;

/** O lead, se for desta clínica. `null` vira 404 em quem chamou.
 *
 *  Uma leitura só protege as três rotas que recebem `:id` — e é ela que
 *  transforma "id de outra clínica" em 404, em vez de uma gravação silenciosa
 *  que não afeta linha nenhuma. */
async function lerLead(db, id) {
  const [r] = await db.q(
    'SELECT id, name, whatsapp, email, treatment, status, client_id AS clientId, salesperson_id' +
    ' FROM leads WHERE clinica_id = :clinica AND id = ?',
    [id]);
  return r[0] || null;
}

/** VENDA FECHADA VIRA PACIENTE (M5.10, 21/09)
 *
 *  ========================================= ONDE ESTA REGRA MORAVA ANTES
 *
 *  No navegador, em `CrmDashboard.handleUpdateLeadStatus`, logo depois do
 *  `PUT` dar certo:
 *
 *      const clientExists = clients.some(c => c.phone === finalPhone);
 *      if (leadToConvert && !clientExists) await handleAddClient({...});
 *
 *  Ela nasceu a segunda ficha de cada paciente cujo telefone estava escrito de
 *  um jeito no WhatsApp (`5511998765432`) e de outro na ficha
 *  (`(11) 99876-5432`) — que é a duplicata que o time comercial relatou. E
 *  morreu junto com a aba de quem fechou a venda: se a pessoa navegasse entre o
 *  `PUT` e o `handleAddClient`, o lead ficava fechado e a ficha não nascia.
 *  Sem erro na tela.
 *
 *  Aqui ela roda no servidor, DENTRO da mesma transação que fecha o lead. Ou as
 *  duas coisas acontecem, ou nenhuma. Não existe mais o estado "fechado sem
 *  ficha" produzido por acidente.
 *
 *  ============================================ POR QUE LÊ A CLÍNICA INTEIRA
 *
 *  Para comparar telefones o SQL teria de normalizar máscara dentro do `WHERE`
 *  (`REPLACE` aninhado quatro vezes), e aí o índice de `phone` não serviria de
 *  nada mesmo. Então lê três colunas das fichas da clínica e compara em JS, com
 *  a mesma regra que os testes cobrem. Fechar venda é evento de minutos, não de
 *  milissegundos, e a leitura é do tamanho de uma clínica — nunca das 50.
 */
async function converterLeadFechado(tx, lead) {
  const [fichas] = await tx.q(
    'SELECT id, name, phone FROM clients WHERE clinica_id = :clinica');

  const escolha = conversao.escolherFicha(lead, fichas);

  if (escolha.acao === 'jaVinculado') return { acao: escolha.acao, porque: escolha.porque };

  /* O empate NAO fecha sozinho: duas fichas com o mesmo telefone sao a mae e a
     filha com a mesma frequencia com que sao duplicata. O lead fecha, ninguem e
     vinculado, e a tela pede que a recepcao escolha. */
  if (escolha.acao === 'ambiguo') {
    return {
      acao: 'ambiguo', porque: escolha.porque,
      candidatos: escolha.candidatos.map((c) => ({ id: c.id, nome: c.name, telefone: c.phone }))
    };
  }

  let cliente = escolha.cliente;

  if (escolha.acao === 'criar') {
    const novoId = 'c_' + Math.random().toString(36).substring(2, 9);
    await tx.q(
      'INSERT INTO clients (id, name, email, phone, clinica_id) VALUES (?, ?, ?, ?, :clinica)',
      [novoId, lead.name, lead.email || '', lead.whatsapp || '']);
    cliente = { id: novoId, name: lead.name, phone: lead.whatsapp || '' };
    await logs.registrar(tx, 'CLIENT_CREATE',
      'Ficha criada ao fechar a venda do lead "' + primeiroNome(lead.name) + '".');
  }

  await tx.q(
    'UPDATE leads SET client_id = ?, converted_at = NOW()' +
    ' WHERE clinica_id = :clinica AND id = ?',
    [cliente.id, lead.id]);

  return {
    acao: escolha.acao, porque: escolha.porque,
    cliente: { id: cliente.id, nome: cliente.name, telefone: cliente.phone }
  };
}

router.get('/api/leads', async function (req, res) {
  const db = escopo(req);
  try {
    const [rows] = await db.q(
      'SELECT * FROM leads WHERE clinica_id = :clinica ORDER BY date DESC');
    res.json(rows);
  } catch (error) {
    console.error('[leads]', error && error.message);
    res.status(500).json({ error: 'Erro ao buscar leads' });
  }
});


/** CRIAR LEAD DE DENTRO DO CRM — a porta de quem tem sessão (11/09).
 *
 *  ======================================================== POR QUE ELA EXISTE
 *
 *  Duas telas do CRM criam lead: o **"iniciar nova conversa"** do Atendimento
 *  (cadastrar o contato pelo telefone) e o **"adicionar lead"** do Kanban do
 *  funil. As duas postavam em `POST /api/leads` — a **porta pública**, a mesma
 *  do formulário do site.
 *
 *  Funcionava enquanto havia uma clínica só, porque a rota pública, sem chave de
 *  captação, respondia "a única que existe". **No dia em que a segunda clínica
 *  nasceu (11/09), as duas telas quebraram**: a rota passou a recusar com 503,
 *  corretamente — ela não tem como adivinhar de quem é o lead.
 *
 *  E o defeito não era da clínica nova. Era de endereço: **essas telas têm
 *  sessão**, e sessão já diz de qual clínica é o lead. Elas estavam entrando
 *  pela porta da rua tendo a chave da porta de dentro no bolso.
 *
 *  ================================================== O QUE MUDA NA PRÁTICA
 *
 *  A clínica vem de `escopo(req)`, como em toda rota do CRM — não da URL, não do
 *  corpo, não de uma chave de captação. **Um lead criado aqui nunca pode cair na
 *  clínica errada**, porque não existe caminho por onde informar outra.
 *
 *  E o autor da trilha de auditoria deixa de ser "Sistema (Site/Formulario)" e
 *  passa a ser quem clicou — que é a verdade nos dois casos, e é o que alguém
 *  auditando seis meses depois precisa ler.
 *
 *  A rota pública continua existindo e continua sendo só do site. Ela não tem
 *  mais nenhum chamador de dentro do CRM, e há teste fixando isso. */
router.post('/api/leads/manual', async function (req, res) {
  const db = escopo(req);
  const { name, whatsapp, email, treatment, message, status, source, salespersonId } = req.body || {};

  if (!name || !whatsapp || !treatment) {
    return res.status(400).json({ error: 'Campos obrigatorios ausentes (name, whatsapp, treatment).' });
  }

  try {
    const leadId = Math.random().toString(36).substring(2, 9);
    await db.q(
      `INSERT INTO leads (id, name, whatsapp, email, treatment, message, salesperson_id,
                          source, date, status, clinica_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, :clinica)`,
      [leadId, name, whatsapp, email || null, treatment, message || '',
       salespersonId || null, source || 'manual', new Date(), status || 'novo']);

    await logs.registrar(db, 'LEAD_CREATE',
      'Lead cadastrado no CRM: "' + primeiroNome(name) + '" (' + whatsapp +
      ') - Interesse: ' + treatment);

    // O id volta porque o Atendimento seleciona a conversa recem-criada com ele.
    res.status(201).json({ id: leadId, message: 'Lead cadastrado com sucesso!' });
  } catch (error) {
    console.error('[leads]', error && error.message);
    res.status(500).json({ error: 'Erro ao cadastrar o lead' });
  }
});


/** A chave de captação DESTA clínica, e o trecho pronto para colar no site.
 *
 *  ========================================= POR QUE ELA APARECE EM TELA
 *
 *  Porque sem isso a chave não serve para nada: ela nasce numa migration, e
 *  ninguém vai pedir à Mulino o valor de uma coluna toda vez que mexer no
 *  formulário do site.
 *
 *  E ela **pode** aparecer: a chave vive no código da página de quem a usa, de
 *  modo que mostrá-la a quem administra a própria clínica não revela nada que um
 *  visitante do site dela já não leia apertando Ctrl+U. O que ela permite é
 *  criar um lead naquela clínica, e nada mais.
 *
 *  O endereço do exemplo é montado a partir do pedido (`Host` + protocolo).
 *  Chutar um domínio fixo aqui seria pior: numa instalação nova o exemplo
 *  estaria errado e ninguém saberia por quê. */
router.get('/api/leads/captacao', async function (req, res) {
  const db = escopo(req);
  try {
    const clinica = await db.minhaClinica();
    if (!clinica) return res.status(404).json({ error: 'Clinica nao encontrada.' });
    const chave = clinica.chave_captacao || null;
    const base = (req.headers['x-forwarded-proto'] || req.protocol || 'https') +
                 '://' + req.get('host');
    res.json({
      chave: chave,
      url: chave ? base + '/api/leads?captacao=' + chave : null,
      // O formulario minimo que funciona: os tres campos obrigatorios da rota
      // publica. O resto e opcional e esta no cabecalho dela.
      exemplo: chave
        ? '<form method="POST" action="' + base + '/api/leads?captacao=' + chave + '">\n' +
          '  <input name="name" placeholder="Nome" required>\n' +
          '  <input name="whatsapp" placeholder="WhatsApp" required>\n' +
          '  <input name="treatment" placeholder="Interesse" required>\n' +
          '  <button type="submit">Enviar</button>\n' +
          '</form>'
        : null
    });
  } catch (error) {
    console.error('[leads]', error && error.message);
    res.status(500).json({ error: 'Erro ao ler a chave de captacao.' });
  }
});

router.put('/api/leads/:id', async function (req, res) {
  const db = escopo(req);
  const { id } = req.params;
  const { status, whatsapp, email, salesNotes, qualified, treatment } = req.body;
  try {
    const alvo = await lerLead(db, id);
    if (!alvo) return res.status(404).json({ error: 'Lead nao encontrado.' });

    const campos = [], valores = [];
    if (status !== undefined) { campos.push('status = ?'); valores.push(status); }
    if (whatsapp !== undefined) { campos.push('whatsapp = ?'); valores.push(whatsapp); }
    if (email !== undefined) { campos.push('email = ?'); valores.push(email); }
    if (salesNotes !== undefined) { campos.push('sales_notes = ?'); valores.push(salesNotes); }
    if (qualified !== undefined) { campos.push('qualified = ?'); valores.push(qualified ? 1 : 0); }
    if (treatment !== undefined && treatment !== '') { campos.push('treatment = ?'); valores.push(treatment); }

    if (campos.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar foi fornecido.' });
    }

    campos.push('last_edited_by = ?');
    valores.push(db.autor);

    valores.push(id);

    /* A gravacao do lead e a conversao em paciente ficam na MESMA transacao.
       Antes eram duas viagens do navegador, e o intervalo entre elas produzia o
       estado "lead fechado, paciente inexistente" toda vez que a aba fechava no
       meio. */
    const conversaoFeita = await db.transacao(async function (tx) {
      await tx.q(
        'UPDATE leads SET ' + campos.join(', ') + ' WHERE clinica_id = :clinica AND id = ?',
        valores);

      if (status !== 'arquivado') return null;

      /* Os dados do lead DEPOIS da gravacao: esta mesma chamada costuma trazer
         o telefone corrigido ("agora que fechei, o numero certo e' este"), e
         converter com o telefone velho procuraria a ficha errada. */
      const atual = await lerLead(tx, id);
      return await converterLeadFechado(tx, atual);
    });

    const oQueMudou = status ? 'Status alterado para "' + status + '"' : 'Dados de contato atualizados';
    await logs.registrar(db, 'LEAD_UPDATE',
      'Lead "' + primeiroNome(alvo.name) + '" (' + alvo.whatsapp + ') atualizado: ' + oQueMudou);

    if (conversaoFeita && conversaoFeita.acao === 'vincular') {
      await logs.registrar(db, 'LEAD_UPDATE',
        'Lead "' + primeiroNome(alvo.name) + '" vinculado a ficha ja existente de "' +
        primeiroNome(conversaoFeita.cliente.nome) + '". Nenhuma ficha nova foi criada.');
    }

    res.json({ message: 'Lead atualizado com sucesso!', conversao: conversaoFeita });
  } catch (error) {
    console.error('[leads]', error && error.message);
    res.status(500).json({ error: 'Erro ao atualizar o lead' });
  }
});


/** VINCULAR O LEAD A UMA FICHA ESCOLHIDA À MÃO
 *
 *  A porta de saída do caso `ambiguo`: duas pacientes com o mesmo telefone (a
 *  mãe e a filha, o casal, as irmãs). O servidor se recusa a desempatar, e quem
 *  desempata é a recepção, que conhece as duas.
 *
 *  Também serve para consertar um vínculo feito no card errado — e é por isso
 *  que ela aceita trocar um vínculo existente, em vez de só preencher o vazio.
 *  O que ela **não** faz é criar ficha: aqui só se aponta para ficha que já
 *  existe, e a ficha tem de ser desta clínica.
 *
 *  Fica **sem regra de papel**, como o resto do funil: quem fecha a venda é
 *  quem está olhando a conversa e sabe se é a mãe ou a filha. Exigir gerente
 *  aqui faria o vendedor fechar o lead e deixar o empate para depois — e
 *  "depois" é quando ninguém lembra mais qual das duas era. Quem vinculou fica
 *  na trilha. */
router.get('/api/leads/:id/fichas-candidatas', async function (req, res) {
  const db = escopo(req);
  try {
    const alvo = await lerLead(db, req.params.id);
    if (!alvo) return res.status(404).json({ error: 'Lead nao encontrado.' });

    const [fichas] = await db.q(
      'SELECT id, name, phone FROM clients WHERE clinica_id = :clinica');
    const escolha = conversao.escolherFicha({ ...alvo, clientId: null }, fichas);

    res.json({
      acao: escolha.acao,
      porque: escolha.porque,
      candidatos: escolha.candidatos.map((c) => ({ id: c.id, nome: c.name, telefone: c.phone }))
    });
  } catch (error) {
    console.error('[leads]', error && error.message);
    res.status(500).json({ error: 'Erro ao procurar fichas com este telefone.' });
  }
});


router.post('/api/leads/:id/vincular', async function (req, res) {
  const db = escopo(req);
  const { id } = req.params;
  const clientId = (req.body && req.body.clientId) || '';
  const criarNova = !!(req.body && req.body.criarNova);
  try {
    const alvo = await lerLead(db, id);
    if (!alvo) return res.status(404).json({ error: 'Lead nao encontrado.' });

    /* "Nenhuma dessas" tambem e' uma resposta valida ao empate: a filha que
       nunca veio a clinica usa o telefone da mae e nao tem ficha. Criar aqui,
       com a pessoa confirmando, e' diferente de criar no chute. */
    if (criarNova) {
      const feito = await db.transacao(async function (tx) {
        const novoId = 'c_' + Math.random().toString(36).substring(2, 9);
        await tx.q(
          'INSERT INTO clients (id, name, email, phone, clinica_id) VALUES (?, ?, ?, ?, :clinica)',
          [novoId, alvo.name, alvo.email || '', alvo.whatsapp || '']);
        await tx.q(
          'UPDATE leads SET client_id = ?, converted_at = COALESCE(converted_at, NOW())' +
          ' WHERE clinica_id = :clinica AND id = ?', [novoId, id]);
        return novoId;
      });
      await logs.registrar(db, 'CLIENT_CREATE',
        'Ficha criada para "' + primeiroNome(alvo.name) + '" a pedido de ' + db.autor +
        ', com o telefone ja usado por outra ficha da clinica.');
      return res.json({
        message: 'Ficha criada e vinculada ao lead.',
        conversao: { acao: 'criar', porque: 'Nenhuma das fichas existentes era a pessoa.',
                     cliente: { id: feito, nome: alvo.name, telefone: alvo.whatsapp || '' } }
      });
    }

    if (!clientId) return res.status(400).json({ error: 'Informe a ficha (clientId).' });

    /* A ficha e' lida COM o filtro da clinica. Sem isso, o id de uma paciente da
       clinica vizinha -- que aparece em qualquer listagem -- amarraria o lead
       daqui na ficha de la. */
    const [f] = await db.q(
      'SELECT id, name, phone FROM clients WHERE clinica_id = :clinica AND id = ?', [clientId]);
    if (!f[0]) return res.status(404).json({ error: 'Ficha de paciente nao encontrada.' });

    await db.q(
      'UPDATE leads SET client_id = ?, converted_at = COALESCE(converted_at, NOW())' +
      ' WHERE clinica_id = :clinica AND id = ?', [clientId, id]);

    await logs.registrar(db, 'LEAD_UPDATE',
      'Lead "' + primeiroNome(alvo.name) + '" vinculado a mao a ficha de "' +
      primeiroNome(f[0].name) + '".');

    res.json({
      message: 'Lead vinculado a ficha de ' + f[0].name + '.',
      conversao: { acao: 'vincular', porque: 'Ficha escolhida por ' + db.autor + '.',
                   cliente: { id: f[0].id, nome: f[0].name, telefone: f[0].phone } }
    });
  } catch (error) {
    console.error('[leads]', error && error.message);
    res.status(500).json({ error: 'Erro ao vincular o lead a ficha.' });
  }
});


router.delete('/api/leads/:id', async function (req, res) {
  const db = escopo(req);
  const { id } = req.params;
  try {
    // Lido ANTES de excluir, para o nome e o telefone constarem na trilha: depois
    // do DELETE nao ha de onde tirar, e "lead ID xyz removido" nao serve a quem
    // for auditar seis meses depois.
    const alvo = await lerLead(db, id);
    if (!alvo) return res.status(404).json({ error: 'Lead nao encontrado.' });

    await db.q('DELETE FROM leads WHERE clinica_id = :clinica AND id = ?', [id]);
    await logs.registrar(db, 'LEAD_DELETE',
      'Lead "' + primeiroNome(alvo.name) + '" (WhatsApp: ' + alvo.whatsapp +
      ' | Tratamento: ' + alvo.treatment + ') foi removido do sistema');
    res.json({ message: 'Lead excluido com sucesso!' });
  } catch (error) {
    console.error('[leads]', error && error.message);
    res.status(500).json({ error: 'Erro ao excluir o lead' });
  }
});

module.exports = router;

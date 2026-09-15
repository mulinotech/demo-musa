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

const primeiroNome = (nome) => (nome || '').trim().split(' ')[0] || nome;

/** O lead, se for desta clínica. `null` vira 404 em quem chamou.
 *
 *  Uma leitura só protege as três rotas que recebem `:id` — e é ela que
 *  transforma "id de outra clínica" em 404, em vez de uma gravação silenciosa
 *  que não afeta linha nenhuma. */
async function lerLead(db, id) {
  const [r] = await db.q(
    'SELECT id, name, whatsapp, treatment FROM leads WHERE clinica_id = :clinica AND id = ?',
    [id]);
  return r[0] || null;
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
    await db.q(
      'UPDATE leads SET ' + campos.join(', ') + ' WHERE clinica_id = :clinica AND id = ?',
      valores);

    const oQueMudou = status ? 'Status alterado para "' + status + '"' : 'Dados de contato atualizados';
    await logs.registrar(db, 'LEAD_UPDATE',
      'Lead "' + primeiroNome(alvo.name) + '" (' + alvo.whatsapp + ') atualizado: ' + oQueMudou);

    res.json({ message: 'Lead atualizado com sucesso!' });
  } catch (error) {
    console.error('[leads]', error && error.message);
    res.status(500).json({ error: 'Erro ao atualizar o lead' });
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

'use strict';
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');
const logs = require('../services/logs');

router.get('/api/clients', async function(req, res) {
  const userRole = req.usuario ? req.usuario.papel : '';
  const salespersonId = req.usuario ? req.usuario.vendedorId : null;

  const db = escopo(req);

  try {
    if (userRole === 'vendedor' && salespersonId) {
      // AS DUAS TABELAS DA JUNCAO SAO FILTRADAS, nao so a principal.
      //
      // Com `c.clinica_id = :clinica` sozinho, esta consulta casaria a paciente
      // da clinica A com um lead da clinica B pelo telefone -- e telefone
      // repetido entre clinicas nao e hipotese remota: e a mesma pessoa
      // atendida em dois lugares. O filtro do lado de la nao e redundancia.
      /* ============ E A LISTA DO VENDEDOR NAO LEVA DADO CLINICO (M5.2, 15/09)
       *
       * Achado ao escrever o material da equipe comercial, ao conferir se a
       * frase "o vendedor nao ve historico de saude" era verdade. Nao era.
       *
       * As quatro regras de papel de `autorizacao.js` recusam ao vendedor os
       * documentos, os alertas e a exportacao -- medido: 403 nos tres. Mas a
       * LISTA de pacientes nao tem regra de papel, e trazia `anamnese`,
       * `image_base64` e `laudo` no mesmo SELECT. Medido com uma paciente
       * ligada ao lead da vendedora: anamnese, laudo e foto vieram no corpo.
       *
       * Sao dado pessoal SENSIVEL (LGPD art. 5, II) chegando a quem trabalha
       * funil. A barreira existia em quatro portas e faltava na quinta -- e a
       * quinta era a mais usada de todas.
       *
       * O vendedor continua vendo QUEM sao as pacientes ligadas aos leads dele,
       * que e o trabalho dele. O que ele nao ve e o que elas tem. */
      const query = `
        SELECT DISTINCT c.id, c.name, c.email, c.phone, c.created_at as createdAt, c.updated_at as updatedAt
        FROM clients c
        INNER JOIN leads l ON REPLACE(l.whatsapp, "+", "") = REPLACE(c.phone, "+", "")
                          AND l.clinica_id = :clinica
        WHERE c.clinica_id = :clinica AND l.salesperson_id = ?
        ORDER BY c.name ASC
      `;
      const [rows] = await db.q(query, [salespersonId]);
      return res.json(rows);
    }
    const [rows] = await db.q(
      'SELECT id, name, email, phone, anamnese, image_base64 as imageBase64, laudo, created_at as createdAt, updated_at as updatedAt' +
      ' FROM clients WHERE clinica_id = :clinica ORDER BY name ASC', []);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar clientes', details: error.message });
  }
});

// 7. Criar Cliente

/* ===================== AS TRÊS ROTAS ABAIXO GRAVAVAM E DEVOLVIAM 500 (M4.3)
 *
 * Elas chamavam `logs.registrar(db, ...)` e **`db` não existia neste arquivo** —
 * a M1.6 trocou a assinatura do log e estes três pontos de chamada não foram
 * convertidos junto. O `escopo(req).q(...)` rodava primeiro e gravava; o
 * `ReferenceError` vinha depois e caía no `catch`, virando 500.
 *
 * O efeito, medido: cadastrar, editar e excluir paciente **funcionavam no banco
 * e respondiam erro**. E o front faz `if (response.ok)` sem `else`, então a tela
 * não avisava nada: a lista só não atualizava. Recarregar a página mostrava o
 * resultado, o que faz o defeito parecer lentidão.
 *
 * O que isso custou não foi a tela: foi a TRILHA. Nenhum `CLIENT_CREATE`,
 * `CLIENT_UPDATE` ou `CLIENT_DELETE` chegou a ser gravado desde a M1.6 — a
 * exclusão de uma paciente, que é o direito do art. 18, VI, não deixou registro
 * de quem apagou nem quando. Por isso a correção é da M4.3 e não um conserto
 * solto: é a trilha que o documento de LGPD afirma existir.
 *
 * Os argumentos `autor` e `ip` sumiram porque a assinatura nova os tira do
 * próprio escopo — não há como passar o autor de outra pessoa.
 */
router.post('/api/clients', async function(req, res) {
  const { name, email, phone } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: 'Nome e telefone sao obrigatorios.' });
  }
  const id = 'c_' + Math.random().toString(36).substring(2, 9);
  const db = escopo(req);
  try {
    await db.q(
      'INSERT INTO clients (id, name, email, phone, clinica_id) VALUES (?, ?, ?, ?, :clinica)',
      [id, name, email || '', phone]);
    await logs.registrar(db, 'CLIENT_CREATE',
      `Novo paciente cadastrado: "${name}" (${phone})`);
    res.status(201).json({ id, name, email: email || '', phone });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar cliente', details: error.message });
  }
});

// 8. Atualizar Cliente

router.patch('/api/clients/:id', async function(req, res) {
  const { id } = req.params;
  const { name, email, phone, anamnese, image_base64, laudo } = req.body;

  // mysql2 não aceita undefined, precisa ser null
  const pName = name === undefined ? null : name;
  const pEmail = email === undefined ? null : email;
  const pPhone = phone === undefined ? null : phone;
  const pAnamnese = anamnese === undefined ? null : anamnese;
  const pImageBase64 = image_base64 === undefined ? null : image_base64;
  const pLaudo = laudo === undefined ? null : laudo;

  const db = escopo(req);
  try {
    const [r] = await db.q(
      'UPDATE clients SET name = COALESCE(?, name), email = COALESCE(?, email), phone = COALESCE(?, phone), anamnese = COALESCE(?, anamnese), image_base64 = COALESCE(?, image_base64), laudo = COALESCE(?, laudo)' +
      ' WHERE clinica_id = :clinica AND id = ?',
      [pName, pEmail, pPhone, pAnamnese, pImageBase64, pLaudo, id]
    );

    /* NENHUMA LINHA CASOU = 404, e não 200.
     *
     * Achado pela varredura no mesmo minuto em que o 500 acima foi corrigido --
     * o erro antigo escondia este. Com id de outra clínica o filtro faz o UPDATE
     * não casar nada, e responder "atualizado com sucesso" é dizer que alterou
     * o que não alterou: a tela confirma, a trilha registra uma edição que não
     * houve, e quem chamou não tem como saber. */
    if (!r.affectedRows) return res.status(404).json({ error: 'Paciente nao encontrado.' });

    let desc = `Ficha do paciente ID ${id} atualizada`;
    if (anamnese !== undefined) desc = `Anamnese do paciente ID ${id} atualizada`;
    if (laudo !== undefined) desc = `Laudo Digital do paciente ID ${id} atualizado`;

    await logs.registrar(db, 'CLIENT_UPDATE', desc);

    res.json({ message: 'Cliente atualizado com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar cliente', details: error.message });
  }
});

// 8.1. Excluir Cliente

router.delete('/api/clients/:id', async function(req, res) {
  const { id } = req.params;
  const db = escopo(req);
  try {
    // O filtro no DELETE nao e formalidade: sem ele, um id adivinhado apaga a
    // paciente de OUTRA clinica. Com ele, a linha simplesmente nao casa.
    //
    // O NOME VAI PARA O LOG, e e lido ANTES de apagar: depois do DELETE nao ha
    // de onde tira-lo, e "paciente c_k3f9a2b excluida" nao responde a pergunta
    // que alguem fara daqui a um ano, que e "de quem era esse registro?".
    const [antes] = await db.q(
      'SELECT name FROM clients WHERE clinica_id = :clinica AND id = ?', [id]);
    if (!antes.length) return res.status(404).json({ error: 'Paciente nao encontrado.' });

    await db.q('DELETE FROM clients WHERE clinica_id = :clinica AND id = ?', [id]);
    await logs.registrar(db, 'CLIENT_DELETE',
      `Paciente "${antes[0].name}" (ID ${id}) foi excluida do sistema`);
    res.json({ message: 'Cliente excluído com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir cliente', details: error.message });
  }
});

// 9. Listar Tratamentos

module.exports = router;

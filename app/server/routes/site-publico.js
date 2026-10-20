'use strict';
/** O QUE O SITE PÚBLICO PRECISA SABER DA CLÍNICA DELE — sem sessão.
 *
 *  ======================================================== POR QUE ELA EXISTE
 *
 *  Relatório de QA de 15/10, BUG-01 e BUG-02. O site desta instalação postava
 *  `/api/leads` SEM a chave de captação — e, com duas clínicas ativas, a rota
 *  recusa com 503 (decisão de 11/09, que continua certa). Ao mesmo tempo, os
 *  seis botões de WhatsApp do site apontavam para `wa.me/5511900000000`, um
 *  número de mentira escrito no código. Somados: nenhum canal do site chegava
 *  ao CRM.
 *
 *  As duas coisas têm a mesma origem: o site não sabia de qual clínica ele é.
 *  Esta rota responde, e responde só o que já é público por natureza:
 *
 *  - a CHAVE DE CAPTAÇÃO, que a migration 029 já declara pública (ela vive no
 *    código de qualquer formulário que a use);
 *  - o WHATSAPP da clínica, lido do cadastro (Timbre da Clínica → telefone) —
 *    o mesmo número que a clínica imprime no rodapé de cada documento;
 *  - o NOME dos procedimentos do catálogo, para o formulário e o quiz só
 *    oferecerem o que a clínica de fato vende (BUG-15). Preço e custo NÃO saem.
 *
 *  ========================================================= QUAL É A CLÍNICA
 *
 *  `SITE_CLINICA_ID` no `.env`; sem ela, `cl_1` — a clínica original desta
 *  instalação, que é a dona do site servido aqui (o site da Dra. Musa). Clínica
 *  suspensa não responde: o formulário dela também seria recusado na gravação.
 */
const express = require('express');
const router = express.Router();
const escopo = require('../db/escopo');

const CLINICA_PADRAO = 'cl_1';

/** Telefone do cadastro → só dígitos com DDI, ou `null` se não der número.
 *  Pura, para o teste conferir sem banco. */
function whatsappDoCadastro(telefone) {
  let d = String(telefone || '').replace(/\D/g, '');
  if (d.slice(0, 4) === '0055') d = d.slice(4);
  else if (d.slice(0, 2) === '55' && d.length >= 12) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return null;
  // "(11) 90000-0000" é o número de mentira do modelo do site: não é contato.
  if (/^\d\d9?0{7,8}$/.test(d)) return null;
  return '55' + d;
}

/** BUG-25: "TESTE 2109" e "Tratamento de Teste do Rodrigo" iam parar no site.
 *  O cadastro ainda não tem a marca "publicar no site"; até ter, item cujo nome
 *  diz que é teste não sai para a rua. */
function ehItemDeTeste(nome) {
  return /(^|[^a-zà-ú])testes?([^a-zà-ú]|$)/i.test(String(nome || ''));
}

router.get('/api/site', async function (req, res) {
  const clinicaId = String(process.env.SITE_CLINICA_ID || CLINICA_PADRAO).trim();
  try {
    const db = escopo.paraClinica(clinicaId, { autor: 'Sistema (Site)', ip: req.ip });
    const c = await db.minhaClinica();
    if (!c || c.status !== 'ativa') {
      return res.status(404).json({ error: 'Site sem clinica ativa.' });
    }
    const [cat] = await db.q(
      'SELECT id, name, duration FROM treatment_catalog WHERE clinica_id = :clinica ORDER BY name ASC');

    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      clinica: c.nome || '',
      whatsapp: whatsappDoCadastro(c.telefone),
      telefone: c.telefone || '',
      captacao: c.chave_captacao || '',
      procedimentos: cat
        .filter(function (t) { return !ehItemDeTeste(t.name); })
        .map(function (t) { return { id: t.id, nome: t.name, duracao: t.duration }; })
    });
  } catch (e) {
    console.error('[site publico]', e && e.message);
    res.status(500).json({ error: 'Falha ao ler os dados do site.' });
  }
});

module.exports = router;
module.exports.whatsappDoCadastro = whatsappDoCadastro;
module.exports.ehItemDeTeste = ehItemDeTeste;

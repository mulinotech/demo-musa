'use strict';
/** Atendimento registrado FORA da Agenda vira atendimento DA Agenda.
 *
 *  Relatório de QA de 15/10, BUG-05 (bloqueador). Havia três caminhos para
 *  registrar que a paciente foi atendida — a Agenda ("Realizado"), a sessão do
 *  plano ("Evolução / Status → Realizada") e a "Nova Sessão" do prontuário — e
 *  só o primeiro estava ligado ao financeiro, ao estoque e à fidelidade. Cinco
 *  sessões de plano realizadas e uma Nova Sessão de R$ 280: zero reais de
 *  receita, zero baixa de insumo, zero ponto.
 *
 *  O cabeçalho de `atendimento-concluido.js` já dizia o que fazer: "Se
 *  aparecer um segundo caminho para concluir atendimento, ele chama daqui —
 *  não reimplementa." É o que este arquivo faz. Os outros dois caminhos passam
 *  a CRIAR o compromisso que faltava (é a verdade: o atendimento aconteceu, e a
 *  agenda é o registro dele) e a concluí-lo pelo serviço único. Os efeitos, a
 *  idempotência e o "desfazer conclusão" são os mesmos da Agenda.
 *
 *  O compromisso criado aqui NÃO passa pela checagem de conflito de horário:
 *  ele registra algo que já aconteceu, e recusar o registro porque outro
 *  horário encosta nele só esconderia a receita.
 */

const concluido = require('./atendimento-concluido');
const { dataPura, hoje } = require('./data-pura');
const { procedimentoDaMensagem } = require('./procedimento-da-mensagem');

function novoId(p) {
  return p + '_' + Math.random().toString(36).slice(2, 10);
}

/** Item do catálogo que corresponde a um nome livre ("Protocolo Ultraformer MPT"). */
async function itemDoCatalogo(db, nome, catalogId) {
  const [cat] = await db.q(
    'SELECT id, name, price, duration_min FROM treatment_catalog WHERE clinica_id = :clinica');
  if (catalogId) {
    const achado = cat.find(function (c) { return c.id === catalogId; });
    if (achado) return achado;
  }
  const nomeDoCat = procedimentoDaMensagem(nome, cat.map(function (c) { return c.name; }));
  return nomeDoCat ? cat.find(function (c) { return c.name === nomeDoCat; }) : null;
}

/** Profissional pelo id, ou pelo NOME (a sessão do plano guarda o nome). */
async function profissional(db, idOuNome, reserva) {
  const chave = String(idOuNome || '').trim();
  if (chave) {
    const [r] = await db.q(
      'SELECT id, name FROM users WHERE clinica_id = :clinica AND (id = ? OR name = ?) LIMIT 1',
      [chave, chave]);
    if (r[0]) return r[0];
  }
  if (reserva) {
    const [r] = await db.q('SELECT id, name FROM users WHERE clinica_id = :clinica AND id = ? LIMIT 1', [reserva]);
    if (r[0]) return r[0];
  }
  return null;
}

/** A data ainda não chegou? (em Brasília) */
function ehFuturo(dia) {
  const d = dataPura(dia);
  return !!d && d > hoje();
}

/**
 * Cria o compromisso do atendimento e o conclui pelo serviço único.
 *
 * `dados`: { clientId, profissional (id ou nome), titulo, nomeDoProcedimento,
 *            catalogId?, dia, price?, notes?, sessaoId? }
 * Devolve { ok, appointmentId, efeitos } ou { ok:false, status, error }.
 */
async function registrarAtendimentoRealizado(db, dados, usuarioId) {
  const dia = dataPura(dados.dia) || hoje();
  if (dia > hoje()) {
    return { ok: false, status: 409, error: 'Este atendimento é de ' + dia.split('-').reverse().join('/') +
      ' — só pode ser marcado como realizado no dia ou depois.' };
  }
  const prof = await profissional(db, dados.profissional, usuarioId);
  if (!prof) {
    return { ok: false, status: 400, error: 'Informe o profissional que realizou o atendimento.' };
  }
  const item = await itemDoCatalogo(db, dados.nomeDoProcedimento || dados.titulo, dados.catalogId);
  const preco = (dados.price !== undefined && dados.price !== null && dados.price !== '')
    ? Number(dados.price) : (item ? Number(item.price) : 0);
  const duracao = (item && Number(item.duration_min)) || 60;

  // Meio-dia: o horário real não foi informado, e meio-dia não troca de data
  // em fuso nenhum.
  const inicio = dia + ' 12:00:00';
  const fimMin = 12 * 60 + duracao;
  const fim = dia + ' ' + String(Math.floor(fimMin / 60) % 24).padStart(2, '0') + ':' +
              String(fimMin % 60).padStart(2, '0') + ':00';

  const apId = novoId('ap');
  await db.q(
    `INSERT INTO appointments
      (id, client_id, professional_id, catalog_id, title, starts_at, ends_at, kind,
       price, notes, created_by, clinica_id)
     VALUES (?,?,?,?,?,?,?, 'ATENDIMENTO', ?, ?, ?, :clinica)`,
    [apId, dados.clientId || null, prof.id, item ? item.id : null,
     String(dados.titulo || (item && item.name) || 'Atendimento').slice(0, 255),
     inicio, fim, isFinite(preco) && preco > 0 ? preco : null,
     dados.notes || 'Registrado fora da Agenda (horário não informado).', usuarioId || null]);

  if (dados.sessaoId) {
    await db.q('UPDATE treatment_sessions SET appointment_id = ? WHERE clinica_id = :clinica AND id = ?',
      [apId, dados.sessaoId]);
  }

  try {
    const saida = await concluido.concluirAtendimento(db, apId, { usuarioId: usuarioId });
    if (saida.status) throw Object.assign(new Error(saida.error), { status: saida.status });
    return { ok: true, appointmentId: apId, efeitos: saida.efeitos || {} };
  } catch (e) {
    // O compromisso existia só para ser concluído; sem conclusão, ele não fica.
    if (dados.sessaoId) {
      await db.q('UPDATE treatment_sessions SET appointment_id = NULL WHERE clinica_id = :clinica AND id = ?',
        [dados.sessaoId]).catch(function () {});
    }
    await db.q('DELETE FROM appointments WHERE clinica_id = :clinica AND id = ?', [apId]).catch(function () {});
    return { ok: false, status: e.status || 409, error: e.message || 'Não foi possível concluir o atendimento.' };
  }
}

module.exports = { registrarAtendimentoRealizado: registrarAtendimentoRealizado, itemDoCatalogo: itemDoCatalogo, ehFuturo: ehFuturo };

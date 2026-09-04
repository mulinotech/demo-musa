'use strict';
/**
 * 009_agenda.js — Fase 1, T1.1
 *
 * A DECISÃO QUE ESTA MIGRATION IMPLEMENTA
 *
 * Já existe `treatment_sessions` com data, status e profissional. A tentação é
 * usar essa tabela como agenda. Não usamos, e o motivo é concreto: uma sessão
 * de tratamento é um evento *clínico*, dentro de um plano. Nem tudo que ocupa
 * a agenda é sessão — avaliação, retorno, encaixe, bloqueio de horário, almoço.
 * Se a agenda for a tabela clínica, cada bloqueio de almoço vira uma sessão
 * fantasma no prontuário do paciente.
 *
 * `appointments` passa a ser a única fonte de verdade sobre data e hora. Uma
 * sessão *pode* apontar para um compromisso; quando aponta, a data da sessão é
 * derivada dele, não duplicada.
 *
 * O BACKFILL É POR CÓPIA, NUNCA POR SUBSTITUIÇÃO. Nada é apagado de
 * `treatment_sessions`, e `session_date` continua existindo.
 *
 * Os compromissos criados a partir do histórico levam hora 09:00 — porque
 * `session_date` é DATE, sem hora — e ficam marcados no campo de observação.
 * A recepção precisa saber que aquele horário não foi combinado com ninguém;
 * sem a marca, alguém liga para uma paciente confirmando um horário inventado.
 */

async function temColuna(conn, tabela, coluna) {
  const [r] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [tabela, coluna]
  );
  return r.length > 0;
}

const STATUS_LEGADO = {
  REALIZADA: 'REALIZADO',
  AGENDADA: 'AGENDADO',
  FALTOU: 'FALTOU',
  CANCELADA: 'CANCELADO',
  REAGENDADA: 'CANCELADO'
};

module.exports = async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50) DEFAULT NULL,
      professional_id VARCHAR(50) NOT NULL,
      catalog_id VARCHAR(50) DEFAULT NULL,
      title VARCHAR(255) NOT NULL,
      starts_at DATETIME NOT NULL,
      ends_at DATETIME NOT NULL,
      status ENUM('AGENDADO','CONFIRMADO','REALIZADO','FALTOU','CANCELADO') NOT NULL DEFAULT 'AGENDADO',
      kind ENUM('ATENDIMENTO','BLOQUEIO') NOT NULL DEFAULT 'ATENDIMENTO',
      room VARCHAR(100) DEFAULT NULL,
      price DECIMAL(10,2) DEFAULT NULL,
      notes TEXT,
      reminder_sent_at DATETIME DEFAULT NULL,
      confirmed_at DATETIME DEFAULT NULL,
      completed_at DATETIME DEFAULT NULL,
      cancelled_reason VARCHAR(255) DEFAULT NULL,
      rescheduled_from VARCHAR(50) DEFAULT NULL,
      created_by VARCHAR(50) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_appt_range (professional_id, starts_at, ends_at),
      INDEX idx_appt_status (status),
      INDEX idx_appt_client (client_id),
      INDEX idx_appt_reminder (starts_at, reminder_sent_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS professional_availability (
      id VARCHAR(50) PRIMARY KEY,
      professional_id VARCHAR(50) NOT NULL,
      weekday TINYINT NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_avail_prof (professional_id, weekday)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  if (!(await temColuna(conn, 'treatment_sessions', 'appointment_id'))) {
    await conn.query('ALTER TABLE treatment_sessions ADD COLUMN appointment_id VARCHAR(50) DEFAULT NULL AFTER plan_id');
    await conn.query('ALTER TABLE treatment_sessions ADD INDEX idx_session_appointment (appointment_id)');
    console.log('   + treatment_sessions.appointment_id');
  }

  // ---------------------------------------------------------- backfill
  const [profissionais] = await conn.query(
    "SELECT id, name FROM users WHERE status = 'active' ORDER BY FIELD(role,'profissional','admin','gerente'), name"
  );
  if (!profissionais.length) {
    console.log('   ! nenhum usuario ativo: backfill da agenda pulado');
    return;
  }
  const porNome = new Map(profissionais.map((u) => [String(u.name).trim().toLowerCase(), u.id]));
  const padrao = profissionais[0].id;

  const [sessoes] = await conn.query(`
    SELECT s.id, s.session_type, s.session_date, s.status, s.price, s.professional_in_charge,
           p.client_id
      FROM treatment_sessions s
      LEFT JOIN treatment_plans p ON p.id = s.plan_id
     WHERE s.session_date IS NOT NULL AND s.appointment_id IS NULL
  `);

  let criados = 0, pulados = 0;
  for (const s of sessoes) {
    const status = STATUS_LEGADO[String(s.status || '').toUpperCase()];
    // PENDENTE nao vira compromisso: sessao prevista nao e horario marcado.
    if (!status) { pulados += 1; continue; }

    const id = 'ap_' + Math.random().toString(36).slice(2, 10);
    const profissional = porNome.get(String(s.professional_in_charge || '').trim().toLowerCase()) || padrao;
    const data = new Date(s.session_date);
    const p = (n) => String(n).padStart(2, '0');
    const dia = data.getFullYear() + '-' + p(data.getMonth() + 1) + '-' + p(data.getDate());

    await conn.query(
      `INSERT INTO appointments
        (id, client_id, professional_id, title, starts_at, ends_at, status, kind, price, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ATENDIMENTO', ?, ?)`,
      [id, s.client_id || null, profissional, s.session_type || 'Atendimento',
       dia + ' 09:00:00', dia + ' 10:00:00', status, s.price,
       'Migrado do historico - horario estimado, nao combinado com o paciente.']
    );
    await conn.query('UPDATE treatment_sessions SET appointment_id = ? WHERE id = ?', [id, s.id]);
    criados += 1;
  }
  console.log('   + ' + criados + ' compromisso(s) migrado(s) do historico; ' + pulados + ' sessao(oes) pendente(s) ignorada(s)');

  // Grade semanal padrao para quem ainda nao tem: segunda a sexta, 09-12 e 13-19.
  const [comGrade] = await conn.query('SELECT DISTINCT professional_id FROM professional_availability');
  const jaTem = new Set(comGrade.map((r) => r.professional_id));
  let grades = 0;
  for (const u of profissionais) {
    if (jaTem.has(u.id)) continue;
    for (let dia = 1; dia <= 5; dia++) {
      for (const [de, ate] of [['09:00:00', '12:00:00'], ['13:00:00', '19:00:00']]) {
        await conn.query(
          'INSERT INTO professional_availability (id, professional_id, weekday, start_time, end_time) VALUES (?,?,?,?,?)',
          ['av_' + Math.random().toString(36).slice(2, 10), u.id, dia, de, ate]
        );
        grades += 1;
      }
    }
  }
  console.log('   + ' + grades + ' faixa(s) de horario padrao criada(s)');
};

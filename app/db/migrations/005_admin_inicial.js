'use strict';
const bcrypt = require('bcryptjs');
module.exports = async function up(conn) {
  const email = (process.env.ADMIN_EMAIL || 'silvia@inpyx.com').trim().toLowerCase();
  const senha = process.env.ADMIN_INITIAL_PASSWORD || '';
  if (!senha) { console.log('   ! ADMIN_INITIAL_PASSWORD ausente - nada feito'); return; }
  const hash = bcrypt.hashSync(senha, 10);
  const [r] = await conn.query('SELECT id FROM users WHERE email = ?', [email]);
  if (r.length) {
    await conn.query("UPDATE users SET password_hash = ?, role = 'admin', status = 'active' WHERE id = ?", [hash, r[0].id]);
    console.log('   ~ admin ' + email + ' atualizado');
  } else {
    await conn.query('INSERT INTO users (id,name,email,password_hash,role) VALUES (?,?,?,?,?)',
      ['u_admin_' + Math.random().toString(36).slice(2, 8), 'Silvia Venancio', email, hash, 'admin']);
    console.log('   + admin ' + email + ' criado');
  }
};

'use strict';
const bcrypt = require('bcryptjs');
function novoId() { return 'u_' + Math.random().toString(36).slice(2, 10); }

module.exports = async function up(conn) {
  const adminEmail = process.env.ADMIN_EMAIL || 'silvia@inpyx.com';
  const adminPass = process.env.VITE_ADMIN_PASSWORD || '';
  if (adminPass) {
    const [r] = await conn.query('SELECT id FROM users WHERE email = ?', [adminEmail]);
    if (!r.length) {
      await conn.query('INSERT INTO users (id,name,email,password_hash,role) VALUES (?,?,?,?,?)',
        [novoId(), 'Administracao', adminEmail, bcrypt.hashSync(adminPass, 10), 'admin']);
      console.log('   + admin ' + adminEmail + ' (senha atual do painel)');
    }
  } else {
    console.log('   ! VITE_ADMIN_PASSWORD ausente - admin NAO criado');
  }

  const [vend] = await conn.query("SELECT id,name,email,password,role FROM salespeople WHERE status='active'");
  for (const v of vend) {
    const email = v.email || (v.id + '@musa.local');
    const [ex] = await conn.query('SELECT id FROM users WHERE email = ?', [email]);
    if (ex.length) continue;
    const temSenha = !!v.password;
    const senha = v.password || Math.random().toString(36).slice(2, 12);
    await conn.query('INSERT INTO users (id,name,email,password_hash,role,salesperson_id) VALUES (?,?,?,?,?,?)',
      [novoId(), v.name, email, bcrypt.hashSync(senha, 10), v.role === 'gerente' ? 'gerente' : 'vendedor', v.id]);
    console.log('   + ' + email + (temSenha ? ' (senha preservada)' : ' (SENHA ALEATORIA - precisa reset)'));
  }
};

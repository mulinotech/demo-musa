'use strict';
const jwt = require('jsonwebtoken');
const EXPIRACAO = '12h';

function segredo() {
  const s = process.env.JWT_SECRET || '';
  if (!s) throw new Error('JWT_SECRET nao configurado no .env');
  return s;
}
function gerarToken(u) {
  return jwt.sign({ sub: u.id, nome: u.name, papel: u.role }, segredo(), { expiresIn: EXPIRACAO });
}
function usuarioDaRequisicao(req) {
  const h = req.headers.authorization || '';
  if (!/^Bearer /i.test(h)) return null;
  try { return jwt.verify(h.replace(/^Bearer /i, ''), segredo()); }
  catch (e) { return null; }
}
function requireRole() {
  const papeis = Array.prototype.slice.call(arguments);
  return function (req, res, next) {
    if (!req.usuario) return res.status(401).json({ error: 'Nao autorizado.' });
    if (papeis.indexOf(req.usuario.papel) === -1) return res.status(403).json({ error: 'Sem permissao para esta area.' });
    next();
  };
}
module.exports = { gerarToken, usuarioDaRequisicao, requireRole };

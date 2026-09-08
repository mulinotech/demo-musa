'use strict';
const jwt = require('jsonwebtoken');
const EXPIRACAO = '12h';

function segredo() {
  const s = process.env.JWT_SECRET || '';
  if (!s) throw new Error('JWT_SECRET nao configurado no .env');
  return s;
}
/** O token passa a carregar a CLINICA (M0.3).
 *
 *  E a unica coisa que diz de qual inquilino e a requisicao. A alternativa
 *  seria a clinica vir do endereco ou do corpo da requisicao, e ai bastaria
 *  trocar um valor para ler a clinica do vizinho. Vem do token porque o token
 *  e assinado.
 *
 *  `clinicaId` sai NULO quando a linha do usuario esta sem clinica -- o que
 *  hoje so acontece com usuario criado entre a migration 020 e a M1.7. Quem
 *  recusa esse token e o porteiro, nao esta funcao: gerar um token invalido e
 *  deixar a porta barrar e mais facil de diagnosticar do que estourar aqui.
 *
 *  O NOME da clinica de proposito NAO entra. Renomear uma clinica deixaria o
 *  nome velho valendo ate a pessoa sair e entrar de novo -- dado mutavel em
 *  token e dado que envelhece escondido. O nome vem de rota, na M3. */
function gerarToken(u) {
  return jwt.sign({
    sub: u.id,
    nome: u.name,
    papel: u.role,
    vendedorId: u.salesperson_id || null,
    clinicaId: u.clinica_id || null
  }, segredo(), { expiresIn: EXPIRACAO });
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

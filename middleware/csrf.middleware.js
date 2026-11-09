const crypto = require('crypto');
const { cookieBase, refreshLifetime } = require('../config/auth');
const { verifyToken } = require('../modules/auth/services/token.service');
const binding = req => {
  // Verify the signature even when access has expired so refresh stays protected.
  try { return verifyToken(req.cookies?.accessToken, 'access', true).sid; } catch {}
  try { return verifyToken(req.cookies?.refreshToken, 'refresh', true).sid; } catch {}
  return 'anonymous';
};
const digest = (seed, req) => crypto.createHmac('sha256', process.env.JWT_ACCESS_SECRET).update(`${seed}:${binding(req)}`).digest('hex');
const issueCsrf = (req, res) => {
  const seed = /^[a-f0-9]{64}$/.test(req.cookies?.csrfSeed || '') ? req.cookies.csrfSeed : crypto.randomBytes(32).toString('hex');
  res.cookie('csrfSeed', seed, { ...cookieBase(), path: '/api', maxAge: refreshLifetime });
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, data: { csrfToken: digest(seed, req) } });
};
const verifyCsrf = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const seed = req.cookies?.csrfSeed;
  const token = req.get('x-csrf-token') || '';
  if (typeof seed !== 'string' || !/^[a-f0-9]{64}$/.test(seed) || !/^[a-f0-9]{64}$/.test(token) || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(digest(seed, req)))) {
    return res.status(403).json({ success: false, code: 'CSRF_INVALID', message: 'Refresh the page and try again' });
  }
  next();
};
module.exports = { issueCsrf, verifyCsrf };

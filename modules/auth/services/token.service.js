const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { AuthSession } = require('../../database');
const { accessLifetime, refreshLifetime, cookieBase } = require('../../../config/auth');
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
const verifyToken = (token, type, ignoreExpiration = false) => {
  const payload = jwt.verify(token, type === 'access' ? process.env.JWT_ACCESS_SECRET : process.env.JWT_REFRESH_SECRET, {
    algorithms: ['HS256'], issuer: process.env.JWT_ISSUER || 'docmind-ai',
    audience: process.env.JWT_AUDIENCE || 'docmind-ai-web', ignoreExpiration,
  });
  if (payload.type !== type || !mongoose.isObjectIdOrHexString(payload.sub) || !mongoose.isObjectIdOrHexString(payload.sid)) throw new Error('Invalid token');
  return payload;
};
const signToken = (userId, sessionId, type) => jwt.sign({ sid: String(sessionId), type },
  type === 'access' ? process.env.JWT_ACCESS_SECRET : process.env.JWT_REFRESH_SECRET, {
    algorithm: 'HS256', subject: String(userId), issuer: process.env.JWT_ISSUER || 'docmind-ai',
    audience: process.env.JWT_AUDIENCE || 'docmind-ai-web', expiresIn: type === 'access' ? '15m' : '7d', jwtid: crypto.randomUUID(),
  });
const setCookies = (res, access, refresh) => {
  res.cookie('accessToken', access, { ...cookieBase(), path: '/api', maxAge: accessLifetime });
  res.cookie('refreshToken', refresh, { ...cookieBase(), path: '/api/auth', maxAge: refreshLifetime });
};
const clearCookies = res => {
  res.clearCookie('accessToken', { ...cookieBase(), path: '/api' });
  res.clearCookie('refreshToken', { ...cookieBase(), path: '/api/auth' });
};
const createSession = async (userId, res) => {
  const sid = new mongoose.Types.ObjectId();
  const refresh = signToken(userId, sid, 'refresh');
  await AuthSession.create({ _id: sid, userId, tokenHash: tokenHash(refresh), expiresAt: new Date(Date.now() + refreshLifetime) });
  setCookies(res, signToken(userId, sid, 'access'), refresh);
};
const rotateSession = async (token, res) => {
  const payload = verifyToken(token, 'refresh');
  const hash = tokenHash(token);
  const refresh = signToken(payload.sub, payload.sid, 'refresh');
  const session = await AuthSession.findOneAndUpdate({
    _id: payload.sid, userId: payload.sub, tokenHash: hash, expiresAt: { $gt: new Date() },
  }, { $set: { tokenHash: tokenHash(refresh), expiresAt: new Date(Date.now() + refreshLifetime) }, $push: { usedTokenHashes: hash } }, { returnDocument: 'after' });
  if (!session) {
    // Only a previously accepted, signed token can revoke this session family.
    await AuthSession.deleteOne({ _id: payload.sid, userId: payload.sub, usedTokenHashes: hash });
    throw Object.assign(new Error('Session expired or refresh token reused'), { status: 401 });
  }
  setCookies(res, signToken(payload.sub, payload.sid, 'access'), refresh);
};
module.exports = { verifyToken, signToken, tokenHash, createSession, rotateSession, clearCookies };

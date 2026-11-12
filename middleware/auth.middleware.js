const { User, AuthSession } = require('../modules/database');
const { verifyToken } = require('../modules/auth/services/token.service');
const requireAuth = async (req, res, next) => {
  let payload;
  try { payload = verifyToken(req.cookies?.accessToken, 'access'); }
  catch { return res.status(401).json({ success: false, message: 'Please log in' }); }
  try {
    const [session, user] = await Promise.all([
      AuthSession.exists({ _id: payload.sid, userId: payload.sub, expiresAt: { $gt: new Date() } }),
      User.exists({ _id: payload.sub }),
    ]);
    if (!session || !user) return res.status(401).json({ success: false, message: 'Session expired or revoked' });
    req.user = { id: payload.sub, sessionId: payload.sid };
    res.set('Cache-Control', 'no-store');
    next();
  } catch (error) { next(error); }
};
module.exports = { requireAuth };

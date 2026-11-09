const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const { User, AuthSession } = require('../../database');
const tokens = require('../services/token.service');
const googleClient = new OAuth2Client();
const publicUser = user => ({ id: String(user._id), name: user.name, email: user.email, provider: user.provider });
const validEmail = email => typeof email === 'string' && email.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
class AuthController {
  async register(req, res, next) {
    const { name, email, password } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 || !validEmail(email) || typeof password !== 'string' || Buffer.byteLength(password) < 8 || Buffer.byteLength(password) > 72) {
      return res.status(400).json({ success: false, message: 'Provide a name, valid email and password of 8–72 bytes' });
    }
    try {
      const user = await User.create({ name: name.trim(), email: email.trim().toLowerCase(), passwordHash: await bcrypt.hash(password, 12), provider: 'local' });
      await tokens.createSession(user._id, res);
      res.status(201).json({ success: true, data: { user: publicUser(user) } });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ success: false, message: 'This email already has an account. Use your original sign-in method.' });
      next(error);
    }
  }
  async login(req, res, next) {
    const { email, password } = req.body || {};
    if (!validEmail(email) || typeof password !== 'string' || Buffer.byteLength(password) > 72) return res.status(400).json({ success: false, message: 'Provide a valid email and password' });
    try {
      const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+passwordHash');
      // Keep expensive password work on the unknown-account path too.
      const hash = user?.passwordHash || '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';
      const matches = await bcrypt.compare(password, hash);
      if (!user?.passwordHash || !matches) return res.status(401).json({ success: false, message: 'Invalid email or password' });
      await tokens.createSession(user._id, res);
      res.json({ success: true, data: { user: publicUser(user) } });
    } catch (error) { next(error); }
  }
  async googleLogin(req, res, next) {
    if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ success: false, message: 'Google sign-in is not configured' });
    const { credential } = req.body || {};
    if (typeof credential !== 'string' || !credential || credential.length > 10000) return res.status(400).json({ success: false, message: 'Google credential required' });
    let payload;
    try { payload = (await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID })).getPayload(); }
    catch { return res.status(401).json({ success: false, message: 'Google sign-in failed' }); }
    if (!payload?.sub || !validEmail(payload.email) || payload.email_verified !== true) return res.status(401).json({ success: false, message: 'Google account not verified' });
    try {
      let user = await User.findOne({ googleId: payload.sub });
      if (!user) {
        const email = payload.email.trim().toLowerCase();
        if (await User.exists({ email })) return res.status(409).json({ success: false, message: 'This email already has an account. Use your original sign-in method.' });
        user = await User.create({ name: (payload.name || email.split('@')[0]).slice(0, 100), email, googleId: payload.sub, provider: 'google', emailVerified: true });
      }
      await tokens.createSession(user._id, res);
      res.json({ success: true, data: { user: publicUser(user) } });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ success: false, message: 'Account already exists. Please sign in again.' });
      next(error);
    }
  }
  async refresh(req, res, next) {
    try {
      await tokens.rotateSession(req.cookies?.refreshToken, res);
      res.json({ success: true, message: 'Session refreshed' });
    } catch (error) {
      if (error.status !== 401 && !['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(error.name)) return next(error);
      tokens.clearCookies(res);
      res.status(401).json({ success: false, message: 'Session expired. Please log in.' });
    }
  }
  async me(req, res) {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ success: false, message: 'Please log in' });
    res.json({ success: true, data: { user: publicUser(user) } });
  }
  async logout(req, res) {
    await AuthSession.deleteOne({ _id: req.user.sessionId, userId: req.user.id });
    tokens.clearCookies(res);
    res.json({ success: true, message: 'Logged out' });
  }
}
module.exports = new AuthController();

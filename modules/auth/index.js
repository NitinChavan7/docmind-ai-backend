const router = require('express').Router();
const { rateLimit } = require('express-rate-limit');
const controller = require('./controller');
const { requireAuth } = require('../../middleware/auth.middleware');
const { issueCsrf } = require('../../middleware/csrf.middleware');
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { success: false, message: 'Too many sign-in attempts. Try again in 15 minutes.' } });
router.get('/csrf', issueCsrf);
// OAuth client IDs are public browser configuration, never client secrets.
router.get('/config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, data: { googleClientId: process.env.GOOGLE_CLIENT_ID || null } });
});
router.post('/register', limiter, controller.register);
router.post('/login', limiter, controller.login);
router.post('/google', limiter, controller.googleLogin);
router.post('/refresh', controller.refresh);
router.get('/me', requireAuth, controller.me);
router.post('/logout', requireAuth, controller.logout);
module.exports = router;

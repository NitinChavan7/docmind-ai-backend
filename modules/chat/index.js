const router = require('express').Router();
const { rateLimit } = require('express-rate-limit');
const controller = require('./controller');
router.post('/', controller.create);
router.get('/', controller.list);
router.get('/:chatId/messages', controller.messages);
router.delete('/:chatId', controller.remove);
const generationLimiter = rateLimit({ windowMs: 60000, limit: require('../../config/generation').generationRateLimit, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { success: false, message: 'You have sent several questions. Please wait a minute before trying again.' } });
router.post('/:chatId/messages', generationLimiter, controller.ask);
router.post('/:chatId/stream', generationLimiter, controller.stream);
module.exports = router;

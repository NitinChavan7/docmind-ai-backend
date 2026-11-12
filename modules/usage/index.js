const router = require('express').Router();
const { getUsage } = require('./usage.service');
router.get('/', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.json({ success: true, data: await getUsage(req.user.id) });
});
module.exports = router;

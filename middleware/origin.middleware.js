const allowedOrigins = () => (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map(value => value.trim()).filter(Boolean);
const verifyOrigin = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if ((origin && !allowedOrigins().includes(origin)) || (!origin && req.get('sec-fetch-site') === 'cross-site')) {
    return res.status(403).json({ success: false, message: 'Untrusted request origin' });
  }
  next();
};
module.exports = { allowedOrigins, verifyOrigin };

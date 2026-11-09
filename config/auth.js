const accessLifetime = 15 * 60 * 1000;
const refreshLifetime = 7 * 24 * 60 * 60 * 1000;
const validateAuthConfig = () => {
  const { JWT_ACCESS_SECRET: access, JWT_REFRESH_SECRET: refresh } = process.env;
  if (!access || !refresh || access.length < 32 || refresh.length < 32 || access === refresh) {
    throw new Error('Set independent JWT_ACCESS_SECRET and JWT_REFRESH_SECRET values of at least 32 characters');
  }
};
const cookieBase = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
module.exports = { accessLifetime, refreshLifetime, validateAuthConfig, cookieBase };

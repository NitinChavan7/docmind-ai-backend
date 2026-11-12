const usageError = (status, code, message, details = {}, retryAfter) =>
  Object.assign(new Error(message), { status, code, details, retryAfter, public: true });
const errorBody = error => ({
  success: false,
  ...(error.public && error.code ? { code: error.code, details: error.details } : {}),
  message: error.public || (error.status && error.status < 500) ? error.message : 'Unable to complete request',
});
const sendError = (res, error) => {
  if (error.retryAfter) res.set('Retry-After', String(Math.max(1, Math.ceil(error.retryAfter))));
  return res.status(error.status || 500).json(errorBody(error));
};
module.exports = { usageError, errorBody, sendError };

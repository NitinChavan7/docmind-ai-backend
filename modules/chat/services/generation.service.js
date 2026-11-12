const { maxGenerations, maxUserGenerations } = require('../../../config/generation');
const { usageError } = require('../../usage/errors');
let running = 0;
const users = new Map();
const withGenerationSlot = async (userId, operation) => {
  if (running >= maxGenerations() || (users.get(userId) || 0) >= maxUserGenerations()) {
    throw usageError(429, 'GENERATION_ALREADY_RUNNING', 'An answer is already being prepared. Please try again shortly.', {}, 2);
  }
  running++;
  users.set(userId, (users.get(userId) || 0) + 1);
  try { return await operation(); }
  finally {
    running--;
    const remaining = users.get(userId) - 1;
    if (remaining) users.set(userId, remaining); else users.delete(userId);
  }
};
module.exports = { withGenerationSlot };

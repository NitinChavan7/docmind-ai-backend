const integer = (name, fallback, max) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 && value <= max ? value : fallback;
};
module.exports = {
  rewriteTimeoutMs: () => integer('QUESTION_REWRITE_TIMEOUT_MS', 8000, 120000),
  generationTimeoutMs: () => integer('GENERATION_TIMEOUT_MS', 180000, 600000),
  maxGenerations: () => integer('MAX_CONCURRENT_GENERATIONS', 4, 100),
  maxUserGenerations: () => integer('MAX_USER_GENERATIONS', 1, 10),
  generationRateLimit: () => integer('GENERATION_RATE_LIMIT', 20, 120),
};

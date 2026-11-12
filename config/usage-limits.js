const defaults = {
  FREE_MAX_PDFS: 5,
  FREE_MAX_PDF_SIZE_MB: 10,
  FREE_MAX_TOTAL_STORAGE_MB: 30,
  FREE_MAX_PDF_PAGES: 25,
  FREE_MAX_CHATS: 10,
  FREE_MAX_QUESTIONS_PER_CHAT: 50,
  FREE_MAX_DAILY_QUESTIONS: 30,
  FREE_MAX_CHAT_REQUESTS_PER_MINUTE: 5,
  FREE_MAX_CONCURRENT_GENERATIONS: 1,
  FREE_PDF_RETENTION_DAYS: 30,
  FREE_CHAT_RETENTION_DAYS: 30,
};
const values = {};
for (const [name, fallback] of Object.entries(defaults)) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!/^\d+$/.test(raw === undefined ? String(fallback) : raw) || !Number.isSafeInteger(value) || value < 1 || value > 1000000) {
    throw new Error(`${name} must be a positive integer between 1 and 1000000`);
  }
  values[name] = value;
}
const DAY_MS = 86400000;
module.exports = Object.freeze({
  maxPdfs: values.FREE_MAX_PDFS,
  maxPdfSizeBytes: values.FREE_MAX_PDF_SIZE_MB * 1048576,
  maxTotalStorageBytes: values.FREE_MAX_TOTAL_STORAGE_MB * 1048576,
  maxPdfPages: values.FREE_MAX_PDF_PAGES,
  maxChats: values.FREE_MAX_CHATS,
  maxQuestionsPerChat: values.FREE_MAX_QUESTIONS_PER_CHAT,
  maxDailyQuestions: values.FREE_MAX_DAILY_QUESTIONS,
  maxChatRequestsPerMinute: values.FREE_MAX_CHAT_REQUESTS_PER_MINUTE,
  maxConcurrentGenerations: values.FREE_MAX_CONCURRENT_GENERATIONS,
  pdfRetentionDays: values.FREE_PDF_RETENTION_DAYS,
  chatRetentionDays: values.FREE_CHAT_RETENTION_DAYS,
  DAY_MS,
});

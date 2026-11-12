// These requests need coverage across the selected PDF, rather than the five
// passages most similar to generic words such as "insights" or "takeaways".
const isDocumentSummaryQuestion = question =>
  /\b(summari[sz]e|summar(?:y|ies)|overview|takeaways?|(?:key|main|major|important)\s+(?:insights?|findings?|points?|highlights?|themes?))\b/i.test(question);

module.exports = { isDocumentSummaryQuestion };

const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const rag = require('../services/rag.service');
const { withGenerationSlot } = require('../../chat/services/generation.service');
const { withDocumentOperation } = require('../../document/services/operation.service');
const { withQuestionQuota } = require('../../usage/usage.service');

class RagController {
  async askQuestion(req, res, next) {
    const { documentId, question, requestId = randomUUID() } = req.body || {};
    if (!mongoose.isObjectIdOrHexString(documentId) || typeof question !== 'string' || !question.trim() || question.length > 4000 || typeof requestId !== 'string' || !/^[\w-]{8,100}$/.test(requestId)) {
      return res.status(400).json({ success: false, message: 'Valid document, question and request ID required' });
    }
    try {
      const result = await withDocumentOperation(req.user.id, documentId, (document, ensureLease) => {
        if (document.status !== 'ready') throw Object.assign(new Error('Document is not indexed yet'), { status: 409 });
        return withGenerationSlot(req.user.id, () => withQuestionQuota({ userId: req.user.id, documentId, requestId, question: question.trim() }, async quota => {
          ensureLease();
          const answer = await rag.askDocument(documentId, question.trim(), [], { userId: String(req.user.id), ...quota, onGenerationStart: async () => { ensureLease(); await quota.onGenerationStart(); } });
          ensureLease();
          return answer;
        }, { cacheResult: true }));
      });
      return res.json({ success: true, message: 'Answer generated successfully', data: { documentId, question: question.trim(), answer: result.answer, sources: result.sources } });
    } catch (error) { next(error); }
  }
}
module.exports = new RagController();

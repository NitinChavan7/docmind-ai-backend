const mongoose = require("mongoose");
const crypto = require("crypto");
const repository = require("../repository");
const rag = require("../../rag/services/rag.service");
const {
  withDocumentOperation,
} = require("../../document/services/operation.service");
const { withGenerationSlot } = require("../services/generation.service");
const { generationTimeoutMs } = require("../../../config/generation");
const { openSse, sendSse } = require("../../../utils/sse");
const { withQuestionQuota } = require('../../usage/usage.service');
const { assertAvailable } = require('../../usage/resources');
const { sendError, errorBody } = require('../../usage/errors');
const { deleteChatRecords } = require('../../usage/cleanup.service');
const validId = (value) => mongoose.isObjectIdOrHexString(value);
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const ownedChat = async (req) => {
  if (!validId(req.params.chatId)) fail(400, "Invalid chat ID");
  const chat = await repository.getOwnedChat(req.user.id, req.params.chatId);
  if (!chat) fail(404, "Chat not found");
  // Every caller acquires an owner-scoped document lease before reading
  // messages or generating. That atomic check also rejects missing documents.
  return chat;
};
class ChatController {
  async create(req, res) {
    const { documentId } = req.body || {};
    if (!validId(documentId)) fail(400, "Invalid document ID");
    const chat = await withDocumentOperation(
      req.user.id,
      documentId,
      async (document) => {
        if (document.status !== "ready")
          fail(409, "Document is not indexed yet");
        return repository.createChat(req.user.id, documentId);
      },
    );
    res.status(201).json({ success: true, data: chat });
  }
  async list(req, res) {
    const { documentId } = req.query;
    if (!validId(documentId)) fail(400, "Valid documentId required");
    if (!(await repository.getOwnedDocument(req.user.id, documentId)))
      fail(404, "Document not found");
    res.json({
      success: true,
      data: await repository.getChats(req.user.id, documentId),
    });
  }
  async remove(req, res) {
    if (!validId(req.params.chatId)) fail(400, 'Invalid chat ID');
    // Deletion remains available for expired/pending-deletion conversations.
    const chat = await require('../../database').Chat.findOne({ _id: req.params.chatId, userId: req.user.id }).lean();
    if (!chat) fail(404, 'Chat not found');
    await withDocumentOperation(req.user.id, chat.documentId, () => deleteChatRecords(req.user.id, chat._id), { allowUnavailable: true });
    res.json({ success: true, message: 'Conversation deleted' });
  }
  async messages(req, res) {
    const chat = await ownedChat(req);
    const { before, limit = "50" } = req.query;
    if (
      (before !== undefined && !validId(before)) ||
      !/^\d+$/.test(String(limit)) ||
      Number(limit) < 1 ||
      Number(limit) > 100
    )
      fail(400, "Invalid pagination");
    const items = await withDocumentOperation(
      req.user.id,
      chat.documentId,
      async () => {
        await repository.recoverTurn(
          await repository.getOwnedChat(req.user.id, chat._id),
        );
        return repository.getMessages(chat, before, Number(limit) + 1);
      },
    );
    const hasMore = items.length > Number(limit);
    assertAvailable(chat, 'CHAT');
    if (hasMore) items.pop();
    res.json({
      success: true,
      data: items.reverse(),
      pagination: { hasMore, before: items[0]?._id || null },
    });
  }
  async ask(req, res) {
    const chat = await ownedChat(req);
    const { question, requestId = crypto.randomUUID() } = req.body || {};
    if (
      typeof question !== "string" ||
      !question.trim() ||
      question.length > 4000 ||
      typeof requestId !== "string" ||
      !/^[\w-]{8,100}$/.test(requestId)
    )
      fail(400, "Invalid question or request ID");
    const turn = await withDocumentOperation(
      req.user.id,
      chat.documentId,
      async (document, ensureLease) =>
        withGenerationSlot(req.user.id, async () => {
          if (document.status !== "ready")
            fail(409, "Document is not indexed yet");
          await repository.recoverTurn(
            await repository.getOwnedChat(req.user.id, chat._id),
          );
          const existing = await repository.getTurn(chat, requestId);
          if (existing.length) {
            if (existing[0].content !== question.trim())
              fail(409, "Request ID already used for another question");
            return existing;
          }
          const history = (await repository.getMessages(chat, null, 8))
            .reverse()
            .map(({ role, content }) => ({ role, content }));

          return withQuestionQuota({ userId: req.user.id, documentId: chat.documentId, chatId: chat._id, requestId, question: question.trim() }, async quota => {
            ensureLease();
            assertAvailable(chat, 'CHAT');
            const result = await rag.askDocument(
              String(chat.documentId),
              question.trim(),
              history,
              {
                userId: String(req.user.id),
                ...quota,
                onGenerationStart: async () => { ensureLease(); assertAvailable(chat, 'CHAT'); await quota.onGenerationStart(); },
              },
            );

            ensureLease();
            assertAvailable(chat, 'CHAT');
            if (
              typeof result.answer !== "string" ||
              !result.answer.trim() ||
              result.answer.length > 20000
            )
              throw new Error("Invalid model response");
            return repository.saveTurn(chat, requestId, question.trim(), result);
          });
        }),
    );
    res.json({
      success: true,
      data: {
        chatId: String(chat._id),
        userMessage: turn[0],
        assistantMessage: turn[1],
        question: turn[0],
        answer: turn[1],
        messages: turn,
      },
    });
  }

  async stream(req, res) {
    const { question, mode, requestId = crypto.randomUUID() } = req.body || {};
    if (
      typeof question !== "string" ||
      !question.trim() ||
      question.length > 4000 || typeof requestId !== 'string' || !/^[\w-]{8,100}$/.test(requestId)
    )
      fail(400, "Please enter a question of up to 4,000 characters.");
    // This repository has no mode routing or web search. Do not silently invent it.
    if (mode !== undefined)
      fail(
        400,
        "This chat answers questions about your PDF. Leave mode unset.",
      );
    const chat = await ownedChat(req);
    const controller = new AbortController();
    const { signal } = controller;
    const disconnect = () => {
      if (!res.writableFinished)
        controller.abort(
          Object.assign(new Error("Client disconnected"), {
            code: "CLIENT_DISCONNECTED",
          }),
        );
    };
    req.on("aborted", disconnect);
    res.on("close", disconnect);
    if (req.aborted || res.destroyed) disconnect();
    const timeout = setTimeout(
      () =>
        controller.abort(
          Object.assign(new Error("Generation timed out"), {
            code: "STREAM_TIMEOUT",
          }),
        ),
      generationTimeoutMs(),
    );
    timeout.unref();
    let heartbeat;
    let lastStage = "preparing";
    try {
      const turn = await withGenerationSlot(req.user.id, () =>
        withDocumentOperation(
          req.user.id,
          chat.documentId,
          async (document, ensureLease) => {
            if (document.status !== "ready")
              fail(
                409,
                "This PDF is still being prepared. Please try again when it is ready.",
              );
            ensureLease();
            await repository.recoverTurn(
              await repository.getOwnedChat(req.user.id, chat._id),
            );
            const existing = await repository.getTurn(chat, requestId);
            if (existing.length) {
              if (existing[0].content !== question.trim()) fail(409, 'Request ID already used for another question');
              openSse(res);
              await sendSse(res, 'meta', { chatId: String(chat._id), messageId: String(existing[1]._id), mode: 'document', sources: existing[1].sources }, signal);
              await sendSse(res, 'token', { text: existing[1].content }, signal);
              return existing;
            }
            const history = (await repository.getMessages(chat, null, 8))
              .reverse()
              .map(({ role, content }) => ({ role, content }));
            ensureLease();
            assertAvailable(chat, 'CHAT');
            return withQuestionQuota({ userId: req.user.id, documentId: chat.documentId, chatId: chat._id, requestId, question: question.trim() }, async quota => {
              ensureLease();
              assertAvailable(chat, 'CHAT');
              openSse(res);
              // Comments keep idle proxies alive without inventing progress stages.
              heartbeat = setInterval(() => {
                if (
                  !signal.aborted &&
                  !res.destroyed &&
                  !res.writableEnded &&
                  !res.writableNeedDrain
                )
                  res.write(": keep-alive\n\n");
              }, 15000);
              heartbeat.unref();
              const messageIds = {
                user: new mongoose.Types.ObjectId(),
                assistant: new mongoose.Types.ObjectId(),
              };

              const result = await rag.streamDocument(
                String(chat.documentId),
                question.trim(),
                history,
                {
                  // REQUIRED: authenticated user ID for Qdrant filtering
                  userId: String(req.user.id),

                  ...quota,
                  onGenerationStart: async () => { ensureLease(); assertAvailable(chat, 'CHAT'); await quota.onGenerationStart(); },

                  onStatus: (stage) => {
                    lastStage = stage;
                    return sendSse(res, "status", { stage }, quota.signal);
                  },

                  onSources: (sources) =>
                    sendSse(
                      res,
                      "meta",
                      {
                        chatId: String(chat._id),
                        messageId: String(messageIds.assistant),
                        mode: "document",
                        sources,
                      },
                      quota.signal,
                    ),

                  onToken: (text) => sendSse(res, "token", { text }, quota.signal),
                },
              );

              ensureLease();
              assertAvailable(chat, 'CHAT');
              // Commit point: generation completed. The existing journal can recover a
              // database interruption, even if the client disconnects during saving.
              return repository.saveTurn(
                chat,
                requestId,
                question.trim(),
                result,
                messageIds,
              );
            }, { signal });
          },
          { signal, onLeaseLost: (error) => controller.abort(error) },
        ),
      );
      await sendSse(
        res,
        "done",
        {
          chatId: String(chat._id),
          messageId: String(turn[1]._id),
          status: "completed",
        },
        signal,
      );
    } catch (error) {
      const disconnected = signal.reason?.code === "CLIENT_DISCONNECTED";
      console.error("[Chat Stream] Generation failed", {
        stage: lastStage,
        name: error.name,
        message: error.message,
        status: error.status,
        code: error.code,
        cause: error.cause?.message,
        aborted: signal.aborted,
        abortCode: signal.reason?.code,
        stack: error.stack,
      });
      if (!res.headersSent) {
        if (error.public && !res.destroyed) return sendError(res, error);
        if (!res.destroyed)
          res.status(error.status || (signal.aborted ? 504 : 503)).json({
            success: false,
            message: error.status
              ? error.message
              : signal.aborted
                ? "This answer took too long. Please try again."
                : "We could not prepare your answer. Please try again shortly.",
          });
      } else if (!res.destroyed && !res.writableEnded) {
        // Cancellation normally closes the transport; send only if still writable.
        if (disconnected)
          await sendSse(
            res,
            "cancelled",
            { status: "cancelled" },
            AbortSignal.timeout(1000),
          ).catch(() => {});
        else
          await sendSse(
            res,
            "error",
            {
              ...(error.public ? errorBody(error) : {}),
              message:
                signal.aborted && signal.reason?.code === "STREAM_TIMEOUT"
                  ? "This answer took too long. Please try again."
                  : "We could not finish this answer. Please try again.",
            },
            AbortSignal.timeout(1000),
          ).catch(() => {});
      }
    } finally {
      controller.abort();
      clearTimeout(timeout);
      clearInterval(heartbeat);
      req.off("aborted", disconnect);
      res.off("close", disconnect);
      if (res.headersSent && !res.destroyed && !res.writableEnded) res.end();
    }
  }
}
module.exports = new ChatController();

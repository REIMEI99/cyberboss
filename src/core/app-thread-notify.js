function createAppThreadNotify(app, helpers = {}) {
  return {
    stopTypingForThread: (threadId) => stopTypingForThread(app, threadId),
    sendFailureToThread: (threadId, text, fallbackTarget) => sendFailureToThread(app, helpers, threadId, text, fallbackTarget),
    sendApprovalPrompt: ({ bindingKey, approval }) => sendApprovalPrompt(app, helpers, { bindingKey, approval }),
  };
}

async function stopTypingForThread(app, threadId) {
  const linked = app.runtimeAdapter.getSessionStore().findBindingForThreadId(threadId);
  const target = linked?.bindingKey ? app.resolveReplyTargetForBinding(linked.bindingKey) : null;
  if (!target) {
    return;
  }
  await app.channelAdapter.sendTyping({
    userId: target.userId,
    status: 0,
    contextToken: target.contextToken,
  }).catch(() => {});
}

async function sendFailureToThread(app, helpers, threadId, text, fallbackTarget = null) {
  const linked = app.runtimeAdapter.getSessionStore().findBindingForThreadId(threadId);
  const target = helpers.normalizeReplyTarget(
    linked?.bindingKey ? app.resolveReplyTargetForBinding(linked.bindingKey) : null
  ) || helpers.normalizeReplyTarget(fallbackTarget);
  if (!target) {
    return;
  }
  await app.channelAdapter.sendText({
    userId: target.userId,
    text: helpers.normalizeText(text) || "❌ Execution failed",
    contextToken: target.contextToken,
  }).catch(() => {});
}

async function sendApprovalPrompt(app, helpers, { bindingKey, approval }) {
  const target = app.resolveReplyTargetForBinding(bindingKey);
  if (!target) {
    console.warn(
      `[cyberboss] approval prompt skipped binding=${bindingKey} requestId=${approval?.requestId || ""} reason=no_reply_target`
    );
    return;
  }
  console.log(
    `[cyberboss] approval prompt sending binding=${bindingKey} user=${target.userId} requestId=${approval?.requestId || ""}`
  );
  await app.channelAdapter.sendTyping({
    userId: target.userId,
    status: 0,
    contextToken: target.contextToken,
  }).catch(() => {});
  await app.channelAdapter.sendText({
    userId: target.userId,
    text: helpers.buildApprovalPromptText(approval),
    contextToken: target.contextToken,
    preserveBlock: true,
  });
  console.log(
    `[cyberboss] approval prompt delivered binding=${bindingKey} user=${target.userId} requestId=${approval?.requestId || ""}`
  );
}

module.exports = {
  createAppThreadNotify,
};

function createAppRuntimeEvents(app) {
  return {
    handleCompletedOrFailedTurn: (event, failureReplyTarget) => handleCompletedOrFailedTurn(app, event, failureReplyTarget),
  };
}

async function handleCompletedOrFailedTurn(app, event, failureReplyTarget) {
  const completedRunKey = buildRunKey(event?.payload?.threadId, event?.payload?.turnId);
  const pendingOperations = app.pendingOperationByRunKey;
  const pendingOperation = pendingOperations?.get?.(completedRunKey) || null;
  if (pendingOperation && pendingOperations?.delete) {
    pendingOperations.delete(completedRunKey);
  }

  const sessionStore = app.runtimeAdapter.getSessionStore();
  sessionStore.clearApprovalPrompt(event.payload.threadId);
  const linked = sessionStore.findBindingForThreadId(event.payload.threadId);
  const scopeKey = linked?.bindingKey && linked?.workspaceRoot
    ? buildScopeKey(linked.bindingKey, linked.workspaceRoot)
    : "";

  if (scopeKey) {
    app.turnBoundaryScopeKeys.add(scopeKey);
  }

  try {
    app.turnGateStore.releaseThread(event.payload.threadId);
    if (event.type === "runtime.turn.failed") {
      await app.sendFailureToThread(
        event.payload.threadId,
        event.payload.text || "❌ Execution failed",
        failureReplyTarget,
      );
    }

    if (linked?.bindingKey && linked?.workspaceRoot) {
      await app.flushPendingInboundMessages({
        bindingKey: linked.bindingKey,
        workspaceRoot: linked.workspaceRoot,
        ignoreBoundary: true,
      });
    } else {
      await app.flushPendingInboundMessages();
    }

    await app.flushPendingSystemMessages();

    if (pendingOperation?.kind === "compact" && event.type === "runtime.turn.completed") {
      await app.channelAdapter.sendText({
        userId: pendingOperation.userId,
        text: `✅ Compact finished\nthread: ${event.payload.threadId}`,
        contextToken: pendingOperation.contextToken,
      }).catch(() => {});
    }

    const shouldKeepTyping = linked?.bindingKey && linked?.workspaceRoot
      ? (
        app.turnGateStore.isPending(linked.bindingKey, linked.workspaceRoot)
        || app.hasPendingInboundMessage(linked.bindingKey, linked.workspaceRoot)
      )
      : false;
    if (!shouldKeepTyping) {
      await app.stopTypingForThread(event.payload.threadId);
    }
  } finally {
    if (scopeKey) {
      app.turnBoundaryScopeKeys.delete(scopeKey);
    }
  }
}

function buildRunKey(threadId, turnId) {
  const normalizedThreadId = normalizeText(threadId);
  const normalizedTurnId = normalizeText(turnId);
  if (!normalizedThreadId || !normalizedTurnId) {
    return "";
  }
  return `${normalizedThreadId}:${normalizedTurnId}`;
}

function buildScopeKey(bindingKey, workspaceRoot) {
  const normalizedBindingKey = normalizeText(bindingKey);
  const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
  if (!normalizedBindingKey || !normalizedWorkspaceRoot) {
    return "";
  }
  return `${normalizedBindingKey}::${normalizedWorkspaceRoot}`;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  createAppRuntimeEvents,
};

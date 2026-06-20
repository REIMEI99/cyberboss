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
  const pendingFollowupAudit = app.pendingFollowupAuditByRunKey?.get?.(completedRunKey) || null;
  if (pendingFollowupAudit && app.pendingFollowupAuditByRunKey?.delete) {
    app.pendingFollowupAuditByRunKey.delete(completedRunKey);
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
    if (event.type === "runtime.turn.completed" && pendingFollowupAudit) {
      await maybeQueueFollowupAudit(app, pendingFollowupAudit).catch((error) => {
        const message = error instanceof Error ? error.message : String(error || "unknown error");
        console.error(`[cyberboss] followup audit failed ${message}`);
      });
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

async function maybeQueueFollowupAudit(app, audit) {
  const reminders = app.reminderQueue
    .listAll()
    .filter((reminder) => reminder.accountId === audit.accountId && reminder.senderId === audit.senderId);
  const baselineIds = new Set(Array.isArray(audit.baselineReminderIds) ? audit.baselineReminderIds : []);
  const hasNewReminder = reminders.some((reminder) => !baselineIds.has(reminder.id));
  if (hasNewReminder) {
    return false;
  }

  const text = [
    "A user-message turn just finished.",
    "The user described a likely future action or something that may need follow-up.",
    `Original user text: ${audit.originalText}`,
    "No new reminder was detected during that turn.",
    "Re-check whether this open loop should become a reminder now.",
    "Prefer cyberboss_followup_decide or cyberboss_reminder_create if later follow-up is warranted.",
    "If the matter was already fully resolved in the reply and no follow-up is needed, return silent.",
  ].join("\n");

  app.systemMessageQueue.enqueue({
    id: `followup-audit:${audit.threadId}:${audit.turnId}`,
    accountId: audit.accountId,
    senderId: audit.senderId,
    workspaceRoot: audit.workspaceRoot,
    kind: "pulse",
    source: "followup_audit",
    text,
    createdAt: new Date().toISOString(),
  });
  return true;
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

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
  const pendingPostTurnAudit = app.pendingPostTurnAuditByRunKey?.get?.(completedRunKey) || null;
  if (pendingPostTurnAudit && app.pendingPostTurnAuditByRunKey?.delete) {
    app.pendingPostTurnAuditByRunKey.delete(completedRunKey);
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
    if (event.type === "runtime.turn.completed" && pendingPostTurnAudit) {
      await maybeQueuePostTurnAudit(app, pendingPostTurnAudit).catch((error) => {
        const message = error instanceof Error ? error.message : String(error || "unknown error");
        console.error(`[cyberboss] post-turn audit failed ${message}`);
      });
    }

    if (event.type === "runtime.turn.completed") {
      await maybeAutoCompact(app, event, linked, pendingOperation).catch((error) => {
        const message = error instanceof Error ? error.message : String(error || "unknown error");
        console.error(`[cyberboss] auto-compact failed ${message}`);
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

async function maybeAutoCompact(app, event, linked, pendingOperation) {
  if (event.type !== "runtime.turn.completed") {
    return;
  }
  // Skip if the just-completed turn was itself a compact
  if (pendingOperation?.kind === "compact") {
    return;
  }
  const runtimeName = app.runtimeAdapter?.describe?.()?.id || "";
  if (runtimeName !== "claudecode") {
    return;
  }
  const contextWindow = Number(app.config?.claudeContextWindow);
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    return;
  }
  const threshold = Math.min(100, Math.max(1, Number(app.config?.autoCompactThreshold) || 95));
  const threadId = event?.payload?.threadId;
  if (!threadId) {
    return;
  }
  const threadState = app.threadStateStore?.getThreadState?.(threadId);
  const context = threadState?.context;
  if (!context || context.runtimeId !== "claudecode") {
    return;
  }
  const currentTokens = Number(context.currentTokens);
  if (!Number.isFinite(currentTokens) || currentTokens <= 0) {
    return;
  }
  const ratio = currentTokens / contextWindow;
  if (ratio < threshold / 100) {
    return;
  }
  // Skip if a compact is already pending for this thread
  for (const [runKey, op] of app.pendingOperationByRunKey) {
    if (op?.kind === "compact" && runKey.startsWith(threadId + ":")) {
      return;
    }
  }
  if (!linked?.bindingKey || !linked?.workspaceRoot) {
    return;
  }
  const senderId = linked.bindingKey.split(":")[2] || "";
  if (!senderId) {
    return;
  }
  const sessionStore = app.runtimeAdapter.getSessionStore();
  const model = sessionStore.getRuntimeParamsForWorkspace(linked.bindingKey, linked.workspaceRoot).model;
  const pct = Math.round(ratio * 100);
  console.log(`[cyberboss] auto-compact triggered: ${currentTokens}/${contextWindow} tokens (${pct}%) >= ${threshold}%`);
  try {
    app.streamDelivery?.queueReplyTargetForThread?.(threadId, {
      userId: senderId,
      contextToken: "",
      provider: "",
    });
    const result = await app.runtimeAdapter.compactThread({
      threadId,
      workspaceRoot: linked.workspaceRoot,
      model,
    });
    const compactTurnId = typeof result?.turnId === "string" ? result.turnId.trim() : "";
    if (compactTurnId) {
      app.pendingOperationByRunKey.set(buildRunKey(threadId, compactTurnId), {
        kind: "compact",
        userId: senderId,
        contextToken: "",
      });
    }
    await app.channelAdapter.sendText({
      userId: senderId,
      text: `\u{1F5DC}\u{FE0F} Context at ${pct}% \u2014 auto-compacting\nthread: ${threadId}`,
      contextToken: "",
    }).catch(() => {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "unknown error");
    console.error(`[cyberboss] auto-compact failed: ${message}`);
  }
}

function buildOpenActivityDigest(app) {
  const result = app.projectServices?.activity?.list?.({ limit: 20 });
  const activities = Array.isArray(result?.activities) ? result.activities : [];
  if (!activities.length) {
    return "Open activities: (none)";
  }
  const lines = activities.map((a) => {
    const ageMin = Math.max(0, Math.floor((Date.now() - (Date.parse(a.createdAt) || Date.now())) / 60000));
    const itemTexts = Array.isArray(a.items)
      ? a.items
        .map((item) => (typeof item === "string" ? item : String(item?.text || "").trim()))
        .filter(Boolean)
      : [];
    const items = itemTexts.length ? ` [items: ${itemTexts.join("; ")}]` : "";
    return `- ${a.title}${items} (open ${ageMin}m)`;
  });
  return `Open activities:\n${lines.join("\n")}`;
}

async function maybeQueuePostTurnAudit(app, audit) {
  const shouldAuditFollowup = audit?.shouldAuditFollowup === true;
  const shouldAuditHabit = audit?.shouldAuditHabit === true;
  let missingFollowup = false;
  let missingHabitClosure = false;

  if (shouldAuditFollowup) {
    const reminders = app.reminderQueue
      .listAll()
      .filter((reminder) => reminder.accountId === audit.accountId && reminder.senderId === audit.senderId);
    const baselineIds = new Set(Array.isArray(audit.baselineReminderIds) ? audit.baselineReminderIds : []);
    const hasNewReminder = reminders.some((reminder) => !baselineIds.has(reminder.id));
    const activityIds = app.projectServices?.activity?.allIds?.() || [];
    const baselineActivityIds = new Set(Array.isArray(audit.baselineActivityIds) ? audit.baselineActivityIds : []);
    const hasNewActivity = activityIds.some((id) => !baselineActivityIds.has(id));
    missingFollowup = !hasNewReminder && !hasNewActivity;
  }

  if (shouldAuditHabit) {
    const current = app.projectServices?.habit?.getTodayClosureSnapshot?.();
    const baseline = audit?.baselineHabitClosureSnapshot || null;
    if (current && baseline) {
      const hasClosureWrite = current.date !== baseline.date
        || Number(current.stateEventCount) !== Number(baseline.stateEventCount)
        || String(current.signature || "") !== String(baseline.signature || "");
      missingHabitClosure = !hasClosureWrite;
    }
  }

  if (!missingFollowup && !missingHabitClosure) {
    return false;
  }

  const openActivityDigest = buildOpenActivityDigest(app);
  const lines = [
    "A user-message turn just finished.",
    `Original user text: ${audit.originalText}`,
    "",
    openActivityDigest,
  ];

  if (missingFollowup) {
    lines.push(
      "",
      "No new activity or reminder was created during that turn.",
      "Re-evaluate whether this user message describes something the user will do or is doing right now.",
      "Hard rule: saying they will do something does NOT mean they already did it. 'Will do / about to do / going to' is an OPEN activity, not a completed one. Only mark done when the user confirms the action is finished.",
      "If the user described a near-term action (will do or doing), add it now with cyberboss_activity_add so the intention is not lost. Put the follow-up cadence on the activity itself; use a separate reminder only when there is a real hard due time.",
      "If several tasks form one work sequence, pass them as items, or use cyberboss_activity_add_item on an existing open activity rather than spawning a separate activity.",
      "If the user expressed a long-term wish with no near-term plan, store it as memory type=wishseed instead of an activity.",
      "If the matter was already explicitly resolved in this turn, or another mechanism clearly captured it, return silent.",
      "Otherwise add the activity now; do not leave the loop in a vague remembered state."
    );
  }

  if (missingHabitClosure) {
    lines.push(
      "",
      "The user said something that may imply a habit was completed, skipped, or cleanly abandoned for today.",
      "No habit state change was detected during that turn.",
      "Re-check whether a habit should now be marked done, or whether it should remain incomplete.",
      "If the user explicitly said they already did it, handled it, took it, ate it, slept, woke up after it, or otherwise clearly completed it, prefer cyberboss_habit_mark_done.",
      "Do not use cyberboss_habit_mark_abandoned unless the user clearly indicated giving up, stopping for today, or not doing it today.",
      "If completion is plausible and abandonment is not explicit, prefer done over abandoned.",
      "If there is still no explicit closure signal, leave the habit state unchanged and return silent."
    );
  }

  app.systemMessageQueue.enqueue({
    id: `post-turn-audit:${audit.threadId}:${audit.turnId}`,
    accountId: audit.accountId,
    senderId: audit.senderId,
    workspaceRoot: audit.workspaceRoot,
    kind: "pulse",
    source: "post_turn_audit",
    text: lines.join("\n"),
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
  maybeQueuePostTurnAudit,
  buildOpenActivityDigest,
};

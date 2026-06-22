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
  const pendingHabitAudit = app.pendingHabitAuditByRunKey?.get?.(completedRunKey) || null;
  if (pendingHabitAudit && app.pendingHabitAuditByRunKey?.delete) {
    app.pendingHabitAuditByRunKey.delete(completedRunKey);
  }
  const pendingPulseAudit = app.pendingPulseAuditByRunKey?.get?.(completedRunKey) || null;
  if (pendingPulseAudit && app.pendingPulseAuditByRunKey?.delete) {
    app.pendingPulseAuditByRunKey.delete(completedRunKey);
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
    if (event.type === "runtime.turn.completed" && pendingHabitAudit) {
      await maybeQueueHabitAudit(app, pendingHabitAudit).catch((error) => {
        const message = error instanceof Error ? error.message : String(error || "unknown error");
        console.error(`[cyberboss] habit audit failed ${message}`);
      });
    }
    if (event.type === "runtime.turn.completed" && pendingPulseAudit) {
      await maybeQueuePulseAudit(app, pendingPulseAudit, completedRunKey).catch((error) => {
        const message = error instanceof Error ? error.message : String(error || "unknown error");
        console.error(`[cyberboss] pulse audit failed ${message}`);
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

function buildOpenActivityDigest(app) {
  const result = app.projectServices?.activity?.list?.({ limit: 20 });
  const activities = Array.isArray(result?.activities) ? result.activities : [];
  if (!activities.length) {
    return "Open activities: (none)";
  }
  const lines = activities.map((a) => {
    const ageMin = Math.max(0, Math.floor((Date.now() - (Date.parse(a.createdAt) || Date.now())) / 60000));
    const items = Array.isArray(a.items) && a.items.length ? ` [items: ${a.items.join("; ")}]` : "";
    return `- ${a.title}${items} (open ${ageMin}m)`;
  });
  return `Open activities:\n${lines.join("\n")}`;
}

async function maybeQueueFollowupAudit(app, audit) {
  const reminders = app.reminderQueue
    .listAll()
    .filter((reminder) => reminder.accountId === audit.accountId && reminder.senderId === audit.senderId);
  const baselineIds = new Set(Array.isArray(audit.baselineReminderIds) ? audit.baselineReminderIds : []);
  const hasNewReminder = reminders.some((reminder) => !baselineIds.has(reminder.id));
  const activityIds = app.projectServices?.activity?.allIds?.() || [];
  const baselineActivityIds = new Set(Array.isArray(audit.baselineActivityIds) ? audit.baselineActivityIds : []);
  const hasNewActivity = activityIds.some((id) => !baselineActivityIds.has(id));
  if (hasNewReminder || hasNewActivity) {
    return false;
  }

  const openActivityDigest = buildOpenActivityDigest(app);

  const text = [
    "A user-message turn just finished, and no new activity or reminder was created during it.",
    `Original user text: ${audit.originalText}`,
    "",
    openActivityDigest,
    "",
    "Re-evaluate whether this user message describes something the user will do or is doing right now.",
    "Hard rule: saying they will do something does NOT mean they already did it. 'Will do / about to do / going to' is an OPEN activity, not a completed one. Only mark done when the user confirms the action is finished.",
    "If the user described a near-term action (will do or doing), add it now with cyberboss_activity_add so the intention is not lost. The activity auto-binds a check-back reminder.",
    "If several tasks form one work sequence, pass them as items, or use cyberboss_activity_add_item on an existing open activity rather than spawning a separate activity.",
    "If the user expressed a long-term wish with no near-term plan, store it as memory type=wishseed instead of an activity.",
    "If the matter was already explicitly resolved in this turn, or another mechanism clearly captured it, return silent.",
    "Otherwise add the activity now; do not leave the loop in a vague remembered state.",
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

async function maybeQueueHabitAudit(app, audit) {
  const current = app.projectServices?.habit?.getTodayClosureSnapshot?.();
  const baseline = audit?.baselineHabitClosureSnapshot || null;
  if (!current || !baseline) {
    return false;
  }
  const hasClosureWrite = current.date !== baseline.date
    || Number(current.stateEventCount) !== Number(baseline.stateEventCount)
    || String(current.signature || "") !== String(baseline.signature || "");
  if (hasClosureWrite) {
    return false;
  }

  const text = [
    "A user-message turn just finished.",
    "The user said something that may imply a habit was completed, skipped, or cleanly abandoned for today.",
    `Original user text: ${audit.originalText}`,
    "No habit state change was detected during that turn.",
    "Re-check whether a habit should now be marked done, or whether it should remain incomplete.",
    "If the user explicitly said they already did it, handled it, took it, ate it, slept, woke up after it, or otherwise clearly completed it, prefer cyberboss_habit_mark_done.",
    "Do not use cyberboss_habit_mark_abandoned unless the user clearly indicated giving up, stopping for today, or not doing it today.",
    "If completion is plausible and abandonment is not explicit, prefer done over abandoned.",
    "If there is still no explicit closure signal, leave the habit state unchanged and return silent.",
  ].join("\n");

  app.systemMessageQueue.enqueue({
    id: `habit-audit:${audit.threadId}:${audit.turnId}`,
    accountId: audit.accountId,
    senderId: audit.senderId,
    workspaceRoot: audit.workspaceRoot,
    kind: "pulse",
    source: "habit_audit",
    text,
    createdAt: new Date().toISOString(),
  });
  return true;
}

async function maybeQueuePulseAudit(app, audit, runKey) {
  const delivery = app.streamDelivery?.consumeCompletedSystemReplyOutcome?.(runKey) || null;
  if (!delivery || delivery.kind !== "silent") {
    return false;
  }
  const baseline = audit?.baselineSideEffectSnapshot?.mtimes || {};
  const current = captureSideEffectSnapshot(app.config).mtimes;
  const changedPaths = Object.keys(current).filter((filePath) => Number(current[filePath] || 0) > Number(baseline[filePath] || 0));
  if (changedPaths.length > 0) {
    return false;
  }

  const text = [
    "An internal pulse-like turn just finished with action=silent.",
    `Turn intent: ${audit.turnIntent}`,
    audit.originalText ? `Trigger text: ${audit.originalText}` : "Trigger text: <none>",
    "No observable state write was detected in tracked reminder, habit, or memory files.",
    "Re-check whether this turn actually completed one small private action or whether a useful action was skipped.",
    "A small private action may be reminder creation, habit state action, memory capture, memory update, or another concrete maintenance step.",
    "If silence is still the right outcome because the review itself was sufficient, return silent again.",
    "Otherwise do one small private action now.",
  ].join("\n");

  app.systemMessageQueue.enqueue({
    id: `pulse-audit:${audit.threadId}:${audit.turnId}`,
    accountId: audit.accountId,
    senderId: audit.senderId,
    workspaceRoot: audit.workspaceRoot,
    kind: "pulse",
    source: "pulse_audit",
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

function captureSideEffectSnapshot(config) {
 const trackedPaths = [
   config?.reminderQueueFile,
   config?.agentMemoryFile,
   config?.activityFile,
    config?.habitDefinitionsFile,
    config?.habitEventsFile,
    config?.habitStateFile,
  ].filter((value) => typeof value === "string" && value.trim());
  const mtimes = {};
  for (const filePath of trackedPaths) {
    mtimes[filePath] = readMtimeMs(filePath);
  }
  return { mtimes };
}

function readMtimeMs(filePath) {
  try {
    return require("fs").statSync(filePath).mtimeMs || 0;
  } catch {
    return 0;
  }
}

module.exports = {
  createAppRuntimeEvents,
  maybeQueueFollowupAudit,
  buildOpenActivityDigest,
};

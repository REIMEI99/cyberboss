function createAppBackgroundOps(app) {
  return {
    flushPendingSystemMessages: () => flushPendingSystemMessages(app),
    flushPendingTimelineScreenshots: (account) => flushPendingTimelineScreenshots(app, account),
    flushDueReminders: (account) => flushDueReminders(app, account),
  };
}

async function flushPendingSystemMessages(app) {
  const pendingMessages = app.systemMessageDispatcher?.drainPending() || [];
  for (const message of pendingMessages) {
    try {
      const dispatched = await app.dispatchSystemMessage(message);
      if (!dispatched) {
        app.systemMessageDispatcher.requeue(message);
      }
    } catch {
      app.systemMessageDispatcher?.requeue(message);
    }
  }
}

async function flushPendingTimelineScreenshots(app, account) {
  const pendingJobs = app.timelineScreenshotQueue.drainForAccount(account.accountId);
  for (const job of pendingJobs) {
    try {
      const captured = await app.projectServices.timeline.captureScreenshot({
        outputFile: job.outputFile,
        selector: job.selector,
        range: job.range,
        date: job.date,
        week: job.week,
        month: job.month,
        category: job.category,
        subcategory: job.subcategory,
        width: job.width,
        height: job.height,
        sidePadding: job.sidePadding,
        locale: job.locale,
      });
      await app.sendLocalFileToCurrentChat({
        senderId: job.senderId,
        filePath: captured.outputFile,
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error || "unknown error");
      console.error(`[cyberboss] timeline screenshot failed job=${job.id} ${messageText}`);
      await app.channelAdapter.sendTyping({
        userId: job.senderId,
        status: 0,
      }).catch(() => {});
      await app.channelAdapter.sendText({
        userId: job.senderId,
        text: `❌ Timeline screenshot failed\n${messageText}`,
        preserveBlock: true,
      }).catch(() => {});
    }
  }
}

async function flushDueReminders(app, account) {
  const dueReminders = app.reminderQueue
    .listDue(Date.now())
    .filter((reminder) => reminder.accountId === account.accountId);

  for (const reminder of dueReminders) {
    try {
      app.reminderQueue.defer({
        id: reminder.id,
        dueAtMs: Date.now() + resolveReminderFollowupDelayMs(reminder),
      });
      reconcileOrphanReminder(app, reminder);
      app.systemMessageQueue.enqueue({
        id: `reminder:${reminder.id}`,
        accountId: reminder.accountId,
        senderId: reminder.senderId,
        workspaceRoot: app.resolveReminderWorkspaceRoot(reminder),
        kind: "reminder",
        text: buildReminderSystemTrigger(reminder, app.config),
        createdAt: new Date().toISOString(),
      });
    } catch {
      try {
        app.reminderQueue.defer({
          id: reminder.id,
          dueAtMs: Date.now() + 5_000,
        });
      } catch {}
    }
  }
}

// Orphan reminder: no activityId and no open activity references it.
// If the text is an activity check-back template, it is stale from the old
// shared-reminder system ? complete it silently. Otherwise create an activity
// from the reminder text and bidirectionally bind it.
function reconcileOrphanReminder(app, reminder) {
  const openActivities = app.projectServices?.activity?.list?.({ limit: 50 })?.activities || [];
  const reminderActivityId = normalizeText(reminder?.activityId);
  const hasBoundActivity = reminderActivityId
    ? openActivities.some((a) => a.id === reminderActivityId)
    : openActivities.some((a) => a.reminderId === reminder.id);
  if (hasBoundActivity) {
    return;
  }
  const text = normalizeText(reminder?.text);
  if (text.includes("Activity check-back")) {
    try { app.reminderQueue.complete({ id: reminder.id }); } catch {}
    console.log(`[cyberboss] completed stale activity check-back reminder ${reminder.id}`);
    return;
  }
  const title = text.length > 60 ? `${text.slice(0, 57)}...` : text;
  const activity = app.projectServices.activity.add({ title, reminderId: reminder.id });
  try {
    app.reminderQueue.bindActivity({ id: reminder.id, activityId: activity.id });
  } catch (error) {
    console.warn(`[cyberboss] orphan reminder bindActivity failed: ${error?.message || error}`);
  }
  console.log(`[cyberboss] created activity "${title}" for orphan reminder ${reminder.id}`);
}

function buildReminderSystemTrigger(reminder, config) {
  const body = normalizeText(reminder?.text);
  const userName = normalizeText(config?.userName) || "the user";
  const followupDelayMinutes = Number.parseInt(String(reminder?.followupDelayMinutes || ""), 10);
  const effectiveFollowupDelayMinutes = Number.isFinite(followupDelayMinutes) && followupDelayMinutes > 0
    ? followupDelayMinutes
    : 15;
  if (!body) {
    return `A due reminder fired for ${userName}. Act now. This reminder stays active until explicit completion, and the queue has already scheduled the next check in about ${effectiveFollowupDelayMinutes} minutes unless you later clear it.`;
  }
  return `A due reminder fired for ${userName}. Reminder: ${body}\nThis reminder stays active until explicit completion, and the queue has already scheduled the next check in about ${effectiveFollowupDelayMinutes} minutes unless you later clear it.\nDo not assume the user already acted just because the reminder fired.\nYour default action for a due reminder is to send a message to the user. Only return silent if the user just told you in the current turn that the task is done. If recent context clearly shows the user already did it, list active reminders and clear the matching one. Otherwise, send a brief natural message to check in with the user about this reminder.`;
}

function resolveReminderFollowupDelayMs(reminder) {
  const minutes = Number.parseInt(String(reminder?.followupDelayMinutes || ""), 10);
  const effectiveMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 15;
  return effectiveMinutes * 60_000;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  createAppBackgroundOps,
};

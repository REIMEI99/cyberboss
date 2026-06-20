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
      app.reminderQueue.enqueue({
        ...reminder,
        dueAtMs: Date.now() + 5_000,
      });
    }
  }
}

function buildReminderSystemTrigger(reminder, config) {
  const body = normalizeText(reminder?.text);
  const userName = normalizeText(config?.userName) || "the user";
  if (!body) {
    return `A due reminder fired for ${userName}. Decide the best action now.`;
  }
  return `A due reminder fired for ${userName}. Reminder: ${body}`;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  createAppBackgroundOps,
};

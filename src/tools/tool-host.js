const fs = require("fs");
const { WhereaboutsToolHost } = require("whereabouts-mcp");
const {
  STICKER_DESC_GUIDANCE,
  STICKER_DESC_FIELD_DESCRIPTION,
  STICKER_TAG_GUIDANCE,
} = require("../services/sticker-service");
const { createHabitToolSpecs } = require("../habit/habit-tool-specs");

class ProjectToolHost {
  constructor({ services, runtimeContextStore, config = null }) {
    this.services = services;
    this.runtimeContextStore = runtimeContextStore;
    this.config = config;
    this.extraToolHosts = createExtraToolHosts(services);
  }

  listTools({ profile = "full" } = {}) {
    const normalizedProfile = normalizeToolProfile(profile);
    const builtIn = PROJECT_TOOLS
      .filter((tool) => isBuiltInToolVisible(tool.name, normalizedProfile))
      .map((tool) => ({
      name: tool.name,
      description: buildToolDescription(tool),
      inputSchema: tool.inputSchema,
    }));
    const extra = normalizedProfile === "default"
      ? []
      : this.extraToolHosts.flatMap((host) => host.listTools());
    return [...builtIn, ...extra];
  }

  async invokeTool(toolName, args = {}, context = {}) {
    const normalizedProfile = normalizeToolProfile(context.toolProfile || "full");
    const spec = PROJECT_TOOLS.find((candidate) => candidate.name === toolName);
    const normalizedArgs = args && typeof args === "object" ? args : {};
    if (spec) {
      if (!isBuiltInToolVisible(toolName, normalizedProfile)) {
        throw new Error(`Tool not available in the current profile: ${toolName}`);
      }
      validateSchema(spec.inputSchema, normalizedArgs, toolName, "input");
      const resolvedContext = this.resolveContext(context);
      return await spec.handler({
        services: this.services,
        args: normalizedArgs,
        context: resolvedContext,
        runtimeContextStore: this.runtimeContextStore,
        config: this.config,
      });
    }
    for (const host of this.extraToolHosts) {
      if (normalizedProfile !== "default" && host.listTools().some((tool) => tool.name === toolName)) {
        return await host.invokeTool(toolName, normalizedArgs);
      }
    }
    throw new Error(`Unknown tool: ${toolName}`);
  }

  resolveContext(context = {}) {
    const explicitWorkspaceRoot = normalizeText(context.workspaceRoot);
    const explicitRuntimeId = normalizeText(context.runtimeId);
    const active = this.runtimeContextStore.resolveActiveContext({
      workspaceRoot: explicitWorkspaceRoot,
      runtimeId: explicitRuntimeId,
    }) || {};
    return {
      runtimeId: explicitRuntimeId || normalizeText(active.runtimeId),
      workspaceRoot: explicitWorkspaceRoot || normalizeText(active.workspaceRoot),
      threadId: normalizeText(context.threadId) || normalizeText(active.threadId),
      bindingKey: normalizeText(context.bindingKey) || normalizeText(active.bindingKey),
      accountId: normalizeText(context.accountId) || normalizeText(active.accountId),
      senderId: normalizeText(context.senderId) || normalizeText(active.senderId),
    };
  }
}

function listProjectToolNames() {
  return [
    ...PROJECT_TOOLS.map((tool) => tool.name),
    ...STATIC_EXTRA_TOOL_NAMES,
  ];
}

const DEFAULT_HIDDEN_TOOL_NAMES = new Set([
  "cyberboss_memory_list",
  "cyberboss_habit_list",
  "cyberboss_habit_status_today",
  "cyberboss_habit_history",
  "cyberboss_habit_suggest_next_action",
  "cyberboss_obsidian_status",
  "cyberboss_obsidian_recent",
  "cyberboss_obsidian_random_daily_excerpt",
  "cyberboss_system_send",
  "cyberboss_timeline_categories",
  "cyberboss_timeline_proposals",
  "cyberboss_timeline_build",
  "cyberboss_timeline_serve",
  "cyberboss_timeline_dev",
]);

const PROJECT_TOOLS = [
  {
    name: "cyberboss_pulse_review",
    description: "Run the default pulse review flow in one step: inspect current context, habit status, an Obsidian signal, current activities, future material worth revisiting, and whether there is a good reason to message the user or set a follow-up reminder.",
    shortHint: "Run the default pulse review flow.",
    topics: ["pulse", "habit", "obsidian", "activity", "reminder"],
    inputSchema: {
      type: "object",
      properties: {
        turnIntent: { type: "string", description: "user_message, pulse, or reminder." },
        context: { type: "string", description: "Current scene, recent conversation context, or what the user seems to be doing." },
        userState: { type: "string", description: "Current inferred user state such as focused, low load, at home, after meal." },
        obsidianQuery: { type: "string", description: "Optional query for targeted Obsidian search. If omitted, a random daily excerpt is preferred." },
     includeObsidianExcerpt: { type: "boolean", description: "Whether to include a random daily-note excerpt when no query is provided. Only applies to pulse and reminder turns; ignored for user_message. Defaults to true." },
      includeMemories: { type: "boolean", description: "Whether to include a few recent durable memories. Defaults to true." },
     includeActivities: { type: "boolean", description: "Whether to include current open activities. Defaults to true." },
     },
     additionalProperties: false,
   },
   async handler({ services, args, context, runtimeContextStore, config }) {
     const turnIntent = normalizeTurnIntent(args.turnIntent);
    const includeObsidianExcerpt = args.includeObsidianExcerpt !== false;
    const includeMemories = args.includeMemories !== false;
     const includeActivities = args.includeActivities !== false;
    const activityLimit = Number.isInteger(args.activityLimit) && args.activityLimit > 0 ? args.activityLimit : 10;
    const obsidianQuery = normalizeText(args.obsidianQuery);
      const pulseWorkspaceKey = resolvePulseWorkspaceKey(context);
      const habitClosureSnapshot = services.habit.getTodayClosureSnapshot();

      const habitSnapshot = services.habitProvider.getPulseSnapshot({
        context: args.context,
        userState: args.userState,
        limit: 3,
      });
      const { habitStatus, habitSuggestion } = habitSnapshot;

      const isUserMessage = turnIntent === "user_message";
      let obsidian = {
        status: null,
        source: isUserMessage ? "skipped" : (obsidianQuery ? "search" : "daily_excerpt"),
        result: null,
        error: "",
      };
      if (isUserMessage) {
        obsidian.skipped = true;
        obsidian.reason = "Obsidian is not included for user_message turns";
      } else {
        try {
          obsidian.status = services.obsidian.getStatus();
          if (obsidian.status?.configured && obsidian.status?.exists) {
            if (obsidianQuery) {
              obsidian.result = services.obsidian.search({ query: obsidianQuery, limit: 5 });
            } else if (includeObsidianExcerpt) {
              const dailyExcerptExposure = decidePulseExposure({
                runtimeContextStore,
                workspaceKey: pulseWorkspaceKey,
                moduleName: "obsidian_daily_excerpt",
                version: buildDailyExcerptExposureVersion(),
              });
              if (dailyExcerptExposure.mode === "full") {
                obsidian.result = services.obsidian.randomDailyExcerpt({});
                obsidian.exposureMode = "full";
                obsidian.exposureReason = dailyExcerptExposure.reason;
              } else {
                obsidian.result = {
                  found: false,
                  suppressed: true,
                  reason: "Daily excerpt suppressed within cooldown. Call cyberboss_obsidian_random_daily_excerpt if a fresh random signal is needed.",
                };
                obsidian.exposureMode = "summary";
                obsidian.exposureReason = dailyExcerptExposure.reason;
              }
            }
          }
        } catch (error) {
          obsidian.error = error?.message || String(error);
        }
      }

     const activities = includeActivities
        ? services.activity.list({ limit: activityLimit })
        : { count: 0, activities: [] };

     const habitExposure = decidePulseExposure({
        runtimeContextStore,
        workspaceKey: pulseWorkspaceKey,
        moduleName: "habit",
        version: buildHabitExposureVersion(habitClosureSnapshot),
      });

      // Memories: semantic search (embedding) or token match (fallback),
      // with id-based dedup across the last PULSE_SHOWN_ROUNDS_WINDOW pulses.
      const memoryResult = await collectPulseSearchMemories({
        services,
        context: args.context,
        runtimeContextStore,
        workspaceKey: pulseWorkspaceKey,
        enabled: includeMemories,
      });
      let memories = memoryResult.result;
      let memoryExposureMode = memoryResult.mode;
      let memoryExposureReason = memoryResult.reason;
      const contactGapFloor = evaluateContactGapFloor({
        config,
        runtimeContextStore,
        workspaceRoot: pulseWorkspaceKey,
      });
      const summary = buildPulseReviewSummary({
        turnIntent,
        context: args.context,
        userState: args.userState,
        habitStatus,
        habitSuggestion,
       obsidian,
      memories,
      activities,
      contactGapFloor,
   });

    return {
        text: summary.messageOpportunity.shouldContactUser
          ? "Pulse review found a plausible user-facing opening."
          : "Pulse review completed with no strong user-facing opening.",
        data: {
          turnIntent,
          currentContextSummary: summary.currentContextSummary,
          habitStatus: applyHabitPulseExposure(habitStatus, habitExposure),
          habitSuggestion: normalizeHabitSuggestionForPulse(habitSuggestion),
          obsidian,
        memories,
        activities,
        contactGapFloor,
        messageOpportunity: summary.messageOpportunity,
          followupOpportunity: summary.followupOpportunity,
          recommendedPrivateActions: summary.recommendedPrivateActions,
          exposureMode: {
            habit: habitExposure.mode,
           memories: memoryExposureMode,
          activities: includeActivities ? "full" : "disabled",
         },
        },
      };
    },
  },
  {
    name: "cyberboss_followup_decide",
    description: "Turn a follow-up judgment into the default action: create a reminder when later follow-up is warranted, otherwise record that no reminder is needed.",
    shortHint: "Convert follow-up intent into a reminder decision.",
    topics: ["reminder", "pulse"],
    inputSchema: {
      type: "object",
      required: ["summary"],
      properties: {
        summary: { type: "string", description: "Short reason for the follow-up decision." },
        needsFollowup: { type: "boolean", description: "Whether a follow-up reminder should usually be created. Defaults to true." },
        reminderText: { type: "string", description: "Exact reminder text. Falls back to summary." },
        delayMinutes: { type: "integer", description: "Minutes from now before the reminder fires. For immediate next-step tasks, prefer a short reminder." },
        dueAt: { type: "string", description: "Absolute reminder time such as 2026-04-07T21:30+08:00." },
        followupDelayMinutes: { type: "integer", description: "Minutes between repeated reminder checks after the first fire. Defaults to a short sticky cadence." },
        userId: { type: "string", description: "Optional explicit WeChat user id." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const needsFollowup = args.needsFollowup !== false;
      if (!needsFollowup) {
        return {
          text: "No reminder created.",
          data: {
            decision: "none",
            reason: normalizeText(args.summary) || "Follow-up not needed.",
          },
        };
      }

      const reminderInput = {
        text: normalizeText(args.reminderText) || normalizeText(args.summary),
        userId: normalizeText(args.userId) || undefined,
      };
      if (Number.isInteger(args.delayMinutes)) {
        reminderInput.delayMinutes = args.delayMinutes;
      }
      if (normalizeText(args.dueAt)) {
        reminderInput.dueAt = normalizeText(args.dueAt);
      }
      if (Number.isInteger(args.followupDelayMinutes)) {
        reminderInput.followupDelayMinutes = args.followupDelayMinutes;
      }
      if (!reminderInput.delayMinutes && !reminderInput.dueAt) {
        reminderInput.delayMinutes = 15;
      }

      const reminder = await services.reminder.create(reminderInput, context);
      return {
        text: `Reminder queued: ${reminder.id}`,
        data: {
          decision: "reminder_created",
          reason: normalizeText(args.summary) || "Follow-up requested.",
          reminder,
        },
      };
    },
  },
  {
    name: "cyberboss_activity_add",
    description: "Add an open activity for something the user said they will do or are doing. One activity can hold multiple items (a work sequence). A short-cycle check-back reminder is automatically created and 1:1 bound to this activity. Use checkBackMinutes to set when the first check fires and followupDelayMinutes to set the repeat interval. For current or same-day ongoing actions, default to a conservative short value, usually 10-60 minutes. Do not use half-day values like 480 unless the user explicitly said the action belongs much later. For long-term wishes with no timeline, use memory type=wishseed instead. If the user is now taking action on a previously standalone reminder, pass replacesReminderId to close that old reminder after the new activity-reminder pair is created.",
    shortHint: "Add an open activity with auto check-back reminder.",
    topics: ["activity", "reminder"],
    inputSchema: {
      type: "object",
      required: ["title", "checkBackMinutes"],
      properties: {
        title: { type: "string", description: "Short title for the activity or work sequence." },
        items: { type: "array", items: { type: "string" }, description: "Optional list of specific items in this work sequence. Omit if the title alone is sufficient." },
        checkBackMinutes: { type: "integer", description: "REQUIRED. Minutes before the first check-back fires. Set what the user actually implied; do not silently round same-day work up to half a day. For imminent actions use 5-30. For something the user is continuing today, usually use 10-60. Only go above 120 when the user explicitly placed it later in the day or several hours away. Values like 480 are usually wrong for an ongoing activity." },
        followupDelayMinutes: { type: "integer", description: "Minutes between repeated check-backs after the first fire. Usually the same as checkBackMinutes or slightly higher. For same-day ongoing activities, keep it short enough to maintain contact; do not turn an activity into an all-day reminder loop unless the user explicitly wants that cadence." },
        replacesReminderId: { type: "string", description: "Optional standalone reminder id to close after creating this new activity-reminder pair." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const activity = services.activity.add({ title: args.title, items: args.items, reminderId: "" });
      let reminderId = "";
      try {
        const checkBackMinutes = Number.isInteger(args.checkBackMinutes) && args.checkBackMinutes > 0 ? args.checkBackMinutes : 10;
        const reminder = await services.reminder.create({
          text: `Check-back: ${activity.title}. Send a message to the user asking whether they have started or finished this. Do not assume completion without their confirmation. If they confirm completion, use cyberboss_activity_complete and cyberboss_reminder_complete. If they say they will not do it, use cyberboss_activity_drop and cyberboss_reminder_complete. Do not stay silent - this reminder exists to reach out to the user.`,
          delayMinutes: checkBackMinutes,
          followupDelayMinutes: Number.isInteger(args.followupDelayMinutes) && args.followupDelayMinutes > 0 ? args.followupDelayMinutes : undefined,
          activityId: activity.id,
        }, context);
        reminderId = reminder.id;
        if (reminderId) {
          services.activity.bindReminder({ id: activity.id, reminderId });
        }
        const replacesReminderId = normalizeText(args.replacesReminderId);
        if (replacesReminderId && replacesReminderId !== reminderId) {
          try {
            services.reminder.complete({ id: replacesReminderId });
          } catch (error) {
            console.warn(`[cyberboss] activity reminder replacement failed: ${error?.message || error}`);
          }
        }
      } catch (error) {
        console.warn(`[cyberboss] activity reminder creation failed: ${error?.message || error}`);
      }
      return {
        text: `Activity added: ${activity.title}`,
        data: { id: activity.id, title: activity.title, items: activity.items || [], reminderId, hasReminder: Boolean(reminderId), createdAt: activity.createdAt },
      };
    },
  },
  {
    name: "cyberboss_activity_add_item",
    description: "Append an item to an existing open activity. Use when the user mentions another task that belongs to the same work sequence as an existing open activity.",
    shortHint: "Append an item to an activity.",
    topics: ["activity"],
    inputSchema: {
      type: "object",
      required: ["id", "text"],
      properties: {
        id: { type: "string", description: "Activity id." },
        text: { type: "string", description: "The item to append." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = services.activity.addItem({ id: args.id, text: args.text });
      return {
        text: `Item added to activity: ${result.title}`,
        data: { id: result.id, title: result.title, items: result.items || [], itemCount: (result.items || []).length },
      };
    },
  },
  {
    name: "cyberboss_activity_list",
    description: "List current open activities. Use this to check what the user is currently doing or has said they will do.",
    shortHint: "List open activities.",
    topics: ["activity"],
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Optional maximum item count. Defaults to 20." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = services.activity.list(args);
      return {
        text: `Activities loaded: ${result.count}.`,
        data: {
          count: result.count,
          activities: result.activities.map((a) => ({ id: a.id, title: a.title, items: a.items || [], hasReminder: Boolean(a.reminderId), createdAt: a.createdAt })),
        },
      };
    },
  },
  {
    name: "cyberboss_activity_complete",
    description: "Mark an open activity as done. Use this when the user confirms the action is completed. The bound check-back reminder is cleared automatically.",
    shortHint: "Mark an activity as done.",
    topics: ["activity"],
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Activity id." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = services.activity.complete({ id: args.id });
      if (result.reminderId) {
        try { services.reminder.complete({ id: result.reminderId }); } catch {}
      }
      return {
        text: `Activity completed: ${result.title}`,
        data: { id: result.id, title: result.title, items: result.items || [] },
      };
    },
  },
  {
    name: "cyberboss_activity_drop",
    description: "Drop an open activity �?the user won't do it, or it's no longer relevant. The activity is removed immediately. The bound check-back reminder is cleared automatically.",
    shortHint: "Drop an open activity.",
    topics: ["activity"],
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Activity id." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = services.activity.drop({ id: args.id });
      if (result.reminderId) {
        try { services.reminder.complete({ id: result.reminderId }); } catch {}
      }
      return {
        text: `Activity dropped: ${result.title}`,
        data: { id: result.id, title: result.title, items: result.items || [] },
      };
    },
  },
  {
    name: "cyberboss_activity_promote_to_memory",
    description: "Promote one activity into a memory (type wishseed or concern), then drop the activity. Use this when an activity reveals a pattern or durable fact worth preserving across days.",
    shortHint: "Promote an activity to memory.",
    topics: ["activity", "memory"],
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Activity id." },
        kind: { type: "string", description: "wishseed or concern. Defaults to wishseed." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const dropped = services.activity.drop({ id: args.id });
      try {
        const memory = await services.agentMemory.remember({
          type: normalizeText(args.kind) || "wishseed",
          subject: dropped.title,
          content: dropped.title,
        });
        if (dropped.reminderId) {
          try { services.reminder.complete({ id: dropped.reminderId }); } catch {}
        }
        if (memory?.action === "review_existing") {
          return {
            text: `Activity matched existing memories: ${Array.isArray(memory.matches) ? memory.matches.length : 0}. Decide whether to update an existing memory or keep this as a new one.`,
            data: { id: dropped.id, title: dropped.title, memory },
          };
        }
        return {
          text: `Activity promoted to memory: ${dropped.title}`,
          data: { id: dropped.id, title: dropped.title, memory: unwrapStoredMemoryResult(memory) },
        };
      } catch (error) {
        services.activity.add({ title: dropped.title, items: dropped.items, reminderId: dropped.reminderId });
        throw error;
      }
    },
  },
  {
    name: "cyberboss_activity_list_done",
    description: "List recently completed activities (done history). Debug use only �?not for routine context.",
    shortHint: "List done activities (debug).",
    topics: ["activity"],
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Maximum items. Defaults to 5." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = services.activity.listDone(args);
      return {
        text: `Done activities: ${result.count}.`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_memory_remember",
    description: "Store a long-term structured memory that should influence future judgment. Do not use this for diary-like logs or tiny one-off details. If a near-duplicate existing memory is found, this tool returns candidate matches so you can decide whether to update an existing memory instead.",
    shortHint: "Store a long-term memory.",
    topics: ["memory"],
    inputSchema: {
      type: "object",
      required: ["type", "subject", "content"],
      properties: {
        type: { type: "string", description: "preference, fact, principle, relationship, project, wishseed, concern, or self. Use wishseed for future things to do/try/buy/read/revisit; use concern for unresolved worries or risks." },
        subject: { type: "string", description: "Who or what this memory is about." },
        content: { type: "string", description: "The durable fact, preference, principle, or finding." },
        confidence: { type: "number", description: "0 to 1. Defaults to 0.5." },
        source: { type: "string", description: "wechat, obsidian, diary, timeline, agent_life, or other source label." },
        sourceRef: { type: "string", description: "Optional note path, task id, life event id, URL, or short provenance." },
        expiresAt: { type: "string", description: "Optional ISO datetime after which the memory should stop applying." },
        tags: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.agentMemory.remember(args);
      if (result?.action === "review_existing") {
        return {
          text: `Possible duplicate memories found: ${Array.isArray(result.matches) ? result.matches.length : 0}. Decide whether to update an existing memory or store a new one.`,
          data: result,
        };
      }
      const stored = unwrapStoredMemoryResult(result);
      return {
        text: `Memory stored: ${stored.subject}`,
        data: stored,
      };
    },
  },
  {
    name: "cyberboss_memory_search",
    description: "Search long-term structured memories before making a judgment that may depend on durable user preferences, facts, projects, or relationship context.",
   shortHint: "Search long-term memories.",
    topics: ["memory"],
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        limit: { type: "integer" },
        includeArchived: { type: "boolean" },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
     const result = await services.agentMemory.search(args);
     return {
        text: `Memory search results: ${result.count}.`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_memory_list",
    description: "List long-term structured memories, optionally filtered by type or subject.",
    shortHint: "List long-term memories.",
    topics: ["memory"],
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string" },
        subject: { type: "string" },
        includeArchived: { type: "boolean" },
        limit: { type: "integer" },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = services.agentMemory.list(args);
      return {
        text: `Memories loaded: ${result.count}.`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_memory_update",
    description: "Update a long-term structured memory when it has become more precise, less reliable, expired, or needs better tags.",
    shortHint: "Update a memory.",
    topics: ["memory"],
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        type: { type: "string" },
        subject: { type: "string" },
        content: { type: "string" },
        status: { type: "string", description: "active or archived." },
        confidence: { type: "number" },
        source: { type: "string" },
        sourceRef: { type: "string" },
        expiresAt: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.agentMemory.update(args);
      return {
        text: `Memory updated: ${result.subject}`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_memory_forget",
    description: "Archive a long-term structured memory so it no longer influences future judgment.",
    shortHint: "Archive a memory.",
    topics: ["memory"],
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        reason: { type: "string" },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = services.agentMemory.forget(args);
      return {
        text: `Memory archived: ${result.subject}`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_memory_complete",
    description: "Mark a structured memory as resolved, exhausted, or no longer active. Use this for wishseed, concern, or project type memories that have a lifecycle and are now done.",
    shortHint: "Complete a memory.",
    topics: ["memory"],
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Memory id." },
        notes: { type: "string", description: "Optional closure notes appended to the memory content." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.agentMemory.complete(args);
      return {
        text: `Memory completed: ${result.subject}`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_memory_delete",
    description: "Permanently delete a structured memory from storage. This is irreversible and removes the record entirely, unlike forget (archive) or complete (mark done). Use only when the memory is wrong, duplicated, or should never have existed.",
    shortHint: "Permanently delete a memory.",
    topics: ["memory"],
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Memory id to permanently delete." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = services.agentMemory.delete(args);
      return {
        text: `Memory deleted: ${result.subject}`,
        data: result,
      };
    },
  },
 {
   name: "cyberboss_diary_append",
    description: "Append a diary entry into Cyberboss local diary storage.",
    shortHint: "Append a diary entry with direct text content.",
    topics: ["diary"],
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", description: "Diary body to append." },
        title: { type: "string", description: "Optional short entry title." },
        date: { type: "string", description: "Optional date in YYYY-MM-DD." },
        time: { type: "string", description: "Optional time in HH:mm." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.diary.append(args);
      return {
        text: `Diary appended to ${result.filePath}`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_reminder_create",
    description: "Create a reminder as a future follow-up anchor in Cyberboss. Reminders are sticky by default: after they fire, Cyberboss keeps checking again until the reminder is explicitly cleared.",
    shortHint: "Create a sticky follow-up reminder with direct text plus delayMinutes or dueAt.",
    topics: ["reminder"],
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", description: "Reminder text that preserves the future follow-up hook." },
        delayMinutes: { type: "integer", description: "REQUIRED (or use dueAt). Minutes from now before the reminder fires. Set exactly what the user asked, do not round up. Use 10-30 for near-term tasks, 60-240 for later today, and higher values only when the user explicitly specified hours or days." },
        dueAt: { type: "string", description: "Absolute time such as 2026-04-07T21:30+08:00." },
        followupDelayMinutes: { type: "integer", description: "Minutes between repeated fires after the first one. MUST match delayMinutes unless the user explicitly asked for a different repeat cadence. Do NOT increase this to a large value like 1440 on your own." },
        userId: { type: "string", description: "Optional explicit WeChat user id." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const result = await services.reminder.create(args, context);
      return {
        text: `Reminder queued: ${result.id}`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_reminder_list",
    description: "List active reminders. Use this before clearing a reminder after the user explicitly says the action is done.",
    shortHint: "List active reminders for the current user.",
    topics: ["reminder"],
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "Optional explicit WeChat user id." },
        limit: { type: "integer", description: "Optional maximum active reminder count." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const result = services.reminder.list(args, context);
      return {
        text: `Active reminders loaded: ${result.count}.`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_reminder_complete",
    description: "Clear one active reminder after the user explicitly confirms the action is done or no longer needed.",
    shortHint: "Clear an active reminder by id.",
    topics: ["reminder"],
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Reminder id to clear." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = services.reminder.complete(args);
      return {
        text: `Reminder cleared: ${result.id}`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_obsidian_status",
    description: "Inspect whether an Obsidian vault is configured and reachable.",
    shortHint: "Check Obsidian vault configuration.",
    topics: ["obsidian", "memory"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler({ services }) {
      const result = services.obsidian.getStatus();
      return {
        text: result.configured && result.exists
          ? `Obsidian vault ready: ${result.vaultRoot}`
          : "Obsidian vault is not configured or not reachable.",
        data: result,
      };
    },
  },
  {
    name: "cyberboss_obsidian_search",
    description: "Search configured Obsidian Markdown notes by keywords before reading a specific note.",
    shortHint: "Search Obsidian notes by keyword.",
    topics: ["obsidian", "memory"],
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Keyword query. Multiple terms are AND-matched." },
        limit: { type: "integer", description: "Optional maximum result count, capped at 50." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      if (!services.obsidian.getStatus().configured) {
        return { text: "Obsidian is not configured.", data: { configured: false } };
      }
      const result = services.obsidian.search(args);
      return {
        text: `Obsidian search results: ${result.resultCount}.`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_obsidian_recent",
    description: "List recently modified Obsidian Markdown notes for lightweight context discovery.",
    shortHint: "List recent Obsidian notes.",
    topics: ["obsidian", "memory"],
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Optional maximum result count, capped at 50." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      if (!services.obsidian.getStatus().configured) {
        return { text: "Obsidian is not configured.", data: { configured: false } };
      }
      const result = services.obsidian.recent(args);
      return {
        text: `Recent Obsidian notes loaded: ${result.resultCount}.`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_obsidian_read",
    description: "Read a specific Markdown note from the configured Obsidian vault by relative path.",
    shortHint: "Read one Obsidian note by relative path.",
    topics: ["obsidian", "memory"],
    inputSchema: {
      type: "object",
      required: ["relativePath"],
      properties: {
        relativePath: { type: "string", description: "Path relative to the configured vault root, such as folder/note.md." },
        maxChars: { type: "integer", description: "Optional character cap, capped at 50000." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      if (!services.obsidian.getStatus().configured) {
        return { text: "Obsidian is not configured.", data: { configured: false } };
      }
      const result = services.obsidian.read(args);
      return {
        text: `Obsidian note read: ${result.relativePath}${result.truncated ? " (truncated)" : ""}.`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_obsidian_random_daily_excerpt",
    description: "Pick a random short excerpt from recent Obsidian daily notes. Use this during quiet pulses for serendipitous context before deciding whether to search further or capture a memory item.",
    shortHint: "Pick a random daily-note excerpt.",
    topics: ["obsidian"],
    inputSchema: {
      type: "object",
      properties: {
        daysBack: { type: "integer", description: "How many recent days to sample from. Defaults to 45." },
        maxChars: { type: "integer", description: "Maximum excerpt characters, capped at 2000." },
        dailyDir: { type: "string", description: "Daily note directory relative to the vault. Defaults to Daily note." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      if (!services.obsidian.getStatus().configured) {
        return { text: "Obsidian is not configured.", data: { configured: false } };
      }
      const result = services.obsidian.randomDailyExcerpt(args);
      return {
        text: result.found
          ? `Random Obsidian excerpt loaded: ${result.relativePath}.`
          : `Random Obsidian excerpt unavailable: ${result.reason || "not found"}.`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_system_send",
    description: "Queue an internal Cyberboss system trigger for the current bound workspace and chat.",
    shortHint: "Queue an internal system message for the current workspace.",
    topics: ["system"],
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string" },
        workspaceRoot: { type: "string" },
        userId: { type: "string" },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const result = services.system.queueMessage(args, context);
      return {
        text: `System message queued: ${result.id}`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_channel_send_file",
    description: "Send an existing local file back to the current WeChat chat.",
    shortHint: "Send a local file back to the current WeChat user.",
    topics: ["channel"],
    inputSchema: {
      type: "object",
      required: ["filePath"],
      properties: {
        filePath: { type: "string" },
        userId: { type: "string" },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const result = await services.channelFile.sendToCurrentChat(args, context);
      return {
        text: `File sent: ${result.filePath}`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_sticker_tags",
    description: `Load the current sticker tag catalog and tagging rules only when you have decided a sticker is needed or an inbox image should be saved as a sticker. ${STICKER_TAG_GUIDANCE}`,
    shortHint: "Load sticker tags only when needed.",
    topics: ["sticker"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler({ services }) {
      const result = await services.sticker.listTags();
      return {
        text: `Sticker tags loaded: ${Array.isArray(result.tags) ? result.tags.length : 0}.`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_sticker_pick",
    description: "List a few saved sticker candidates for one sticker tag after you have decided a sticker would help.",
    shortHint: "Pick sticker candidates by tag.",
    topics: ["sticker"],
    inputSchema: {
      type: "object",
      required: ["tag"],
      properties: {
        tag: { type: "string", description: "Sticker tag such as 可爱, 无语, 闭嘴, 感动, or OK." },
        limit: { type: "integer", description: "Optional maximum number of candidates to return." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.sticker.pick(args);
      return {
        text: `Sticker candidates loaded: ${result.candidates.length}.`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_sticker_send",
    description: "Send a saved sticker back to the current WeChat chat by sticker id.",
    shortHint: "Send a saved sticker by id.",
    topics: ["sticker"],
    inputSchema: {
      type: "object",
      required: ["stickerId"],
      properties: {
        stickerId: { type: "string", description: "Sticker id such as stk_001." },
        userId: { type: "string", description: "Optional explicit WeChat user id." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const result = await services.sticker.sendToCurrentChat(args, context);
      return {
        text: `Sticker sent: ${result.stickerId}`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_sticker_delete",
    description: "Delete one or more saved stickers by sticker id and remove their local GIF files.",
    shortHint: "Delete saved stickers by id array.",
    topics: ["sticker"],
    inputSchema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["stickerId"],
            properties: {
              stickerId: { type: "string", description: "Sticker id such as stk_001." },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const result = await services.sticker.delete(args, context);
      return {
        text: `Sticker batch deleted: ${result.deletedCount}.`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_sticker_save_from_inbox",
    description: `Save one or more inbox images as reusable sticker GIFs after reading them all. Use an items array even for one sticker. ${STICKER_TAG_GUIDANCE} ${STICKER_DESC_GUIDANCE}`,
    shortHint: "Save inbox stickers with an items array.",
    topics: ["sticker"],
    inputSchema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          description: "One to ten inbox stickers to save in one call.",
          items: {
            type: "object",
            required: ["filePath", "tags", "desc"],
            properties: {
              filePath: { type: "string", description: "Absolute inbox image path under ~/.cyberboss/inbox." },
              tags: {
                type: "array",
                description: "One to three sticker tags. New short tags are allowed when the current catalog does not fit.",
                items: { type: "string" },
              },
              desc: { type: "string", description: STICKER_DESC_FIELD_DESCRIPTION },
            },
            additionalProperties: false,
          },
        },
        userId: { type: "string", description: "Optional explicit WeChat user id." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const result = await services.sticker.saveFromInbox(args, context);
      const duplicateNote = result.dedupedCount > 0
        ? " Existing stickers usually mean the user only sent them for you to see. Do not mention duplicates; just reply normally."
        : "";
      return {
        text: `Sticker batch processed: ${result.createdCount} saved, ${result.dedupedCount} already existed.${duplicateNote}`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_sticker_update",
    description: `Overwrite tags and desc for one or more saved stickers. Use an items array even for one sticker. ${STICKER_TAG_GUIDANCE} ${STICKER_DESC_GUIDANCE}`,
    shortHint: "Overwrite stickers with an items array.",
    topics: ["sticker"],
    inputSchema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["stickerId", "tags", "desc"],
            properties: {
              stickerId: { type: "string", description: "Sticker id such as stk_001." },
              tags: {
                type: "array",
                description: "One to three sticker tags. New short tags are allowed when needed.",
                items: { type: "string" },
              },
              desc: { type: "string", description: STICKER_DESC_FIELD_DESCRIPTION },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.sticker.update(args);
      return {
        text: `Sticker batch updated: ${result.updatedCount}.`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_timeline_read",
    description: "Read the current timeline day data for a specific date. Use this before editing when the current day state is uncertain.",
    shortHint: "Read a timeline day before editing it.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      required: ["date"],
      properties: {
        date: { type: "string", description: "Target date in YYYY-MM-DD." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.timeline.read(args);
      const exists = !!result?.data?.exists;
      const eventCount = Number.isInteger(result?.data?.eventCount) ? result.data.eventCount : 0;
      return {
        text: `Timeline day ${args.date}: ${exists ? `${eventCount} events` : "missing"}.`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_timeline_categories",
    description: "List the current timeline taxonomy categories, subcategories, and event nodes. Use this before choosing category ids or event nodes.",
    shortHint: "Inspect the current timeline taxonomy before choosing category ids or event nodes.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler({ services }) {
      const result = await services.timeline.listCategories();
      const categoryCount = Number.isInteger(result?.data?.categoryCount) ? result.data.categoryCount : 0;
      return {
        text: `Timeline categories loaded: ${categoryCount}.`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_timeline_proposals",
    description: "List proposed timeline event nodes, optionally filtered by date. Use this when deciding whether a new event node is actually needed.",
    shortHint: "Inspect proposed timeline event nodes before introducing new taxonomy.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Optional date in YYYY-MM-DD." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.timeline.listProposals(args);
      const proposalCount = Number.isInteger(result?.data?.proposalCount) ? result.data.proposalCount : 0;
      return {
        text: `Timeline proposals loaded: ${proposalCount}.`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_timeline_write",
    description: "Write timeline events through timeline-for-agent. If category ids, subcategory ids, event nodes, or existing day content are uncertain, first use cyberboss_timeline_read and cyberboss_timeline_categories, and use cyberboss_timeline_proposals before introducing new taxonomy. Do not inspect local files to guess timeline structure.",
    shortHint: "Write timeline events only after tool-based day/taxonomy inspection when structure is uncertain.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      required: ["date", "events"],
      properties: {
        date: { type: "string", description: "Target date in YYYY-MM-DD." },
        events: {
          type: "array",
          description: "Timeline events for the target date.",
          items: {
            type: "object",
            required: ["startAt", "endAt"],
            properties: {
              id: { type: "string" },
              startAt: { type: "string", description: "ISO datetime within the target date." },
              endAt: { type: "string", description: "ISO datetime within the target date." },
              title: { type: "string", description: "Event title. Required unless eventNodeId resolves a taxonomy label." },
              note: { type: "string" },
              description: { type: "string" },
              categoryId: { type: "string" },
              subcategoryId: { type: "string" },
              eventNodeId: { type: "string", description: "Timeline taxonomy node id. Use this or provide a title." },
              tags: {
                type: "array",
                items: { type: "string" },
              },
            },
            additionalProperties: true,
          },
        },
        locale: { type: "string", description: "Optional timeline locale." },
        mode: { type: "string", description: "Optional write mode, usually merge." },
        finalize: { type: "boolean", description: "Whether to finalize the day after writing." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      validateTimelineWriteArgs(args);
      const result = await services.timeline.write(args);
      return {
        text: "Timeline write completed.",
        data: result,
      };
    },
  },
  {
    name: "cyberboss_timeline_build",
    description: "Build the timeline site through timeline-for-agent.",
    shortHint: "Build the timeline site, optionally with locale.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      properties: {
        locale: { type: "string" },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.timeline.build(args);
      return {
        text: "Timeline build completed.",
        data: result,
      };
    },
  },
  {
    name: "cyberboss_timeline_serve",
    description: "Start the timeline static server through timeline-for-agent.",
    shortHint: "Serve the timeline site, optionally with locale.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      properties: {
        locale: { type: "string" },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.timeline.serve(args);
      return {
        text: result.url ? `Timeline serve started at ${result.url}` : "Timeline serve completed.",
        data: result,
      };
    },
  },
  {
    name: "cyberboss_timeline_dev",
    description: "Start the timeline dev server through timeline-for-agent.",
    shortHint: "Start the timeline dev server, optionally with locale.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      properties: {
        locale: { type: "string" },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.timeline.dev(args);
      return {
        text: result.url ? `Timeline dev started at ${result.url}` : "Timeline dev completed.",
        data: result,
      };
    },
  },
  {
    name: "cyberboss_timeline_screenshot",
    description: "Capture a timeline screenshot and send it back to the current WeChat chat.",
    shortHint: "Capture a timeline screenshot with structured selection fields.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "Optional explicit WeChat user id." },
        outputFile: { type: "string", description: "Optional absolute output path for the PNG file." },
        selector: { type: "string", description: "main, timeline, analytics, events, or a custom CSS selector." },
        range: { type: "string", description: "Optional range: day, week, or month." },
        date: { type: "string", description: "Optional day selector YYYY-MM-DD." },
        week: { type: "string", description: "Optional week key." },
        month: { type: "string", description: "Optional month selector YYYY-MM." },
        category: { type: "string", description: "Optional category label or id." },
        subcategory: { type: "string", description: "Optional subcategory label or id." },
        width: { type: "integer", description: "Optional viewport width in pixels." },
        height: { type: "integer", description: "Optional viewport height in pixels." },
        sidePadding: { type: "integer", description: "Optional screenshot padding in pixels." },
        locale: { type: "string", description: "Optional timeline locale." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const captured = await services.timeline.captureScreenshot(args);
      const delivery = await services.channelFile.sendToCurrentChat({
        userId: args.userId,
        filePath: captured.outputFile,
      }, context);
      return {
        text: `Timeline screenshot sent: ${captured.outputFile}`,
        data: {
          ...captured,
          delivery,
        },
      };
    },
  },
  ...createHabitToolSpecs(),
];

const STATIC_EXTRA_TOOL_NAMES = new WhereaboutsToolHost({ service: null })
  .listTools()
  .map((tool) => tool.name);

function createExtraToolHosts(services = {}) {
  const hosts = [];
  if (services.whereabouts) {
    hosts.push(new WhereaboutsToolHost({ service: services.whereabouts }));
  }
  return hosts;
}

function normalizeToolProfile(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "default") {
    return "default";
  }
  return "full";
}

function normalizeTurnIntent(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "pulse" || normalized === "reminder") {
    return normalized;
  }
  return "user_message";
}

function isBuiltInToolVisible(toolName, profile) {
  const normalizedProfile = normalizeToolProfile(profile);
  if (normalizedProfile !== "default") {
    return true;
  }
  return !DEFAULT_HIDDEN_TOOL_NAMES.has(normalizeText(toolName));
}

function unwrapStoredMemoryResult(result) {
  if (result?.action === "stored" && result.memory) {
    return result.memory;
  }
  return result;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function evaluateContactGapFloor({ config, runtimeContextStore, workspaceRoot }) {
  const maxGapMinutes = Number.parseInt(String(config?.maxContactGapMinutes || ""), 10);
  const thresholdMinutes = Number.isFinite(maxGapMinutes) && maxGapMinutes > 0 ? maxGapMinutes : 45;
  const floorState = runtimeContextStore?.getPulseExposureModule?.(workspaceRoot, "contactGapFloor");
  const lastBotOutboundAt = normalizeText(floorState?.lastBotOutboundAt);
  const lastUserMessageAt = normalizeText(floorState?.lastUserMessageAt);
  const anchorTime = lastBotOutboundAt || lastUserMessageAt;
  if (!anchorTime) {
    return { triggered: false, gapMinutes: null, quietHours: false, reason: "no contact anchor recorded yet" };
  }
  const lastMs = Date.parse(anchorTime);
  if (!Number.isFinite(lastMs)) {
    return { triggered: false, gapMinutes: null, quietHours: false, reason: "invalid contact anchor timestamp" };
  }
  const gapMs = Math.max(0, Date.now() - lastMs);
  const gapMinutes = Math.floor(gapMs / 60000);
  const inQuietHours = isWithinQuietHours(config?.quietHoursStart, config?.quietHoursEnd);
  if (inQuietHours) {
    return { triggered: false, gapMinutes, quietHours: true, reason: `quiet hours active (gap ${gapMinutes} min)` };
  }
  if (gapMinutes >= thresholdMinutes) {
    return {
      triggered: true,
      gapMinutes,
      quietHours: false,
      reason: `it has been ${gapMinutes} minutes since the last contact (threshold ${thresholdMinutes} min); reach out now`,
    };
  }
  return { triggered: false, gapMinutes, quietHours: false, reason: `gap ${gapMinutes} min below threshold ${thresholdMinutes} min` };
}

function isWithinQuietHours(quietHoursStart, quietHoursEnd, now = new Date()) {
  const start = parseHourMinute(quietHoursStart);
  const end = parseHourMinute(quietHoursEnd);
  if (start === null || end === null) {
    return false;
  }
  const localTime = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const parts = localTime.split(":").map(Number);
  const currentMinutes = parts[0] * 60 + parts[1];
  if (start <= end) {
    return currentMinutes >= start && currentMinutes < end;
  }
  return currentMinutes >= start || currentMinutes < end;
}

function parseHourMinute(value) {
  if (typeof value !== "string") {
    return null;
  }
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

const ACTIVITY_STALE_MS = 30 * 60 * 1000;

function buildPulseReviewSummary({
  turnIntent,
  context,
  userState,
  habitStatus,
  habitSuggestion,
  obsidian,
  memories,
  activities,
  contactGapFloor = null,
}) {
  const incompleteHabits = Array.isArray(habitStatus?.habits)
    ? habitStatus.habits.filter((item) => item?.dailyState === "incomplete")
    : [];
  const openActivities = Array.isArray(activities?.activities) ? activities.activities : [];
  const durableMemories = Array.isArray(memories?.memories) ? memories.memories : [];

  // Activity analysis �?first priority regardless of turn intent.
  const isUserMessage = turnIntent === "user_message";
  const oldestActivity = openActivities.length
    ? openActivities.reduce((oldest, item) => {
        const itemMs = Date.parse(item?.createdAt || 0) || 0;
        const oldestMs = Date.parse(oldest?.createdAt || 0) || 0;
        return itemMs < oldestMs ? item : oldest;
      })
    : null;
  const oldestActivityAgeMs = oldestActivity
    ? Math.max(0, Date.now() - (Date.parse(oldestActivity.createdAt) || 0))
    : 0;
  const oldestActivityAgeMinutes = Math.floor(oldestActivityAgeMs / 60000);
  const hasStaleActivity = openActivities.length > 0 && oldestActivityAgeMs >= ACTIVITY_STALE_MS;
  const hasNoOpenActivities = openActivities.length === 0;

  const currentContextSummary = {
    turnIntent,
    context: normalizeText(context),
    userState: normalizeText(userState),
    openActivityCount: openActivities.length,
    oldestActivityAgeMinutes,
    hasStaleActivity,
    hasNoOpenActivities,
    incompleteHabitCount: incompleteHabits.length,
    memoryCount: durableMemories.length,
    obsidianSource: normalizeText(obsidian?.source) || "none",
    obsidianFound: detectObsidianSignal(obsidian),
    contactGapMinutes: contactGapFloor?.gapMinutes ?? null,
    contactGapFloorTriggered: contactGapFloor?.triggered ?? false,
    quietHoursActive: contactGapFloor?.quietHours ?? false,
  };

  // Priority: activity first, then reminder, then habit, then obsidian.
  const shouldContactForActivity = (turnIntent === "pulse" && (hasStaleActivity || hasNoOpenActivities))
    || (turnIntent === "reminder" && hasStaleActivity);
  const shouldContactForReminder = turnIntent === "reminder";
  const shouldContactForHabit = habitSuggestion?.shouldContactUser === true;
  const shouldContactForFloor = contactGapFloor?.triggered === true;
  const hasInterestingObsidianSignal = detectObsidianSignal(obsidian);
  const shouldContactUser = shouldContactForActivity || shouldContactForReminder || shouldContactForHabit || shouldContactForFloor;
  const topIncompleteHabit = incompleteHabits[0] || null;

  const reasons = [];
  if (shouldContactForActivity) {
    if (hasNoOpenActivities) {
      reasons.push("no open activities tracked; ask the user what they are doing or about to do");
    } else if (hasStaleActivity) {
      reasons.push(`an activity has been open for ${oldestActivityAgeMinutes} minutes; check whether it is still active or should be completed or dropped`);
    }
  }
  if (shouldContactForReminder) {
    reasons.push("a reminder is due now");
  }
  if (shouldContactForHabit) {
    reasons.push(normalizeText(habitSuggestion?.reason) || "a habit nudge looks appropriate");
  }
  if (shouldContactForFloor) {
    reasons.push(normalizeText(contactGapFloor?.reason) || "the user has been silent too long; a check-in is required");
  }
  if (!reasons.length && hasInterestingObsidianSignal) {
    reasons.push("Obsidian contains a potentially relevant signal, but it may only justify private review");
  }
  if (!reasons.length) {
    reasons.push("no strong interruption-worthy signal was found");
  }

  const recommendedPrivateActions = [];
  let followupOpportunity = {
    shouldSetReminder: false,
    reason: "no habit- or context-based follow-up stood out",
    reminderText: "",
    suggestedDelayMinutes: null,
  };

  // Activity-first recommended actions.
  // For reminder turns, frame as user-facing contact, not internal review.
  const isReminder = turnIntent === "reminder";
  if (hasStaleActivity) {
    if (isReminder) {
      recommendedPrivateActions.push(`send a message to the user about the open activity "${oldestActivity?.title || ""}" (open for ${oldestActivityAgeMinutes} min); ask whether it is done, in progress, or abandoned. Do not stay silent.`);
    } else {
      recommendedPrivateActions.push(`review the oldest open activity "${oldestActivity?.title || ""}" (open for ${oldestActivityAgeMinutes} min); complete, drop, or check with the user`);
    }
  }
  if (hasNoOpenActivities && isUserMessage) {
    recommendedPrivateActions.push("consider asking the user what they are working on or about to do, and capture it as an activity");
  }
  if (openActivities.length > 0 && !hasStaleActivity) {
    if (isReminder) {
      recommendedPrivateActions.push(`send a brief message to the user checking on their open activity "${openActivities[0]?.title || ""}"; do not assume it is done without confirmation`);
    } else {
      recommendedPrivateActions.push("review open activities and complete or drop any that are resolved");
    }
  }
  if (hasNoOpenActivities && isReminder) {
    recommendedPrivateActions.push("send a brief check-in message to the user; ask what they are working on or about to do");
  }
  if (shouldContactForFloor) {
    recommendedPrivateActions.push(`the user has been silent for ${contactGapFloor?.gapMinutes ?? "many"} minutes; send a brief check-in grounded in current activities or context`);
  }

  // Habit follow-up.
  if (!shouldContactForReminder && incompleteHabits.length > 0) {
    followupOpportunity = {
      shouldSetReminder: true,
      reason: shouldContactForHabit
        ? "an incomplete habit matters today; either remind the user now or schedule a follow-up reminder"
        : "at least one habit is still incomplete today, so a follow-up reminder is usually warranted",
      reminderText: topIncompleteHabit
        ? `Check whether ${topIncompleteHabit.habit.title} is still undone today, and either remind her or mark the day cleanly.`
        : "Check whether today's remaining habits still need a reminder or a clean reset.",
      suggestedDelayMinutes: shouldContactForHabit ? 90 : 180,
    };
  }
  if (followupOpportunity.shouldSetReminder && !shouldContactForReminder) {
    recommendedPrivateActions.push("set a reminder for today's incomplete habit instead of letting it disappear");
  }

  // Obsidian review (only surfaced for non-user-message turns).
  if (hasInterestingObsidianSignal && !shouldContactUser && !isUserMessage) {
    recommendedPrivateActions.push("review the Obsidian result before deciding whether to message the user");
  }

  if (!recommendedPrivateActions.length) {
    if (isReminder) {
      recommendedPrivateActions.push("send a brief message to the user; this is a due reminder and should not be ignored");
    } else {
      recommendedPrivateActions.push("stay silent and wait for a better trigger");
    }
  }

  return {
    currentContextSummary,
    messageOpportunity: {
      shouldContactUser,
      primaryReason: reasons[0],
      reasons,
    },
    followupOpportunity,
    recommendedPrivateActions,
  };
}

function detectObsidianSignal(obsidian) {
  if (!obsidian || typeof obsidian !== "object") {
    return false;
  }
  const result = obsidian.result;
  if (!result || typeof result !== "object") {
    return false;
  }
  if (result.found === true && normalizeText(result.excerpt)) {
    return true;
  }
  if (Number.isInteger(result.resultCount) && result.resultCount > 0) {
    return true;
  }
  return false;
}

const PULSE_DETAIL_COOLDOWN_MS = 60 * 60 * 1000;

// Pulse memory path: search top PULSE_SEARCH_CANDIDATE_LIMIT items, skip any id
// already surfaced within the last PULSE_SHOWN_ROUNDS_WINDOW pulses, then return
// the top PULSE_SEARCH_TOP. When embedding is configured the search is semantic;
// otherwise it degrades to token/substring matching. Dedup applies to both paths.
const PULSE_SEARCH_TOP = 3;
const PULSE_SEARCH_CANDIDATE_LIMIT = 6;
const PULSE_SHOWN_ROUNDS_WINDOW = 10;

function getShownIdSet(runtimeContextStore, workspaceKey, moduleName) {
  const state = runtimeContextStore?.getPulseExposureModule?.(workspaceKey, moduleName);
  const rounds = Array.isArray(state?.shownRounds) ? state.shownRounds : [];
  return new Set(rounds.flat().filter(Boolean));
}

function recordPulseShownIds(runtimeContextStore, workspaceKey, moduleName, ids = []) {
  const state = runtimeContextStore?.getPulseExposureModule?.(workspaceKey, moduleName) || {};
  const rounds = Array.isArray(state.shownRounds) ? state.shownRounds : [];
  const cleanIds = (Array.isArray(ids) ? ids : []).map(normalizeText).filter(Boolean);
  const nextRounds = [...rounds, cleanIds].slice(-PULSE_SHOWN_ROUNDS_WINDOW);
  runtimeContextStore?.setPulseExposureModule?.(workspaceKey, moduleName, {
    shownRounds: nextRounds,
    lastSearchedAt: new Date().toISOString(),
  });
  return nextRounds;
}

async function collectPulseSearchMemories({
  services,
  context,
  runtimeContextStore,
  workspaceKey,
  enabled,
}) {
  if (!enabled) {
    return { mode: "disabled", result: { count: 0, memories: [] }, reason: "module disabled for this pulse" };
  }
  const query = normalizeText(context);
  const embeddingConfigured = services.embedding?.isConfigured?.() === true;
  const result = await services.agentMemory.search({
    query,
    limit: embeddingConfigured ? PULSE_SEARCH_CANDIDATE_LIMIT : PULSE_SEARCH_TOP,
    includeArchived: false,
  });
  const shownSet = getShownIdSet(runtimeContextStore, workspaceKey, "memories");
  const candidates = Array.isArray(result?.memories) ? result.memories : [];
  const picked = candidates
    .filter((item) => !shownSet.has(normalizeText(item?.id)))
    .slice(0, PULSE_SEARCH_TOP);
  recordPulseShownIds(
    runtimeContextStore,
    workspaceKey,
    "memories",
    picked.map((item) => normalizeText(item?.id)),
  );
  const mode = embeddingConfigured ? "semantic" : "token";
  return {
    mode,
    result: {
      filePath: result?.filePath || "",
      query: result?.query || query,
      count: picked.length,
      memories: picked,
    },
    reason: picked.length
      ? `${mode} search top-${PULSE_SEARCH_TOP} after id dedup`
      : `no new memories matched after dedup (${mode})`,
  };
}


function resolvePulseWorkspaceKey(context = {}) {
  return normalizeText(context?.workspaceRoot) || "__global__";
}

function decidePulseExposure({
  runtimeContextStore,
  workspaceKey,
  moduleName,
  version,
  enabled = true,
} = {}) {
  if (!enabled) {
    return { mode: "disabled", reason: "module disabled for this pulse", version: "" };
  }
  const normalizedModuleName = normalizeText(moduleName);
  const normalizedWorkspaceKey = normalizeText(workspaceKey) || "__global__";
  const normalizedVersion = normalizeText(version);
  const currentMs = Date.now();
  const exposureState = runtimeContextStore?.getPulseExposureModule?.(normalizedWorkspaceKey, normalizedModuleName) || null;
  if (!exposureState || !normalizeText(exposureState.lastVersion)) {
    runtimeContextStore?.setPulseExposureModule?.(normalizedWorkspaceKey, normalizedModuleName, {
      lastVersion: normalizedVersion,
      lastFullAt: new Date(currentMs).toISOString(),
      lastMode: "full",
    });
    return { mode: "full", reason: "first exposure", version: normalizedVersion };
  }
  const lastVersion = normalizeText(exposureState.lastVersion);
  const lastFullMs = Date.parse(exposureState.lastFullAt || "") || 0;
  const versionChanged = normalizedVersion && lastVersion !== normalizedVersion;
  const cooldownExpired = !lastFullMs || currentMs - lastFullMs >= PULSE_DETAIL_COOLDOWN_MS;
  const shouldExposeFull = versionChanged || cooldownExpired;
  runtimeContextStore?.setPulseExposureModule?.(normalizedWorkspaceKey, normalizedModuleName, {
    lastVersion: normalizedVersion || lastVersion,
    lastFullAt: shouldExposeFull ? new Date(currentMs).toISOString() : exposureState.lastFullAt || "",
    lastMode: shouldExposeFull ? "full" : "summary",
  });
  return {
    mode: shouldExposeFull ? "full" : "summary",
    reason: versionChanged ? "state changed" : (cooldownExpired ? "cooldown expired" : "within cooldown and unchanged"),
    version: normalizedVersion || lastVersion,
  };
}

function buildHabitExposureVersion(snapshot = {}) {
  const date = normalizeText(snapshot?.date);
  const signature = normalizeText(snapshot?.signature);
  const stateEventCount = Number(snapshot?.stateEventCount) || 0;
  return [date, stateEventCount, signature].filter(Boolean).join("|");
}

function buildDailyExcerptExposureVersion() {
  const now = new Date();
  const dayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return `daily_excerpt|${dayKey}`;
}

function buildFileExposureVersion(filePath = "") {
  const normalizedPath = normalizeText(filePath);
  if (!normalizedPath) {
    return "";
  }
  try {
    const stats = fs.statSync(normalizedPath);
    return `${normalizedPath}|${Number(stats.mtimeMs || 0)}`;
  } catch {
    return normalizedPath;
  }
}

function applyHabitPulseExposure(habitStatus, exposure) {
  if (exposure?.mode !== "summary") {
    return {
      ...habitStatus,
      exposureMode: exposure?.mode || "full",
      exposureReason: exposure?.reason || "",
    };
  }
  const habits = Array.isArray(habitStatus?.habits) ? habitStatus.habits : [];
  const summary = summarizeHabitStatus(habits);
  return {
    filePath: habitStatus?.filePath || "",
    date: habitStatus?.date || "",
    count: Number(habitStatus?.count) || habits.length,
    habits: [],
    summary,
    exposureMode: "summary",
    exposureReason: exposure?.reason || "",
    detailsSuppressed: true,
  };
}

function summarizeHabitStatus(habits) {
  const items = Array.isArray(habits) ? habits : [];
  const summary = {
    doneCount: 0,
    incompleteCount: 0,
    abandonedCount: 0,
    topIncompleteHabits: [],
  };
  for (const item of items) {
    const state = normalizeText(item?.dailyState) || "incomplete";
    if (state === "done") summary.doneCount += 1;
    else if (state === "incomplete") summary.incompleteCount += 1;
    else if (state === "abandoned") summary.abandonedCount += 1;
  }
  summary.topIncompleteHabits = items
    .filter((item) => normalizeText(item?.dailyState) === "incomplete")
    .slice(0, 3)
    .map((item) => ({
      habitId: normalizeText(item?.habit?.id),
      title: normalizeText(item?.habit?.title),
      canNudge: item?.canNudge === true,
    }))
    .filter((item) => item.habitId || item.title);
  return summary;
}

function normalizeHabitSuggestionForPulse(habitSuggestion) {
  const suggestion = habitSuggestion && typeof habitSuggestion === "object"
    ? { ...habitSuggestion }
    : {};
  if (!normalizeText(suggestion.reason)) {
    delete suggestion.reason;
  }
  return suggestion;
}

function buildToolDescription(tool) {
  const baseDescription = normalizeText(tool?.description);
  const signature = summarizeSchema(tool?.inputSchema);
  if (!signature) {
    return baseDescription;
  }
  return `${baseDescription} Input: ${signature}`;
}

function summarizeSchema(schema, { depth = 0 } = {}) {
  if (!schema || typeof schema !== "object") {
    return "";
  }
  const schemaType = normalizeText(schema.type).toLowerCase();
  if (schemaType === "object") {
    const properties = schema.properties && typeof schema.properties === "object"
      ? schema.properties
      : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const entries = Object.entries(properties);
    if (!entries.length) {
      return "{}";
    }
    const parts = entries.map(([key, value]) => {
      const suffix = required.has(key) ? "" : "?";
      return `${key}${suffix}: ${summarizeSchema(value, { depth: depth + 1 }) || "any"}`;
    });
    return `{ ${parts.join(", ")} }`;
  }
  if (schemaType === "array") {
    const itemSummary = summarizeSchema(schema.items, { depth: depth + 1 }) || "any";
    return `${itemSummary}[]`;
  }
  if (schemaType === "integer" || schemaType === "number" || schemaType === "string" || schemaType === "boolean") {
    return schemaType;
  }
  return schemaType || "any";
}

function validateTimelineWriteArgs(args) {
  const events = Array.isArray(args?.events) ? args.events : [];
  events.forEach((event, index) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      return;
    }
    const hasTitle = normalizeText(event.title).length > 0;
    const hasEventNodeId = normalizeText(event.eventNodeId).length > 0;
    if (!hasTitle && !hasEventNodeId) {
      throw new Error(`cyberboss_timeline_write input.events[${index}].title or input.events[${index}].eventNodeId is required.`);
    }
  });
}

function validateSchema(schema, value, toolName, path) {
  if (!schema || typeof schema !== "object") {
    return;
  }
  const schemaType = schema.type;
  if (schemaType === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${toolName} ${path} must be an object.`);
    }
    const properties = schema.properties && typeof schema.properties === "object"
      ? schema.properties
      : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!(key in value)) {
        throw new Error(`${toolName} ${path}.${key} is required.`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          throw new Error(`${toolName} ${path}.${key} is not allowed.`);
        }
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (key in value) {
        validateSchema(propertySchema, value[key], toolName, `${path}.${key}`);
      }
    }
    return;
  }
  if (schemaType === "array") {
    if (!Array.isArray(value)) {
      throw new Error(`${toolName} ${path} must be an array.`);
    }
    if (schema.items) {
      value.forEach((item, index) => validateSchema(schema.items, item, toolName, `${path}[${index}]`));
    }
    return;
  }
  if (schemaType === "string" && typeof value !== "string") {
    throw new Error(`${toolName} ${path} must be a string.`);
  }
  if (schemaType === "boolean" && typeof value !== "boolean") {
    throw new Error(`${toolName} ${path} must be a boolean.`);
  }
  if (schemaType === "integer" && !Number.isInteger(value)) {
    throw new Error(`${toolName} ${path} must be an integer.`);
  }
  if (schemaType === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error(`${toolName} ${path} must be a number.`);
  }
}

module.exports = {
  ProjectToolHost,
  listProjectToolNames,
};

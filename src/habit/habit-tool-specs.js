function createHabitToolSpecs() {
  return [
    {
      name: "cyberboss_habit_upsert",
      description: "Create or update a long-running habit definition. Habits are contextual recurring rhythms, not fixed repeated reminders.",
      shortHint: "Create or update a habit.",
      topics: ["habit", "reminder", "task"],
      inputSchema: {
        type: "object",
        required: ["title"],
        properties: {
          id: { type: "string", description: "Stable habit id. Defaults to a slug from title." },
          title: { type: "string" },
          cadence: { type: "string", description: "Currently daily." },
          status: { type: "string", description: "active, paused, or archived." },
          preferredWindows: { type: "array", items: { type: "string" }, description: "Context windows like lunch, before_sleep, morning." },
          contexts: { type: "array", items: { type: "string" }, description: "Useful contexts such as at_home, after_meal, low_cognitive_load." },
          avoidContexts: { type: "array", items: { type: "string" }, description: "Contexts where nudges should be avoided, such as deep_work or emotionally_overloaded." },
          promptStyle: { type: "string", description: "Reminder style guidance, e.g. gentle_varied." },
          cooldownMinutes: { type: "integer", description: "Minimum minutes between nudges. Defaults to 180." },
          minimumVersion: { type: "string", description: "Smallest acceptable version, e.g. just vitamin D." },
          notes: { type: "string" },
        },
        additionalProperties: false,
      },
      async handler({ services, args }) {
        const result = services.habit.upsertDefinition(args);
        return {
          text: `Habit saved: ${result.title}`,
          data: result,
        };
      },
    },
    {
      name: "cyberboss_habit_list",
      description: "List habit definitions.",
      shortHint: "List habits.",
      topics: ["habit"],
      inputSchema: {
        type: "object",
        properties: {
          includeArchived: { type: "boolean" },
        },
        additionalProperties: false,
      },
      async handler({ services, args }) {
        const result = services.habit.listDefinitions(args);
        return {
          text: `Habits loaded: ${result.count}.`,
          data: result,
        };
      },
    },
    {
      name: "cyberboss_habit_status_today",
      description: "Read today's habit state. Each habit is exactly one of done, incomplete, or abandoned for the day, plus nudge metadata.",
      shortHint: "Read today's habit status.",
      topics: ["habit"],
      inputSchema: {
        type: "object",
        properties: {
          habitId: { type: "string" },
          date: { type: "string", description: "Optional YYYY-MM-DD date. Defaults to today in Asia/Shanghai." },
        },
        additionalProperties: false,
      },
      async handler({ services, args }) {
        const result = services.habit.statusToday(args);
        return {
          text: `Habit status ${result.date}: ${result.count}.`,
          data: result,
        };
      },
    },
    {
      name: "cyberboss_habit_history",
      description: "Read historical habit day-state data shaped for heatmaps, dashboards, or external plugins.",
      shortHint: "Read habit history for analytics/heatmaps.",
      topics: ["habit", "analytics"],
      inputSchema: {
        type: "object",
        properties: {
          habitId: { type: "string" },
          from: { type: "string", description: "Optional start date YYYY-MM-DD." },
          to: { type: "string", description: "Optional end date YYYY-MM-DD." },
          days: { type: "integer", description: "Optional trailing day window. Defaults to 120." },
          includeArchived: { type: "boolean" },
        },
        additionalProperties: false,
      },
      async handler({ services, args }) {
        const result = services.habit.history(args);
        return {
          text: `Habit history ${result.from} to ${result.to}: ${result.count} habits.`,
          data: result,
        };
      },
    },
    {
      name: "cyberboss_habit_mark_done",
      description: "Set today's mutually exclusive habit state to done. This can replace today's incomplete or abandoned state.",
      shortHint: "Mark habit done.",
      topics: ["habit"],
      inputSchema: {
        type: "object",
        required: ["habitId"],
        properties: {
          habitId: { type: "string" },
          note: { type: "string" },
          source: { type: "string" },
          createdAt: { type: "string" },
        },
        additionalProperties: false,
      },
      async handler({ services, args }) {
        const result = services.habit.markDone(args);
        return {
          text: `Habit done: ${result.habitId}`,
          data: result,
        };
      },
    },
    {
      name: "cyberboss_habit_mark_incomplete",
      description: "Set today's mutually exclusive habit state to incomplete. Use when the habit is still open and may be nudged later.",
      shortHint: "Mark habit incomplete.",
      topics: ["habit"],
      inputSchema: {
        type: "object",
        required: ["habitId"],
        properties: {
          habitId: { type: "string" },
          note: { type: "string" },
          source: { type: "string" },
          createdAt: { type: "string" },
        },
        additionalProperties: false,
      },
      async handler({ services, args }) {
        const result = services.habit.markIncomplete(args);
        return {
          text: `Habit incomplete: ${result.habitId}`,
          data: result,
        };
      },
    },
    {
      name: "cyberboss_habit_mark_abandoned",
      description: "Set today's mutually exclusive habit state to abandoned. Only use when the user explicitly signals giving up for today. The note field is REQUIRED and must quote the user's exact words (e.g. note: \"我今天不想吃药了\"). Without an explicit user give-up signal, do not mark abandoned — leave it incomplete instead.",
      shortHint: "Mark habit abandoned.",
      topics: ["habit"],
      inputSchema: {
        type: "object",
        required: ["habitId"],
        properties: {
          habitId: { type: "string" },
          note: { type: "string", description: "REQUIRED. Quote the user's exact words that signal giving up for today." },
          source: { type: "string" },
          createdAt: { type: "string" },
        },
        additionalProperties: false,
      },
      async handler({ services, args }) {
        const result = services.habit.markAbandoned(args);
        return {
          text: `Habit abandoned: ${result.habitId}`,
          data: result,
        };
      },
    },
    {
      name: "cyberboss_habit_mark_skipped",
      description: "Compatibility alias for cyberboss_habit_mark_abandoned. Same note requirement applies: note must quote the user's exact give-up words.",
      shortHint: "Mark habit skipped.",
      topics: ["habit"],
      inputSchema: {
        type: "object",
        required: ["habitId"],
        properties: {
          habitId: { type: "string" },
          note: { type: "string", description: "REQUIRED. Quote the user's exact words that signal giving up for today." },
          source: { type: "string" },
          createdAt: { type: "string" },
        },
        additionalProperties: false,
      },
      async handler({ services, args }) {
        const result = services.habit.markSkipped(args);
        return {
          text: `Habit skipped: ${result.habitId}`,
          data: result,
        };
      },
    },
    {
      name: "cyberboss_habit_log_event",
      description: "Log a habit event such as nudged, deferred, note, done, incomplete, or abandoned.",
      shortHint: "Log a habit event.",
      topics: ["habit"],
      inputSchema: {
        type: "object",
        required: ["habitId", "type"],
        properties: {
          habitId: { type: "string" },
          type: { type: "string", description: "done, incomplete, abandoned, nudged, deferred, note, or legacy skipped." },
          note: { type: "string" },
          source: { type: "string" },
          context: { type: "string" },
          createdAt: { type: "string" },
        },
        additionalProperties: false,
      },
      async handler({ services, args }) {
        const result = services.habit.logEvent(args);
        return {
          text: `Habit event logged: ${result.type}`,
          data: result,
        };
      },
    },
    {
      name: "cyberboss_habit_suggest_next_action",
      description: "Evaluate active habits against current context and suggest whether a contextual low-shame nudge is appropriate now.",
      shortHint: "Suggest habit nudge/action.",
      topics: ["habit", "pulse", "reminder"],
      inputSchema: {
        type: "object",
        properties: {
          context: { type: "string", description: "Current scene, time window, whereabouts, or conversation context." },
          userState: { type: "string", description: "Current inferred user state such as focused, low load, at home, after meal." },
          limit: { type: "integer" },
        },
        additionalProperties: false,
      },
      async handler({ services, args }) {
        const result = services.habit.suggestNextAction(args);
        return {
          text: result.shouldContactUser ? "Habit nudge opportunity found." : "No habit nudge opportunity found.",
          data: result,
        };
      },
    },
  ];
}

module.exports = { createHabitToolSpecs };

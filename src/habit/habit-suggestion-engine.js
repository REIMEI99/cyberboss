class HabitSuggestionEngine {
  suggestNextAction({ habitStatus, context = "", userState = "", limit = 3 } = {}) {
    const nowMs = Date.now();
    const statusItems = Array.isArray(habitStatus?.habits) ? habitStatus.habits : [];
    const normalizedContext = normalizeText(context).toLowerCase();
    const normalizedUserState = normalizeText(userState).toLowerCase();
    const candidates = statusItems
      .filter((item) => item.habit.status === "active")
      .filter((item) => item.dailyState === "incomplete")
      .map((item) => ({
        ...item,
        score: scoreHabitOpportunity(item, `${normalizedContext} ${normalizedUserState}`, nowMs),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.habit.title.localeCompare(right.habit.title))
      .slice(0, normalizeLimit(limit));
    const best = candidates[0] || null;
    return {
      shouldContactUser: Boolean(best && best.canNudge),
      reason: best
        ? buildSuggestionReason(best)
        : "No active incomplete habit currently looks appropriate.",
      suggestions: candidates.map(buildHabitSuggestion),
    };
  }
}

function scoreHabitOpportunity(status, context, nowMs) {
  if (!status.canNudge) {
    return 0;
  }
  const habit = status.habit;
  let score = 1;
  const avoidHit = habit.avoidContexts.some((item) => context.includes(item.toLowerCase()));
  if (avoidHit) {
    return 0;
  }
  for (const item of habit.contexts) {
    if (context.includes(item.toLowerCase())) {
      score += 3;
    }
  }
  for (const item of habit.preferredWindows) {
    if (context.includes(item.toLowerCase())) {
      score += 2;
    }
  }
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    hour12: false,
  }).format(new Date(nowMs)));
  if (hour >= 10 && hour <= 23) {
    score += 1;
  }
  return score;
}

function buildHabitSuggestion(item) {
  const habit = item.habit;
  return {
    habitId: habit.id,
    title: habit.title,
    shouldContactUser: item.canNudge,
    reason: buildSuggestionReason(item),
    messageGuidance: buildMessageGuidance(habit),
    fallbackPrivateAction: `Record why ${habit.title} was not nudged now, or update its context/cooldown if the timing was wrong.`,
  };
}

function buildSuggestionReason(item) {
  const habit = item.habit;
  const bits = [`today state: ${item.dailyState || "incomplete"}`];
  if (habit.preferredWindows.length) {
    bits.push(`preferred windows: ${habit.preferredWindows.join(", ")}`);
  }
  if (habit.contexts.length) {
    bits.push(`useful contexts: ${habit.contexts.join(", ")}`);
  }
  if (item.lastNudgeAt) {
    bits.push(`last nudge: ${item.lastNudgeAt}`);
  }
  return bits.join("; ");
}

function buildMessageGuidance(habit) {
  const minimum = habit.minimumVersion
    ? ` Offer the minimum viable version: ${habit.minimumVersion}.`
    : " Offer a minimum viable version so this does not feel like a full task.";
  return `Write one fresh, context-aware, low-shame message about "${habit.title}". Avoid repeating fixed wording.${minimum}`;
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 3;
  }
  return Math.min(parsed, 20);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { HabitSuggestionEngine };

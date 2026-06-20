const { HabitStateService } = require("./habit-state-service");
const { HabitSuggestionEngine } = require("./habit-suggestion-engine");

class HabitService {
  constructor(options = {}) {
    this.stateService = new HabitStateService(options);
    this.suggestionEngine = new HabitSuggestionEngine();
  }

  upsertDefinition(input = {}) {
    return this.stateService.upsertDefinition(input);
  }

  listDefinitions(args = {}) {
    return this.stateService.listDefinitions(args);
  }

  history(args = {}) {
    return this.stateService.history(args);
  }

  exportHeatmap(args = {}) {
    return this.stateService.exportHeatmap(args);
  }

  statusToday(args = {}) {
    return this.stateService.statusToday(args);
  }

  logEvent(args = {}) {
    return this.stateService.logEvent(args);
  }

  markDone(args = {}) {
    return this.stateService.markDone(args);
  }

  markIncomplete(args = {}) {
    return this.stateService.markIncomplete(args);
  }

  markAbandoned(args = {}) {
    return this.stateService.markAbandoned(args);
  }

  markSkipped(args = {}) {
    return this.stateService.markSkipped(args);
  }

  suggestNextAction({ context = "", userState = "", limit = 3 } = {}) {
    const habitStatus = this.stateService.statusToday({});
    return this.suggestionEngine.suggestNextAction({
      habitStatus,
      context,
      userState,
      limit,
    });
  }
}

module.exports = { HabitService };

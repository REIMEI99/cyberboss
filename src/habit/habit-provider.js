class HabitProvider {
  constructor({ habitService }) {
    if (!habitService) {
      throw new Error("HabitProvider requires habitService.");
    }
    this.habitService = habitService;
  }

  getPulseSnapshot({ context = "", userState = "", limit = 3 } = {}) {
    const habitStatus = this.habitService.statusToday({});
    const habitSuggestion = this.habitService.suggestNextAction({
      context,
      userState,
      limit,
    });
    return {
      habitStatus,
      habitSuggestion,
    };
  }
}

module.exports = { HabitProvider };

const test = require("node:test");
const assert = require("node:assert/strict");

const { ProjectToolHost } = require("../src/tools/tool-host");

function createHost() {
  return new ProjectToolHost({
    services: {
      diary: {
        async append(args) {
          return { filePath: "/tmp/diary.md", ...args };
        },
      },
      reminder: {
        async create(args) {
          return { id: "reminder-1", followupDelayMinutes: args.followupDelayMinutes || 15, ...args };
        },
        list(args) {
          return {
            count: 1,
            reminders: [{
              id: "reminder-1",
              text: "order food",
              followupDelayMinutes: 15,
              senderId: args.userId || "user-1",
              dueAtMs: 123,
            }],
          };
        },
        complete(args) {
          return { id: args.id, text: "order food" };
        },
      },
      system: {
        queueMessage(args) {
          return { id: "system-1", ...args };
        },
      },
      seedbox: {
        create(args) {
          return {
            id: "seed-1",
            kind: args.kind || "wishseed",
            title: args.title,
            tags: args.tags || [],
            notes: args.notes || "",
            createdAt: "2026-06-21T00:00:00.000Z",
            updatedAt: "2026-06-21T00:00:00.000Z",
            completedAt: "",
          };
        },
        list(args) {
          return {
            count: 1,
            items: [{
              id: "seed-1",
              kind: args.kind || "wishseed",
              title: "Read later",
              tags: [],
              notes: "",
              createdAt: "2026-06-21T00:00:00.000Z",
              updatedAt: "2026-06-21T00:00:00.000Z",
              completedAt: "",
            }],
          };
        },
        update(args) {
          return {
            id: args.id,
            kind: args.kind || "wishseed",
            title: args.title || "Read later",
            tags: args.tags || [],
            notes: args.notes || "",
            createdAt: "2026-06-21T00:00:00.000Z",
            updatedAt: "2026-06-21T01:00:00.000Z",
            completedAt: "",
          };
        },
        complete(args) {
          return {
            id: args.id,
            kind: "wishseed",
            title: "Read later",
            tags: [],
            notes: args.notes || "",
            createdAt: "2026-06-21T00:00:00.000Z",
            updatedAt: "2026-06-21T02:00:00.000Z",
            completedAt: "2026-06-21T02:00:00.000Z",
          };
        },
      },
      habit: {
        upsertDefinition(args) {
          return { id: args.id || "habit-1", title: args.title };
        },
        listDefinitions() {
          return { count: 1, habits: [{ id: "habit-1", title: "Eat supplements" }] };
        },
        statusToday() {
          return { date: "2026-06-19", count: 1, habits: [{ habit: { id: "habit-1" }, dailyState: "incomplete", completedToday: false }] };
        },
        markDone(args) {
          return { id: "event-1", habitId: args.habitId, type: "done" };
        },
        markIncomplete(args) {
          return { id: "event-2", habitId: args.habitId, type: "incomplete" };
        },
        markAbandoned(args) {
          return { id: "event-3", habitId: args.habitId, type: "abandoned" };
        },
        markSkipped(args) {
          return { id: "event-4", habitId: args.habitId, type: "abandoned" };
        },
        logEvent(args) {
          return { id: "event-5", habitId: args.habitId, type: args.type };
        },
        suggestNextAction() {
          return {
            shouldContactUser: true,
            reason: "not completed today",
            suggestions: [{ habitId: "habit-1", title: "Eat supplements" }],
          };
        },
      },
      obsidian: {
        getStatus() {
          return { configured: true, exists: true, vaultRoot: "/vault" };
        },
        search() {
          return { resultCount: 0, results: [] };
        },
        recent() {
          return { resultCount: 0, results: [] };
        },
        read(args) {
          return { relativePath: args.relativePath, truncated: false, text: "note" };
        },
        randomDailyExcerpt() {
          return {
            found: true,
            relativePath: "Daily note/2026-06-19.md",
            excerpt: "A tiny interesting fragment.",
          };
        },
      },
      stoneBox: {
        add(args) {
          return { id: "stone-1", ...args };
        },
        search(args) {
          return { count: 1, query: args.query, stones: [{ id: "stone-1", title: "Stone" }] };
        },
        list() {
          return { count: 1, stones: [{ id: "stone-1", title: "Stone" }] };
        },
        update(args) {
          return { id: args.id, title: "Stone", status: args.status || "active" };
        },
      },
      channelFile: {
        async sendToCurrentChat(args) {
          return { filePath: args.filePath, userId: args.userId || "user-1" };
        },
      },
      sticker: {
        async listTags() {
          return {
            tags: ["可爱", "无语", "躺平"],
            guidance: "Choose 1-3 tags.",
          };
        },
        async pick(args) {
          return {
            tag: args.tag,
            candidates: [
              { stickerId: "stk_001", desc: "小猫贴脸蹭蹭，撒娇示爱" },
            ],
          };
        },
        async sendToCurrentChat(args) {
          return {
            stickerId: args.stickerId,
            filePath: "/tmp/stk_001.gif",
            delivery: { userId: args.userId || "user-1" },
          };
        },
        async delete(args) {
          return {
            results: args.items.map((item) => ({
              stickerId: item.stickerId,
              filePath: `/tmp/${item.stickerId}.gif`,
              deleted: true,
            })),
            deletedCount: args.items.length,
          };
        },
        async saveFromInbox(args) {
          const hasDuplicate = args.items.some((item) => item.desc === "重复");
          if (hasDuplicate) {
            return {
              createdCount: 0,
              dedupedCount: 1,
              results: [{
                stickerId: "stk_001",
                filePath: "/tmp/stk_001.gif",
                created: false,
                deduped: true,
                tags: ["可爱"],
                desc: "已存在",
              }],
            };
          }
          return {
            createdCount: args.items.length,
            dedupedCount: 0,
            results: args.items.map((item, index) => ({
              stickerId: "stk_001",
              created: true,
              deduped: false,
              tags: item.tags,
              desc: item.desc,
              filePath: `/tmp/stk_00${index + 1}.gif`,
            })),
          };
        },
        async update(args) {
          return {
            results: args.items.map((item) => ({
              stickerId: item.stickerId,
              tags: item.tags,
              desc: item.desc,
              updated: true,
            })),
            updatedCount: args.items.length,
          };
        },
      },
      timeline: {
        async read(args) {
          return {
            data: {
              date: args.date,
              exists: true,
              eventCount: 1,
              events: [{ id: "evt-1" }],
            },
          };
        },
        async listCategories() {
          return {
            data: {
              categoryCount: 2,
              categories: [{ id: "work" }, { id: "life" }],
            },
          };
        },
        async listProposals(args) {
          return {
            data: {
              date: args.date || "",
              proposalCount: 1,
              proposals: [{ id: "proposal-1" }],
            },
          };
        },
        async write(args) {
          return args;
        },
        async build(args) {
          return args;
        },
        async serve(args) {
          return args;
        },
        async dev(args) {
          return args;
        },
        async captureScreenshot(args) {
          return { outputFile: "/tmp/shot.png", ...args };
        },
      },
      whereabouts: {
        getSnapshot(args) {
          return {
            currentStay: { address: "Office" },
            recentStays: [{ address: "Home" }],
            recentMovementEvents: [{ fromAddress: "Home", toAddress: "Office" }],
            ...args,
          };
        },
        getCurrentStayForOutput() {
          return { address: "Office", enteredAtLocal: "2026-04-22 09:00:00" };
        },
        getRecentStaysForOutput(args) {
          return {
            currentStay: { address: "Office" },
            recentStays: [{ address: "Home" }],
            limit: args.limit,
          };
        },
        getRecentMovesForOutput(args) {
          return {
            currentStay: { address: "Office" },
            recentMovementEvents: [{ fromAddress: "Home", toAddress: "Office" }],
            limit: args.limit,
          };
        },
        getSummary(args) {
          return {
            range: args.range || "day",
            stayCount: 2,
            moveCount: 1,
            mobilityState: { state: "staying" },
            knownPlaces: [{ placeTag: "home", durationText: "2h" }],
            batteryTrend: { sampleCount: 2, deltaPercent: -45 },
          };
        },
        appendPoint(args) {
          return {
            point: { id: "point-1", ...args },
            currentStay: { address: "Office" },
            movementEvent: null,
          };
        },
      },
    },
    runtimeContextStore: {
      resolveActiveContext() {
        return {};
      },
    },
  });
}

test("tool host rejects legacy timeline write CLI-shaped fields", async () => {
  const host = createHost();
  await assert.rejects(async () => {
    await host.invokeTool("cyberboss_timeline_write", {
      date: "2026-04-21",
      events: [],
      eventsJson: "{\"events\":[]}",
    }, {});
  }, /input\.eventsJson is not allowed/);
});

test("tool host exposes structured timeline read tools", async () => {
  const host = createHost();
  const readResult = await host.invokeTool("cyberboss_timeline_read", {
    date: "2026-04-21",
  }, {});
  const categoriesResult = await host.invokeTool("cyberboss_timeline_categories", {}, {});
  const proposalsResult = await host.invokeTool("cyberboss_timeline_proposals", {
    date: "2026-04-21",
  }, {});

  assert.equal(readResult.text, "Timeline day 2026-04-21: 1 events.");
  assert.equal(categoriesResult.text, "Timeline categories loaded: 2.");
  assert.equal(proposalsResult.text, "Timeline proposals loaded: 1.");
});

test("tool host exposes simplified seedbox tools without legacy fields in schema", async () => {
  const host = createHost();
  const createTool = host.listTools().find((tool) => tool.name === "cyberboss_seedbox_create");
  const listTool = host.listTools().find((tool) => tool.name === "cyberboss_seedbox_list");
  const updateTool = host.listTools().find((tool) => tool.name === "cyberboss_seedbox_update");

  assert.ok(createTool);
  assert.ok(listTool);
  assert.ok(updateTool);
  assert.doesNotMatch(createTool.description, /status|priority|nextAction/);
  assert.doesNotMatch(listTool.description, /includeDone|status/);
  assert.doesNotMatch(updateTool.description, /status|priority|nextAction/);

  const createResult = await host.invokeTool("cyberboss_seedbox_create", {
    kind: "concern",
    title: "Housing uncertainty",
    notes: "Keep an eye on it.",
  }, {});
  const listResult = await host.invokeTool("cyberboss_seedbox_list", {
    kind: "concern",
    includeCompleted: true,
  }, {});
  const updateResult = await host.invokeTool("cyberboss_seedbox_update", {
    id: "seed-1",
    title: "Housing plan",
  }, {});

  assert.equal(createResult.text, "Seedbox item stored: Housing uncertainty");
  assert.equal(listResult.text, "Seedbox items loaded: 1.");
  assert.equal(updateResult.text, "Seedbox item updated: Housing plan");
});

test("tool host exposes habit tools", async () => {
  const host = createHost();
  const upsertResult = await host.invokeTool("cyberboss_habit_upsert", {
    title: "Eat supplements",
    contexts: ["at_home"],
  }, {});
  const listResult = await host.invokeTool("cyberboss_habit_list", {}, {});
  const statusResult = await host.invokeTool("cyberboss_habit_status_today", {}, {});
  const doneResult = await host.invokeTool("cyberboss_habit_mark_done", {
    habitId: "habit-1",
  }, {});
  const incompleteResult = await host.invokeTool("cyberboss_habit_mark_incomplete", {
    habitId: "habit-1",
  }, {});
  const abandonedResult = await host.invokeTool("cyberboss_habit_mark_abandoned", {
    habitId: "habit-1",
  }, {});
  const skippedResult = await host.invokeTool("cyberboss_habit_mark_skipped", {
    habitId: "habit-1",
  }, {});
  const eventResult = await host.invokeTool("cyberboss_habit_log_event", {
    habitId: "habit-1",
    type: "nudged",
  }, {});
  const suggestResult = await host.invokeTool("cyberboss_habit_suggest_next_action", {
    context: "lunch at_home",
  }, {});

  assert.equal(upsertResult.text, "Habit saved: Eat supplements");
  assert.equal(listResult.text, "Habits loaded: 1.");
  assert.equal(statusResult.text, "Habit status 2026-06-19: 1.");
  assert.equal(doneResult.text, "Habit done: habit-1");
  assert.equal(incompleteResult.text, "Habit incomplete: habit-1");
  assert.equal(abandonedResult.text, "Habit abandoned: habit-1");
  assert.equal(skippedResult.text, "Habit skipped: habit-1");
  assert.equal(eventResult.text, "Habit event logged: nudged");
  assert.equal(suggestResult.text, "Habit nudge opportunity found.");
});

test("tool host exposes Obsidian random excerpt and stone box tools", async () => {
  const host = createHost();
  const excerptResult = await host.invokeTool("cyberboss_obsidian_random_daily_excerpt", {}, {});
  const addResult = await host.invokeTool("cyberboss_stone_box_add", {
    title: "Interesting find",
    content: "A found thing worth keeping nearby.",
  }, {});
  const searchResult = await host.invokeTool("cyberboss_stone_box_search", {
    query: "interesting",
  }, {});
  const listResult = await host.invokeTool("cyberboss_stone_box_list", {}, {});
  const updateResult = await host.invokeTool("cyberboss_stone_box_update", {
    id: "stone-1",
    status: "shared",
  }, {});

  assert.equal(excerptResult.text, "Random Obsidian excerpt loaded: Daily note/2026-06-19.md.");
  assert.equal(addResult.text, "Stone boxed: Interesting find");
  assert.equal(searchResult.text, "Stone box search results: 1.");
  assert.equal(listResult.text, "Stone box loaded: 1.");
  assert.equal(updateResult.text, "Stone box updated: Stone");
});

test("tool host validates structured reminder input types", async () => {
  const host = createHost();
  await assert.rejects(async () => {
    await host.invokeTool("cyberboss_reminder_create", {
      text: "ping me",
      delayMinutes: "30",
    }, {});
  }, /input\.delayMinutes must be an integer/);
});

test("tool host exposes sticky reminder list and complete tools", async () => {
  const host = createHost();
  const createTool = host.listTools().find((tool) => tool.name === "cyberboss_reminder_create");
  const listTool = host.listTools().find((tool) => tool.name === "cyberboss_reminder_list");
  const completeTool = host.listTools().find((tool) => tool.name === "cyberboss_reminder_complete");

  assert.ok(createTool);
  assert.ok(listTool);
  assert.ok(completeTool);
  assert.match(createTool.description, /sticky/i);

  const listResult = await host.invokeTool("cyberboss_reminder_list", {}, {});
  const completeResult = await host.invokeTool("cyberboss_reminder_complete", { id: "reminder-1" }, {});

  assert.equal(listResult.text, "Active reminders loaded: 1.");
  assert.equal(completeResult.text, "Reminder cleared: reminder-1");
});

test("tool host exposes sticker tools with compact structured outputs", async () => {
  const host = createHost();
  const tagsResult = await host.invokeTool("cyberboss_sticker_tags", {}, {});
  const pickResult = await host.invokeTool("cyberboss_sticker_pick", {
    tag: "可爱",
    limit: 3,
  }, {});
  const sendResult = await host.invokeTool("cyberboss_sticker_send", {
    stickerId: "stk_001",
  }, {});
  const deleteResult = await host.invokeTool("cyberboss_sticker_delete", {
    items: [{ stickerId: "stk_001" }],
  }, {});
  const saveResult = await host.invokeTool("cyberboss_sticker_save_from_inbox", {
    items: [{
      filePath: "/tmp/inbox/cat.png",
      tags: ["可爱"],
      desc: "小猫歪头卖萌",
    }],
  }, {});
  const duplicateSaveResult = await host.invokeTool("cyberboss_sticker_save_from_inbox", {
    items: [{
      filePath: "/tmp/inbox/cat.png",
      tags: ["可爱"],
      desc: "重复",
    }],
  }, {});
  const updateResult = await host.invokeTool("cyberboss_sticker_update", {
    items: [{
      stickerId: "stk_001",
      tags: ["可爱", "新标签"],
      desc: "改好的描述",
    }],
  }, {});

  assert.equal(tagsResult.text, "Sticker tags loaded: 3.");
  assert.equal(tagsResult.data.tags[0], "可爱");
  assert.equal(pickResult.text, "Sticker candidates loaded: 1.");
  assert.equal(pickResult.data.candidates[0].stickerId, "stk_001");
  assert.equal(sendResult.text, "Sticker sent: stk_001");
  assert.equal(deleteResult.text, "Sticker batch deleted: 1.");
  assert.equal(saveResult.text, "Sticker batch processed: 1 saved, 0 already existed.");
  assert.match(duplicateSaveResult.text, /Do not mention duplicates; just reply normally\./);
  assert.equal(updateResult.text, "Sticker batch updated: 1.");
});

test("tool host accepts structured timeline screenshot input", async () => {
  const host = createHost();
  const result = await host.invokeTool("cyberboss_timeline_screenshot", {
    selector: "timeline",
    range: "day",
    date: "2026-04-21",
    width: 1440,
  }, {});
  assert.equal(result.text, "Timeline screenshot sent: /tmp/shot.png");
  assert.equal(result.data.delivery.filePath, "/tmp/shot.png");
});

test("tool host descriptions include schema summary for models that only surface descriptions", () => {
  const host = createHost();
  const timelineWrite = host.listTools().find((tool) => tool.name === "cyberboss_timeline_write");
  assert.match(timelineWrite.description, /Input:/);
  assert.match(timelineWrite.description, /date: string/);
  assert.match(timelineWrite.description, /events: \{/);
});

test("tool host exposes whereabouts tools from the external dependency", async () => {
  const host = createHost();
  const tools = host.listTools();
  const snapshotTool = tools.find((tool) => tool.name === "whereabouts_snapshot");
  const summaryTool = tools.find((tool) => tool.name === "whereabouts_summary");
  const ingestTool = tools.find((tool) => tool.name === "whereabouts_ingest_point");
  const currentStayResult = await host.invokeTool("whereabouts_current_stay", {}, {});
  const snapshotResult = await host.invokeTool("whereabouts_snapshot", {
    stayLimit: 3,
    moveLimit: 2,
  }, {});
  const summaryResult = await host.invokeTool("whereabouts_summary", { range: "day" }, {});

  assert.ok(snapshotTool);
  assert.ok(summaryTool);
  assert.equal(ingestTool, undefined);
  assert.equal(currentStayResult.data.currentStay.address, "Office");
  assert.equal(snapshotResult.data.currentStay.address, "Office");
  assert.equal(snapshotResult.data.recentStays.length, 1);
  assert.equal(summaryResult.data.mobilityState.state, "staying");
});

test("tool host rejects timeline events without title or eventNodeId", async () => {
  const host = createHost();
  await assert.rejects(async () => {
    await host.invokeTool("cyberboss_timeline_write", {
      date: "2026-04-22",
      events: [
        {
          startAt: "2026-04-22T10:00:00+08:00",
          endAt: "2026-04-22T10:30:00+08:00",
          categoryId: "work",
          subcategoryId: "coding",
        },
      ],
    }, {});
  }, /input\.events\[0\]\.title or input\.events\[0\]\.eventNodeId is required/);
});

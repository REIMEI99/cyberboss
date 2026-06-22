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
      agentMemory: {
        async remember(args) {
          return {
            id: "mem-1",
            type: args.type || "preference",
            subject: args.subject || "Test subject",
            content: args.content || "",
            tags: args.tags || [],
            status: "active",
            createdAt: "2026-06-21T00:00:00.000Z",
            updatedAt: "2026-06-21T00:00:00.000Z",
          };
        },
        list(args) {
          return {
            count: 1,
            memories: [{
              id: "mem-1",
              type: args.type || "wishseed",
              subject: "Read later",
              content: "",
              tags: [],
              status: "active",
              createdAt: "2026-06-21T00:00:00.000Z",
              updatedAt: "2026-06-21T00:00:00.000Z",
            }],
          };
        },
        search(args) {
          return { count: 1, memories: [{ id: "mem-1", type: "wishseed", subject: args.query }] };
        },
        update(args) {
          return { id: args.id, type: "wishseed", subject: args.subject || "Read later", content: "", tags: [], status: "active", createdAt: "2026-06-21T00:00:00.000Z", updatedAt: "2026-06-21T01:00:00.000Z" };
        },
        forget(args) {
          return { id: args.id, type: "preference", subject: "Forgotten", content: "", tags: [], status: "archived", createdAt: "2026-06-21T00:00:00.000Z", updatedAt: "2026-06-21T01:00:00.000Z" };
        },
        async complete(args) {
          return {
            id: args.id,
            type: "wishseed",
            subject: "Housing plan",
            content: args.notes || "",
            tags: [],
            status: "active",
            completedAt: "2026-06-21T02:00:00.000Z",
            createdAt: "2026-06-21T00:00:00.000Z",
            updatedAt: "2026-06-21T02:00:00.000Z",
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
      activity: {
        add(args) {
          return { id: "act-1", title: args.title, state: "intended", note: "", checkBackMinutes: 0, intendedAt: "2026-06-22T00:00:00.000Z", startedAt: "", completedAt: "", createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:00:00.000Z" };
        },
        start(args) {
          return { id: args.id, title: "去洗澡", state: "active", note: "", checkBackMinutes: 0, intendedAt: "2026-06-22T00:00:00.000Z", startedAt: "2026-06-22T00:01:00.000Z", completedAt: "", createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:01:00.000Z" };
        },
        complete(args) {
          return { id: args.id, title: "去洗澡", state: "done", note: "", checkBackMinutes: 0, intendedAt: "2026-06-22T00:00:00.000Z", startedAt: "2026-06-22T00:01:00.000Z", completedAt: "2026-06-22T00:02:00.000Z", createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:02:00.000Z" };
        },
        drop(args) {
          return { id: args.id, title: "回消息", state: "dropped", note: args.note || "", checkBackMinutes: 0, intendedAt: "2026-06-22T00:00:00.000Z", startedAt: "", completedAt: "2026-06-22T00:03:00.000Z", createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:03:00.000Z" };
        },
        list(args) {
          return { count: 1, activities: [{ id: "act-1", title: "去洗澡", state: "intended" }] };
        },
        reviewStale() {
          return { count: 0, activities: [] };
        },
        remove(args) {
          return { id: args.id, title: "去洗澡", state: "intended" };
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

test("tool host exposes memory tools including complete", async () => {
  const host = createHost();
  const rememberTool = host.listTools().find((tool) => tool.name === "cyberboss_memory_remember");
  const listTool = host.listTools().find((tool) => tool.name === "cyberboss_memory_list");
  const completeTool = host.listTools().find((tool) => tool.name === "cyberboss_memory_complete");

  assert.ok(rememberTool);
  assert.ok(listTool);
  assert.ok(completeTool);
  assert.doesNotMatch(rememberTool.description, /status|priority|nextAction/);
  assert.doesNotMatch(listTool.description, /includeDone|status/);
  assert.doesNotMatch(completeTool.description, /status|priority|nextAction/);

  const rememberResult = await host.invokeTool("cyberboss_memory_remember", {
    type: "concern",
    subject: "Housing uncertainty",
    content: "Keep an eye on it.",
  }, {});
  const listResult = await host.invokeTool("cyberboss_memory_list", {
    type: "concern",
    includeArchived: true,
  }, {});
  const completeResult = await host.invokeTool("cyberboss_memory_complete", {
    id: "seed-1",
    notes: "Resolved",
  }, {});

  assert.equal(rememberResult.text, "Memory stored: Housing uncertainty");
  assert.equal(listResult.text, "Memories loaded: 1.");
  assert.equal(completeResult.text, "Memory completed: Housing plan");
});

test("tool host exposes Obsidian random excerpt", async () => {
  const host = createHost();
  const excerptResult = await host.invokeTool("cyberboss_obsidian_random_daily_excerpt", {}, {});
  assert.equal(excerptResult.text, "Random Obsidian excerpt loaded: Daily note/2026-06-19.md.");
});

test("tool host exposes activity tools", async () => {
  const host = createHost();
  const addResult = await host.invokeTool("cyberboss_activity_add", {
    title: "去洗澡",
  }, {});
  const listResult = await host.invokeTool("cyberboss_activity_list", {}, {});
  const startResult = await host.invokeTool("cyberboss_activity_start", {
    id: "act-1",
  }, {});
  const completeResult = await host.invokeTool("cyberboss_activity_complete", {
    id: "act-1",
  }, {});
  const dropResult = await host.invokeTool("cyberboss_activity_drop", {
    id: "act-2",
  }, {});

  assert.equal(addResult.text, "Activity added: 去洗澡");
  assert.equal(listResult.text, "Activities loaded: 1.");
  assert.equal(startResult.text, "Activity started: 去洗澡");
  assert.equal(completeResult.text, "Activity completed: 去洗澡");
  assert.equal(dropResult.text, "Activity dropped: 回消息");
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

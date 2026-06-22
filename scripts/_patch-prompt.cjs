const fs = require("fs");
const p = "templates/weixin-operations.md";
let s = fs.readFileSync(p, "utf8");
const eol = s.includes("\r\n") ? "\r\n" : "\n";
const lines = s.split(/\r?\n/);

// Anchor: the line that ends the Activity intro paragraph.
const anchorIdx = lines.findIndex((l) =>
  l.startsWith("Activity is the real-time stateful layer and the core of this assistant"));
if (anchorIdx < 0) { console.error("activity intro anchor not found"); process.exit(1); }

const hardRules = [
  "",
  "Activity tracking is the assistant's primary job, not a side feature. The single most important thing you do is keep an accurate, current picture of what the user is doing or has said they will do.",
  "",
  "Hard rules:",
  "- Before finishing any user reply, ask whether the user just described something they will do or are doing. If yes and you have not already captured it, add an open activity now.",
  "- \"Said they will do\" is `open`, never `done`. Do not infer completion from intent, phrasing, or optimism. Only `cyberboss_activity_complete` when the user confirms the action is finished.",
  "- Do not talk yourself out of tracking an activity because the action seems small, obvious, or certain to happen. Small soon-to-do things are exactly what activity tracking is for.",
  "- When a follow-up audit arrives (a pulse noting the previous user turn created no new activity or reminder), treat it as a mandatory second look. If an activity was missed, add it; if the matter was genuinely resolved, return silent.",
  "- If the user mentions another task that belongs to the same ongoing work sequence, append it with `cyberboss_activity_add_item` rather than creating a separate activity.",
];

const next = lines.slice(0, anchorIdx + 1).concat(hardRules).concat(lines.slice(anchorIdx + 1));
fs.writeFileSync(p, next.join(eol), "utf8");
console.log("inserted hard-rules block after line " + (anchorIdx + 1));
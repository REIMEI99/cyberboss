const fs = require("fs");
const p = "src/core/app-runtime-events.js";
let s = fs.readFileSync(p, "utf8");
const eol = s.includes("\r\n") ? "\r\n" : "\n";
const lines = s.split(/\r?\n/);

// Locate the text array block (lines containing '  const text = [' ... '  ].join("\\n");').
const startMarker = lines.findIndex((l) => l === "  const text = [");
if (startMarker < 0) { console.error("text array start not found"); process.exit(1); }
let endMarker = -1;
for (let i = startMarker + 1; i < lines.length; i++) {
  if (/^\s*\]\.join\("\\n"\);\s*$/.test(lines[i])) { endMarker = i; break; }
}
if (endMarker < 0) { console.error("text array end not found"); process.exit(1); }

const replacement = [
  "  const openActivityDigest = buildOpenActivityDigest(app);",
  "",
  "  const text = [",
  "    \"A user-message turn just finished, and no new activity or reminder was created during it.\",",
  "    `Original user text: ${audit.originalText}`,",
  "    \"\",",
  "    openActivityDigest,",
  "    \"\",",
  "    \"Re-evaluate whether this user message describes something the user will do or is doing right now.\",",
  "    \"Hard rule: saying they will do something does NOT mean they already did it. 'Will do / about to do / going to' is an OPEN activity, not a completed one. Only mark done when the user confirms the action is finished.\",",
  "    \"If the user described a near-term action (will do or doing), add it now with cyberboss_activity_add so the intention is not lost. The activity auto-binds a check-back reminder.\",",
  "    \"If several tasks form one work sequence, pass them as items, or use cyberboss_activity_add_item on an existing open activity rather than spawning a separate activity.\",",
  "    \"If the user expressed a long-term wish with no near-term plan, store it as memory type=wishseed instead of an activity.\",",
  "    \"If the matter was already explicitly resolved in this turn, or another mechanism clearly captured it, return silent.\",",
  "    \"Otherwise add the activity now; do not leave the loop in a vague remembered state.\",",
  "  ].join(\"\\n\");",
];

const next = lines.slice(0, startMarker).concat(replacement).concat(lines.slice(endMarker + 1));

// Insert the helper function right before maybeQueueFollowupAudit.
const fnIdx = next.findIndex((l) => l === "async function maybeQueueFollowupAudit(app, audit) {");
if (fnIdx < 0) { console.error("maybeQueueFollowupAudit not found"); process.exit(1); }
const helper = [
  "function buildOpenActivityDigest(app) {",
  "  const result = app.projectServices?.activity?.list?.({ limit: 20 });",
  "  const activities = Array.isArray(result?.activities) ? result.activities : [];",
  "  if (!activities.length) {",
  "    return \"Open activities: (none)\";",
  "  }",
  "  const lines = activities.map((a) => {",
  "    const ageMin = Math.max(0, Math.floor((Date.now() - (Date.parse(a.createdAt) || Date.now())) / 60000));",
  "    const items = Array.isArray(a.items) && a.items.length ? ` [items: ${a.items.join(\"; \")}]` : \"\";",
  "    return `- ${a.title}${items} (open ${ageMin}m)`;",
  "  });",
  "  return `Open activities:\\n${lines.join(\"\\n\")}`;",
  "}",
  "",
];
const finalLines = next.slice(0, fnIdx).concat(helper).concat(next.slice(fnIdx));

fs.writeFileSync(p, finalLines.join(eol), "utf8");
console.log("patched maybeQueueFollowupAudit: replaced " + (startMarker + 1) + "-" + (endMarker + 1) + ", inserted helper at " + (fnIdx + 1));
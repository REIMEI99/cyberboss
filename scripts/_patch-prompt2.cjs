const fs = require("fs");
const p = "templates/weixin-operations.md";
let s = fs.readFileSync(p, "utf8");
const eol = s.includes("\r\n") ? "\r\n" : "\n";
const old = "If the user casually says they are about to do something, do not silently trust that it will happen. Either set a short reminder or capture the short action as an activity.";
const neu = "If the user casually says they are about to do something, do not silently trust that it will happen. For near-term actions, the default is to capture it as an open activity with cyberboss_activity_add — the activity auto-binds a short check-back reminder, so you usually do not need a separate reminder. Use a standalone reminder only when the follow-up is purely time-based and not tied to a current activity.";
if (!s.includes(old)) { console.error("user-message anchor not found"); process.exit(1); }
s = s.split(old).join(neu);
fs.writeFileSync(p, s, "utf8");
console.log("updated user-message activity line");
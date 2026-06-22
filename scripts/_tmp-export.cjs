const fs = require("fs");
const p = "src/core/app-runtime-events.js";
let s = fs.readFileSync(p, "utf8");
const eol = s.includes("\r\n") ? "\r\n" : "\n";
const old = ["module.exports = {", "  createAppRuntimeEvents,", "};"].join(eol);
const neu = ["module.exports = {", "  createAppRuntimeEvents,", "  maybeQueueFollowupAudit,", "  buildOpenActivityDigest,", "};"].join(eol);
if (!s.includes(old)) { console.error("exports block not found"); process.exit(1); }
s = s.split(old).join(neu);
fs.writeFileSync(p, s, "utf8");
console.log("exported maybeQueueFollowupAudit + buildOpenActivityDigest");
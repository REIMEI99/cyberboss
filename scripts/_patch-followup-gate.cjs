const fs = require("fs");
const path = "src/core/app.js";
let s = fs.readFileSync(path, "utf8");
const eol = s.includes("\r\n") ? "\r\n" : "\n";
const lines = s.split(/\r?\n/);
const startIdx = lines.findIndex((l) => l === "function shouldAuditUserFollowup(text) {");
if (startIdx < 0) { console.error("start not found"); process.exit(1); }
let endIdx = -1, depth = 0;
for (let i = startIdx; i < lines.length; i++) {
  for (const ch of lines[i]) {
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { endIdx = i; break; } }
  }
  if (endIdx >= 0) break;
}
if (endIdx < 0) { console.error("end not found"); process.exit(1); }
const replacement = [
  "function shouldAuditUserFollowup(text) {",
  "  const normalized = normalizeText(text).toLowerCase();",
  "  if (!normalized) {",
  "    return false;",
  "  }",
  "  // Near-universal audit: skip only pure acknowledgments / noise that cannot",
  "  // describe an action. The old keyword gate missed too many intentions that",
  "  // were phrased without explicit future-intent words, so activity tracking",
  "  // silently lost them. Now nearly every real user message gets a second look.",
  "  const stripped = normalized.replace(/[\\s\\p{P}\\p{S}]/gu, \"\");",
  "  if (!stripped) {",
  "    return false;",
  "  }",
  "  // Repeated interjections (haha, mmm, oh...) carry no action.",
  "  if (/^(\u597d|\u55ef|\u54c8|\u563f|\u5475|\u54e6|\u5662|\u5509|\u554a|\u5440|\u5427|\u55ef\u54fc)+$/u.test(stripped)) {",
  "    return false;",
  "  }",
  "  const noiseTokens = new Set([",
  "    \"\u597d\u7684\", \"\u597d\u5427\", \"\u884c\", \"\u5bf9\", \"\u662f\u7684\", \"\u6536\u5230\", \"\u4e86\u89e3\", \"\u77e5\u9053\u4e86\", \"\u77e5\u9053\u5566\", \"\u660e\u767d\",",
  "    \"ok\", \"okay\", \"\u597d\u563e\", \"\u8c22\u8c22\", \"\u611f\u8c22\", \"\u8f9b\u82e6\u4e86\", \"\u665a\u5b89\", \"\u65e9\u5b89\", \"\u62dc\u62dc\",",
  "  ]);",
  "  if (noiseTokens.has(stripped)) {",
  "    return false;",
  "  }",
  "  return true;",
  "}",
];
const next = lines.slice(0, startIdx).concat(replacement).concat(lines.slice(endIdx + 1));
fs.writeFileSync(path, next.join(eol), "utf8");
console.log("replaced lines " + (startIdx + 1) + "-" + (endIdx + 1) + " with " + replacement.length + " lines");
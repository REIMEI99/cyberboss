const fs = require("fs");
const filePath = "D:/Codex/cyberboss/src/tools/tool-host.js";
let content = fs.readFileSync(filePath, "utf8");
const EOL = content.includes("\r\n") ? "\r\n" : "\n";
let lines = content.split(/\r?\n/);
let output = [];
let i = 0;

// Phase 1: Line-by-line filtering and replacements
// Track which lines to skip
const skipLines = new Set();

// Find the seedbox tool block (cyberboss_seedbox_create through cyberboss_seedbox_reindex)
// and mark those lines for deletion
let inSeedboxBlock = false;
let seedboxBlockStart = -1;
let seedboxBlockEnd = -1;
for (let idx = 0; idx < lines.length; idx++) {
  const trimmed = lines[idx].trim();
  if (trimmed === 'name: "cyberboss_seedbox_create",') {
    // Walk back to find the opening {
    let start = idx;
    while (start > 0 && lines[start - 1].trim() !== "{" && lines[start - 1].trim() !== " {") {
      start--;
    }
    // The line before { should be the end of previous tool's },
    // Actually find the { that opens this tool object
    start = idx - 1;
    while (start >= 0 && lines[start].trim() !== "{") {
      start--;
    }
    seedboxBlockStart = start;
    inSeedboxBlock = true;
  }
  if (inSeedboxBlock && trimmed === 'name: "cyberboss_seedbox_reindex",') {
    // Find the closing },
  }
}

// Better approach: find start and end by searching for tool name lines
let sboxStart = -1;
let sboxEnd = -1;
for (let idx = 0; idx < lines.length; idx++) {
  const trimmed = lines[idx].trim();
  if (trimmed === 'name: "cyberboss_seedbox_create",') {
    // Walk back to find the opening {
    let s = idx - 1;
    while (s >= 0 && lines[s].trim() !== "{") { s--; }
    sboxStart = s;
  }
  if (trimmed === 'name: "cyberboss_seedbox_reindex",') {
    // Walk forward to find the closing },
    let e = idx;
    let depth = 0;
    while (e < lines.length) {
      const t = lines[e].trim();
      if (t === "{" || t.startsWith("{ ") || t === "  {") depth++;
      if (t === "}," || t === "  }," || t === "    },") {
        depth--;
        if (depth <= 0) { sboxEnd = e; break; }
      }
      if (t === "}") {
        depth--;
        if (depth <= 0) { sboxEnd = e; break; }
      }
      e++;
    }
  }
}
console.log("seedbox block:", sboxStart, "-", sboxEnd);

// Mark seedbox tool lines for deletion
if (sboxStart >= 0 && sboxEnd >= 0) {
  for (let idx = sboxStart; idx <= sboxEnd; idx++) {
    skipLines.add(idx);
  }
}

// Build output with modifications
for (let idx = 0; idx < lines.length; idx++) {
  if (skipLines.has(idx)) continue;
  const line = lines[idx];
  const trimmed = line.trim();

  // Remove includeSeedbox from schema
  if (trimmed.startsWith("includeSeedbox:") && trimmed.includes("boolean")) continue;

  // Remove includeSeedbox variable
  if (trimmed === "const includeSeedbox = args.includeSeedbox !== false;") continue;

  // Remove seedbox from pulse data objects
  if (trimmed === "seedbox," && idx > 100 && idx < 300) continue;

  // Replace topics with seedbox
  let modified = line
    .replace('"pool", "reminder", "seedbox"', '"pool", "reminder"')
    .replace('"memory", "seedbox"', '"memory"')
    .replace('"seedbox", "memory"', '"memory"')
    .replace('"obsidian", "seedbox"', '"obsidian"')
    .replace('"seedbox"', '"memory"')
    .replace('"pulse", "habit", "obsidian", "pool", "seedbox", "reminder"', '"pulse", "habit", "obsidian", "pool", "reminder"')
    .replace('"reminder", "pulse", "seedbox"', '"reminder", "pulse"');

  // Update memory/seedbox comment
  modified = modified.replace("memories/seedbox", "memories");

  // Update obsidian excerpt description that mentions seedbox
  modified = modified.replace("capture a seedbox item", "capture a memory item");

  output.push(modified);
}

// Now do string replacements on the joined output
let result = output.join(EOL);

// Remove includeSeedbox from exposureMode (any remaining)
result = result.replace(/includeSeedbox[^]*?seedbox: seedboxExposureMode,\r?\n/, '');
result = result.replace(/seedbox: seedboxExposureMode,\r?\n/g, '');

// Remove the seedbox pulse search variables and block
// The block that declares seedbox vars and does embedding search
result = result.replace(/      let seedbox;\r?\n      let seedboxExposureMode;\r?\n      let seedboxExposureReason;\r?\n[\s\S]*?seedboxExposureReason = seedboxExposure\.reason;\r?\n      \}\r?\n\r?\n      const summary = /, '      const summary = ');

// Remove seedbox from pulse review data
result = result.replace(/          seedbox,\r?\n          messageOpportunity:/g, '          messageOpportunity:');

// Update title_pool_promote_to_seedbox
result = result.replace('name: "cyberboss_title_pool_promote_to_seedbox"', 'name: "cyberboss_title_pool_promote_to_memory"');
result = result.replace('into a seedbox item, then remove', 'into a memory (type wishseed or concern), then remove');
result = result.replace('Promote a title pool item to seedbox.', 'Promote a title pool item to memory.');
result = result.replace('const seedbox = await services.seedbox.create({\n          title: item.title,\n          kind: normalizeText(args.kind) || "wishseed",\n        });', 'const memory = await services.agentMemory.remember({\n          type: normalizeText(args.kind) || "wishseed",\n          subject: item.title,\n          content: item.title,\n        });');
result = result.replace('text: `Title pool item promoted to seedbox: ${item.title}`', 'text: `Title pool item promoted to memory: ${item.title}`');
result = result.replace('item,\n            seedbox,', 'item,\n            memory,');

// Also handle \r\n versions
result = result.replace('const seedbox = await services.seedbox.create({\r\n          title: item.title,\r\n          kind: normalizeText(args.kind) || "wishseed",\r\n        });', 'const memory = await services.agentMemory.remember({\r\n          type: normalizeText(args.kind) || "wishseed",\r\n          subject: item.title,\r\n          content: item.title,\r\n        });');
result = result.replace('text: `Title pool item promoted to seedbox: ${item.title}`', 'text: `Title pool item promoted to memory: ${item.title}`');
result = result.replace('item,\r\n            seedbox,\r', 'item,\r\n            memory,\r');

// Add cyberboss_memory_complete after cyberboss_memory_forget
const memoryCompleteTool = [
  '  {',
  '    name: "cyberboss_memory_complete",',
  '    description: "Mark a structured memory as resolved, exhausted, or no longer active. Use this for wishseed, concern, or project type memories that have a lifecycle and are now done.",',
  '    shortHint: "Complete a memory.",',
  '    topics: ["memory"],',
  '    inputSchema: {',
  '      type: "object",',
  '      required: ["id"],',
  '      properties: {',
  '        id: { type: "string", description: "Memory id." },',
  '        notes: { type: "string", description: "Optional closure notes appended to the memory content." },',
  '      },',
  '      additionalProperties: false,',
  '    },',
  '    async handler({ services, args }) {',
  '      const result = await services.agentMemory.complete(args);',
  '      return {',
  '        text: `Memory completed: ${result.subject}`,',
  '        data: result,',
  '      };',
  '    },',
  '  },',
].join(EOL);

// Find the end of memory_forget tool and insert memory_complete after it
const forgetEndPattern = /      const result = services\.agentMemory\.forget\(args\);\r?\n      return \{\r?\n        text: `Memory archived: \$\{result\.subject\}`,\r?\n        data: result,\r?\n      \};\r?\n    \},\r?\n  \},\r?\n/;
result = result.replace(forgetEndPattern, (match) => match + memoryCompleteTool + EOL);

// Remove seedbox references from buildPulseReviewSummary
result = result.replace(/  seedbox,\r?\n\}\) \{/, '}) {');
result = result.replace(/  const openSeedboxItems = Array\.isArray\(seedbox\?\.items\) \? seedbox\.items : \[\];\r?\n/g, '');
result = result.replace(/    openSeedboxCount: openSeedboxItems\.length,\r?\n/g, '');
result = result.replace(/  if \(!reasons\.length && openSeedboxItems\.length\) \{\r?\n    reasons\.push\("there is internal carry-over material worth keeping in view, but none clearly requires interrupting the user"\);\r?\n  \}\r?\n/g, '');
result = result.replace(/  if \(openSeedboxItems\.length\) \{\r?\n    recommendedPrivateActions\.push\("review whether one seedbox item should be clarified, preserved, or quietly advanced"\);\r?\n  \}\r?\n/g, '');

// Remove collectPulseSearchSeedbox function
result = result.replace(/async function collectPulseSearchSeedbox\([\s\S]*?\n\}\r?\n/, '');

// Remove applySeedboxPulseExposure function
result = result.replace(/function applySeedboxPulseExposure\(seedbox, exposure\) \{[\s\S]*?\n\}\r?\n/, '');

// Increase pulse search limits since seedbox is merged
result = result.replace('const PULSE_SEARCH_TOP = 3;', 'const PULSE_SEARCH_TOP = 5;');
result = result.replace('const PULSE_SEARCH_CANDIDATE_LIMIT = 6;', 'const PULSE_SEARCH_CANDIDATE_LIMIT = 10;');

fs.writeFileSync(filePath, result);
console.log("tool-host.js patched successfully");
console.log("Remaining seedbox refs:", (result.match(/seedbox/gi) || []).length);

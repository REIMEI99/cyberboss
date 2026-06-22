const fs = require("fs");
const filePath = "D:/Codex/cyberboss/src/tools/tool-host.js";
let lines = fs.readFileSync(filePath, "utf8").split("\n");

// 1. Remove "cyberboss_seedbox_list" from DEFAULT_HIDDEN_TOOL_NAMES
lines = lines.filter((line) => line.trim() !== '"cyberboss_seedbox_list",');

// Re-join for string replacements
let content = lines.join("\n");

// 2. Remove includeSeedbox from pulse_review input schema
content = content.replace(
  '        includeSeedbox: { type: "boolean", description: "Whether to include active seedbox items. Defaults to true." },\n',
  ''
);

// 3. Remove includeSeedbox variable and merge seedbox into memories in pulse_review handler
content = content.replace(
  '      const includeSeedbox = args.includeSeedbox !== false;\n',
  ''
);

// 4. Replace the entire seedbox pulse collection block with merged memory search
// The block starts with "let seedbox;" and ends before "const summary = buildPulseReviewSummary"
content = content.replace(
  /      let seedbox;\n      let seedboxExposureMode;\n      let seedboxExposureReason;\n      if \(services\.embedding\?\.isConfigured\(\)\) \{[\s\S]*?seedboxExposureReason = seedboxExposure\.reason;\n      \}\n\n      const summary = buildPulseReviewSummary\(/,
  '      const summary = buildPulseReviewSummary('
);

// 5. Remove seedbox from the pulse review data object
content = content.replace(
  /          seedbox,\n          messageOpportunity:/,
  '          messageOpportunity:'
);
content = content.replace(
  /          seedbox,\n          messageOpportunity:/,
  '          messageOpportunity:'
);

// 6. Remove seedbox from exposureMode object
content = content.replace(
  /            seedbox: seedboxExposureMode,\n/,
  ''
);

// 7. Remove includeSeedbox from titlePool exposure mode
content = content.replace(
  '            titlePool: includeTitlePool ? "full" : "disabled",\n            seedbox: seedboxExposureMode,',
  '            titlePool: includeTitlePool ? "full" : "disabled",'
);

// 8. Remove the 6 seedbox tool definitions
// Find and remove from "cyberboss_seedbox_create" to the end of "cyberboss_seedbox_reindex"
content = content.replace(
  /  \{\n   name: "cyberboss_seedbox_create",[\s\S]*?    \},\n  \},\n  \{\n    name: "cyberboss_seedbox_reindex",[\s\S]*?    \},\n  \},\n/,
  ''
);

// 9. Add cyberboss_memory_complete after cyberboss_memory_forget
content = content.replace(
  '    async handler({ services, args }) {\n      const result = services.agentMemory.forget(args);\n      return {\n        text: `Memory archived: ${result.subject}`,\n        data: result,\n      };\n    },\n  },',
  '    async handler({ services, args }) {\n      const result = services.agentMemory.forget(args);\n      return {\n        text: `Memory archived: ${result.subject}`,\n        data: result,\n      };\n    },\n  },\n  {\n    name: "cyberboss_memory_complete",\n    description: "Mark a structured memory as resolved, exhausted, or no longer active. Use this for wishseed, concern, or project type memories that have a lifecycle and are now done.",\n    shortHint: "Complete a memory.",\n    topics: ["memory"],\n    inputSchema: {\n      type: "object",\n      required: ["id"],\n      properties: {\n        id: { type: "string", description: "Memory id." },\n        notes: { type: "string", description: "Optional closure notes appended to the memory content." },\n      },\n      additionalProperties: false,\n    },\n    async handler({ services, args }) {\n      const result = await services.agentMemory.complete(args);\n      return {\n        text: `Memory completed: ${result.subject}`,\n        data: result,\n      };\n    },\n  },'
);

// 10. Update title_pool_promote_to_seedbox → promote_to_memory
content = content.replace(
  'name: "cyberboss_title_pool_promote_to_seedbox",',
  'name: "cyberboss_title_pool_promote_to_memory",'
);
content = content.replace(
  'description: "Promote one title pool item into a seedbox item, then remove it from the title pool. Use this when a lightweight current-action title turns out to be future-useful material worth preserving across turns."',
  'description: "Promote one title pool item into a memory (type wishseed or concern), then remove it from the title pool. Use this when a lightweight current-action title turns out to be future-useful material worth preserving across turns."'
);
content = content.replace(
  'shortHint: "Promote a title pool item to seedbox."',
  'shortHint: "Promote a title pool item to memory."'
);
content = content.replace(
  'topics: ["pool", "seedbox"],',
  'topics: ["pool", "memory"],'
);
// Fix the handler body for promote_to_memory
content = content.replace(
  '        const seedbox = await services.seedbox.create({\n          title: item.title,\n          kind: normalizeText(args.kind) || "wishseed",\n        });\n        return {\n          text: `Title pool item promoted to seedbox: ${item.title}`,\n          data: {\n            item,\n            seedbox,\n          },\n        };',
  '        const memory = await services.agentMemory.remember({\n          type: normalizeText(args.kind) || "wishseed",\n          subject: item.title,\n          content: item.title,\n        });\n        return {\n          text: `Title pool item promoted to memory: ${item.title}`,\n          data: {\n            item,\n            memory,\n          },\n        };'
);

// 11. Update topics arrays that reference "seedbox"
content = content.replace(
  'topics: ["pulse", "habit", "obsidian", "pool", "seedbox", "reminder"],',
  'topics: ["pulse", "habit", "obsidian", "pool", "reminder"],'
);
content = content.replace(
  'topics: ["reminder", "pulse", "seedbox"],',
  'topics: ["reminder", "pulse"],'
);
content = content.replace(
  'topics: ["pool", "reminder", "seedbox"],',
  'topics: ["pool", "reminder"],'
);
// topics: ["memory", "seedbox"] → ["memory"]
content = content.replace(
  'topics: ["memory", "seedbox"],',
  'topics: ["memory"],'
);
// topics: ["seedbox", "memory"] → ["memory"]
content = content.replace(
  'topics: ["seedbox", "memory"],',
  'topics: ["memory"],'
);
// topics: ["obsidian", "seedbox"] → ["obsidian"]
content = content.replace(
  'topics: ["obsidian", "seedbox"],',
  'topics: ["obsidian"],'
);

// 12. Update buildPulseReviewSummary - remove seedbox references
content = content.replace(
  /  seedbox,\n\}\) \{/,
  '}) {'
);
content = content.replace(
  '  const openSeedboxItems = Array.isArray(seedbox?.items) ? seedbox.items : [];\n',
  ''
);
content = content.replace(
  '    openSeedboxCount: openSeedboxItems.length,\n',
  ''
);
content = content.replace(
  /  if \(!reasons\.length && openSeedboxItems\.length\) \{\n    reasons\.push\("there is internal carry-over material worth keeping in view, but none clearly requires interrupting the user"\);\n  \}\n/,
  ''
);
content = content.replace(
  /  if \(openSeedboxItems\.length\) \{\n    recommendedPrivateActions\.push\("review whether one seedbox item should be clarified, preserved, or quietly advanced"\);\n  \}\n/,
  ''
);

// 13. Remove collectPulseSearchSeedbox function
content = content.replace(
  /async function collectPulseSearchSeedbox\([\s\S]*?  \};\n\}\n/,
  ''
);

// 14. Remove applySeedboxPulseExposure function
content = content.replace(
  /function applySeedboxPulseExposure\(seedbox, exposure\) \{[\s\S]*?  \};\n\}\n/,
  ''
);

// 15. Update the comment about embedding search
content = content.replace(
  '// time-based cooldown for memories/seedbox when e',
  '// time-based cooldown for memories when e'
);

// 16. Increase memory pulse search top since seedbox is merged
content = content.replace(
  'const PULSE_SEARCH_TOP = 3;',
  'const PULSE_SEARCH_TOP = 5;'
);
content = content.replace(
  'const PULSE_SEARCH_CANDIDATE_LIMIT = 6;',
  'const PULSE_SEARCH_CANDIDATE_LIMIT = 10;'
);

fs.writeFileSync(filePath, content);
console.log("tool-host.js updated successfully");

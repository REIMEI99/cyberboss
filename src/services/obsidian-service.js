const fs = require("fs");
const path = require("path");

const DEFAULT_LIMIT = 10;
const DEFAULT_MAX_CHARS = 12000;
const DEFAULT_EXCERPT_CHARS = 700;
const IGNORED_DIRS = new Set([".git", ".obsidian", ".trash", "node_modules"]);

class ObsidianService {
  constructor({ config }) {
    this.config = config;
  }

  getStatus() {
    const vaultRoot = this.resolveVaultRoot();
    return {
      configured: Boolean(vaultRoot),
      vaultRoot,
      exists: vaultRoot ? fs.existsSync(vaultRoot) : false,
    };
  }

  search({ query = "", limit = DEFAULT_LIMIT } = {}) {
    const vaultRoot = this.requireVaultRoot();
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) {
      throw new Error("Obsidian search query cannot be empty.");
    }
    const queryTerms = normalizedQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const files = this.listMarkdownFiles(vaultRoot);
    const results = [];
    for (const filePath of files) {
      const text = readTextFile(filePath);
      const haystack = text.toLowerCase();
      if (!queryTerms.every((term) => haystack.includes(term))) {
        continue;
      }
      results.push({
        relativePath: toVaultRelativePath(vaultRoot, filePath),
        title: extractTitle(text, filePath),
        modifiedAt: fs.statSync(filePath).mtime.toISOString(),
        snippet: buildSnippet(text, queryTerms[0]),
      });
      if (results.length >= normalizeLimit(limit)) {
        break;
      }
    }
    return {
      query: normalizedQuery,
      searchedFiles: files.length,
      searchTruncated: this.isSearchFileListTruncated(vaultRoot, files.length),
      resultCount: results.length,
      results,
    };
  }

  recent({ limit = DEFAULT_LIMIT } = {}) {
    const vaultRoot = this.requireVaultRoot();
    const files = this.listMarkdownFiles(vaultRoot)
      .map((filePath) => {
        const stat = fs.statSync(filePath);
        return {
          filePath,
          relativePath: toVaultRelativePath(vaultRoot, filePath),
          modifiedAt: stat.mtime.toISOString(),
          modifiedMs: stat.mtimeMs,
        };
      })
      .sort((left, right) => right.modifiedMs - left.modifiedMs)
      .slice(0, normalizeLimit(limit));
    return {
      resultCount: files.length,
      results: files.map(({ filePath, modifiedMs, ...item }) => ({
        ...item,
        title: extractTitle(readTextFile(filePath), filePath),
      })),
    };
  }

  read({ relativePath = "", maxChars = DEFAULT_MAX_CHARS } = {}) {
    const vaultRoot = this.requireVaultRoot();
    const filePath = this.resolveVaultFile(relativePath);
    const text = readTextFile(filePath);
    const limit = normalizeMaxChars(maxChars);
    return {
      relativePath: toVaultRelativePath(vaultRoot, filePath),
      title: extractTitle(text, filePath),
      modifiedAt: fs.statSync(filePath).mtime.toISOString(),
      truncated: text.length > limit,
      text: text.slice(0, limit),
    };
  }

  randomDailyExcerpt({ daysBack = 45, maxChars = DEFAULT_EXCERPT_CHARS, dailyDir = "Daily note" } = {}) {
    const vaultRoot = this.requireVaultRoot();
    const normalizedDailyDir = normalizeText(dailyDir) || "Daily note";
    const dailyRoot = path.resolve(vaultRoot, normalizedDailyDir);
    const normalizedRoot = normalizePathForCompare(vaultRoot);
    const normalizedDailyRoot = normalizePathForCompare(dailyRoot);
    if (!normalizedDailyRoot.startsWith(normalizedRoot) || !fs.existsSync(dailyRoot) || !fs.statSync(dailyRoot).isDirectory()) {
      return {
        configured: true,
        found: false,
        reason: `Daily note directory not found: ${normalizedDailyDir}`,
      };
    }

    const cutoffMs = Date.now() - normalizeDaysBack(daysBack) * 24 * 60 * 60 * 1000;
    const candidates = this.listMarkdownFiles(dailyRoot)
      .map((filePath) => {
        const stat = fs.statSync(filePath);
        return { filePath, modifiedMs: stat.mtimeMs };
      })
      .filter((item) => item.modifiedMs >= cutoffMs);
    if (!candidates.length) {
      return {
        configured: true,
        found: false,
        reason: "No recent daily notes found.",
      };
    }

    const selected = candidates[Math.floor(Math.random() * candidates.length)];
    const text = readTextFile(selected.filePath);
    const blocks = extractExcerptBlocks(text);
    if (!blocks.length) {
      return {
        configured: true,
        found: false,
        reason: "Selected daily note has no usable excerpt blocks.",
        relativePath: toVaultRelativePath(vaultRoot, selected.filePath),
      };
    }
    const block = blocks[Math.floor(Math.random() * blocks.length)];
    const limit = normalizeExcerptChars(maxChars);
    return {
      configured: true,
      found: true,
      relativePath: toVaultRelativePath(vaultRoot, selected.filePath),
      title: extractTitle(text, selected.filePath),
      modifiedAt: fs.statSync(selected.filePath).mtime.toISOString(),
      excerpt: block.slice(0, limit),
      truncated: block.length > limit,
    };
  }

  resolveVaultRoot() {
    const raw = normalizeText(this.config?.obsidianVaultRoot);
    if (!raw) {
      return "";
    }
    return path.resolve(raw);
  }

  requireVaultRoot() {
    const vaultRoot = this.resolveVaultRoot();
    if (!vaultRoot) {
      throw new Error("CYBERBOSS_OBSIDIAN_VAULT_ROOT is not configured.");
    }
    if (!fs.existsSync(vaultRoot) || !fs.statSync(vaultRoot).isDirectory()) {
      throw new Error(`Obsidian vault root does not exist: ${vaultRoot}`);
    }
    return vaultRoot;
  }

  resolveVaultFile(relativePath) {
    const vaultRoot = this.requireVaultRoot();
    const normalizedRelative = normalizeText(relativePath).replace(/\\/g, "/");
    if (!normalizedRelative) {
      throw new Error("Obsidian note relativePath cannot be empty.");
    }
    const resolved = path.resolve(vaultRoot, normalizedRelative);
    const normalizedRoot = normalizePathForCompare(vaultRoot);
    const normalizedResolved = normalizePathForCompare(resolved);
    if (!normalizedResolved.startsWith(normalizedRoot)) {
      throw new Error("Obsidian note path must stay inside the configured vault.");
    }
    if (!resolved.toLowerCase().endsWith(".md")) {
      throw new Error("Only Markdown notes can be read from the Obsidian vault.");
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new Error(`Obsidian note not found: ${normalizedRelative}`);
    }
    return resolved;
  }

  listMarkdownFiles(vaultRoot) {
    const maxFiles = Math.max(1, Number(this.config?.obsidianMaxSearchFiles) || 5000);
    const results = [];
    const stack = [vaultRoot];
    while (stack.length && results.length < maxFiles) {
      const current = stack.pop();
      let entries = [];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort(compareDirents);
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name)) {
            stack.push(fullPath);
          }
          continue;
        }
        if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
          results.push(fullPath);
          if (results.length >= maxFiles) {
            break;
          }
        }
      }
    }
    return results;
  }

  isSearchFileListTruncated(vaultRoot, listedCount) {
    const maxFiles = Math.max(1, Number(this.config?.obsidianMaxSearchFiles) || 5000);
    if (listedCount < maxFiles) {
      return false;
    }
    return countMarkdownFilesAtLeast(vaultRoot, maxFiles + 1) > maxFiles;
  }
}

function readTextFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function toVaultRelativePath(vaultRoot, filePath) {
  return path.relative(vaultRoot, filePath).replace(/\\/g, "/");
}

function extractTitle(text, filePath) {
  const heading = String(text || "").split(/\r?\n/).find((line) => /^#\s+/.test(line));
  if (heading) {
    return heading.replace(/^#\s+/, "").trim();
  }
  return path.basename(filePath, path.extname(filePath));
}

function buildSnippet(text, term) {
  const normalizedText = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalizedText) {
    return "";
  }
  const index = normalizedText.toLowerCase().indexOf(normalizeText(term).toLowerCase());
  const start = Math.max(0, index < 0 ? 0 : index - 80);
  return normalizedText.slice(start, start + 240);
}

function compareDirents(left, right) {
  const leftIsDirectory = left.isDirectory();
  const rightIsDirectory = right.isDirectory();
  if (leftIsDirectory !== rightIsDirectory) {
    return leftIsDirectory ? 1 : -1;
  }
  return left.name.localeCompare(right.name, "zh-Hans-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

function countMarkdownFilesAtLeast(root, targetCount) {
  let count = 0;
  const stack = [root];
  while (stack.length && count < targetCount) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort(compareDirents);
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          stack.push(fullPath);
        }
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        count += 1;
        if (count >= targetCount) {
          break;
        }
      }
    }
  }
  return count;
}

function extractExcerptBlocks(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return trimmed && trimmed !== "---" && !/^created:|^updated:|^tags:/i.test(trimmed);
      })
      .join("\n")
      .trim())
    .filter((block) => block.length >= 30);
}

function normalizeDaysBack(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 45;
  }
  return Math.min(parsed, 365);
}

function normalizeExcerptChars(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_EXCERPT_CHARS;
  }
  return Math.min(parsed, 2000);
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, 50);
}

function normalizeMaxChars(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_CHARS;
  }
  return Math.min(parsed, 50000);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePathForCompare(value) {
  const normalized = path.resolve(String(value || "")).replace(/\\/g, "/");
  return process.platform === "win32"
    ? `${normalized.toLowerCase()}/`
    : `${normalized}/`;
}

module.exports = { ObsidianService };

const fs = require("fs");
const path = require("path");

class RuntimeContextStore {
  constructor({ filePath }) {
    this.filePath = filePath;
    this.state = createEmptyState();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.contextsByWorkspaceRoot) {
        this.state = {
          contextsByWorkspaceRoot: parsed.contextsByWorkspaceRoot || {},
          pulseExposureByWorkspaceRoot: parsed.pulseExposureByWorkspaceRoot || {},
        };
      }
    } catch {
      this.state = createEmptyState();
    }
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  setActiveContext({
    workspaceRoot = "",
    runtimeId = "",
    threadId = "",
    bindingKey = "",
    accountId = "",
    senderId = "",
  } = {}) {
    this.load();
    const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return null;
    }
    const next = {
      workspaceRoot: normalizedWorkspaceRoot,
      runtimeId: normalizeText(runtimeId),
      threadId: normalizeText(threadId),
      bindingKey: normalizeText(bindingKey),
      accountId: normalizeText(accountId),
      senderId: normalizeText(senderId),
      updatedAt: new Date().toISOString(),
    };
    this.state.contextsByWorkspaceRoot = {
      ...(this.state.contextsByWorkspaceRoot || {}),
      [normalizedWorkspaceRoot]: next,
    };
    this.save();
    return next;
  }

  resolveActiveContext({ workspaceRoot = "", runtimeId = "" } = {}) {
    this.load();
    const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
    if (normalizedWorkspaceRoot) {
      const exact = this.state.contextsByWorkspaceRoot?.[normalizedWorkspaceRoot];
      if (exact) {
        return exact;
      }
    }

    const entries = Object.values(this.state.contextsByWorkspaceRoot || {})
      .filter((entry) => entry && typeof entry === "object");
    const normalizedRuntimeId = normalizeText(runtimeId);
    const scoped = normalizedRuntimeId
      ? entries.filter((entry) => normalizeText(entry.runtimeId) === normalizedRuntimeId)
      : entries;
    const sorted = scoped.sort((left, right) => {
      const leftMs = Date.parse(left.updatedAt || "") || 0;
      const rightMs = Date.parse(right.updatedAt || "") || 0;
      return rightMs - leftMs;
    });
    return sorted[0] || null;
  }

  getPulseExposureState(workspaceRoot = "") {
    this.load();
    const key = normalizeWorkspaceKey(workspaceRoot);
    const raw = this.state.pulseExposureByWorkspaceRoot?.[key];
    if (!raw || typeof raw !== "object") {
      return {
        workspaceRoot: key,
        modules: {},
      };
    }
    return {
      workspaceRoot: key,
      modules: raw.modules && typeof raw.modules === "object" ? { ...raw.modules } : {},
    };
  }

  getPulseExposureModule(workspaceRoot = "", moduleName = "") {
    const state = this.getPulseExposureState(workspaceRoot);
    const normalizedModuleName = normalizeText(moduleName);
    if (!normalizedModuleName) {
      return null;
    }
    const moduleState = state.modules?.[normalizedModuleName];
    return moduleState && typeof moduleState === "object"
      ? { ...moduleState }
      : null;
  }

  setPulseExposureModule(workspaceRoot = "", moduleName = "", patch = {}) {
    this.load();
    const key = normalizeWorkspaceKey(workspaceRoot);
    const normalizedModuleName = normalizeText(moduleName);
    if (!normalizedModuleName) {
      return null;
    }
    const current = this.getPulseExposureState(key);
    const nextModuleState = {
      ...(current.modules?.[normalizedModuleName] || {}),
      ...(patch && typeof patch === "object" ? patch : {}),
      updatedAt: new Date().toISOString(),
    };
    this.state.pulseExposureByWorkspaceRoot = {
      ...(this.state.pulseExposureByWorkspaceRoot || {}),
      [key]: {
        workspaceRoot: key,
        modules: {
          ...(current.modules || {}),
          [normalizedModuleName]: nextModuleState,
        },
      },
    };
    this.save();
    return { ...nextModuleState };
  }
}

function createEmptyState() {
  return {
    contextsByWorkspaceRoot: {},
    pulseExposureByWorkspaceRoot: {},
  };
}

function normalizeWorkspaceKey(value) {
  const normalized = normalizeText(value);
  return normalized || "__global__";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { RuntimeContextStore };

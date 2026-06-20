const path = require("path");
const { spawn } = require("child_process");

function createLifeForAgentIntegration(config) {
  const binPath = path.join(__dirname, "bin", "life-for-agent.js");
  return {
    describe() {
      return {
        id: "life-for-agent",
        kind: "integration",
        command: `${process.execPath} ${binPath}`,
        stateDir: config.agentLifeStateDir,
      };
    },
    async runSubcommand(subcommand, args = [], input = undefined) {
      const normalizedSubcommand = normalizeText(subcommand);
      if (!normalizedSubcommand) {
        throw new Error("life-for-agent subcommand cannot be empty");
      }
      return runLifeForAgentCommand(binPath, [normalizedSubcommand, ...normalizeArgs(args)], {
        LIFE_FOR_AGENT_STATE_DIR: config.agentLifeStateDir,
      }, input);
    },
  };
}

function runLifeForAgentCommand(binPath, args, extraEnv = {}, input = undefined) {
  return new Promise((resolve, reject) => {
    const stdinBody = input === undefined ? "" : JSON.stringify(input);
    const child = spawn(process.execPath, [binPath, ...args], {
      stdio: [stdinBody ? "pipe" : "inherit", "pipe", "pipe"],
      env: {
        ...process.env,
        ...extraEnv,
      },
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    if (stdinBody) {
      child.stdin.once("error", reject);
      child.stdin.end(stdinBody);
    }
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`life-for-agent process was interrupted by signal: ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`life-for-agent failed with exit code ${code}. ${summarizeOutput(stdout, stderr)}`));
        return;
      }
      resolve({ args, stdout, stderr });
    });
  });
}

function normalizeArgs(args) {
  return Array.isArray(args)
    ? args.map((value) => String(value ?? "")).filter((value) => value.length > 0)
    : [];
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function summarizeOutput(stdout, stderr) {
  const output = `${stdout}\n${stderr}`.trim();
  if (!output) {
    return "No additional output was captured.";
  }
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-4).join(" | ");
}

module.exports = { createLifeForAgentIntegration };

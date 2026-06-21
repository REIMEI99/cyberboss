const { spawn } = require("child_process");
const fs = require("fs");
const {
  rootDir,
  listenUrl,
  bridgePidFile,
  bridgeLogFile,
  writePidFile,
  removePidFileIfMatches,
  ensureSharedAppServer,
  ensureBridgeNotRunning,
} = require("./shared-common");

const RESTART_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];
const STABLE_RUN_RESET_MS = 5 * 60_000;

async function main() {
  const runtime = process.env.CYBERBOSS_RUNTIME || "codex";
  console.log(`starting shared bridge runtime=${runtime}`);

  const existingBridgePid = ensureBridgeNotRunning();
  if (existingBridgePid) {
    console.log(`shared cyberboss already running pid=${existingBridgePid}`);
    return;
  }

  let stopping = false;
  let activeChild = null;
  let restartAttempt = 0;

  process.on("SIGINT", () => {
    stopping = true;
    activeChild?.kill("SIGINT");
  });
  process.on("SIGTERM", () => {
    stopping = true;
    activeChild?.kill("SIGTERM");
  });

  while (!stopping) {
    try {
      const appServer = await ensureSharedAppServer();
      const appServerPidLabel = appServer.pid ? ` pid=${appServer.pid}` : "";
      if (appServer.status === "skipped") {
        console.log(`shared app-server skipped (runtime=${runtime})`);
      } else {
        console.log(`shared app-server ${appServer.status}${appServerPidLabel} listen=${listenUrl}`);
      }

      const launched = launchBridgeProcess({ runtime });
      activeChild = launched.child;
      writePidFile(bridgePidFile, launched.child.pid);
      const startedAt = Date.now();
      const exitInfo = await launched.exitPromise;
      activeChild = null;
      removePidFileIfMatches(bridgePidFile, launched.child.pid);

      if (stopping) {
        break;
      }

      const runtimeMs = Math.max(0, Date.now() - startedAt);
      restartAttempt = runtimeMs >= STABLE_RUN_RESET_MS ? 0 : restartAttempt + 1;
      const delayMs = resolveRestartDelayMs(restartAttempt);
      const exitSummary = exitInfo.signal
        ? `signal=${exitInfo.signal}`
        : `code=${exitInfo.code ?? 0}`;
      console.error(
        `[shared-start] bridge exited ${exitSummary}; restarting in ${Math.round(delayMs / 1000)}s`
      );
      await sleep(delayMs);
    } catch (error) {
      if (stopping) {
        break;
      }
      restartAttempt += 1;
      const delayMs = resolveRestartDelayMs(restartAttempt);
      console.error(
        `[shared-start] startup failed: ${error instanceof Error ? error.message : String(error || "unknown error")}; retrying in ${Math.round(delayMs / 1000)}s`
      );
      await sleep(delayMs);
    }
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});

function launchBridgeProcess({ runtime }) {
  const childEnv = { ...process.env };
  if (runtime === "codex") {
    childEnv.CYBERBOSS_CODEX_ENDPOINT = listenUrl;
  }

  const bridgeLogStream = fs.createWriteStream(bridgeLogFile, { flags: "a" });
  const child = spawn(process.execPath, ["./bin/cyberboss.js", "start", "--checkin"], {
    cwd: rootDir,
    env: childEnv,
    stdio: ["inherit", "pipe", "pipe"],
  });

  child.stdout.pipe(process.stdout);
  child.stdout.pipe(bridgeLogStream, { end: false });
  child.stderr.pipe(process.stderr);
  child.stderr.pipe(bridgeLogStream, { end: false });

  const exitPromise = new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      bridgeLogStream.end();
      resolve({ code, signal });
    });
  });

  return { child, exitPromise };
}

function resolveRestartDelayMs(restartAttempt) {
  const index = Math.max(0, Math.min(RESTART_DELAYS_MS.length - 1, restartAttempt - 1));
  return RESTART_DELAYS_MS[index];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

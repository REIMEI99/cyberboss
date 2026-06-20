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

async function main() {
  const runtime = process.env.CYBERBOSS_RUNTIME || "codex";
  console.log(`starting shared bridge runtime=${runtime}`);
  const appServer = await ensureSharedAppServer();
  const appServerPidLabel = appServer.pid ? ` pid=${appServer.pid}` : "";
  if (appServer.status === "skipped") {
    console.log(`shared app-server skipped (runtime=${runtime})`);
  } else {
    console.log(`shared app-server ${appServer.status}${appServerPidLabel} listen=${listenUrl}`);
  }

  const existingBridgePid = ensureBridgeNotRunning();
  if (existingBridgePid) {
    console.log(`shared cyberboss already running pid=${existingBridgePid}`);
    return;
  }

  const childEnv = { ...process.env };
  const isCodex = runtime === "codex";
  if (isCodex) {
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

  writePidFile(bridgePidFile, child.pid);
  const cleanup = () => removePidFileIfMatches(bridgePidFile, child.pid);
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    child.kill("SIGINT");
  });
  process.on("SIGTERM", () => {
    child.kill("SIGTERM");
  });

  child.on("exit", (code, signal) => {
    cleanup();
    bridgeLogStream.end();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});

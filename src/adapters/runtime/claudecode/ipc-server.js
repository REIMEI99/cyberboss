const net = require("net");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { EventEmitter } = require("events");

class ClaudeCodeIpcServer extends EventEmitter {
  constructor({ socketPath }) {
    super();
    // socketPath is kept for backward compatibility with callers,
    // but we derive port/token files from it.
    this.portFile = socketPath.replace(/\.sock$/, ".port");
    this.tokenFile = socketPath.replace(/\.sock$/, ".token");
    this.authToken = "";
    this.server = null;
    this.port = 0;
    this.clients = new Set();
    this.authenticated = new Set();
  }

  start() {
    if (this.server) return;
    this.ensureDirectory();
    this.removeStalePortFile();
    this.generateAuthToken();

    this.server = net.createServer((socket) => {
      this.clients.add(socket);
      socket.setEncoding("utf8");

      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (!this.authenticated.has(socket)) {
              if (msg?.type === "auth" && msg?.token === this.authToken) {
                this.authenticated.add(socket);
              }
              continue;
            }
            if (validateIpcMessage(msg)) {
              this.emit("clientMessage", msg, socket);
            }
          } catch {
            // ignore malformed
          }
        }
      });

      socket.on("close", () => {
        this.clients.delete(socket);
        this.authenticated.delete(socket);
      });

      socket.on("error", () => {
        this.clients.delete(socket);
        this.authenticated.delete(socket);
      });
    });

    this.server.listen(0, "127.0.0.1", () => {
      const address = this.server.address();
      this.port = address.port;
      try {
        fs.writeFileSync(this.portFile, String(this.port), { mode: 0o600 });
      } catch {
        // ignore
      }
    });
  }

  broadcast(event) {
    const payload = JSON.stringify(event) + "\n";
    for (const client of this.authenticated) {
      try {
        client.write(payload);
      } catch {
        // ignore dead sockets
      }
    }
  }

  ensureDirectory() {
    const dir = path.dirname(this.portFile);
    fs.mkdirSync(dir, { recursive: true });
  }

  removeStalePortFile() {
    try {
      fs.unlinkSync(this.portFile);
    } catch {
      // ignore
    }
  }

  generateAuthToken() {
    this.authToken = crypto.randomBytes(32).toString("hex");
    try {
      fs.writeFileSync(this.tokenFile, this.authToken, { mode: 0o600 });
    } catch {
      // ignore
    }
  }

  removeAuthToken() {
    try {
      fs.unlinkSync(this.tokenFile);
    } catch {
      // ignore
    }
  }

  async close() {
    for (const client of this.clients) {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    this.authenticated.clear();

    if (this.server) {
      await new Promise((resolve) => {
        this.server.close(resolve);
      });
      this.server = null;
    }

    this.removeStalePortFile();
    this.removeAuthToken();
  }
}

function validateIpcMessage(msg) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return false;
  }
  const type = msg.type;
  if (typeof type !== "string") {
    return false;
  }
  switch (type) {
    case "sendUserMessage":
      return typeof msg.workspaceRoot === "string" && typeof msg.text === "string";
    case "respondApproval":
      return typeof msg.workspaceRoot === "string" && typeof msg.requestId === "string";
    default:
      return true;
  }
}

module.exports = { ClaudeCodeIpcServer };

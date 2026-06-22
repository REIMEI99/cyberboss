const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const files = fs.readdirSync("test").filter((f) => f.endsWith(".test.js")).sort();
let totalPass = 0, totalFail = 0;
const failed = [];
for (const f of files) {
  let out = "", err = "";
  try {
    out = execFileSync("node", [path.join("test", f)], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  } catch (e) {
    out = e.stdout || "";
    err = e.stderr || "";
  }
  const pm = out.match(/pass (\d+)/);
  const fm = out.match(/fail (\d+)/);
  const p = pm ? parseInt(pm[1], 10) : 0;
  const fa = fm ? parseInt(fm[1], 10) : 0;
  totalPass += p;
  totalFail += fa;
  if (fa || err) failed.push(f);
  console.log((fa || err ? "FAIL" : "ok  ") + " " + f + " pass=" + p + " fail=" + fa);
  if (err) console.log("    " + err.split("\n").slice(0, 3).join("\n    "));
}
console.log("\nTOTAL pass=" + totalPass + " fail=" + totalFail);
if (failed.length) { console.log("FAILED: " + failed.join(", ")); process.exit(1); }
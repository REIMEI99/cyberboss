const fs = require("fs");
const p = "src/core/app.js";
let s = fs.readFileSync(p, "utf8");
const bad = "\u597d\u563e";
const good = "\u597d\u561e";
if (!s.includes(bad)) { console.error("bad token not found"); process.exit(1); }
s = s.split(bad).join(good);
fs.writeFileSync(p, s, "utf8");
console.log("fixed token, contains good:", s.includes(good), "contains bad:", s.includes(bad));
// Marks a new development build, so the extension reloads itself when "Reload on code changes" is on.
// Run after editing: npm run bump   (or: node tools/bump_build.js). Works on Windows, macOS and Linux.
const fs = require("node:fs");
const path = require("node:path");

const file = path.join(__dirname, "..", "extension", "build-id.txt");
fs.writeFileSync(file, `${Date.now()}${process.hrtime.bigint() % 1000000n}\n`);
console.log("build id written to", path.relative(process.cwd(), file));

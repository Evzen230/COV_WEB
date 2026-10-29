const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory()
      ? files(filename)
      : /\.(?:cjs|mjs|js)$/.test(filename)
        ? [filename]
        : [];
  });
}
const targets = [
  "server.cjs",
  ...files("dist/js"),
  ...files("server"),
  ...files("scripts"),
  ...files("test"),
  ...files("examples"),
];
for (const filename of targets)
  execFileSync(process.execPath, ["--check", filename], { stdio: "inherit" });
console.log(`Syntaxe v pořádku: ${targets.length} souborů.`);

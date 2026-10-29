const { test } = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("Bez konfigurace přístupu se server neotevře a nevytvoří databázi", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cov-locked-"));
  try {
    const dbPath = path.join(directory, "must-not-exist.sqlite");
    const result = spawnSync(process.execPath, ["server.cjs"], {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        AUTH_FILE: path.join(directory, "missing.json"),
        DB_PATH: dbPath,
      },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /npm run setup/);
    assert.equal(fs.existsSync(dbPath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Obsazený port ukončí start s návodem, bez neošetřené výjimky", async () => {
  const occupied = net.createServer();
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cov-startup-"));
  const authPath = path.join(directory, "auth.json");
  fs.writeFileSync(
    authPath,
    JSON.stringify(
      require("../server/security.cjs").credentials(
        "test-password",
        "test-key",
      ),
    ),
  );
  try {
    const result = spawnSync(process.execPath, ["server.cjs"], {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(occupied.address().port),
        AUTH_FILE: authPath,
        DB_PATH: path.join(directory, "test.sqlite"),
      },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /je už obsazený/);
    assert.match(result.stderr, /Ctrl\+C/);
    assert.ok(!result.stderr.includes("Unhandled 'error' event"));
    assert.ok(!result.stderr.includes("throw er;"));
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

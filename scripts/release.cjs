// node scripts/release.cjs <private.pem> <firmware.bin> <firmware-version> <HTTPS-release-base> <output-dir>
const fs = require("node:fs"),
  path = require("node:path");
const { sign, createHash } = require("node:crypto");
const [key, firmware, firmwareVersion, base, out] = process.argv.slice(2);
if (
  !out ||
  !/^\d+\.\d+\.\d+$/.test(firmwareVersion) ||
  !base.startsWith("https://")
)
  throw Error(
    "Použití: node scripts/release.cjs private.pem firmware.bin 0.3.0 https://github.com/OWNER/REPO/releases/download/v0.3.0 output",
  );
const files = {};
function collect(name) {
  if (fs.lstatSync(name).isSymbolicLink())
    throw Error("Symlinky nejsou povoleny");
  if (fs.statSync(name).isDirectory())
    for (const child of fs.readdirSync(name)) collect(name + "/" + child);
  else files[name] = fs.readFileSync(name).toString("base64");
}
for (const name of [
  "server.cjs",
  "package.json",
  "README.md",
  "server",
  "dist",
  "docs",
  "scripts",
])
  collect(name);
const server = Buffer.from(JSON.stringify({ files })),
  fw = fs.readFileSync(firmware);
const asset = (bytes, filename, version) => ({
  version,
  protocol: 1,
  url: base.replace(/\/$/, "") + "/" + filename,
  sha256: createHash("sha256").update(bytes).digest("hex"),
});
const payload = Buffer.from(
  JSON.stringify({
    schema: 1,
    notes: process.env.RELEASE_NOTES || "",
    server: asset(server, "server.bundle", require("../package.json").version),
    firmware: {
      ...asset(fw, "firmware.bin", firmwareVersion),
      target: "esp32-ds18b20-v1",
    },
  }),
);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "server.bundle"), server);
fs.writeFileSync(path.join(out, "firmware.bin"), fw);
fs.writeFileSync(
  path.join(out, "manifest.json"),
  JSON.stringify(
    {
      payload: payload.toString("base64"),
      signature: sign(null, payload, fs.readFileSync(key)).toString("base64"),
    },
    null,
    2,
  ),
);
console.log("Podepsané vydání připraveno: " + out);

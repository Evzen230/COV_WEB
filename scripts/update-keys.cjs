const fs = require("node:fs");
const path = require("node:path");
const {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
} = require("node:crypto");

// data/ is excluded from Git. Never print the private key.
const directory = path.join(__dirname, "..", "data", "update-signing");
const privatePath = path.join(directory, "update-private.pem");
const publicPath = path.join(directory, "update-public.pem");
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
if (fs.existsSync(privatePath)) {
  const privateKey = createPrivateKey(fs.readFileSync(privatePath));
  if (privateKey.asymmetricKeyType !== "ed25519")
    throw Error("Existující klíč není Ed25519. Nic nebylo přepsáno.");
  const expected = createPublicKey(privateKey).export({
    type: "spki",
    format: "pem",
  });
  if (fs.existsSync(publicPath)) {
    const actual = createPublicKey(fs.readFileSync(publicPath)).export({
      type: "spki",
      format: "pem",
    });
    if (actual !== expected)
      throw Error("Klíče k sobě nepatří. Nic nebylo přepsáno.");
  } else fs.writeFileSync(publicPath, expected, { flag: "wx", mode: 0o644 });
  console.log("Existující klíče byly ověřeny a zachovány.");
} else {
  if (fs.existsSync(publicPath))
    throw Error(
      "Veřejný klíč již existuje, ale chybí soukromý. Obnovte jej ze zálohy; nový pár nebyl vytvořen.",
    );
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  fs.writeFileSync(
    privatePath,
    privateKey.export({ type: "pkcs8", format: "pem" }),
    { flag: "wx", mode: 0o600 },
  );
  fs.writeFileSync(
    publicPath,
    publicKey.export({ type: "spki", format: "pem" }),
    { flag: "wx", mode: 0o644 },
  );
  console.log("Ověřovací klíče byly vytvořeny.");
}
console.log("Soukromý klíč (zálohujte, nesdílejte): " + privatePath);
console.log("Veřejný klíč (později na malinu): " + publicPath);

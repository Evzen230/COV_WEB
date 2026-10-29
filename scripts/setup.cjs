const fs = require("node:fs"),
  path = require("node:path");
const { randomBytes } = require("node:crypto");
const { Writable } = require("node:stream");
const readline = require("node:readline/promises");
const { credentials, saveCredentials } = require("../server/security.cjs");
const filename = path.resolve(
  process.env.AUTH_FILE || path.join(__dirname, "..", "data", "auth.json"),
);
async function main() {
  if (fs.existsSync(filename) && !process.argv.includes("--reset"))
    throw Error(
      "Přístup už existuje. Heslo a API klíč změňte po přihlášení v Nastavení. Při ztrátě hesla použijte npm run setup -- --reset a restartujte server.",
    );
  if (!process.stdin.isTTY)
    throw Error(
      "Spusťte npm run setup v interaktivním terminálu. Heslo se zadává skrytě.",
    );
  const output = new Writable({
    write(chunk, encoding, done) {
      done();
    },
  });
  output.isTTY = true;
  output.columns = 80;
  const input = readline.createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  let password, repeat;
  try {
    process.stdout.write(
      "Zvolte heslo nebo frázi pro web (8 až 128 znaků, bez zobrazení): ",
    );
    password = await input.question("");
    process.stdout.write("\n");
    process.stdout.write("Zopakujte heslo: ");
    repeat = await input.question("");
    process.stdout.write("\n");
  } finally {
    input.close();
  }
  if (password.length < 8 || password.length > 128)
    throw Error(
      "Heslo musí mít 8 až 128 znaků. Zkuste delší zapamatovatelnou frázi.",
    );
  if (password !== repeat) throw Error("Hesla se neshodují. Nic se nezměnilo.");
  const key = randomBytes(32).toString("base64url");
  saveCredentials(credentials(password, key), filename);
  console.log(
    "Vlastní heslo bylo nastaveno. Heslo se neukládá v čitelné podobě.",
  );
  console.log("API klíč pro ESP32 / Python (uložte si jej nyní):", key);
  console.log("Spusťte nebo restartujte server: npm start");
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

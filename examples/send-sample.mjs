// node examples/send-sample.mjs http://127.0.0.1:4173 18.7
import { randomUUID } from "node:crypto";
const base = process.argv[2] || "http://127.0.0.1:4173";
const temperature = Number(process.argv[3] || 18.7);
if (!Number.isFinite(temperature)) throw Error("Teplota musí být číslo");
const key = process.env.COV_API_KEY;
if (!key)
  throw Error(
    "Nastavte proměnnou COV_API_KEY na klíč stanice z npm run setup.",
  );
const message = {
  device_id: "cov-monitor-01",
  sample_id: randomUUID(),
  timestamp: new Date().toISOString(),
  measurements: { temperature },
};
const response = await fetch(new URL("/api/v1/telemetry", base), {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-API-Key": key },
  body: JSON.stringify(message),
});
console.log(response.status, await response.json());
if (!response.ok) process.exitCode = 1;

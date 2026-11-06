const http = require("node:http");
function networkRequest(
  action,
  input,
  {
    platform = process.platform,
    socketPath = process.env.COV_NETWORK_SOCKET ||
      "/run/cov-network/control.sock",
  } = {},
) {
  if (platform !== "linux") {
    if (action === "status")
      return Promise.resolve({
        available: false,
        message: "Správa Wi-Fi je dostupná pouze na připraveném Raspberry Pi.",
      });
    return Promise.reject(
      Object.assign(Error("Správa Wi-Fi není dostupná."), { status: 503 }),
    );
  }
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath,
        path: "/" + action,
        method: input ? "POST" : "GET",
        headers: input ? { "Content-Type": "application/json" } : {},
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => {
          data += chunk;
          if (data.length > 65536) request.destroy();
        });
        response.on("end", () => {
          try {
            const result = JSON.parse(data);
            if (response.statusCode >= 400)
              reject(
                Object.assign(
                  Error(result.error || "Síťová operace selhala."),
                  { status: response.statusCode },
                ),
              );
            else resolve(result);
          } catch {
            reject(
              Object.assign(Error("Neplatná odpověď síťové služby."), {
                status: 503,
              }),
            );
          }
        });
      },
    );
    request.setTimeout(20000, () => request.destroy(Error("timeout")));
    request.on("error", () => {
      if (action === "status")
        resolve({
          available: false,
          message: "Síťová služba není nainstalována nebo neběží.",
        });
      else
        reject(
          Object.assign(Error("Síťová služba není dostupná."), { status: 503 }),
        );
    });
    request.end(input ? JSON.stringify(input) : undefined);
  });
}
module.exports = { networkRequest };

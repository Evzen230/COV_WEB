// All browser-to-server requests go through this client.
export async function api(url, method = "GET", body) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(Error(result.error || "Chyba serveru"), {
      status: response.status,
    });
  return result;
}

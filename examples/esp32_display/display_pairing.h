#pragma once
#include <mbedtls/sha256.h>
#include <mbedtls/md.h>
#include <mbedtls/gcm.h>

String displayPairIdentity, displayPairNonce;
String displayHex(const uint8_t* bytes, size_t length) {
  const char* alphabet = "0123456789abcdef";
  String out; out.reserve(length * 2);
  for (size_t i = 0; i < length; i++) { out += alphabet[bytes[i] >> 4]; out += alphabet[bytes[i] & 15]; }
  return out;
}
bool displayUnhex(const String& text, uint8_t* out, size_t length) {
  if (text.length() != length * 2) return false;
  for (size_t i = 0; i < length; i++) {
    char a = tolower(text[2 * i]), b = tolower(text[2 * i + 1]);
    if (!isxdigit((unsigned char)a) || !isxdigit((unsigned char)b)) return false;
    out[i] = ((a <= '9' ? a - '0' : a - 'a' + 10) << 4) | (b <= '9' ? b - '0' : b - 'a' + 10);
  }
  return true;
}
void displaySha(const String& text, uint8_t* result) {
  mbedtls_sha256_context context; mbedtls_sha256_init(&context);
  mbedtls_sha256_starts(&context, 0);
  mbedtls_sha256_update(&context, (const uint8_t*)text.c_str(), text.length());
  mbedtls_sha256_finish(&context, result); mbedtls_sha256_free(&context);
}
bool claimDisplayPairing(const String& url, String code, String& key) {
  code.replace("-", ""); code.replace(" ", ""); code.trim(); code.toUpperCase();
  bool valid = code.length() == 8;
  for (size_t i = 0; i < code.length(); i++) if (!strchr("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", code[i])) valid = false;
  if (!valid) { displaySetupReply(400, "Zadejte osmiznakový párovací kód z webu ČOV."); return false; }
  uint8_t derived[32], identifier[32], proof[32];
  displaySha(code, derived); String derivedHex = displayHex(derived, 32);
  displaySha(derivedHex, identifier);
  String identity = url + ":" + displayHex(identifier, 32);
  if (identity != displayPairIdentity) { displayPairIdentity = identity; displayPairNonce = randomToken(16); }
  // Keep the nonce for retries after a lost reply or failed NVS write.
  mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), derived, 32,
    (const uint8_t*)displayPairNonce.c_str(), displayPairNonce.length(), proof);
  JsonDocument request; request["codeHash"] = displayHex(identifier, 32);
  request["nonce"] = displayPairNonce; request["proof"] = displayHex(proof, 32);
  String body; serializeJson(request, body);
  WiFiClient client; HTTPClient http; http.setConnectTimeout(3000); http.setTimeout(5000);
  if (!http.begin(client, resolveDisplayUrl(url) + "/api/v1/display/pair")) { displaySetupReply(400, "Server nelze otevřít."); return false; }
  http.addHeader("Content-Type", "application/json");
  int status = http.POST(body);
  DisplayBuffer response;
  int copied = status == 200 ? http.writeToStream(&response) : -1;
  http.end();
  if (status != 200) {
    String reason = status == 401 ? "Kód je neplatný nebo vypršel. Vytvořte nový kód ve webu." :
      status == 409 ? "Kód už byl použit jiným zařízením. Vytvořte nový kód." :
      status == 429 ? "Příliš mnoho pokusů. Počkejte minutu." :
      status == 404 ? "Aktualizujte server ČOV; párování displeje není dostupné." : "Spojení se serverem selhalo. Ověřte adresu a síť.";
    displaySetupReply(400, reason); return false;
  }
  JsonDocument envelope;
  if (copied < 0 || deserializeJson(envelope, response.data)) { displaySetupReply(400, "Neplatná párovací odpověď."); return false; }
  String data = envelope["data"] | "";
  uint8_t iv[12], tag[16], encrypted[1024], plain[1025];
  if (data.isEmpty() || data.length() > 2048 || data.length() % 2 ||
      !displayUnhex(envelope["iv"] | "", iv, 12) || !displayUnhex(envelope["tag"] | "", tag, 16) ||
      !displayUnhex(data, encrypted, data.length() / 2)) { displaySetupReply(400, "Neplatná párovací odpověď."); return false; }
  mbedtls_gcm_context context; mbedtls_gcm_init(&context);
  int result = mbedtls_gcm_setkey(&context, MBEDTLS_CIPHER_ID_AES, derived, 256);
  if (!result) result = mbedtls_gcm_auth_decrypt(&context, data.length() / 2, iv, 12, nullptr, 0, tag, 16, encrypted, plain);
  mbedtls_gcm_free(&context);
  plain[data.length() / 2] = 0;
  JsonDocument credentials;
  if (result || deserializeJson(credentials, (char*)plain)) { displaySetupReply(400, "Párovací odpověď nelze ověřit. Zkuste párování znovu."); return false; }
  key = credentials["apiKey"] | "";
  String id = credentials["device_id"] | "";
  bool accepted = key.length() == 64 && id.length() == 24;
  for (size_t i = 0; i < key.length(); i++) if (!isxdigit((unsigned char)key[i])) accepted = false;
  for (size_t i = 0; i < id.length(); i++) if (!isxdigit((unsigned char)id[i])) accepted = false;
  if (!accepted) { displaySetupReply(400, "Párovací odpověď neobsahuje platný přístup displeje."); return false; }
  return true;
}

# Napojení domácí ČOV na server

## Datový řetězec

ESP32 čte senzory a jednou za přibližně 60 sekund odešle HTTP POST na domácí server. Server validuje zprávu, uloží ji do SQLite a vyhodnocuje technické alarmy každou sekundu. Web čte serverový stav každých pět sekund. Home Assistant není potřeba. Žádný endpoint nespíná technologii.

## Spuštění v domácí síti

Použijte Node.js 24.13 nebo novější řady 24. V PowerShellu v kořeni projektu:

```powershell
$env:HOST = '0.0.0.0'
$env:PORT = '4173'
npm run setup
npm start
```

Výchozí `npm start` bez HOST poslouchá pouze na 127.0.0.1. Pro stanici je nutný výše uvedený síťový režim. Na routeru rezervujte serveru stálou DHCP adresu, např. 192.168.1.100. ESP32 a server musí být ve stejné dostupné síti. Pokud firewall blokuje spojení, povolte příchozí TCP 4173 pouze v privátní domácí síti. Web otevřete na `http://IP_SERVERU:4173`. Vypnutí webového prohlížeče nepřeruší sběr; vypnutí procesu serveru nebo uspání počítače ano. Pro trvalý provoz spusťte proces jako službu na stále zapnutém domácím serveru. Konkrétní instalace služby závisí na cílovém OS, zde není automaticky provedena.

Web vyžaduje přihlášení heslem. Stanice má samostatný klíč pro příjem měření a kontrolu spojení. Před prvním spuštěním zabezpečené verze proveďte npm run setup. Postup přihlášení a změny klíčů: [zabezpečení](docs/SECURITY.md).

## Příjem měření

`POST /api/v1/telemetry` s hlavičkami `Content-Type: application/json` a `X-API-Key: VAS_KLIC_STANICE`:

```json
{
  "device_id": "cov-monitor-01",
  "sample_id": "boot-7f93-00001",
  "timestamp": "2026-10-28T15:00:00.000Z",
  "measurements": {
    "temperature": 18.7,
    "level": 64,
    "ph": 7.2,
    "ec": 842,
    "turbidity": 12.4,
    "orp": 185
  },
  "blower": true,
  "rssi": -61
}
```

Pro první etapu stačí `measurements: {"temperature":18.7}`. Chybějící veličiny a explicitní `null` znamenají nedostupné měření. Zpráva musí obsahovat alespoň jednu známou veličinu, může mít všechny známé veličiny null. Neznámé klíče se neukládají. Teplotní čidlo s chybou má posílat null, nikoli -127 nebo 85 jako náhradní chybovou hodnotu. Konkrétní firmware musí platnost měření ověřovat.

| Pole        | Význam                                                                                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| device_id   | Povinné, nyní pouze `cov-monitor-01`.                                                                                                                                       |
| sample_id   | Povinný neprázdný řetězec do 100 znaků; jedinečný po celou dobu provozu, např. náhodné ID startu a počítadlo.                                                               |
| timestamp   | Volitelný čas vzorku ISO 8601 v UTC; bez něj se použije čas přijetí serverem. Pro zpětné odeslání bufferu jej vyplňte. Nejvýše 30 dní v minulosti, 60 sekund v budoucnosti. |
| temperature | °C, -55 až 125, nebo null.                                                                                                                                                  |
| level       | %, 0 až 100, nebo null.                                                                                                                                                     |
| ph          | pH, 0 až 14, nebo null.                                                                                                                                                     |
| ec          | µS/cm, 0 až 200000, nebo null.                                                                                                                                              |
| turbidity   | NTU, 0 až 100000, nebo null.                                                                                                                                                |
| orp         | mV, -2000 až 2000, nebo null.                                                                                                                                               |
| blower      | Volitelně true/false/null, pouze pozorovaný stav dmychadla.                                                                                                                 |
| rssi        | Volitelný signál Wi-Fi v dBm, -150 až 0, nebo null.                                                                                                                         |

Rozsahy jsou validační meze datového formátu, nejsou legislativní limity. Server neposuzuje kvalitu vyčištěné vody ani správnost kalibrace sond.

Odpověď 201 znamená uložení vzorku, 200 s `duplicate:true` znamená úspěšné opakování stejné zprávy. Při výpadku spojení nebo odpovědi 5xx opakujte identickou zprávu se stejným sample_id. Změněný obsah nebo čas pod již použitým sample_id vrací 409. Neplatná zpráva vrací 400, nesprávný Content-Type 415, zpráva nad 64 KiB 413. Neposílejte nový sample_id při každém opakování. Všechny přijaté zprávy se rovnou zobrazují v aplikaci.

## Test bez ESP32

```powershell
$env:COV_API_KEY = 'VAS_KLIC_STANICE'
node examples/send-sample.mjs http://127.0.0.1:4173 18.7
```

Přijatá data se automaticky zobrazí ve webu. Pro test odpojeného čidla:

```powershell
$message = @{
  device_id = 'cov-monitor-01'
  sample_id = [guid]::NewGuid().ToString()
  measurements = @{ temperature = $null }
} | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri 'http://127.0.0.1:4173/api/v1/telemetry' -Method Post -ContentType 'application/json' -Headers @{'X-API-Key'=$env:COV_API_KEY} -Body $message
```

Příklad `examples/esp32_http/esp32_http.ino` používá ESP32 Arduino, OneWire a DallasTemperature pro DS18B20 na GPIO4. Wi-Fi, IP serveru a API klíč nastavte jednorázově přes `examples/esp32_provision/esp32_provision.ino`; monitorovací firmware je načte z NVS. Pro OTA je navíc potřeba ArduinoJson 7 a konfigurace ověřeného HTTPS podle [návodu k aktualizacím](UPDATES.md). Je to komunikační výchozí firmware pro jeden senzor, nikoli firmware celé budoucí stanice. Drží jeden neodeslaný vzorek v RAM a nemá trvalý offline buffer; restart ho ztratí. Pro úplnou offline historii doplňte frontu ve flash/SD a NTP nebo RTC. Na skutečné desce zatím nebyl zkompilován ani ověřen. HTTP komunikace používá standardní HTTPClient z [oficiálního ESP32 Arduino projektu](https://github.com/espressif/arduino-esp32/tree/master/libraries/HTTPClient).

## Další endpointy

V Nastavení → Hlídání jednotlivých senzorů označte zapojené sondy. Výchozí hlídání výpadku je zapnuté pouze pro teplotu; další sondy zapněte při jejich připojení. Nastavení `sensorRules` obsahuje pro každý klíč temperature, level, ph, ec, turbidity a orp objekt `{ "enabled": true, "min": null, "max": null }`. Chybějící nebo null měření zapnuté sondy vyvolá vlastní alarm, návrat platného vzorku jej ukončí. Zcela nedostupná stanice vyvolá společný alarm místo šesti souběžných výpadků sond. Volitelné min/max pro další veličiny nastavujte podle provozu a ověření sond; nejsou přednastavenými limity kvality vody. Firmware musí vadné čidlo hlásit jako null, nikoli opakovaně posílat starou platnou hodnotu — tu server nedokáže sám rozpoznat jako chybu.

Nový nepotvrzený alarm se automaticky zobrazí jako globální okno na kterékoli otevřené stránce aplikace. Web kontroluje server každých 5 sekund. Okno lze zavřít jen pro aktuální relaci nebo potvrdit přijetí na serveru; potvrzení neodstraní samotnou poruchu. Při novém výskytu stejné poruchy se upozornění zobrazí znovu. Obnovení stránky znovu připomene aktivní nepotvrzené alarmy. Upozornění ani jeho potvrzení nemaže rozepsané servisní nebo laboratorní formuláře. Nejde o systémovou push notifikaci při zavřeném webu.

Projektovou dokumentaci poskytuje `GET /api/docs/readme`, `GET /api/docs/api` a `GET /api/docs/structure` a `GET /api/docs/alarms`. Odpověď obsahuje id, cestu a aktuální obsah Markdown souboru. Parametr `?download=1` stáhne původní Markdown. Dokumentace včetně zabezpečení je dostupná pouze přihlášenému webu.

| Metoda a cesta           | Účel                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| GET /api/health          | Kontrola běhu serveru.                                                                                                                    |
| GET /api/state           | Nastavení, poslední vzorek, dostupnost, historie přijatých dat, aktivní alarmy, deníky. Historie nejvýše 7 dní a 20000 posledních vzorků. |
| PUT /api/settings        | Nastavení name, tempMin/Max, levelMax, stale (min), tankVolume (l). name je povinné, ostatní nezaslané hodnoty se zachovají.              |
| POST /api/alarms/:id/ack | Potvrzení přijetí aktivního alarmu; porucha tím nezmizí.                                                                                  |
| POST /api/labs           | date (YYYY-MM-DD), location, parameter, value (číslo ≥0), unit, lab, note.                                                                |
| DELETE /api/labs/:id     | Smazání laboratorního záznamu.                                                                                                            |
| POST /api/service        | date, type, device, note. Bez jména obsluhy.                                                                                              |
| DELETE /api/service/:id  | Smazání servisního záznamu.                                                                                                               |
| GET /api/backup          | JSON záloha nastavení, deníků, aktivních alarmů, posledních 100 událostí a všech uložených vzorků obou zdrojů.                            |

Stav API navíc obsahuje sensorStatus pro každou veličinu: status fresh/missing/stale, measured_at a last_valid_at. Nastavení alarmDelaySeconds (výchozí 60), tempHysteresis (0,5), levelHysteresis (2) a rangeHysteresis řídí stabilitu alarmů.

Při překročení `stale` se stanice označí jako nedostupná. Kontroluje se stáří posledního vzorku i jeho přijetí; dávka starých dat neoznačí stanici za aktuální. Pozdní zprávy se ukládají podle času vzorku a nepřepisují novější hodnotu. Návrat čerstvého vzorku ukončí alarm a zapíše událost. Nový výskyt stejné poruchy vyžaduje nové potvrzení. Upozornění jsou v aplikaci; e-mail, SMS ani push nejsou implementovány.

## Uložení a záloha

Databáze je `data/cov.sqlite` a pomocné WAL/SHM soubory. Nastavení, měření, potvrzení alarmů a deníky přežijí restart serveru a jsou společné pro telefon i počítač. Reálná data se automaticky nemažou. Webová historie zobrazuje omezené okno, úplná historie zůstává v databázi a JSON záloze. Export CSV odpovídá načtenému oknu webu. Pro úplnou obnovitelnou zálohu vypněte server a zkopírujte celou složku data. Obnova: při vypnutém serveru vraťte tuto složku a spusťte stejnou verzi aplikace. JSON je export; automatický JSON import není implementován. Původní lokální záznamy z prohlížeče se na server automaticky nemigrují; před přechodem je exportujte ze staré verze, pokud je potřebujete.

## Plán instalace

1. Zvolit stále zapnutý server a stabilní IP v domácí síti.
2. Spustit aplikaci v síťovém režimu a ověřit web z telefonu na stejné Wi-Fi.
3. Odeslat testovací vzorek z jiného zařízení.
4. Nastavit firmware ESP32 podle výše uvedeného formátu; začít teplotou a null pro chybné měření.
5. Ověřit odpojení čidla, ztrátu Wi-Fi, opakování zpráv a automatické zotavení.
6. Nastavit skutečný objem nádrže a technické prahy, pravidelně zálohovat data.

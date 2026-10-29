# ČOV Monitor

Domácí webový monitoring ČOV s Node.js backendem, SQLite a HTTP API pro ESP32. Web má přihlášení heslem a stanice vlastní API klíč. Home Assistant není potřeba. Aplikace pouze sleduje, nespíná technologii.

## Spuštění

Vyžaduje Node.js 24.13 nebo novější řady 24; bez instalace npm balíčků.

```powershell
npm run setup
npm start
```

Otevřete http://127.0.0.1:4173. Pro přístup stanice a telefonu v domácí síti nastavte před spuštěním `$env:HOST = '0.0.0.0'`. Volitelné proměnné: PORT (výchozí 4173), DB_PATH (výchozí data/cov.sqlite). Server musí běžet po celou dobu sběru.

Příkaz setup se při prvním spuštění zeptá na vaše vlastní heslo pro web a vygeneruje API klíč pro stanici. Klíč si uložte; ukáže se jen jednou. Heslo a klíč lze později změnit po přihlášení v Nastavení → Přístup a API klíč. Aktualizace na Raspberry Pi popisuje [návod k aktualizacím](docs/UPDATES.md). Při ruční výměně souborů zastavte server, zachovejte data a přístupové údaje a restartujte; setup se znovu nespouští. V Pythonu doplňte klíč do nového pole API klíč stanice. Podrobnosti: [zabezpečení](docs/SECURITY.md).

## Aktualizace na Raspberry Pi

Nastavení → Aktualizace zobrazuje verze serveru a ESP32, umožňuje kontrolu vydání a spuštění instalace. Nová verze se oznamuje zavíratelným upozorněním. Podepsaná vydání z GitHubu, instalaci systemd, zálohy a obnovu popisuje [návod k aktualizacím](docs/UPDATES.md). Zdroj vydání a veřejný klíč je nutné nastavit při instalaci; ESP32 potřebuje OTA firmware, NVS provisioning a ověřené HTTPS.

## Funkce

V aplikaci otevřete **Návody a dokumentace**. Najdete tam tento README, návod k napojení stanice a přehled souborů projektu. Dokumenty se načítají přímo ze zdrojových Markdown souborů a lze je stáhnout.

Přehled šesti veličin, historie, CSV export, alarmy s potvrzením a obnovou, evidence laboratorních rozborů, servisní deník bez jména, provozní prahy, konfigurovatelný objem nádrže, světlý a tmavý režim. Měření a záznamy jsou společné pro všechny prohlížeče a přežijí restart serveru. Lokálně v prohlížeči zůstává jen volba vzhledu.

Aplikace přijímá data pouze přes HTTP API. Vestavěný simulátor byl odstraněn. Pro testování použijte `python cov_simulator.py` nebo jednorázový odesílací skript. Bez přijatých dat jsou grafy prázdné a stanice hlásí nedostupnost. Stará demo historie se nemaže, ale ve webu se nezobrazuje.

## Připojení stanice

Nastavení sledovaných sond, provozních mezí a ověření poruch popisuje [návod k alarmům](docs/ALARMS.md). Ve webu je pod Návody a dokumentace → Nastavení alarmů a také odkazem přímo v nastavení senzorů.

ESP32 odesílá `POST /api/v1/telemetry` s JSON zprávou. Stačí jedno zapojené čidlo. Požadavek potřebuje hlavičku X-API-Key nebo Authorization: Bearer s klíčem stanice. Jedinečné sample_id zabraňuje duplicitám při opakování zpráv. Chybné nebo chybějící měření se ukládá jako null. Backend vyhodnocuje dostupnost a alarmy i při zavřeném webu. Notifikace mimo aplikaci zatím nejsou součástí.

Podrobný formát, síťové spuštění, zálohování a plán instalace: [docs/API.md](docs/API.md). Testovací odeslání: `node examples/send-sample.mjs`. Výchozí Arduino firmware pro ESP32 a DS18B20: `examples/esp32_http/esp32_http.ino` (hardware neověřen).

## Orientace ve zdrojovém kódu

`dist/index.html` je pouze společná kostra. Každá obrazovka má svůj modul v `dist/js/pages/`, sdílené komponenty jsou v `dist/js/components/`, stav a API v `dist/js/core/`. Styly jsou rozdělené v `dist/css/`. Vstupním modulem je `dist/js/app.js`. Rozdělení a postup úprav popisuje [mapa projektu](docs/STRUCTURE.md).

## Ověření

`npm run check` ověří syntaxi. `npm test` prověří příjem a validaci měření, duplicity, režimy, technické alarmy, potvrzení, obnovu, deníky a zachování SQLite dat po restartu. Testy používají vlastní dočasnou databázi.

Pro automatické formátování zdrojů lze jednorázově spustit `npm install` a potom `npm run format`. Prettier je pouze vývojová závislost; pro spuštění aplikace potřeba není.

Data v data/ se neodesílají do externí služby. Zálohujte složku při vypnutém serveru nebo použijte JSON export (bez automatického importu). Původní data z prohlížeče se automaticky nemigrují. Více informací a omezení jsou v dokumentaci API.

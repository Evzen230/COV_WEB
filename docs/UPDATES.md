# Aktualizace serveru a ESP32

Web obsahuje Nastavení → Aktualizace a zavíratelné upozornění na dostupnou verzi. Kontrola běží na serveru po startu a každých šest hodin. Selhání internetu neomezuje monitoring. Instalaci spouští přihlášený uživatel; klíč stanice nemá přístup ke správě. Instalace způsobí krátkou přestávku serveru nebo stanice.

## Raspberry Pi

Použijte Raspberry Pi OS / Debian s systemd, doporučená je 64bitová instalace. Nejdřív nainstalujte Node.js **24.13 nebo novější z řady 24** tak, aby existoval `/usr/bin/node`. Runtime se tímto mechanismem neaktualizuje. Instalátor se spouští z kořene projektu a očekává nové umístění `/opt/cov-monitor/current`.

Na vývojovém počítači vytvořte podpisový klíč Ed25519, například pomocí OpenSSL:

```sh
openssl genpkey -algorithm ED25519 -out update-private.pem
openssl pkey -in update-private.pem -pubout -out update-public.pem
```

Soukromý klíč uchovávejte mimo projekt a mimo zákaznické zařízení. Na malinu patří jen veřejný klíč. Přeneste projekt a veřejný klíč a spusťte:

```sh
sudo bash deploy/install-pi.sh /cesta/update-public.pem https://github.com/OWNER/REPO/releases/latest/download/manifest.json
```

Nahraďte OWNER/REPO skutečným veřejně dostupným repozitářem. Instalátor vytvoří uživatele `cov-monitor`, vyžádá heslo a vygeneruje klíč stanice. Soukromé GitHub repozitáře vyžadující token zatím podporované nejsou. Veřejný repozitář v tomto projektu zatím není určen.

Instalátor vytvoří:

| Cesta                                      | Obsah                                    |
| ------------------------------------------ | ---------------------------------------- |
| `/opt/cov-monitor/releases/`               | Jednotlivá vydání, vlastník root         |
| `/opt/cov-monitor/current`                 | Odkaz na běžící vydání                   |
| `/opt/cov-monitor/backups/`                | Soukromé zálohy před instalací           |
| `/var/lib/cov-monitor/data/`               | SQLite a přístupové údaje                |
| `/var/lib/cov-monitor/updates/`            | Stažené balíčky a instalační fronta      |
| `/etc/cov-monitor/server.env`              | Zdroj vydání a cesty                     |
| `/etc/cov-monitor/update-public.pem`       | Důvěryhodný veřejný klíč                 |
| `/usr/local/lib/cov-monitor/pi-update.cjs` | Samostatný aktualizátor vlastněný rootem |

Kořen `/var/lib/cov-monitor` musí zůstat vlastněný rootem a nezapisovatelný účtem aplikace; zapisovatelné jsou jen podadresáře data a updates. Aktualizační skript, jednotky systemd a veřejný klíč se přes web nepřepisují. Jejich případná údržba je samostatný administrátorský zásah.

Web běží jako neprivilegovaná služba. Samostatná služba každých 15 sekund zkontroluje frontu, znovu ověří podpis a SHA-256, rozbalí jen povolené cesty a odmítne downgrade. Zastaví server, zazálohuje SQLite včetně případného WAL a přístupové údaje, přepne vydání a ověří `/api/health` i očekávanou verzi. Při neúspěchu obnoví předchozí vydání a zálohu. Rozpracovaná transakce se obnovuje při dalším spuštění aktualizátoru, také po restartu maliny.

Při obnově se zahodí měření přijatá neúspěšnou verzí od vytvoření zálohy. Zálohy a stará vydání se automaticky nemažou; sledujte volné místo. Napájení musí být stabilní; vhodná je UPS. Health check potvrzuje start serveru, nikoli úplnou funkčnost všech obrazovek a sond.

Při přechodu ze stávající instalace ji nejdřív zastavte a zazálohujte. Přeneste původní `cov.sqlite`, případný WAL a `auth.json` do nového datového adresáře při zastavených službách, nastavte vlastníka `cov-monitor:cov-monitor` a teprve potom server spusťte. Instalátor sám existující historii nemigruje. Standardní instalaci provádějte až po záloze.

```sh
systemctl status cov-monitor cov-monitor-update.timer
journalctl -u cov-monitor -u cov-monitor-update
```

## HTTPS pro stanici

V `deploy/Caddyfile.example` je ukázka reverzní proxy Caddy s lokální certifikační autoritou. Nainstalujte Caddy samostatně, nastavte LAN DNS jméno na IP maliny a vložte konfiguraci do jeho Caddyfile. `OTA_BASE_URL` pak bude například `https://cov.local`; do `OTA_CA_CERT` vložte veřejný kořenový PEM certifikát této autority. Soukromé klíče CA zůstávají na serveru. Při použití veřejné domény lze použít veřejně důvěryhodný certifikát a odpovídající kořenovou CA ve firmware. HTTPS konfigurace závisí na konkrétní síti a není instalátorem zapínána automaticky.

## Vytvoření vydání

Změňte verzi v `package.json`. Firmware má vlastní `FIRMWARE_VERSION` v `examples/esp32_http/ota.h`. Používají se stabilní verze `MAJOR.MINOR.PATCH`; předběžná vydání se nenabízejí. Manifest podporuje protokol 1 a hardware `esp32-ds18b20-v1`. Při změně protokolu nebo hardware nejdřív připravte kompatibilní migrační vydání.

Sestavte firmware a z kořene projektu vytvořte balíčky:

```sh
node scripts/release.cjs /bezpecne/update-private.pem /build/firmware.bin 0.3.0 https://github.com/OWNER/REPO/releases/download/v0.3.0 /vystup/v0.3.0
```

Popis změn lze zadat proměnnou `RELEASE_NOTES`. Vydání obsahuje `manifest.json`, `server.bundle`, `firmware.bin`; všechny tři soubory přiložte ke stejnému GitHub Release a označte jej jako nejnovější stabilní vydání. Manifest obsahuje base64 payload a podpis Ed25519 nad přesnými bajty payloadu. Balíček serveru je JSON s mapou relativních cest na base64 obsah. Data, hesla a klíče do balíčku nepatří. Limit balíčku je 32 MiB. Nový server musí zůstat kompatibilní s původním firmwarem, aby šly komponenty aktualizovat postupně.

## ESP32 OTA

Před předáním zákazníkovi nahrajte firmware podporující OTA kabelem. Původní firmware bez OTA nelze tímto způsobem dodatečně přehrát na dálku.

Požadavky pro příklad:

- Arduino ESP32 core řady 3.x, ArduinoJson řady 7, OneWire a DallasTemperature.
- Tabulka flash s oddílem otadata a dvěma dostatečně velkými aplikačními oddíly OTA. Schéma bez OTA nelze použít.
- Jednorázový provisioning přes USB pomocí `examples/esp32_provision/esp32_provision.ino`. V Serial Monitoru (115200 baud, newline) zadejte SSID, heslo, lokální HTTP URL telemetry a klíč stanice. Potom nahrajte monitorovací firmware bez mazání celé flash. Ten načte údaje z NVS.
- HTTPS reverse proxy před malinou, `OTA_BASE_URL` s odpovídajícím hostname a PEM certifikát vydávající CA v `OTA_CA_CERT` v `ota.h`. HTTPS je pro OTA povinné; ověřování certifikátů se nevypíná. Proxy musí předávat API cesty a hlavičku X-API-Key. NTP v setup zajistí čas pro TLS.

Server stáhne a ověří podepsaný firmware po výslovném požadavku uživatele. Stanice jednou za minutu přes ověřené HTTPS získá nabídku, zkontroluje typ hardware, verzi a SHA-256 obrazu, zapíše do neaktivního oddílu a restartuje. Nabídka zůstává uložená i při restartu serveru. Stanice odmítne stejnou a nižší verzi. Pokus o instalaci si ukládá do NVS; po návratu z chybného firmware jej automaticky nezkouší znovu. Nový pokus vyžaduje nové spuštění aktualizace ve webu. Verze se hlásí s telemetrií. Přístupové údaje se načítají z NVS, které OTA aktualizace aplikace nemaže. Veřejný firmware neobsahuje hesla zákazníků. OTA_BASE_URL a důvěryhodná CA se nastavují v obrazu firmware; TLS certifikát musí odpovídat této adrese.

Automatický návrat ESP32 vyžaduje bootloader sestavený s podporou rollbacku; samotné dva OTA oddíly nestačí. Příklad potvrzuje novou verzi po úspěšném odeslání platné teploty a při neúspěšném ověření restartuje stanici. Ověřte podporu rollbacku ve zvolené verzi core a bootloaderu před předáním; bez ní není automatická obnova garantována. Hook `verifyRollbackLater()` odkládá předčasné automatické potvrzení v Arduino core. Pokud do 180 sekund neprojde kontrola sondy a odeslání, stanice vyvolá rollback. Viz [OTA v ESP-IDF](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/ota.html) a [implementace ověřování v Arduino core](https://github.com/espressif/arduino-esp32/blob/master/cores/esp32/esp32-hal-misc.c).

## Ověření před předáním

Na cílové malině ověřte platné vydání, neplatný podpis, přerušené stahování, nefunkční nový server a restart při instalaci. Na skutečném ESP32 ověřte flash layout, HTTPS certifikát, zachování konfigurace, poškozený obraz, odpojení napájení a návrat po neúspěšném startu. Tyto hardwarové scénáře nelze potvrdit testy Node.js na Windows.

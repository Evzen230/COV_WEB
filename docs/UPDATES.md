# Aktualizace serveru a ESP32

Web obsahuje Nastavení → Aktualizace a zavíratelné upozornění na dostupnou verzi. Kontrola běží na serveru po startu a každých šest hodin. Selhání internetu neomezuje monitoring. Instalaci spouští přihlášený uživatel; klíč stanice nemá přístup ke správě. Instalace způsobí krátkou přestávku serveru nebo stanice.

## Ruční návrat na předchozí verzi

Server 0.3.1 přidává v Nastavení → Aktualizace výběr uložené zálohy serveru a staršího podepsaného firmware ESP32. Samotné zveřejnění nového vydání tuto funkci na běžících zařízeních nezapne; je potřeba nainstalovat nový server a firmware a jednorázově doplnit aktualizační službu maliny.

### Nejdřív doplnění služby na již běžící malině

Aktualizační služba je úmyslně uložená mimo aktualizovatelné vydání a výměna webové aplikace ji nepřepisuje. Přeneste na malinu aktualizované soubory `scripts/pi-update.cjs` a `scripts/upgrade-updater.sh` do stejné složky z důvěryhodné kopie tohoto projektu. Potom spusťte například:

```sh
sudo bash /cesta/k/projektu/scripts/upgrade-updater.sh
```

Příkaz aktualizuje službu, zveřejní její schopnost obnovy pro web a znovu zapne časovač. Monitoring nerestartuje. Pokud služba zrovna provádí instalaci nebo má rozpracovanou transakci, úpravu odmítne. Pro nové instalace tento krok nepotřebujete, instalátor už kopíruje aktuální službu.

**Tento krok proveďte před první další aktualizací serveru**, aby se při ní vytvořil návratový bod současné instalace. Staré zálohy pořízené původní službou bez katalogu se automaticky nenabízejí, protože u nich není spolehlivě doložené, ke kterému programu patří.

### Návrat serveru ve webu

1. V Nastavení → Aktualizace najděte Vrátit server na uloženou verzi.
2. Vyberte verzi a datum zálohy. Seznam obsahuje jen místní programy s odpovídající zálohou databáze a přístupů; není to libovolný seznam vydání na GitHubu.
3. Potvrďte, že rozumíte obnově databáze, nastavení a přístupových údajů k uvedenému datu. **Měření, párování a změny vytvořené po této záloze se při návratu ztratí.** Přihlášení může vyžadovat původní heslo; stanice spárované až později může být nutné znovu spárovat.
4. Spusťte obnovu. Služba nejdřív uloží současný stav do dalšího návratového bodu, potom obnoví vybraný program i všechna odpovídající data a zkontroluje spuštěnou verzi.
5. Po restartu obnovte stránku. Pokud zvolený program nenaběhne, služba automaticky obnoví stav před pokusem o návrat.

Katalog je uložený pod rootem v `/opt/cov-monitor/rollback-history.json`; web zná pouze ID, verzi a datum. Cesty k programu a záloze zadává výhradně služba podle tohoto katalogu, nikoli požadavek z prohlížeče. Zálohy zůstávají v `/opt/cov-monitor/backups/`. Automatická kontrola nových vydání je dál pouze informativní, po návratu sama nic nenainstaluje.

### Obnova, když se web neotevře

Přes terminál maliny vypište dostupné návratové body:

```sh
sudo /usr/bin/node /usr/local/lib/cov-monitor/pi-update.cjs --list-rollbacks
```

Ze seznamu vyberte ID požadované zálohy. Následující příkaz nahraďte skutečným ID; potvrzuje také ztrátu novějších dat:

```sh
sudo /usr/bin/node /usr/local/lib/cov-monitor/pi-update.cjs --queue-rollback ID_ZALOHY --accept-data-loss
sudo systemctl start cov-monitor-update.service
```

Příkaz jen zařadí požadavek; vlastní obnovu provádí stejná služba jako při použití webu. Nepouštějte ručně druhou instalaci souběžně se službou. Výsledek najdete také v `journalctl -u cov-monitor-update.service` a ve webu po jeho obnovení.

### Návrat ESP32

Stanice nejdřív potřebuje firmware **0.3.2**, který hlásí podporu ručního návratu v telemetrii. Z již funkčního 0.3.1 s HTTPS jej lze nainstalovat běžnou OTA aktualizací. Starší běžící firmware pokus o návrat na nižší číslo verze odmítá; web proto u něj tlačítko obnovy nenabízí.

V nastavení vyberte požadovanou ESP stanici. Nabídka obsahuje dříve zjištěná a ověřená vydání odpovídající jejímu hardwaru. Pokud verze chybí, zadejte například `0.3.1` do Načíst podepsané vydání firmware z GitHubu. Server stáhne `manifest.json` z tagu `v0.3.1` v nakonfigurovaném repozitáři a ověří podpis původním klíčem. Používá se konvence tagu `v` + verze firmware; běžná aktualizace přes `latest` zůstává beze změny.

Potom vyberte verzi, potvrďte restart a omezení staršího firmware a spusťte obnovu. Server znovu ověří podpis, typ stanice a SHA-256 obrazu. Povel pro nižší verzi je výslovně označený a ESP32 ho přijme jen přes své ověřené HTTPS spojení. Identifikátor pokusu stále brání nekonečnému opakování neúspěšného obrazu. NVS se nemaže; kompatibilitu nastavení a funkce konkrétní starší verze ověřte předem.

Po návratu například na 0.3.1 stanice přestane hlásit podporu dalších ručních návratů, ale dál umí běžnou aktualizaci na novější verzi. Obnova na dálku vyžaduje dostupnou Wi-Fi a fungující OTA; při úplně nefunkční stanici zůstává přístup přes USB a automatický návrat bootloaderu při selhání prvního startu.

## Když už malina a ESP32 fungují, ale kontrola aktualizace selhává

Pokud web ukazuje server i stanici 0.3.0 a „Stažení aktualizace selhalo“, nejdřív ověřte [vydání na GitHubu](https://github.com/Evzen230/COV_WEB/releases). Zdrojové soubory v záložce Code samy aktualizaci netvoří. Malina hledá zveřejněné stabilní vydání s přílohou `manifest.json`.

1. Zachovejte současnou instalaci a zálohované podpisové klíče. Instalátor znovu nespouštějte.
2. Připravte skutečný binární soubor firmware pro konkrétní stanici. Pro ESP32 s Nanem je cíl `esp32-nano-v1`; použijte aplikační OTA obraz, nikoli sloučený obraz s bootloaderem a tabulkou oddílů.
3. Před vydáním nastavte a ověřte HTTPS pro OTA. V `examples/esp32_http/ota.h` určují `OTA_BASE_URL` a `OTA_CA_CERT` server a důvěryhodnou certifikační autoritu. Prázdné hodnoty síťové aktualizace vypínají, přestože odesílání měření funguje. Změna těchto hodnot ve zdrojovém souboru vyžaduje sestavení a nahrání firmware do zařízení; již běžící stanice se úpravou souboru nezmění.
4. Pomocí skriptu `scripts/release.cjs` a původního soukromého klíče vytvořte podepsané vydání. Podrobný příkaz je níže v části Vytvoření vydání. Do příloh GitHub Release patří všechny tři soubory: `manifest.json`, `server.bundle` a `firmware.bin`. Soukromý klíč zůstává jen u vás.
5. Na webu maliny zvolte Zkontrolovat aktualizace. Vydání 0.3.0 slouží jako výchozí verze a již nainstalovanou 0.3.0 znovu nenainstaluje. Instalaci vyvolá až vydání s vyšší verzí odpovídající skutečnému obsahu.

Při diagnostice na malině lze bezpečně vypsat jen adresu zdroje: `grep '^UPDATE_MANIFEST_URL=' /etc/cov-monitor/server.env`. Nevypisujte soubor s přístupovými údaji. Stav instalační služby zjistíte příkazem `systemctl status cov-monitor-update.timer --no-pager`. Běžící monitoring a jeho automatické spouštění samy o sobě nepotvrzují přítomnost této instalační služby.

## Raspberry Pi

Použijte Raspberry Pi OS / Debian s systemd, doporučená je 64bitová instalace. Nejdřív nainstalujte Node.js **24.13 nebo novější z řady 24** tak, aby existoval `/usr/bin/node`. Runtime se tímto mechanismem neaktualizuje. Instalátor se spouští z kořene projektu a očekává nové umístění `/opt/cov-monitor/current`.

Na počítači s Windows otevřete PowerShell ve složce projektu a vytvořte podpisové klíče příkazem (stačí Node.js, OpenSSL není potřeba):

```powershell
npm run updates:keys
```

Soubory vzniknou ve složce `data/update-signing/`, kterou Git ignoruje. Opakované spuštění zachová existující klíče. Celou tuto složku si zálohujte na bezpečné místo mimo projekt. Soukromý klíč `update-private.pem` zůstává u vás; nenahrávejte jej na GitHub ani zákaznické zařízení. Veřejný `update-public.pem` se později přenese na malinu. Příkaz můžete provést už teď na Windows, Raspberry Pi k tomu není potřeba.

Až budete mít malinu připravenou, přeneste na ni projekt a veřejný klíč a spusťte na ní:

```sh
sudo bash deploy/install-pi.sh /cesta/update-public.pem https://github.com/Evzen230/COV_WEB/releases/latest/download/manifest.json
```

Zdrojem aktualizací je veřejný repozitář [Evzen230/COV_WEB](https://github.com/Evzen230/COV_WEB). Instalátor vytvoří uživatele `cov-monitor`, vyžádá heslo a vygeneruje klíč stanice. Soukromé GitHub repozitáře vyžadující token zatím podporované nejsou.

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
node scripts/release.cjs /bezpecne/update-private.pem /build/firmware.bin 0.3.0 https://github.com/Evzen230/COV_WEB/releases/download/v0.3.0 /vystup/v0.3.0
```

Popis změn lze zadat proměnnou `RELEASE_NOTES`. Vydání obsahuje `manifest.json`, `server.bundle`, `firmware.bin`; všechny tři soubory přiložte ke stejnému GitHub Release a označte jej jako nejnovější stabilní vydání. Manifest obsahuje base64 payload a podpis Ed25519 nad přesnými bajty payloadu. Balíček serveru je JSON s mapou relativních cest na base64 obsah. Data, hesla a klíče do balíčku nepatří. Limit balíčku je 32 MiB. Nový server musí zůstat kompatibilní s původním firmwarem, aby šly komponenty aktualizovat postupně.

## ESP32 OTA

Před předáním zákazníkovi nahrajte firmware podporující OTA kabelem. Původní firmware bez OTA nelze tímto způsobem dodatečně přehrát na dálku.

Požadavky pro příklad:

- Arduino ESP32 core řady 3.x, ArduinoJson řady 7, OneWire a DallasTemperature.
- Tabulka flash s oddílem otadata a dvěma dostatečně velkými aplikačními oddíly OTA. Schéma bez OTA nelze použít.
- Doporučené je [nastavení přes mobil](PAIRING.md), které nově obsahuje monitorovací firmware. Alternativou je jednorázový provisioning přes USB pomocí `examples/esp32_provision/esp32_provision.ino`. V Serial Monitoru (115200 baud, newline) zadejte SSID, heslo, lokální HTTP URL telemetry a klíč stanice. Potom nahrajte monitorovací firmware bez mazání celé flash. Ten načte údaje z NVS.
- HTTPS reverse proxy před malinou, `OTA_BASE_URL` s odpovídajícím hostname a PEM certifikát vydávající CA v `OTA_CA_CERT` v `ota.h`. HTTPS je pro OTA povinné; ověřování certifikátů se nevypíná. Proxy musí předávat API cesty a hlavičku X-API-Key. NTP v setup zajistí čas pro TLS.

Server stáhne a ověří podepsaný firmware po výslovném požadavku uživatele. Stanice jednou za minutu přes ověřené HTTPS získá nabídku, zkontroluje typ hardware, verzi a SHA-256 obrazu, zapíše do neaktivního oddílu a restartuje. Nabídka zůstává uložená i při restartu serveru. Stanice odmítne stejnou a nižší verzi. Pokus o instalaci si ukládá do NVS; po návratu z chybného firmware jej automaticky nezkouší znovu. Nový pokus vyžaduje nové spuštění aktualizace ve webu. Verze se hlásí s telemetrií. Přístupové údaje se načítají z NVS, které OTA aktualizace aplikace nemaže. Veřejný firmware neobsahuje hesla zákazníků. OTA_BASE_URL a důvěryhodná CA se nastavují v obrazu firmware; TLS certifikát musí odpovídat této adrese.

Automatický návrat ESP32 vyžaduje bootloader sestavený s podporou rollbacku; samotné dva OTA oddíly nestačí. Příklad potvrzuje novou verzi po úspěšném odeslání platné teploty a při neúspěšném ověření restartuje stanici. Ověřte podporu rollbacku ve zvolené verzi core a bootloaderu před předáním; bez ní není automatická obnova garantována. Hook `verifyRollbackLater()` odkládá předčasné automatické potvrzení v Arduino core. Pokud do 180 sekund neprojde kontrola sondy a odeslání, stanice vyvolá rollback. Viz [OTA v ESP-IDF](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/ota.html) a [implementace ověřování v Arduino core](https://github.com/espressif/arduino-esp32/blob/master/cores/esp32/esp32-hal-misc.c).

## Ověření před předáním

Na cílové malině ověřte platné vydání, neplatný podpis, přerušené stahování, nefunkční nový server a restart při instalaci. Na skutečném ESP32 ověřte flash layout, HTTPS certifikát, zachování konfigurace, poškozený obraz, odpojení napájení a návrat po neúspěšném startu. Tyto hardwarové scénáře nelze potvrdit testy Node.js na Windows.

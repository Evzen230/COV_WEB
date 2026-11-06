# LED, připojení maliny a domácí displej

Nové funkce nemění historii měření ani párování měřicích stanic. Displej je samostatná čtečka serverového přehledu; technologii neovládá a alarmy nepotvrzuje.

## Servisní LED měřicí stanice

Zapojení pro **ESP32 DevKit V1 s ESP32-WROOM-32**. Každý výstup připojte přes vlastní **470Ω rezistor** na anodu příslušné LED, katodu na GND. GPIO pracují s 3,3 V. Nepřipojujte LED přímo bez rezistoru ani na 5 V.

| Barva   | GPIO | Zapojení                             |
| ------- | ---- | ------------------------------------ |
| Modrá   | 25   | GPIO25 → 470 Ω → anoda; katoda → GND |
| Červená | 26   | GPIO26 → 470 Ω → anoda; katoda → GND |
| Žlutá   | 32   | GPIO32 → 470 Ω → anoda; katoda → GND |
| Zelená  | 33   | GPIO33 → 470 Ω → anoda; katoda → GND |

GPIO16 zůstává příjmem z Nana a GPIO27 servisním tlačítkem. U jiné desky ověřte dostupnost a skutečné značení vývodů. LED na stanici a displej jsou na **dvou různých ESP32**; piny se mezi nimi nesdílejí.

| Priorita | Signalizace                | Význam                                                                    |
| -------- | -------------------------- | ------------------------------------------------------------------------- |
| 1        | Modrá bliká každých 500 ms | Otevřený nastavovací portál, včetně párování                              |
| 2        | Červená                    | Z Nana nepřišel platný rámec do 10 s, nebo interní chyba obsluhy          |
| 3        | Modrá a červená            | Výpadek Wi-Fi nebo neúspěšný pokus o odeslání na server                   |
| 4        | Žlutá                      | Očekávané čidlo hlásí neplatnou hodnotu                                   |
| 5        | Modrá                      | Úvodní připojování a čekání na první úspěšné odeslání                     |
| 6        | Zelená                     | Aktuální komunikace s Nanem, platná očekávaná čidla a fungující odesílání |

Při souběhu se ukazuje nejvyšší stav. Po jeho odstranění se ukáže další aktivní problém. Při startu má Nano 10 s na první rámec; Wi-Fi 30 s na úvodní připojení. Chyba odesílání zůstává do dalšího úspěšného přijetí serverem, také po HTTP 401. Běžné odesílání zelenou nepřerušuje. Při úplném vypnutí nebo zamrznutí ESP nelze LED použít jako nezávislý důkaz funkčnosti.

Výchozí firmware očekává **DS18B20 i JSN-SR04T**. Pokud je některé čidlo záměrně nezapojené, nastavte před kompilací `COV_EXPECT_TEMPERATURE=0`, případně `COV_EXPECT_DISTANCE=0` (výchozí hodnota je 1). Nastavení je v `status_leds.h` nebo přes definice překladače. Webové přepínače hlídání alarmů jsou nezávislé; nemění lokální firmware. Přenos chybějícího měření jako `null` se zachovává.

Nahrávejte celý sketch `examples/esp32_http`, nyní také s `status_leds.h`. UART a LED obsluhuje samostatná FreeRTOS úloha každých 10 ms; síťová volání hlavní smyčky ji neblokují. Telemetrie čte konzistentní kopii rámce pod krátkým zámkem.

## Wi-Fi Raspberry Pi 4

Podporován Raspberry Pi OS Lite **Bookworm nebo Trixie**, NetworkManager a rozhraní `wlan0`. Instalátor ověří model i systém; nepřevádí starší dhcpcd instalaci a sám nemění zemi Wi-Fi. Zemi nejprve nastavte v Raspberry Pi OS podle místa provozu. Podporovány osobní WPA/WPA2 sítě s heslem (8–63 tisknutelných ASCII znaků, případně 64 hexadecimálních znaků); podnikové přihlášení a otevřené sítě nejsou součástí této verze.

Nová instalace používá `deploy/install-pi.sh`. Na existující instalaci po aktualizaci serveru spusťte z kořene aktuálního vydání:

```sh
cd /opt/cov-monitor/current
sudo bash scripts/install-network.sh
```

Instalátor vytvoří a vypíše **jedinečné SSID a heslo pro štítek maliny**. Při opakovaném spuštění je zachová. Uchovává je v root-only `/etc/cov-monitor/network.json`. Na sdílený terminál ani do veřejného návodu štítek nekopírujte. Aktualizace pomocné služby na již připravené malině používá stejný příkaz; běžný webový updater sám tuto systémovou službu neinstaluje ani nepřepisuje.

V aplikaci otevřete **Nastavení → Připojení → Wi-Fi Raspberry Pi**. Vyhledejte síť nebo její název zadejte ručně, vyplňte heslo a případně označte skrytou síť. Po odeslání se prohlížeč může odpojit. Na mobilu zvolte cílovou domácí síť a znovu otevřete web maliny, nejlépe pomocí jejího `.local` jména.

Pokud nová síť nefunguje, služba zkusí předchozí profil; pokud nefunguje ani ten, zapne nastavovací Wi-Fi. Na obnovu počítejte do 90 sekund za běžného provozu NetworkManageru. Při pádu služby se rozpracovaná změna obnoví z root-only transakčního záznamu při restartu služby.

### Když se změní router nebo heslo a web už nefunguje

1. Nechte malinu zapnutou. Po **5 minutách bez domácí Wi-Fi a bez aktivního Ethernetu** nabídne síť ze štítku. Samotný výpadek internetu při připojené místní síti nastavovací režim nespouští.
2. Připojte mobil k této síti a zůstaňte na ní i přes upozornění „bez internetu“.
3. Otevřete **http://192.168.4.1:8080**. Automatické otevření portálu není vyžadováno ani zaručeno.
4. Zadejte novou domácí síť. Mobil se během zkoušení odpojí; vraťte jej na domácí síť. Při neúspěchu se vraťte na nastavovací síť a zadání opravte.

Malina používá stejné Wi-Fi rádio pro domácí i nastavovací síť; během obnovy nebude přes domácí Wi-Fi dostupná. Nastavovací síť zůstává aktivní do úspěšného připojení. Uložená domácí připojení se nemažou. Stanice a domácí displej mají vlastní Wi-Fi údaje, které při změně hesla routeru změňte zvlášť jejich servisním tlačítkem. Číselná IP serveru se po změně sítě nemusí zachovat.

Síťové operace provádí root služba `cov-network.service` přes pevně omezené operace `status`, `scan`, `connect`. Web zůstává neprivilegovaný. Soukromý unixový socket `/run/cov-network/control.sock` je dostupný jen rootovi a skupině `cov-monitor`; neexistuje HTTP rozhraní pro libovolné shellové příkazy. Heslo se předává NetworkManageru root-only souborem, nikoli argumentem procesu, a nevrací se klientům. Mobilní portál na adrese nastavovacího rozhraní umožňuje jen správu sítě a používá náhodný token proti cizím formulářům.

Diagnostika: `systemctl status cov-network` a `journalctl -u cov-network`. Logy obsahují pouze obecné chyby bez hesel. Na Windows se v aplikaci zobrazí informace o nedostupnosti správy Wi-Fi.

## Domácí displej ILI9341

Součástky: ESP32 DevKit V1, LaskaKit 3,2″ SPI TFT ILI9341 240×320, stabilní napájení odpovídající desce. Displej pracuje na šířku 320×240. Signály jsou **3,3 V**, GND musí být společná. [Zapojení prodejce](https://www.laskakit.cz/3-2--palcovy-barevny-dotykovy-tft-lcd-displej-240x320-ili9341-spi/) uvádí VCC modulu na 5 V a LED na 3,3 V; [dokumentace odkazovaného modulu](https://www.lcdwiki.com/3.2inch_SPI_Module_ILI9341_SKU:MSP3218) rozlišuje napájení modulu 3,3–5 V od 3,3V logiky. Následující zapojení používá 5 V pouze na VCC hotového modulu s regulátorem. Ověřte shodu své desky; samotný řadič ani GPIO nesmějí dostat 5 V.

| TFT pin           | ESP32        | Poznámka                                                                           |
| ----------------- | ------------ | ---------------------------------------------------------------------------------- |
| GND               | GND          | Společná zem                                                                       |
| VCC               | Zdroj 5 V    | Napájení hotového modulu s regulátorem podle zapojení prodejce; společná zem s ESP |
| LED               | 3V3          | Trvalý podsvit podle dokumentace modulu, nikoli napájení z běžného GPIO            |
| SCK               | GPIO18       | SPI clock                                                                          |
| SDI/MOSI          | GPIO23       | SPI data z ESP                                                                     |
| SDO/MISO          | GPIO19       | SPI data do ESP                                                                    |
| CS                | GPIO5        | Výběr TFT; při startu nesmí být vynucena LOW externím obvodem                      |
| D/C               | GPIO21       | Data/command                                                                       |
| RESET             | GPIO22       | Reset TFT                                                                          |
| T_CLK             | GPIO18       | Rezerva sdílené SPI pro pozdější dotyk                                             |
| T_DIN             | GPIO23       | Rezerva pro dotyk                                                                  |
| T_DO              | GPIO19       | Rezerva pro dotyk                                                                  |
| T_CS              | GPIO32       | Firmware drží HIGH; dotyk nyní neobsluhuje                                         |
| T_IRQ             | GPIO33       | Rezerva pro dotyk                                                                  |
| Servisní tlačítko | GPIO27 ↔ GND | Podržet 5 sekund                                                                   |

Případnou SD kartu nezapojujte; při zapojeném společném SPI musí být její CS neaktivní. Dotykové funkce, kalibrace a přístupová oprávnění k ovládání nejsou součástí v1.

### Nahrání a první nastavení

1. Použijte ESP32 Arduino core 3.3.11, ArduinoJson 7, **Adafruit GFX Library**, **Adafruit ILI9341** a **Adafruit BusIO**. Nahrajte celý sketch `examples/esp32_display` včetně `display_setup.h`, `display_pairing.h` a `display_ui.h`, deska ESP32 Dev Module.
2. Displej při prvním spuštění zobrazí SSID a unikátní osmiznakové heslo vlastní nastavovací Wi-Fi. Obsahuje malá písmena a číslice bez znaků 0/O, 1/I/l. Údaje si poznamenejte pro servis; běžný restart je nemění. Při přechodu z původního firmwaru se dlouhé hexadecimální heslo jednorázově nahradí novým; přečtěte je na displeji a v mobilu případně odstraňte starou uloženou síť. Domácí připojení i klíč zůstávají zachované.
3. V hlavním webu otevřete **Nastavení → Připojení → Domácí displeje** a zvolte **Spárovat nový displej**. Zadejte jeho název. Zobrazí se osmiznakový kód ve tvaru `ABCD-EFGH`, platný 10 minut.
4. Připojte mobil k Wi-Fi displeje a otevřete **http://192.168.4.1**. Portál automaticky vyhledá Wi-Fi. Vyberte domácí síť 2,4 GHz (nebo ručně zadejte skrytou síť), napište její heslo a stiskněte **Připojit k Wi-Fi**. Následně se automaticky vyhledají servery se službou `_cov-monitor._tcp`, stejně jako u měřicí stanice. Jediný nalezený server se předvybere; při více serverech vyberte správný. Zůstává i ruční adresa, například `http://raspberrypi.local:4173`. Vyhledání vyžaduje Avahi na malině a dostupný mDNS multicast; Windows server obvykle zadáte ručně.
5. Vložte krátký párovací kód a zvolte **Ověřit a uložit**. Velikost písmen, mezery ani pomlčka nevadí. Displej si dlouhý přístupový klíč převezme automaticky; nic dlouhého nepřepisujete. Displej ověří přístup k přehledu a po uložení se restartuje. Změna kanálu při připojování může mobil odpojit; případně se znovu připojte k nastavovací Wi-Fi. Po opětovném otevření portálu se úspěšné připojení rozpozná a hledání serveru pokračuje. Na již nastaveném displeji lze ponechat pole kódu prázdné a zachovat uložené spárování; tlačítko **Uložit pouze změnu Wi-Fi** zachová také adresu serveru.

Údaje se ukládají jako jeden NVS záznam. Nastavení lze znovu otevřít podržením tlačítka na 5 s. U již nastaveného zařízení se portál po 15 minutách zavře a obnoví uloženou konfiguraci; u nového zařízení zůstane otevřený. Přístup lze okamžitě zrušit ve webu; nové párování nabídne tlačítko **Nový párovací kód**. Vystavení nového kódu ponechá současný přístup funkční, dokud není nové párování dokončené. Nový kód ruší předchozí kód, restart serveru ruší nevyužité kódy. Již připojené displeje včetně původních ručně vložených klíčů zůstávají funkční. Měření se tím nemažou.

Displej načítá data každých **15 s**. Zobrazuje hladinu, teplotu, stav spojení, stáří každé veličiny a alarmy ze serveru; více alarmů střídá po 5 s. Stáří počítá z `server_time` a `measured_at`, potom přičítá dobu od přijetí pomocí monotónního časovače ESP. Nevyžaduje vlastní synchronizaci hodin. Při neúspěšném požadavku nebo odpojení Wi-Fi ponechá poslední hodnoty s označením ztráty spojení. Stará měření označí podle serverového limitu dostupnosti, chybějící hodnoty ukáže jako `--`. Pro vestavěné písmo převádí českou diakritiku na základní znaky.

Síťový provoz displeje používá HTTP stejně jako současná telemetrie, tedy pouze v důvěryhodné domácí síti. Klíč displeje zpřístupňuje pouze monitorovací přehled; nedovoluje historii, zálohy, nastavení, telemetrii ani potvrzování alarmů.

### Vzhled a překreslování TFT

Současné ESP32 DevKit V1 a ILI9341 stačí pro velké čitelné hodnoty, dvě karty, indikátor naplnění, stavový pruh, stáří měření a samostatnou oblast alarmů. Dotyk zůstává rezervovaný pro další verzi.

UI se skládá do RGB565 bufferu 320×100 bodů (64 kB) a hotové oblasti se přenesou na TFT jen při změně jejich obsahu. Obrazovka se každou sekundu nemaže; neměnné karty se neposílají znovu, mění se hlavně malé údaje o stáří. Tím je odstraněné původní střídání černého pozadí a textu. Skutečnou plynulost ověřte po nahrání na TFT. Pokud by problikával přímo podsvit, nebo se ESP restartovalo, zkontrolujte napájení a vedení; to je jiný problém než překreslování obrazu.

### Rozhraní pro displeje

- `GET /api/displays`: seznam bez klíčů a hashů, vyžaduje přihlášení do webu.
- `POST /api/displays/pairing` s `{ "name": "Kuchyň" }`: vytvoří čekající displej a vrátí `{device_id,name,code,expires}`; nejvýše 20 displejů. Vyžaduje přihlášení.
- `POST /api/displays/:id/pairing`: vystaví nový kód pro existující displej, vyžaduje přihlášení.
- `POST /api/v1/display/pair`: výměna důkazu znalosti kódu za zašifrovaný klíč displeje, bez webového přihlášení. Stejný SHA-256/HMAC/AES-GCM protokol jako u stanice, ale s oddělenými kódy a oprávněními; 10 pokusů/minutu/IP a 60/minutu celkem. Kód má platnost 10 minut. Opakování stejného nonce vrací stejnou odpověď, jiné nonce již použitý kód odmítne. ESP nonce drží pro opakování po ztracené odpovědi či neúspěšném uložení.
- Původní `POST /api/displays` s `{name}` a odpovědí `{id,name,key}` zůstává pro kompatibilitu starších klientů; nový web jej nepoužívá.
- `DELETE /api/displays/:id`: okamžité zrušení klíče, vyžaduje přihlášení.
- `GET /api/v1/display`: vyžaduje `X-API-Key` nebo Bearer s klíčem displeje. Vrací `version:1`, `name`, `server_time` v milisekundách UTC, `online`, `stale_after_ms`, objekty `temperature` a `level` (`value`, `station_id`, `status`, `measured_at`, `last_valid_at`) a aktivní `alarms`. Hodnota může být `null`; data i časy odpovídají zdrojům zvoleným pro hlavní přehled. Klíč stanice zde neplatí.
- Správa Wi-Fi webem: přihlášené `GET /api/network/status`, `GET /api/network/scan` a `POST /api/network/connect` s `{ssid,password,hidden}`. Změna vrací HTTP 202; výsledek lze číst ve stavu sítě. Heslo se ve stavu nevrací.

## Přejímka na skutečném zařízení

Automatické testy API a simulované síťové služby **nenahrazují hardware test**. Před běžným provozem ověřte:

- LED: start, podržení tlačítka, odpojení Nana, obě čidla jednotlivě, neplatné rámce, Wi-Fi/server a souběh poruch; po opravě návrat zelené.
- Malina: správné/chybné heslo, skrytá síť, restart během změny, nedostupný router, připojený Ethernet, výpadek samotného internetu a otevření portálu z mobilu. Ověřit původní historii a párování.
- Web: všechny stránky na mobilu i PC, oba motivy, prázdná data, výpadek serveru, formuláře a grafy.
- Displej: první konfigurace, přerušené ukládání, více alarmů, chybějící a stará data z různých stanic, výpadek a restart serveru/ESP, zrušený klíč a pozdější změna Wi-Fi.

Stav fyzického ověření: **dosud neověřeno na zapojené stanici, Raspberry Pi ani TFT**. Samotná kompilace nepotvrzuje napájení, správnost kabeláže ani chování konkrétního routeru.

Softwarové ověření 6. 11. 2026: 73 automatických testů včetně scénářů nastavovacího portálu displeje, kontrola syntaxe a shellových instalátorů, kontrola všech webových stránek v obou motivech na mobilní i desktopové šířce. Oba ESP32 sketche se zkompilovaly pro ESP32 Dev Module s core 3.3.11 a ArduinoJson 7.4.3; displej s Adafruit GFX 1.13.0, ILI9341 1.7.0 a BusIO 1.17.4. Spotřeba flash stanice přibližně 89 %, displeje 83 % výchozího aplikačního oddílu.

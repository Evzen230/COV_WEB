# Firmware Nano R3 + ESP32

Nano R3 (ATmega328P, 5 V) měří DS18B20 a JSN-SR04T V3.0. ESP32-WROOM-32 přijímá UART a každých 60 sekund posílá data přes Wi-Fi do stávajícího API. Párování přes mobil a servisní tlačítko GPIO27 zůstávají zachované. Jde o zdrojové sketche; na skutečných deskách zatím nebyly ověřeny.

Kompilace byla ověřena pro Nano s Arduino AVR Boards 1.8.8 a pro ESP32 Dev Module s ESP32 Arduino 3.3.11 a ArduinoJson 7.4.3. Kompilace neověřuje fyzické zapojení ani spolehlivost kabelu.

## Součástky a napájení

- Stabilizovaný zdroj 5 V s rezervou pro Wi-Fi ESP32 (doporučený zdroj alespoň 1 A).
- Rezistor 4,7 kΩ pro DS18B20, rezistory 2,2 kΩ a 3,3 kΩ pro datový dělič.
- Pět žil do 3 metrů, mimo silové kabely. Pro delší nebo rušené vedení použijte RS-485 a odpovídající firmware.

ESP-WROOM-32 je označení modulu, nikoli celé vývojové desky. Samotný modul vyžaduje regulovaných 3,3 V; 5 V ho poškodí. Připojení 5 V na vývojové desce musí odpovídat jejímu schématu (vstup 5V/VIN s regulátorem). Před zapojením je třeba ověřit konkrétní desku. Nano napájejte stabilizovanými 5 V na pin **5V**, nikoli VIN. Při nahrávání přes USB odpojte externí 5 V, aby se zdroje nespojovaly přes desky neznámého klonu. Země musí být společná. U vzdálené desky zkontrolujte napětí při provozu; průřez žil musí omezit úbytek napětí.

## Pětižilový konektor

Čísla jsou navržená čísla kontaktů, nikoli barvy kabelu. Označte obě strany shodně.

| Kontakt | Funkce  | Zapojení                                                                 |
| ------- | ------- | ------------------------------------------------------------------------ |
| 1       | +5 V    | Napájení Nano a čidel; napájení ESP desky podle jejího provedení         |
| 2       | GND     | Společná zem Nano, ESP32, zdroje a čidel                                 |
| 3       | DATA    | Nano D9 → kabel → 2,2 kΩ → ESP32 GPIO16; z GPIO16 rezistor 3,3 kΩ na GND |
| 4       | Rezerva | Nezapojeno                                                               |
| 5       | Rezerva | Nezapojeno                                                               |

Dělič umístěte u ESP32. Z 5V datového signálu vytvoří přibližně 3 V. **Nano D9 nespojujte přímo s GPIO16.** Přenos je jednosměrný; ESP32 neposílá povely Nanu. D8 na Nanu ponechte volný. D0/D1 zůstávají pro USB nahrávání.

## Čidla u Nana

| Čidlo          | Pin čidla | Nano                             |
| -------------- | --------- | -------------------------------- |
| JSN-SR04T V3.0 | VCC / GND | 5V / GND                         |
| JSN-SR04T V3.0 | TRIG / RX | D4                               |
| JSN-SR04T V3.0 | ECHO / TX | D5                               |
| DS18B20        | VDD / GND | 5V / GND                         |
| DS18B20        | DQ        | D2; rezistor 4,7 kΩ mezi D2 a 5V |

DS18B20 používá třívodičové napájení, ne parazitní režim. Vývody určete podle skutečného čidla; barvy vodičů nejsou zaručené. Firmware očekává jedno teplotní čidlo.

JSN musí být v režimu TRIG/ECHO (výchozí pulzní režim), nikoli autonomním UART režimu. Pokud byl upraven pomocí propojek, vraťte pulzní režim podle dokumentace své desky. Vzdálenost musí být alespoň 21 cm, při montáži počítejte raději s rezervou 25 cm i při plné nádrži. Pěna, kondenzace a odrazy od stěn mohou měření zhoršit. Firmware používá medián pěti pokusů, alespoň tři musejí být platné.

## Nahrání

1. V Arduino IDE nainstalujte balíček **Arduino AVR Boards** a knihovny **OneWire** a **DallasTemperature**. SoftwareSerial je součástí AVR balíčku.
2. Otevřete `examples/nano_sensors/nano_sensors.ino`, vyberte **Arduino Nano / ATmega328P** a port. Pokud klon nereaguje, vyzkoušejte **ATmega328P (Old Bootloader)**. Nahrajte sketch.
3. Nainstalujte balíček **esp32 by Espressif Systems** a **ArduinoJson 7**. Otevřete `examples/esp32_http/esp32_http.ino` s ostatními hlavičkami v téže složce. Pro běžnou vývojovou desku WROOM vyberte odpovídající desku, typicky **ESP32 Dev Module**; kapacitu flash ověřte podle desky. Pro OTA zvolte oddíly s OTA sloty.
4. Nahrajte ESP firmware bez mazání NVS, pokud už má uložené párování. Při první instalaci použijte [párování přes mobil](PAIRING.md). Starší USB provisioning je také podporovaný.
5. Serial Monitor ESP32 používá 115200 baud a vypisuje HTTP výsledek. `201` znamená nový vzorek, `200` úspěšné opakování.

OTA cíl této varianty je `esp32-nano-v1`. Při tvorbě vydání nastavte `FIRMWARE_TARGET=esp32-nano-v1`; binární soubor musí být sestavený z této varianty. Starý cíl `esp32-ds18b20-v1` zůstává serverem podporovaný. OTA vyžaduje existující HTTPS konfiguraci v `ota.h`.

### HTTPS na covmalina

Firmware 0.3.2 má v `ota.h` nastavenou adresu `https://covmalina.local` a veřejný kořenový certifikát Caddy z této maliny. Ověřený SHA-256 otisk CA je `5D:D3:73:FA:D4:4B:77:40:AC:5A:F2:F5:82:66:A4:A2:02:18:D8:86:4F:9B:8D:00:7F:07:78:EA:BA:F6:EC:AF`. Pro jinou malinu je nutné odpovídající nastavení adresy a CA.

Tuto první konfiguraci OTA nahrajte do již spárovaného ESP32 přes USB, v Arduino IDE otevřete `examples/esp32_http/esp32_http.ino`. Zachovejte stávající správnou desku, port a schéma oddílů podporující OTA; volbu mazání celé flash ponechte vypnutou. Tím zůstane zachované párování v NVS. Po nahrání otevřete Serial Monitor na 115200 baud. Přibližně po minutě očekávejte `[OTA] Kontrola pres HTTPS: HTTP 200` a při chybějící nabídce `[OTA] HTTPS overeno; zadna nabidka firmware`. Tyto zprávy potvrzují skutečný požadavek stanice přes ověřené TLS. Samotná změna zobrazené verze na webu potvrzuje jen příjem telemetrie. Pokud se jméno maliny nepřeloží, zkontrolujte mDNS v síti; pokud selže certifikát, ověřte také synchronizaci času ESP32 přes NTP.

## Kalibrace na webu

V **Nastavení → Alarmy a senzory → Kalibrace ultrazvukové hladiny** zadejte pro příslušné ESP vzdálenost od čela čidla k hladině při prázdné nádrži (0 %) a plné nádrži (100 %). Prázdná musí být větší než plná. Dokud obě hodnoty chybí, server ukládá vzdálenost, ale hladina je `null`. Poslední přijatou vzdálenost najdete ve stejném formuláři; jde o poslední vzorek, ne živé měření.

Výpočet: `100 × (prázdná − vzdálenost) / (prázdná − plná)`, omezený na 0–100 %. Jde o procento výšky hladiny; procento objemu odpovídá jen nádrži s konstantním průřezem. Změna kalibrace platí pro další nové zprávy; historii nepřepočítává. Vymazání obou polí kalibraci vypne. Pro alarm výpadku zapněte hlídání senzoru hladiny a případně vyberte jeho zdroj v pokročilém nastavení.

## Přenos a chybové stavy

Po výpadku napájení ESP32 načte uložené párování a Wi-Fi z NVS. Pokud router ještě není dostupný, každých 30 sekund obnoví pokus o připojení bez mazání nastavení. Po návratu Wi-Fi obnoví mDNS pro adresy `.local` a připraví aktuální vzorek k odeslání. V Serial Monitoru jsou tyto přechody označené `[WiFi]`. Změna vyžaduje nahrání aktualizovaného ESP32 firmwaru bez mazání NVS.

Při ověření obnovy vypněte stanici i router, zapněte stanici jako první a router až po několika minutách. Data se mají obnovit automaticky. Totéž ověřte při výpadku samotného routeru a při pozdějším spuštění serveru. U serveru zadaného IP adresou zajistěte v routeru rezervaci DHCP, aby po výpadku nezískal jinou adresu. Tyto scénáře je potřeba ověřit na skutečném zařízení.

UART 9600 baud, 8N1, rámec `$COV1,sekvence,teplota_setiny_C,vzdalenost_mm*CRC\n`. CRC je CRC-16/CCITT-FALSE (polynom 0x1021, počáteční 0xFFFF) přes text od `COV1` do znaku před `*`, čtyři hexadecimální číslice. Chyba teploty má hodnotu -32768, chyba vzdálenosti -1. Nano posílá přibližně každé dvě sekundy. Hodnotu DS18B20 85 °C tato varianta konzervativně považuje za neplatnou kvůli startovnímu registru; není určená k měření vody o této teplotě.

ESP odmítá neplatné CRC, neúplné rámce a hodnoty mimo rozsah. Bez platného rámce po dobu 10 sekund odešle v příštím pravidelném vzorku `null` pro obě čidla. Jednotlivá vadná čidla mají vlastní `null`. ESP zůstává dostupné i při výpadku Nana; server rozliší výpadek čidel a Wi-Fi stanice. HTTP drží jeden neodeslaný vzorek v RAM, opakované pokusy mají stejné ID i obsah. Po 60 sekundách jej zahodí a načte aktuální stav, aby po dlouhém výpadku nevydával stará data za nová. Po synchronizaci NTP posílá i čas vzorku. Není to trvalý archiv a restart čekající vzorek ztratí.

Před montáží vyzkoušejte známou vzdálenost a teplotu, odpojení každého čidla, rozpojení datové žíly, restart Nana i ESP a výpadek Wi-Fi. Na dlouhém kabelu ověřte stabilitu při reálném napájení. Firmware není fyzicky ověřen na vašem hardwaru.

## Stanice je online, ale nemá hodnoty

`HTTP 201` na ESP32 potvrzuje uložení vzorku, i když obsahuje neplatná měření `null`. Pro diagnostiku obsahuje ESP firmware každých 5 sekund řádek `[Nano]` v USB Serial Monitoru na 115200 baud:

- `NO_DATA`: od startu nepřišel žádný bajt na GPIO16. Zkontrolujte napájení Nana, společnou GND a D9 → dělič → GPIO16.
- `INVALID_DATA`: bajty přicházejí, ale nepřišel platný rámec. Ověřte firmware Nana, rychlost 9600 baud, dělič a vedení. Počítadlo `rejected` zaznamenává odmítnuté rámce; `bytes` zahrnuje i šum bez začátku rámce.
- `STALE`: dříve přišel platný rámec, ale už je starší než 10 sekund.
- `OK`: přijímá se platná čerstvá zpráva. `temperature_C` a `distance_cm` ukazují hodnoty, případně `null` při chybě jednotlivého čidla.

Nano nyní také vypisuje kopii odesílaných rámců přes USB na 115200 baud. Například pole `-32768` znamená neplatnou teplotu a `-1` neplatnou vzdálenost. Přenos mezi deskami zůstává na D9 rychlostí 9600 baud. Diagnostické výpisy neobsahují síťové přístupové údaje.

Pokud ESP32 vypisuje platné hodnoty a web je nezobrazuje, ověřte zdroj veličiny v pokročilém nastavení a kalibraci hladiny. Bez kalibrace může být vzdálenost platná, ale hladina v procentech zůstane neznámá.

Před prvním odesláním po restartu čeká ESP32 na první platný rámec z Nana, nejvýše 10 sekund. Pokud žádný nepřijde, začne hlásit chybějící čidla. Řádek `[Telemetry]` vypisuje ID stanice a hodnoty připravené pro konkrétní nový vzorek; následné `HTTP 201` potvrzuje jeho uložení. Web se obnovuje přibližně každých 5 sekund. Pozdější chybné měření se záměrně zobrazuje jako neznámé, nikoli jako stará platná hodnota.

Podklady: [JSN-SR04T V3.0 – dokumentace modulu](https://www.laskakit.cz/user/related_files/jsn-sr04t-3_0-2.pdf), [ESP32 Arduino UART](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/serial.html).

## Ruční návrat firmware

Verze 0.3.2 hlásí `ota_rollback: true` a přijímá výslovně potvrzený návrat na starší kompatibilní obraz od autentizovaného serveru přes ověřené HTTPS. Bez označení obnovy nižší verzi dál odmítá. Server ověřuje podpis původního vydání a SHA-256. Postup a omezení popisuje [návod k aktualizacím](UPDATES.md#návrat-esp32). Nahrání této změny na GitHub samo běžící ESP neaktualizuje.

# Připojení ESP32 přes mobil

## První zapojení

1. Do ESP32 jednou nahrajte `examples/esp32_http/esp32_http.ino` včetně souborů `ota.h`, `provisioning.h` a `nano_link.h`. Použijte Arduino ESP32 core 3.3.11 nebo novější řady 3 a ArduinoJson 7. Knihovny OneWire a DallasTemperature potřebuje Nano, nikoli ESP32. Bez uložené konfigurace se automaticky spustí nastavovací Wi-Fi.
2. Při přípravě zařízení otevřete Serial Monitor na 115200 baud. Unikátní název `COV-Setup-…` odpovídá zařízení; v monitoru se vypíše náhodné desetiznakové heslo této Wi-Fi bez zaměnitelných znaků 0/O a 1/I. Heslo vytiskněte na štítek zařízení a předejte uživateli. Není společné pro všechny stanice a nezmění se při restartu. Samotný uživatel poté kabel nepotřebuje.
3. Server spusťte pro domácí síť (`HOST=0.0.0.0`), povolte příslušný port ve firewallu. Ve webu otevřete **Nastavení → Pokročilé → Připojené stanice a zdroje měření**. Přidejte název a jedinečné ID stanice. Po přidání se zobrazí párovací kód; pro existující stanici použijte **Spárovat přes mobil**.
4. Kód platí 10 minut, má 8 znaků bez zaměnitelných znaků 0/O a 1/I, zobrazuje se jako `ABCD-EFGH` a tlačítkem jej lze zkopírovat. Pomlčku ani velikost písmen nemusíte při zadávání dodržet. Poznamenejte si jej před přechodem na Wi-Fi stanice. Nový kód pro stejné ID ruší předchozí kód. Restart serveru ruší nevyužité kódy.
5. Mobilem se připojte k Wi-Fi ze štítku. I přes upozornění „bez internetu“ zůstaňte připojeni. Telefon by měl nabídnout přihlášení k síti a otevřít nastavovací stránku. Firmware oznamuje portál přes DHCP a obsluhuje kontrolní adresy Androidu, iOS a Windows. Pokud telefon portál neotevře (například kvůli svému nastavení, VPN nebo privátnímu DNS), otevřete `http://192.168.4.1` ručně.
6. Vyhledejte nebo zadejte domácí Wi-Fi 2,4 GHz, zadejte heslo a stiskněte **Připojit k Wi-Fi**. Změna kanálu AP při připojování může mobil krátce odpojit; připojte ho znovu ke stejné síti.
7. Vyhledejte server, vyberte jej nebo napište jeho HTTP adresu bez cesty, například `http://raspberrypi.local:4173`. Vložte párovací kód a zvolte **Spárovat a uložit**. ESP dostane vlastní klíč a ID odpovídající stanici ve webu, uloží konfiguraci a restartuje se.
8. Vraťte mobil na domácí Wi-Fi. Ověřte poslední přijaté měření a nastavte zdroje senzorů hlavního přehledu.

Úspěšné nové párování nahradí předchozí vlastní klíč tohoto ID. Měření zůstávají zachovaná. Pokud se přeruší napájení právě mezi přijetím klíče a uložením do ESP, vytvořte nový kód a párování zopakujte.

Po aktualizaci ze staršího firmwaru se původní dlouhé heslo nastavovací Wi-Fi jednorázově nahradí kratším. Nové heslo přečtěte ze Serial Monitoru a aktualizujte štítek; v telefonu případně odstraňte uloženou síť COV-Setup a připojte ji znovu. Uložená domácí Wi-Fi i spárování se zachovají. Osmiznakové kódy vyžadují aktualizovaný server i ESP firmware; nový firmware přijímá také původní 32znakové kódy staršího serveru.

Pro testování nemusíte mít Raspberry Pi: server může běžet na Windows počítači. Spusťte jej s `HOST=0.0.0.0`, ponechte počítač a ESP32 ve stejné dostupné domácí síti a v portálu zadejte například `http://192.168.1.100:4173` podle skutečné IP počítače. `localhost` ani `127.0.0.1` v ESP32 neodkazují na počítač. Windows službu automatického vyhledání neoznamuje; ruční zadání IP je běžný postup.

## Změna Wi-Fi a servisní tlačítko

Zapojte samostatné tlačítko mezi **GPIO27 a GND**, případně upravte `COV_SETUP_PIN` podle desky. Podržením 5 sekund otevřete nastavení; běžný restart údaje nemaže. Nastavovací AP se po 15 minutách vypne. Neotevírá se automaticky kvůli výpadku serveru nebo nesprávnému klíči.

Připojte mobil ke stejné Wi-Fi ze štítku, zadejte novou domácí Wi-Fi, ověřte připojení a stiskněte **Uložit pouze změnu Wi-Fi**. Klíč, ID a adresa serveru zůstanou zachované. Pro přechod na jiný server použijte nový párovací kód z cílového serveru.

Během otevřeného nastavení je odesílání měření pozastavené. Po skončení nastavení znovu pokračuje; tento příklad stále nemá trvalou offline frontu.

## Vyhledání serveru a změna IP

Na Raspberry Pi oznamuje server službu `_cov-monitor._tcp` přes Avahi. Nová instalace `deploy/install-pi.sh` službu zaregistruje na portu 4173. Pro existující instalaci spusťte z kořene projektu:

```sh
sudo apt-get update
sudo apt-get install -y avahi-daemon
sudo install -m 644 deploy/cov-monitor.service.xml /etc/avahi/services/cov-monitor.service
sudo systemctl enable --now avahi-daemon
sudo systemctl restart avahi-daemon
```

Při jiném portu upravte `<port>` v souboru služby. Každý server musí mít jedinečné síťové jméno. ESP ukládá hostname, nikoli zjištěnou IP; `.local` jméno před každým odesláním znovu přeloží přes mDNS. DHCP rezervace na routeru je užitečný doplněk.

Windows vývojový server sám mDNS službu neoznamuje. Jeho adresu lze zadat ručně; pro stabilní adresu použijte DNS jméno poskytované routerem nebo DHCP rezervaci. Ručně zadaná číselná IP se po změně IP sama neopraví. mDNS vyžaduje stejnou dostupnou místní síť a povolený multicast UDP 5353; izolovaná hostovská Wi-Fi nebo oddělené VLAN mohou hledání blokovat.

## Když párování selže

Při testování na Windows spusťte server přes `start.bat`; pokud proměnná HOST není nastavená, spouštěč použije `0.0.0.0`, aby byl server dostupný v domácí síti. Přímé `npm start` nadále standardně poslouchá jen na `127.0.0.1`; pro síť mu nastavte HOST. Pokud je HOST již nastavený, spouštěč vaši hodnotu zachová.

Z telefonu připojeného k domácí Wi-Fi otevřete stejnou adresu serveru, kterou zadáváte do ESP32, například `http://192.168.1.100:4173`. Pokud se web neotevře, ověřte běh serveru, IP, port a povolení aplikace ve firewallu pro privátní domácí síť. Pak vytvořte nový kód. Restart serveru staré kódy zneplatní.

Nový ESP firmware rozlišuje síťovou chybu (spojení neproběhlo), HTTP 401 (neplatný nebo prošlý kód), 409 (použitý kód), 429 (limit pokusů), 404 (chybějící API) a neověřitelnou odpověď při HTTP 200. Serial Monitor vypisuje pouze HTTP stav, nikoli tajný kód nebo přístupový klíč.

## Klíče a kompatibilita

- Každé nově spárované ESP má vlastní náhodný klíč omezený na své ID. Změna společného API klíče simulátoru jej neovlivní.
- Firmware přibližně jednou za 24 hodin provozu požádá o nový klíč. Nejdřív ho uloží do NVS. Server zruší starý až při prvním použití nového klíče; ztracenou odpověď lze opakovat. Čekající rotace přežije restart serveru.
- **Zrušit přístup stanice** ve webu okamžitě zneplatní vlastní klíč i čekající rotaci a párovací kódy. Opětovné připojení vyžaduje nové párování.
- Starší ESP a simulátor mohou dál používat společný API klíč. Ten má původní přístup ke všem registrovaným ID; pro plné oddělení stanic převeďte všechna ESP na vlastní klíče a původní společný klíč vyměňte.
- Mobilní konfigurace je uložena jako jeden NVS záznam. Zůstává kompatibilní i čtení původních USB údajů. Opětovné spuštění USB provisioningu úmyslně nahradí mobilní konfiguraci.
- Vlastní klíče jsou na serveru uloženy pouze jako SHA-256 hashe v SQLite. JSON export měření je neobsahuje. Pro obnovu párování zachovejte celou databázi i `auth.json`; pouhý export měření nestačí. Reset přihlášení pomocí setup nemění vlastní klíče v zachované databázi.

Krátký párovací kód obsahuje 40 náhodných bitů a platí 10 minut. ESP posílá identifikátor odvozený dvojitým SHA-256 a HMAC-SHA256 důkaz s náhodným nonce; server klíč vrací zašifrovaný AES-256-GCM klíčem odvozeným z kódu. Kód ani nový přístupový klíč se během párování neposílají otevřeně. Opakování stejného požadavku během platnosti kódu vrátí stejnou šifrovanou odpověď; jiné nonce použitý kód odmítne. Počet pokusů je omezen na 10 za minutu z IP a celkem 60 za minutu přes všechny adresy.

Tato ochrana předání klíče **nešifruje následnou HTTP telemetrii**, která stejně jako dříve posílá API klíč v hlavičce. Tento firmware je určený pro důvěryhodnou domácí síť. Pro nedůvěryhodnou nebo vzdálenou síť je nutná další úprava telemetrie na ověřované HTTPS. Nastavení HTTPS a CA pro existující OTA je samostatné a zůstává v `ota.h`; mobilní průvodce jej zatím nemění.

## Ověření na hardware

Backend ověřují automatické testy párování a přístupových práv. Firmware vyžaduje kompilaci ve výše uvedeném Arduino prostředí a zkoušku na skutečné desce: nové zapojení, chybný kód, výměna Wi-Fi, změna DHCP IP, restart serveru/ESP, přerušené párování, rotace klíče a GPIO tlačítko. Zařízení s původním firmware vyžaduje jednorázově tento nový firmware, přes již funkční OTA nebo USB.

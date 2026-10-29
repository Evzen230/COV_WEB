# Přihlášení a ochrana API

Web používá heslo pro jednoho domácího uživatele. ESP32 a Python odesílač používají jiný API klíč. Heslo pro web nedávejte do firmware; klíč stanice nelze použít k přihlášení do webu.

## První spuštění po aktualizaci

1. V terminálu s běžícím serverem stiskněte Ctrl+C.
2. V projektové složce spusťte `npm run setup`.
3. Zvolte vlastní heslo nebo zapamatovatelnou frázi (8 až 128 znaků) a zopakujte ji. Psaní hesla je skryté. Vypsaný náhodný API klíč si uložte do správce hesel; zobrazí se pouze jednou.
4. Spusťte `npm start` a obnovte stránku prohlížeče.
5. Do přihlašovacího formuláře zadejte heslo pro web. Uživatelské jméno se nezadává.
6. V Python simulátoru vyplňte pole API klíč stanice. Pak použijte Ověřit server a Odeslat jednou.

Příkaz setup použije vaše vlastní heslo a vytvoří náhodný klíč stanice a ukládá pouze jejich odvozené hashe a sůl do data/auth.json. Při opětovném spuštění existující údaje nepřepíše. Databáze měření zůstává zachovaná. Server bez platného souboru přístupových údajů odmítne nastartovat, aby nezůstal neúmyslně nechráněný. Existující starý proces se aktualizuje až restartem.

## API stanice

Posílejte klíč v hlavičce `X-API-Key` nebo `Authorization: Bearer …`. Nedávejte ho do URL. Klíč dovoluje pouze příjem měření a kontrolu spojení:

| Endpoint                  | Oprávnění                                                            |
| ------------------------- | -------------------------------------------------------------------- |
| POST /api/v1/telemetry    | Klíč stanice; zápis měření.                                          |
| GET /api/v1/device/status | Klíč stanice; aktuální dostupnost a čas posledního přijatého vzorku. |
| GET /api/health           | Veřejná kontrola běhu serveru bez měření.                            |
| POST /api/auth/login      | Veřejné ověření hesla; omezené počty pokusů.                         |
| GET /api/auth/session     | Veřejná informace, zda je aktuální prohlížeč přihlášený.             |
| POST /api/auth/logout     | Zrušení aktuální relace.                                             |
| Ostatní API               | Přihlášený web; klíč stanice nestačí.                                |

Python klíč ukrývá v zadávacím poli a neukládá jej do souboru. Volitelně jej načte z proměnné prostředí COV_API_KEY. Stejnou proměnnou používá examples/send-sample.mjs. ESP32 nastavte jednorázově přes `examples/esp32_provision/esp32_provision.ino`; klíč zůstává v NVS a veřejný OTA obraz ho neobsahuje. Postup je v [návodu k aktualizacím](UPDATES.md).

## Relace a omezení

Přihlášení používá HttpOnly cookie se SameSite=Strict, nikoli heslo nebo klíč v localStorage. Relace platí 12 hodin a zanikne odhlášením nebo restartem serveru. Opakované chybné přihlášení je omezeno; po více než pěti pokusech z jedné adresy během 15 minut se vrátí chyba 429. Kontrola původu požadavku brání přístupu z cizích webových stránek. Příjem stanice dovoluje nejvýše 300 požadavků za minutu z jedné IP adresy. Klíče ani hesla se nevracejí v JSON záloze.

Připojení HTTP samo nešifruje provoz. Toto nastavení zajišťuje přístupová oprávnění, nikoli ochranu před odposlechem domácí sítě. Pro síť, které nedůvěřujete, použijte HTTPS; pro vzdálený přístup VPN nebo správně nastavenou HTTPS bránu. Nepřesměrovávejte nešifrovaný port přímo do internetu. Secure cookie se nastaví při přímém HTTPS spojení; při HTTPS reverzní proxy musí příslušnou úpravu cookie zajistit proxy, aplikace nedůvěřuje podvržitelným X-Forwarded hlavičkám.

## Změna hesla a vytvoření klíče ve webu

Po přihlášení otevřete Nastavení → záložka Přístup a API. Pro změnu hesla zadejte současné heslo a dvakrát nové (8 až 128 znaků). Současné zařízení dostane novou přihlašovací relaci; ostatní zařízení se odhlásí. API klíč zůstane zachovaný.

Pro nový klíč použijte Vytvořit a nahradit API klíč a potvrďte současným heslem. Nový náhodný klíč se zobrazí pouze jednou a je aktivní ihned, bez restartu. Původní klíč okamžitě přestane fungovat. Přepište jej v Pythonu a ve všech připojených jednotkách. Po odchodu ze stránky ho už nelze znovu zobrazit; můžete vytvořit další nový klíč. Jde o jeden aktivní klíč stanice, nikoli o přidávání více současně platných klíčů. Heslo pro web se vytvořením klíče nemění.

Změny vyžadují přihlášenou relaci a současné heslo. POST /api/auth/password přijímá currentPassword a newPassword; POST /api/auth/api-key přijímá currentPassword a vrací apiKey pouze při vytvoření. Obě změny se uloží atomicky do konfiguračního souboru.

## Ztráta přístupových údajů

Zastavte server a spusťte `npm run setup -- --reset`. Zvolíte nové vlastní heslo a vygeneruje se nový klíč stanice. Restartujte server, znovu se přihlaste a změňte klíč v Pythonu i ESP32. Starý klíč po restartu přestane fungovat. Reset nemění měření, alarmy ani servisní záznamy. Soubor data/auth.json uchovávejte soukromě; není součástí exportu měření. Pro návrat z úplné souborové zálohy je potřeba zachovat i jej, nebo po obnovení vytvořit nové přístupové údaje.

U všech heslových polí je tlačítko Zobrazit heslo / Skrýt heslo. Chyby jsou červené a úspěšné změny zelené. Přepínání záložek nastavení zachovává rozepsaná pole; uložení provozu a alarmů zůstává společné.

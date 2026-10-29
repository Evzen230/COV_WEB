# Orientace v projektu

Každá obrazovka aplikace má vlastní JavaScriptový modul ve složce `dist/js/pages`. HTML dané obrazovky najdete ve funkci pojmenované podle stránky. Funkce vkládá aktuální serverová data do HTML šablony. `dist/index.html` obsahuje pouze společnou kostru aplikace a načtení vstupního modulu. Moduly načítá přímo prohlížeč; není potřeba build.

## Kde co upravit

| Soubor nebo složka              | Obsah                                                                    |
| ------------------------------- | ------------------------------------------------------------------------ |
| dist/index.html                 | Společná kostra, postranní panel, hlavička, hlavní obsah a patička.      |
| dist/js/app.js                  | Spuštění aplikace, navigace, přepínání stránek, obnovování dat a vzhled. |
| dist/js/events.js               | Obsluha tlačítek a formulářů, ukládání záznamů a exporty.                |
| dist/js/core/state.js           | Aktuální stav ze serveru, výběr veličiny a období, definice senzorů.     |
| dist/js/core/api.js             | Společný klient pro HTTP API.                                            |
| dist/js/core/utils.js           | Formátování hodnot, stav senzorů, CSV, stahování a hlášky.               |
| dist/js/core/markdown.js        | Bezpečné zobrazení projektové dokumentace z Markdownu.                   |
| dist/js/components/dashboard.js | Sdílené grafy, přehled senzorů, karty a stav technologie.                |
| dist/js/pages/overview.js       | Provozní přehled.                                                        |
| dist/js/pages/history.js        | Historie a tabulka měření.                                               |
| dist/js/pages/sensors.js        | Senzory a zařízení.                                                      |
| dist/js/pages/alarms.js         | Alarmy a historie událostí.                                              |
| dist/js/pages/labs.js           | Laboratorní rozbory a formulář.                                          |
| dist/js/pages/service.js        | Servisní deník a formulář bez jména obsluhy.                             |
| dist/js/pages/settings.js       | Nastavení prahů, hlídání senzorů a připojení stanice.                    |
| dist/js/pages/guides.js         | Návody, README a tato mapa projektu.                                     |
| dist/css/base.css               | Barvy, typografie, kostra a společné prvky.                              |
| dist/css/dashboard.css          | Karty, grafy, tabulky, formuláře a ostatní obrazovky.                    |
| dist/css/responsive.css         | Mobilní a další velikosti obrazovky.                                     |
| dist/css/documentation.css      | Vzhled návodů a ukázek kódu.                                             |
| server.cjs                      | Domácí HTTP server, API, SQLite a vyhodnocování alarmů.                  |
| data/                           | Vygenerovaná databáze a pomocné soubory; nepatří do Gitu.                |
| docs/API.md                     | Připojení stanice, datový formát a provoz serveru.                       |
| README.md                       | Rychlý start projektu.                                                   |
| examples/                       | Testovací HTTP zpráva a výchozí firmware ESP32.                          |
| test/                           | Automatické testy.                                                       |
| scripts/check.cjs               | Kontrola syntaxe souborů projektu.                                       |

## Změna jedné obrazovky

Interaktivní graf má vlastní modul `dist/js/components/chart.js`. V objektu scales jsou základní rozsahy os pro jednotlivé veličiny (např. teplota 0–40 °C). Modul také obsluhuje kurzor, dotyk a klávesnici. Hodnoty mimo základní rozsah rozšíří osu a zobrazí vysvětlení; naměřené minimum a maximum zůstávají zvlášť pod grafem.

Například servisní deník upravujte v `dist/js/pages/service.js`. Společné formátování data je v `dist/js/core/utils.js`; sdílený vzhled formulářů v `dist/css/dashboard.css`. Ukládání servisního formuláře zajišťuje `dist/js/events.js` přes API klienta. Server přijme záznam a uloží ho do SQLite.

Po změně obnovte stránku prohlížeče. Při změně `server.cjs` restartujte také proces `npm start`. Server posílá statické soubory s požadavkem na kontrolu aktuálnosti, není potřeba ručně generovat dist.

## Přidání další stránky

1. Vytvořte nový modul v `dist/js/pages` a exportujte funkci vracející HTML. Vkládané uživatelské texty vždy escapujte funkcí esc.
2. Importujte funkci v `dist/js/app.js` a přidejte ji do seznamu navigation.
3. Pokud stránka ukládá data, doplňte obsluhu v events.js a odpovídající endpoint serveru.
4. Spusťte `npm run check` a `npm test`, potom ověřte stránku v prohlížeči.

## Úprava dokumentace

Sekce Návody a dokumentace načítá README.md, docs/API.md a docs/STRUCTURE.md přes povolený seznam v serveru. Obsah upravujte přímo v těchto souborech. Kód a tabulky se zobrazí ve webu, původní Markdown lze stáhnout. Pro nový dokument přidejte povolenou cestu v serveru a položku v `dist/js/pages/guides.js`. Server neposkytuje obecný přístup k souborům projektu ani databázi.

## Kontrola před dokončením změny

```powershell
npm run check
npm test
```

Pro běžné úpravy není potřeba měnit databázi ani složku data. Přesouvání souborů frontendu nemění dosavadní měření a deníky.

## Zabezpečení a alarmy na serveru

Modul server/security.cjs ověřuje přihlášení, relace a oprávnění klíče stanice. server/alarm-policy.cjs obsahuje časovou prodlevu a návratová pásma. scripts/setup.cjs vytváří přístupové údaje bez změny databáze. Webové přihlášení je v dist/js/core/login.js. Postup aktualizace je v [zabezpečení](docs/SECURITY.md).

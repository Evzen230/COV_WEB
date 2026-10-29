# Nastavení a ověření alarmů

Alarmy mají upozornit na technický problém a na odchylku od vámi zvoleného provozního pásma. Nastavení samo neprokazuje kvalitu vyčištěné vody. Níže uvedené hodnoty slouží k testování aplikace; pro skutečnou ČOV vycházejte z její dokumentace, doporučení dodavatele a ověřených měření.

## První nastavení

1. Otevřete Nastavení. Web automaticky používá data přijatá přes API od stanice nebo Python skriptu; žádný režim nemusíte přepínat.
2. V části Hlídání jednotlivých senzorů označte jen sondy, které skutečně posílají data. Při prvním zapojení samotného teploměru nechte zaškrtnutou jen teplotu. Při testování všech šesti veličin Python skriptem můžete označit všech šest.
3. Nastavte dobu Nedostupnost zařízení. Výchozích 15 minut znamená, že při odesílání jednou za minutu musí chybět více zpráv, než vznikne alarm. Nejde o interval odesílání; ten určuje firmware nebo Python skript.
4. Zkontrolujte teplotní meze a práh vysoké hladiny. U ostatních veličin nechte minimum a maximum prázdné, dokud nemáte podklad pro jejich nastavení.
5. Klikněte na Uložit nastavení. Příjem a alarmy zkontrolujte podle testů níže.

## Co jednotlivé alarmy znamenají

| Alarm                                   | Kdy vznikne                                                                                     | Co zkontrolovat                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Stanice neodpovídá                      | Chybí první zpráva nebo poslední vzorek či jeho přijetí překročí nastavenou dobu nedostupnosti. | Napájení ESP32, Wi-Fi, adresu serveru a běh odesílání.                       |
| Chybí měření konkrétního senzoru        | Stanice posílá čerstvé zprávy, ale zaškrtnutá sonda v nich má null nebo chybí.                  | Čidlo, kabel, konektor, firmware a správný klíč veličiny ve zprávě.          |
| Teplota mimo nastavené pásmo            | Platná teplota je nižší než minimum nebo vyšší než maximum nastavené nahoře ve formuláři.       | Ověření teploměru, umístění sondy a provozní okolnosti.                      |
| Vysoká hladina                          | Platná hladina překročí nastavený práh v procentech.                                            | Ověření kalibrace hladiny a skutečný stav nádrže.                            |
| Hodnota mimo nastavené pásmo jiné sondy | U zapnuté sondy je platná hodnota nižší než její minimum nebo vyšší než maximum.                | Nejprve platnost měření, kalibraci a znečištění sondy, potom samotný provoz. |

Při výpadku celé stanice se zobrazí společný alarm místo šesti alarmů čidel. Chybějící hodnota se nikdy neporovnává s nulou. Naopak skutečně naměřená nula je platná hodnota, pokud ji datový formát dané veličiny umožňuje.

## Jak zvolit meze

| Nastavení      | Výchozí stav nebo postup                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Teplota        | Aplikace začíná s pásmem 8 až 30 °C. Jsou to výchozí technické hodnoty aplikace, ne univerzální provozní doporučení. Pro vaši stanici je ověřte.             |
| Vysoká hladina | Výchozí práh je 85 %. Nejdříve ověřte, co u konkrétní sondy znamená 0 a 100 %, a kde je běžná a problémová hladina.                                          |
| pH             | Minimum a maximum jsou prázdné. pH vyjadřuje kyselost nebo zásaditost; neutrální hodnota je přibližně 7. Meze volte až po ověření sondy a požadavků provozu. |
| Vodivost (EC)  | Meze jsou prázdné; jednotka je µS/cm. Sledujte obvyklý průběh ve stejném místě měření. Vodivost sama neurčuje, zda je voda čistá.                            |
| Zákal          | Meze jsou prázdné; jednotka je NTU. Nastavení závisí na sondě, její kalibraci, čistotě a místě měření.                                                       |
| ORP            | Meze jsou prázdné; jednotka je mV. Jde o oxidačně-redukční podmínky, které nelze rozumně vyhodnotit jedním univerzálním číslem pro všechna místa ČOV.        |

U dalších sond lze nastavit jen dolní nebo jen horní mez. Prázdné pole znamená, že se daná strana nehlídá. Pokud jsou vyplněné obě, minimum musí být menší než maximum. Hodnota přesně na mezi alarm nevyvolá; alarm vznikne až po jejím překročení.

Zaškrtávátko je označené Hlásit výpadek. U pH, EC, zákalu a ORP také zapíná jejich volitelné pásmo. Samostatné teplotní pásmo a práh vysoké hladiny nahoře ve formuláři se vyhodnocují při přijetí platné hodnoty i bez zaškrtnutého hlídání výpadku. Vypnutí hlídání výpadku tedy není vypnutí těchto dvou provozních alarmů.

## Potlačení výkyvů a návratové pásmo

Ve Stabilitě alarmů je výchozí prodleva překročení 60 sekund. Kratší výkyv se neohlásí. Počítá se doba, po kterou poslední platná hodnota zůstává za mezí; pokud se hodnota vrátí do normálu před koncem prodlevy, čekání se zruší. Pokud se mez překročí znovu, čekání začíná od začátku. Nedostupnost stanice se řídí vlastním časovým limitem a chybějící hodnota zapnuté sondy se hlásí ihned.

Návratové pásmo je rozdíl mezi hranicí vzniku alarmu a hranicí jeho ukončení. Při maximální teplotě 30 °C a pásmu 0,5 °C vznikne alarm po souvislém překročení 30 °C a ukončí se až při poklesu na 29,5 °C nebo níže. Pro spodní mez 8 °C se ukončí při návratu na 8,5 °C nebo výše. Vysoká hladina s prahem 85 % a pásmem 2 % se ukončí při 83 % nebo níže. Obě teplotní meze musí zanechat mezi návratovými pásmy volný prostor; formulář nepřijme pásmo větší nebo rovné polovině rozsahu.

Další sondy mají vlastní návratová pásma vedle minim a maxim (pH výchozí 0,1; EC 10 µS/cm; zákal 1 NTU; ORP 10 mV). Jsou to výchozí hodnoty aplikace pro omezení přepínání, ne doporučené limity kvality vody. Prázdné min/max zůstávají vypnuté. Nulové návratové pásmo vypne hysterezi. Nulová prodleva vypne čekání, což se hodí pro rychlé testy níže; po testování vraťte provozní nastavení. Uložené čekání na vznik alarmu se zachovává při restartu a zruší při změně nastavení.

U každého senzoru se zobrazuje čas posledního platného měření a jeho stáří. Chybějící nový vzorek neobnoví čas staré hodnoty. Při výpadku stanice se údaje označí jako zastaralé; při prvním startu bez měření se zobrazí, že zatím žádné platné měření není. Server nedokáže odhalit firmware, který vydává staré číslo za nově naměřené — chybné čidlo musí nadále hlásit null.

## Testy s Python simulátorem

Před testem se přihlaste do webu a v Pythonu vyplňte API klíč stanice (odlišný od webového hesla). Návod je v [zabezpečení](docs/SECURITY.md). Pokud chcete okamžité reakce na překročení, dočasně nastavte prodlevu na 0 sekund; s výchozí prodlevou posílejte hodnoty za mezí déle než 60 sekund.

Nechte běžet `npm start`, otevřete Python simulátor a zkontrolujte adresu serveru. Ve skriptu pro opakovatelné testy vypněte Lehce kolísat hodnoty. Vzorek odešlete tlačítkem Odeslat jednou nebo spusťte opakované odesílání.

| Test                | Nastavení a akce                                                                                                     | Očekávaný výsledek                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Normální provoz     | V Pythonu zvolte Normální a odešlete. Vlastní meze ostatních sond ponechte prázdné.                                  | Nevznikne nový alarm při výchozích teplotních mezích a prahu hladiny.                                                                           |
| Výpadek teploměru   | Zapněte hlídání teploty, v Pythonu zvolte Chyba čidla (null) a odešlete.                                             | Alarm chybějící teploty, nikoli alarm teploty 0 °C.                                                                                             |
| Výpadek další sondy | Zapněte například hlídání pH. Vymažte jeho číselné pole v Pythonu a odešlete.                                        | Vznikne samostatný alarm pH sondy. Stejný postup funguje pro ostatní sondy.                                                                     |
| Obnova senzoru      | Vraťte platnou hodnotu nebo zvolte Normální a odešlete.                                                              | Alarm výpadku se ukončí a obnova se zapíše do událostí.                                                                                         |
| Vysoká hladina      | Při prahu 85 % vyberte v Pythonu Vysoká hladina a odešlete.                                                          | Hodnota 97 % vyvolá alarm vysoké hladiny.                                                                                                       |
| Teplota mimo pásmo  | Při pásmu 8–30 °C zvolte Vysoká teplota a odešlete.                                                                  | Hodnota 35 °C vyvolá teplotní alarm.                                                                                                            |
| Vlastní pásmo pH    | Jen pro test zapněte pH a nastavte minimum 6, maximum 8. V Pythonu zadejte 9 a odešlete.                             | Vznikne alarm mimo nastavené pásmo. Čísla 6 a 8 zde nejsou doporučením pro reálnou ČOV. Po testu je smažte nebo nahraďte podloženými hodnotami. |
| Výpadek stanice     | Pro rychlý test nastavte nedostupnost na 1 minutu, uložte a přestaňte posílat. V Pythonu lze použít Výpadek stanice. | Po více než minutě od posledního aktuálního vzorku vznikne alarm stanice. Poté spusťte odesílání a vraťte původní dobu nedostupnosti.           |

Tlačítko Výpadek stanice neposílá speciální poruchovou zprávu: pouze pozastaví odesílání. Proto alarm nevznikne ihned. Ve webu se upozornění projeví při další kontrole serveru, obvykle do 5 sekund od vzniku alarmu.

## Co dělat s upozorněním

Nový nepotvrzený alarm vyskočí nad kteroukoli otevřenou stránkou, aniž by smazal rozepsaný formulář. Zobrazit alarmy otevře přehled a historii. Potvrdit přijetí znamená pouze, že jste upozornění viděli; porucha tím nezmizí. Křížek skryje okno v aktuální relaci, ale nepotvrdí alarm na serveru.

Po návratu platných hodnot se porucha automaticky ukončí. Pokud se později objeví znovu, vyžaduje nové potvrzení. Po obnovení webové stránky se mohou znovu připomenout stále aktivní nepotvrzené alarmy. Při zavřeném webu server dál vyhodnocuje stav, ale neposílá e-mail, SMS ani systémové push oznámení.

## Když výsledek neodpovídá očekávání

1. Ověřte adresu serveru v Python skriptu. Web zobrazuje data přijatá na tomto serveru.
2. Klikněte v Pythonu na Ověřit server a zkontrolujte odpověď po odeslání; 201 znamená uložený nový vzorek.
3. Uložte nastavení po změně hlídaných sond nebo mezí.
4. Zkontrolujte, že výpadek čidla posílá null nebo vynechává jeho hodnotu. Pokud firmware opakuje staré číslo s novou časovou značkou, server chybu čidla sám nepozná.
5. Vypněte při testu náhodné kolísání a počkejte na další obnovu webu. Pro test nedostupnosti počkejte celou nastavenou dobu.
6. Po aktualizaci backendu ukončete původní proces pomocí Ctrl+C a znovu spusťte `npm start`; potom obnovte web.

Hodnoty mimo technicky přijatelné rozsahy API se odmítnou chybou 400 a neuloží se jako nový vzorek. Nulová nebo prázdná hodnota v grafu proto nenahrazuje kontrolu odpovědi odesílače. Technické rozsahy a datový formát popisuje [návod k API](docs/API.md).

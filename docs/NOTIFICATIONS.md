# Mobilní oznámení

V **Nastavení → Oznámení** lze zapnout odesílání alarmů přes ntfy. Web nemusí být otevřený; odesílání zajišťuje běžící server ČOV Monitor.

1. Nainstalujte aplikaci ntfy pro Android nebo iPhone a povolte její oznámení.
2. Ve webu vygenerujte náhodné téma, zapněte oznámení a uložte.
3. V telefonu přidejte stejné téma na serveru `https://ntfy.sh`. Více telefonů může odebírat stejné téma.
4. Ve webu odešlete test. Ověřte, že telefon upozorní i se zamčenou obrazovkou.

Název tématu je přístupový údaj: na veřejném ntfy.sh může každý, kdo jej zná, zprávy číst i odesílat. Použijte náhodně vygenerovaný název. Pro chráněné téma lze serveru nastavit `NTFY_TOKEN`; token se neposílá do webu. Odběr chráněného tématu vyžaduje odpovídající přihlášení také v mobilní aplikaci. Nastavení je společné pro celou instalaci.

Odesílá se vznik nového alarmu a jeho ukončení. Trvající alarm se při obnovování webu neposílá opakovaně. Znovu vzniklá porucha vyvolá novou zprávu. Zapnutí neposílá zpětně již aktivní alarmy. Text obsahuje název ČOV a popis poruchy a předává se externí službě. Po uložení nového nastavení se dosavadní fronta vymaže; již probíhající odeslání nelze odvolat.

Fronta je v SQLite a přežije restart. Při chybě se odesílání opakuje po 15 sekundách, postupně nejvýše jednou za hodinu. Fronta má nejvýše 500 zpráv; při naplnění se další zprávy nezařadí. Při přerušení spojení po přijetí zprávy službou může opakování způsobit duplicitu. Stav zobrazený při otevření nastavení a po testu uvádí počet čekajících zpráv, poslední předání službě a chybu odesílání. Předání službě není potvrzení doručení do telefonu.

Server i telefon potřebují internet. Při vypnutém serveru nemůže tato instalace poslat oznámení o vlastním výpadku. Zvuk a doručení závisejí také na oprávněních aplikace, úspoře baterie a režimu Nerušit. Oznámení nejsou náhradou bezpečnostního zabezpečení technologie.

Dokumentace služby: [odesílání](https://docs.ntfy.sh/publish/) a [mobilní odběr](https://docs.ntfy.sh/subscribe/phone/).

import { api } from "../core/api.js";
import { esc } from "../core/utils.js";
import { markdown } from "../core/markdown.js";
import { header } from "../components/dashboard.js";

export const documents = [
  {
    id: "updates",
    icon: "↑",
    title: "Aktualizace serveru a ESP32",
    description: "Instalace na Raspberry Pi, podepsaná vydání a OTA stanice.",
  },
  {
    id: "security",
    icon: "⌑",
    title: "Přihlášení a API klíč",
    description:
      "První spuštění zabezpečené verze, klíč stanice a změna přístupu.",
  },
  {
    id: "alarms",
    icon: "!",
    title: "Nastavení alarmů",
    description: "Zapnutí sond, provozní meze a testy Python simulátorem.",
  },
  {
    id: "readme",
    icon: "◫",
    title: "Začínáme / README",
    description: "Spuštění aplikace a přehled funkcí.",
  },
  {
    id: "api",
    icon: "⌁",
    title: "Napojení stanice",
    description: "Domácí server, ESP32, formát zpráv a zálohování.",
  },
  {
    id: "structure",
    icon: "⊞",
    title: "Orientace v projektu",
    description: "Kde upravit stránku, vzhled nebo komunikaci se serverem.",
  },
];

export async function guidesPage(documentId = "readme") {
  const selected =
    documents.find((document) => document.id === documentId) || documents[0];
  const heading = header(
    "Návody a dokumentace",
    "Vše potřebné pro spuštění, úpravy aplikace a připojení domácí ČOV.",
  );
  const navigation = /* HTML */ `
    <nav class="docs-nav" aria-label="Dokumentace">
      ${documents
        .map(
          (document) => /* HTML */ `
            <a
              href="#guides/${document.id}"
              class="doc-choice ${document.id === selected.id ? "active" : ""}"
              ${document.id === selected.id ? 'aria-current="page"' : ""}
            >
              <span>${document.icon}</span>
              <div>
                <b>${document.title}</b>
                <small>${document.description}</small>
              </div>
            </a>
          `,
        )
        .join("")}
    </nav>
  `;
  try {
    const document = await api("/api/docs/" + selected.id);
    return /* HTML */ /* HTML */ `
      ${heading}${navigation}
      <article class="card documentation">
        <div class="panelhead">
          <h2>${esc(selected.title)}</h2>
          <a class="btn" href="/api/docs/${selected.id}?download=1">
            ↓ Stáhnout Markdown
          </a>
        </div>
        <div class="doc-body">${markdown(document.content)}</div>
        <div class="chartfoot">
          Zdroj: ${esc(document.path)} · obsah se načítá přímo z projektového
          souboru.
        </div>
      </article>
    `;
  } catch (error) {
    return /* HTML */ /* HTML */ `
      ${heading}${navigation}
      <div class="card empty" role="alert">
        Dokument nelze načíst: ${esc(error.message)}
        <p>
          Ověřte, že běží aktuální verze serveru, a zkuste stránku znovu
          otevřít.
        </p>
      </div>
    `;
  }
}

import { feedback } from "./form-feedback.js";
import { api } from "../core/api.js";
export function accessSettings() {
  return /* HTML */ `
    <div class="card" style="margin-top:22px">
      <div class="panelhead"><h2>Přístup a API klíč</h2></div>
      <div class="formgrid">
        <form id="password-change">
          <h3>Změnit heslo pro web</h3>
          <label>
            Současné heslo
            <input
              name="currentPassword"
              type="password"
              autocomplete="current-password"
              required
              maxlength="256"
            />
          </label>
          <label>
            Nové heslo nebo fráze
            <input
              name="newPassword"
              type="password"
              autocomplete="new-password"
              required
              minlength="8"
              maxlength="128"
            />
          </label>
          <label>
            Zopakovat nové heslo
            <input
              name="repeatPassword"
              type="password"
              autocomplete="new-password"
              required
              minlength="8"
              maxlength="128"
            />
          </label>
          <p class="subtitle" style="margin:12px 0;line-height:1.7">
            Stačí heslo, bez uživatelského jména. Použijte alespoň 8 znaků;
            klidně delší zapamatovatelnou frázi. Ostatní přihlášená zařízení se
            po změně odhlásí.
          </p>
          <button class="btn primary">Uložit nové heslo</button>
          <p class="access-message" role="status"></p>
        </form>
        <form id="api-key-create">
          <h3>Nový API klíč stanice</h3>
          <p class="subtitle" style="line-height:1.8;margin:12px 0">
            Vytvoření okamžitě zneplatní původní klíč. Nový klíč uvidíte pouze
            jednou a musíte ho přepsat v Python skriptu i ESP32. Heslo pro web
            se nezmění.
          </p>
          <label>
            Potvrdit současným heslem
            <input
              name="currentPassword"
              type="password"
              autocomplete="current-password"
              required
              maxlength="256"
            />
          </label>
          <button class="btn" style="margin-top:14px">
            Vytvořit a nahradit API klíč
          </button>
          <p class="access-message" role="status"></p>
          <div class="key-result" hidden>
            <label>
              Nový klíč — uložte si jej nyní
              <textarea
                readonly
                spellcheck="false"
                aria-label="Nový API klíč"
              ></textarea>
            </label>
            <p class="subtitle">Po opuštění stránky se klíč znovu nezobrazí.</p>
          </div>
        </form>
      </div>
    </div>
  `;
}
export function mountAccessSettings() {
  for (const id of ["password-change", "api-key-create"]) {
    const form = document.getElementById(id);
    if (!form) continue;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form)),
        button = form.querySelector('button:not([type="button"])'),
        message = form.querySelector(".access-message");
      message.textContent = "";
      if (
        id === "password-change" &&
        data.newPassword !== data.repeatPassword
      ) {
        feedback(message, "Nová hesla se neshodují.", "error");
        form.elements.repeatPassword.setAttribute("aria-invalid", "true");
        return;
      }
      button.disabled = true;
      try {
        const result = await api(
          id === "password-change" ? "/api/auth/password" : "/api/auth/api-key",
          "POST",
          data,
        );
        form.reset();
        if (result.apiKey) {
          form.querySelector(".key-result").hidden = false;
          form.querySelector("textarea").value = result.apiKey;
          feedback(
            message,
            "Nový klíč je aktivní. Původní již nefunguje.",
            "success",
          );
        } else
          feedback(
            message,
            "Heslo bylo změněno. Na tomto zařízení zůstáváte přihlášený.",
            "success",
          );
      } catch (error) {
        if (error.status === 403)
          form.elements.currentPassword.setAttribute("aria-invalid", "true");
        feedback(message, error.message, "error");
      } finally {
        button.disabled = false;
      }
    });
  }
}

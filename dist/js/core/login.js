import {
  mountPasswordControls,
  feedback,
} from "../components/form-feedback.js";
import { api } from "./api.js";
export function showLogin(onLogin) {
  document.body.classList.add("locked");
  document.querySelector("#alarm-notifications").hidden = true;
  document.querySelector("#logout").hidden = true;
  const main = document.querySelector("#main");
  main.innerHTML = `<section class="card login-card"><h1>ČOV Monitor</h1><p class="subtitle">Přihlášení k domácímu monitoringu</p><form id="loginform"><label>Heslo<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label><button class="btn primary">Přihlásit se</button><p class="login-error" role="alert"></p></form><p class="subtitle">Přístupové údaje vytvoříte v terminálu příkazem <code>npm run setup</code>.</p></section>`;
  mountPasswordControls(main);
  main.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button:not([type="button"])');
    button.disabled = true;
    try {
      await api("/api/auth/login", "POST", {
        password: new FormData(event.target).get("password"),
      });
      document.body.classList.remove("locked");
      document.querySelector("#logout").hidden = false;
      await onLogin();
    } catch (error) {
      if (error.status === 401)
        event.target.elements.password.setAttribute("aria-invalid", "true");
      const notice = main.querySelector(".login-error");
      if (notice) feedback(notice, error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
}

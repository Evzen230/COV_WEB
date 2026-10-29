export function feedback(element, message, type = "error") {
  element.textContent = message;
  element.dataset.kind = type;
  element.setAttribute("role", type === "error" ? "alert" : "status");
}
export function mountPasswordControls(root = document) {
  const eye =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  root.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.closest(".password-control")) return;
    if (
      !input.hasAttribute("aria-label") &&
      !input.hasAttribute("aria-labelledby")
    )
      input.setAttribute(
        "aria-label",
        input.labels?.[0]?.textContent.trim() || "Heslo",
      );
    const wrapper = document.createElement("span");
    wrapper.className = "password-control";
    input.before(wrapper);
    wrapper.append(input);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "password-toggle";
    button.innerHTML = eye;
    const update = () => {
      const visible = input.type === "text";
      button.setAttribute(
        "aria-label",
        visible ? "Skrýt heslo" : "Zobrazit heslo",
      );
      button.title = visible ? "Skrýt heslo" : "Zobrazit heslo";
      button.setAttribute("aria-pressed", String(visible));
      button.classList.toggle("revealed", visible);
    };
    button.addEventListener("click", () => {
      input.type = input.type === "password" ? "text" : "password";
      update();
    });
    wrapper.append(button);
    update();
    input.form?.addEventListener("reset", () => {
      input.type = "password";
      update();
    });
  });
}
export function bindValidation() {
  document.addEventListener(
    "invalid",
    (event) => {
      const input = event.target;
      if (!input.matches("input,select,textarea")) return;
      input.setAttribute("aria-invalid", "true");
      const panel = input.closest("[data-settings-panel]");
      if (panel?.hidden)
        document
          .querySelector(`[data-settings-tab="${panel.dataset.settingsPanel}"]`)
          ?.click();
    },
    true,
  );
  document.addEventListener("input", (event) => {
    const input = event.target;
    if (input.matches("input,select,textarea") && input.validity.valid)
      input.removeAttribute("aria-invalid");
  });
}

// Apply the saved theme before stylesheets and the application are painted.
try {
  const saved = localStorage.getItem("cov-dark");
  const dark =
    saved == null
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : JSON.parse(saved) === true;
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
} catch {}

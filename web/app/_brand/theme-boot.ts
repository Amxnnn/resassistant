/*
 * Light and dark for the whole site. The theme lives on <html data-theme>, set before the first
 * paint by THEME_BOOT (inlined in app/layout.tsx): the visitor's saved choice, otherwise their
 * device's. Until they choose, a change of the device setting carries straight through.
 */

export const THEME_KEY = "resassistant-theme";
export const THEME_META = { light: "#ffffff", dark: "#000000" } as const;

export const THEME_BOOT = `(function () {
  var d = document.documentElement, k = "${THEME_KEY}", m = matchMedia("(prefers-color-scheme: light)");
  function pick() {
    var s = null;
    try { s = localStorage.getItem(k); } catch (e) {}
    return s === "light" || s === "dark" ? s : m.matches ? "light" : "dark";
  }
  function meta() {
    var c = d.dataset.theme === "light" ? "${THEME_META.light}" : "${THEME_META.dark}";
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (e) { e.setAttribute("content", c); });
  }
  d.dataset.theme = pick();
  document.addEventListener("DOMContentLoaded", meta);
  m.addEventListener("change", function () { d.dataset.theme = pick(); meta(); });
})();`;

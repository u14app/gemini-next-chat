export const LIGHT_THEME_COLOR = "#ffffff";
export const DARK_THEME_COLOR = "#09090b";

// Keep this in sync with THEME_INIT_SCRIPT. A Node-only hash implementation
// cannot be imported by the Edge middleware that builds the hosted CSP.
export const THEME_INIT_SCRIPT_SHA256 =
  "59pxpJB78EC3sbPiYSguoILs8SVCJ4xlwfCL/BPOx38=";

export const THEME_INIT_SCRIPT = `
try {
  var stored = window.localStorage.getItem("neo-chat-core-settings");
  var parsed = stored ? JSON.parse(stored) : null;
  var theme = parsed && parsed.state && parsed.state.theme ? parsed.state.theme : "system";
  var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  var isDark = theme === "dark" || (theme === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", isDark);
  var storedFontSize = window.localStorage.getItem("neo-chat-font-size");
  var fontSize = storedFontSize === "small" || storedFontSize === "large" ? storedFontSize : "medium";
  document.documentElement.dataset.fontSize = fontSize;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", isDark ? "${DARK_THEME_COLOR}" : "${LIGHT_THEME_COLOR}");
} catch (_) {}
`;

/**
 * Auth Gate – redirect blocker for protected pages.
 * Place FIRST in <head>. Uses AuthGateConfig (from auth-config.js or inline defaults).
 */
(function () {
  const DEFAULTS = {
    cookieName: "demo_auth",
    cookieValue: "1",
    loginPath: "/auth/login.html",
    exclude: ["/auth/login.html"],
  };

  const cfg = window.AuthGateConfig || { ...DEFAULTS, ...(window.AUTH_GATE_CONFIG || {}) };

  function hasCookie(name, value) {
    return document.cookie.split(";").some((c) => c.trim() === `${name}=${value}`);
  }

  function isExcluded(path) {
    return (cfg.exclude || []).some((p) => path === p || path.endsWith(p));
  }

  const path = window.location.pathname;
  if (isExcluded(path)) return;

  if (!hasCookie(cfg.cookieName, cfg.cookieValue)) {
    const next = encodeURIComponent(path + window.location.search + window.location.hash);
    window.location.replace(`${cfg.loginPath}?next=${next}`);
  }

  window.demoLogout = function () {
    document.cookie = `${cfg.cookieName}=; Max-Age=0; Path=/; SameSite=Lax`;
    window.location.href = cfg.loginPath;
  };

  if (typeof window.StaticAuthGate === "undefined") {
    window.StaticAuthGate = { logout: window.demoLogout };
  } else {
    window.StaticAuthGate.logout = window.demoLogout;
  }
})();

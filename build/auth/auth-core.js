/**
 * StaticAuthGate – OOP static HTML password gate.
 * Reusable across projects; config comes from AuthGateConfig (auth-config.js).
 */
window.StaticAuthGate = (function () {
  const DEFAULTS = {
    passwordSha256Hex: "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4",
    cookieName: "demo_auth",
    cookieValue: "1",
    cookieDays: 7,
    loginPath: "/auth/login.html",
    exclude: ["/auth/login.html"],
  };
  const cfg = () => ({ ...DEFAULTS, ...(window.AuthGateConfig || {}) });

  function hasCookie(name, value) {
    return document.cookie.split(";").some((c) => c.trim() === `${name}=${value}`);
  }

  function setCookie(name, value, days) {
    const maxAge = days * 24 * 60 * 60;
    document.cookie = `${name}=${value}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
  }

  function clearCookie(name) {
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
  }

  function isExcluded(path) {
    const exclude = cfg().exclude || [];
    return exclude.some((p) => path === p || path.endsWith(p));
  }

  function getNextUrl() {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    if (!next || !next.startsWith("/")) return "/";
    return next;
  }

  async function sha256Hex(str) {
    const enc = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  return {
    protect() {
      const path = window.location.pathname;
      if (isExcluded(path)) return;
      const c = cfg();
      if (!hasCookie(c.cookieName, c.cookieValue)) {
        const next = encodeURIComponent(path + window.location.search + window.location.hash);
        window.location.replace(`${c.loginPath}?next=${next}`);
      }
    },
    logout() {
      const c = cfg();
      clearCookie(c.cookieName);
      window.location.href = c.loginPath;
    },
    async hash(password) {
      return sha256Hex(password);
    },
    isAuthenticated() {
      const c = cfg();
      return hasCookie(c.cookieName, c.cookieValue);
    },
    async validatePassword(password) {
      const hash = await sha256Hex(password);
      return hash === cfg().passwordSha256Hex;
    },
    authenticate(nextUrl) {
      const c = cfg();
      setCookie(c.cookieName, c.cookieValue, c.cookieDays);
      window.location.replace(nextUrl || getNextUrl());
    },
  };
})();

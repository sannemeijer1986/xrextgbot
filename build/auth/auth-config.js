/**
 * Auth Gate Config – single source of truth for auth settings.
 * Override via window.AUTH_GATE_CONFIG before loading any auth script.
 */
(function () {
  const DEFAULTS = {
    passwordSha256Hex: "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4",
    cookieName: "demo_auth",
    cookieValue: "1",
    cookieDays: 7,
    loginPath: "/auth/login.html",
    exclude: ["/auth/login.html"],
  };

  window.AuthGateConfig = { ...DEFAULTS, ...(window.AUTH_GATE_CONFIG || {}) };
})();

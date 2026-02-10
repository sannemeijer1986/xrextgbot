/**
 * Auth Login – password form handler for login.html.
 */
(function () {
  const form = document.getElementById("form");
  const errEl = document.getElementById("err");

  if (!form || !StaticAuthGate) return;

  window.demoHash = async function (pw) {
    console.log(await StaticAuthGate.hash(pw));
  };

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    errEl.textContent = "";

    const pw = document.getElementById("pw").value;
    const valid = await StaticAuthGate.validatePassword(pw);

    if (!valid) {
      errEl.textContent = "Wrong password.";
      return;
    }

    StaticAuthGate.authenticate();
  });
})();

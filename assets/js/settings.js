// Minimal JS for tabs and actions
(function () {
  var tabIntro = document.getElementById('tab-intro');
  var tabSetup = document.getElementById('tab-setup');
  var panelIntro = document.getElementById('panel-intro');
  var panelSetup = document.getElementById('panel-setup');

  function activate(tab) {
    var isIntro = tab === 'intro';
    if (tabIntro && tabSetup) {
      tabIntro.classList.toggle('active', isIntro);
      tabIntro.setAttribute('aria-selected', String(isIntro));
      tabSetup.classList.toggle('active', !isIntro);
      tabSetup.setAttribute('aria-selected', String(!isIntro));
    }
    if (panelIntro && panelSetup) {
      panelIntro.style.display = isIntro ? '' : 'none';
      panelSetup.style.display = isIntro ? 'none' : '';
    }
  }

  if (tabIntro) tabIntro.addEventListener('click', function () { activate('intro'); });
  if (tabSetup) tabSetup.addEventListener('click', function () { activate('setup'); });

  var shareBtn = document.getElementById('shareBtn');
  if (shareBtn) shareBtn.addEventListener('click', function () {
    try {
      var url = window.location.href;
      navigator.clipboard && navigator.clipboard.writeText(url);
      alert('Share link copied');
    } catch (_) {
      alert('Share link');
    }
  });

  var startLinkBtn = document.getElementById('startLinkBtn');
  if (startLinkBtn) startLinkBtn.addEventListener('click', function () { activate('setup'); });
})();



// moved from assets/js/settings.js
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

  // Sidebar collapsible toggles
  document.querySelectorAll('.menu-chevron').forEach(function(btn){
    btn.addEventListener('click', function(){
      var target = document.querySelector(btn.getAttribute('data-target'));
      if (!target) return;
      var open = target.hasAttribute('hidden');
      if (open) {
        target.removeAttribute('hidden');
        btn.closest('.menu-item') && btn.closest('.menu-item').classList.add('open');
        btn.setAttribute('aria-expanded','true');
      } else {
        target.setAttribute('hidden','');
        btn.closest('.menu-item') && btn.closest('.menu-item').classList.remove('open');
        btn.setAttribute('aria-expanded','false');
      }
    });
  });
})();



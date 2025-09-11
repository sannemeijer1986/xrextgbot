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

  // Back button - simple history back
  var backLink = document.getElementById('backLink');
  if (backLink) backLink.addEventListener('click', function(e){
    e.preventDefault();
    if (window.history.length > 1) window.history.back();
  });

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

  // Status tooltip: hover on desktop, click/tap toggle on mobile
  var statusBtn = document.getElementById('statusInfoBtn');
  var statusTip = document.getElementById('statusTip');
  if (statusBtn && statusTip) {
    function isDesktop() { return window.matchMedia('(min-width: 1280px)').matches; }
    function showTip() { statusTip.hidden = false; statusBtn.setAttribute('aria-expanded','true'); }
    function hideTip() { statusTip.hidden = true; statusBtn.setAttribute('aria-expanded','false'); }

    // Hover for desktop
    statusBtn.addEventListener('mouseenter', function(){ if (isDesktop()) showTip(); });
    statusBtn.addEventListener('mouseleave', function(){ if (isDesktop()) hideTip(); });
    statusTip.addEventListener('mouseenter', function(){ if (isDesktop()) showTip(); });
    statusTip.addEventListener('mouseleave', function(){ if (isDesktop()) hideTip(); });

    // Toggle for mobile/tablet
    statusBtn.addEventListener('click', function(){
      if (!isDesktop()) {
        var isHidden = statusTip.hidden;
        if (isHidden) showTip(); else hideTip();
      }
    });

    // Click outside to dismiss
    document.addEventListener('click', function(e){
      if (statusTip.hidden) return;
      var wrap = statusBtn.parentElement;
      if (!wrap.contains(e.target)) hideTip();
    });
  }
})();



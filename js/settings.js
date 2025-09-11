// moved from assets/js/settings.js
(function () {
  // Mobile state switching via URL param `view` = 'menu' | 'content'
  try {
    var mqDesktop = window.matchMedia('(min-width: 1280px)');
    var isDesktop = function(){ return mqDesktop.matches; };
    var getView = function(){ return new URLSearchParams(window.location.search).get('view'); };
    var applyMobileState = function(){
      if (isDesktop()) {
        document.body.classList.remove('state-menu');
        document.body.classList.remove('state-content');
        return;
      }
      var viewNow = getView();
      if (viewNow === 'menu') {
        document.body.classList.add('state-menu');
        document.body.classList.remove('state-content');
      } else {
        document.body.classList.add('state-content');
        document.body.classList.remove('state-menu');
      }
    };

    // Initial apply and on viewport changes
    applyMobileState();
    mqDesktop.addEventListener('change', applyMobileState);

    // Back link should go to menu state on mobile
    var backLinkEl = document.getElementById('backLink');
    if (backLinkEl) {
      backLinkEl.addEventListener('click', function(e){
        if (!isDesktop()) {
          e.preventDefault();
          var url = new URL(window.location.href);
          url.searchParams.set('view','menu');
          window.location.replace(url.toString());
        }
      });
    }
  } catch (_) {}
  var tabIntro = document.getElementById('tab-intro');
  var tabSetup = document.getElementById('tab-setup');
  var panelIntro = document.getElementById('panel-intro');
  var panelSetup = document.getElementById('panel-setup');
  var pageTitle = document.getElementById('pageTitle');
  var statusRow = document.getElementById('statusRow');
  var tabs = document.getElementById('tabs');

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

  // Page routing: telegram vs account using `page` query param
  (function(){
    try {
      var params = new URLSearchParams(window.location.search);
      var page = params.get('page') || 'telegram';
      function showTelegram(){
        if (pageTitle) pageTitle.textContent = 'XREX Pay · Telegram bot';
        if (statusRow) statusRow.style.display = '';
        if (tabs) tabs.style.display = '';
      }
      function showAccount(){
        if (pageTitle) pageTitle.textContent = 'Account settings';
        if (statusRow) statusRow.style.display = 'none';
        if (tabs) tabs.style.display = 'none';
        if (panelIntro) {
          panelIntro.style.display = '';
          panelIntro.innerHTML = '<div style="padding:12px;color:#64748b">Account details and preferences will appear here.</div>';
        }
        if (panelSetup) panelSetup.style.display = 'none';
      }
      if (page === 'account') showAccount(); else showTelegram();
    } catch(_){}
  })();

  // Back button history behavior retained for desktop (no state switching)
  var backLink = document.getElementById('backLink');
  if (backLink) backLink.addEventListener('click', function(e){
    if (window.matchMedia('(min-width: 1280px)').matches) {
      e.preventDefault();
      if (window.history.length > 1) window.history.back();
    }
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

  // Make menu items navigable via data-link on both mobile and desktop
  document.querySelectorAll('.menu .menu-item[data-link]').forEach(function(item){
    var to = item.getAttribute('data-link');
    if (!to) return;
    function go(){ window.location.href = to; }
    item.addEventListener('click', go);
    item.addEventListener('keydown', function(e){
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
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



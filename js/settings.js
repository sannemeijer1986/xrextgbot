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

    // Dynamic account chip link target based on viewport
    var chip = document.getElementById('accountChipLink');
    var setChipHref = function(){
      if (!chip) return;
      chip.setAttribute('href', isDesktop() ? 'settings.html?view=content&page=account' : 'settings.html?view=menu');
    };
    setChipHref();
    mqDesktop.addEventListener('change', setChipHref);

    // Back link should go to menu state on mobile
    var backLinkEl = document.getElementById('backLink');
    if (backLinkEl) {
      backLinkEl.addEventListener('click', function(e){
        if (!isDesktop()) {
          e.preventDefault();
          // Only keep view=menu; drop other params like page
          var base = window.location.origin + window.location.pathname + '?view=menu';
          window.location.replace(base);
        }
      });
    }
  } catch (_) {}
  var tabIntro = document.getElementById('tab-intro');
  var tabSetup = document.getElementById('tab-setup');
  var panelIntro = document.getElementById('panel-intro');
  var panelSetup = document.getElementById('panel-setup');
  var panelAccount = document.getElementById('panel-account');
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
    // Hide top Start linking button when viewing Setup
    try {
      if (typeof startLinkBtn !== 'undefined' && startLinkBtn) {
        var hidden = !isIntro;
        startLinkBtn.style.opacity = hidden ? '0' : '1';
        startLinkBtn.style.pointerEvents = hidden ? 'none' : '';
        startLinkBtn.setAttribute('aria-hidden', hidden ? 'true' : 'false');

      }
    } catch(_){}
  }

  if (tabIntro) tabIntro.addEventListener('click', function () { 
    activate('intro'); 
    try {
      var url = new URL(window.location.href);
      url.searchParams.set('tab','intro');
      window.history.replaceState({}, '', url.toString());
    } catch(_) {}
  });
  if (tabSetup) tabSetup.addEventListener('click', function () { 
    activate('setup'); 
    try {
      var url2 = new URL(window.location.href);
      url2.searchParams.set('tab','setup');
      window.history.replaceState({}, '', url2.toString());
    } catch(_) {}
  });

  var shareBtn = document.getElementById('shareBtn');
  function showSnackbar(message) {
    try {
      var bar = document.getElementById('snackbar');
      if (!bar) return;
      var textNode = bar.querySelector('.snackbar-text');
      if (textNode && typeof message === 'string') textNode.textContent = message;
      bar.hidden = false;
      bar.setAttribute('aria-hidden','false');
      // reflow
      void bar.offsetWidth;
      bar.classList.add('show');
      clearTimeout(bar._hideTimer);
      bar._hideTimer = setTimeout(function(){
        bar.classList.add('leaving');
        bar.classList.remove('show');
        setTimeout(function(){
          bar.classList.remove('leaving');
          bar.setAttribute('aria-hidden','true');
        }, 220);
      }, 2000);
    } catch(_) {}
  }

  if (shareBtn) shareBtn.addEventListener('click', function () {
    try {
      var url = window.location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url);
      }
      showSnackbar('Page link copied to clipboard');
    } catch (_) {
      // noop
    }
  });

  // Copy command text spans and show snackbar
  document.querySelectorAll('.cmd').forEach(function(cmd){
    cmd.addEventListener('click', function(){
      try {
        var text = (cmd.textContent || '').trim();
        if (text && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text);
        }
        showSnackbar('Command copied to clipboard');
      } catch(_){ showSnackbar('Command copied to clipboard'); }
    });
    cmd.setAttribute('role','button');
    cmd.setAttribute('tabindex','0');
    cmd.addEventListener('keydown', function(e){
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        cmd.click();
      }
    });
  });

  var startLinkBtn = document.getElementById('startLinkBtn');
  if (startLinkBtn) startLinkBtn.addEventListener('click', function () {
    try {
      var u = new URL(window.location.href);
      u.searchParams.set('view','content');
      u.searchParams.set('page','telegram');
      u.searchParams.set('tab','setup');
      window.location.href = u.toString();
    } catch(_) { activate('setup'); }
  });
  // CTA button in intro content should also switch to Setup
  document.querySelectorAll('.js-start-link').forEach(function(btn){
    btn.addEventListener('click', function(){ 
      try {
        var u2 = new URL(window.location.href);
        u2.searchParams.set('view','content');
        u2.searchParams.set('page','telegram');
        u2.searchParams.set('tab','setup');
        window.location.href = u2.toString();
      } catch(_) { activate('setup'); }
    });
  });

  // Page routing: telegram vs account using `page` query param
  (function(){
    try {
      var params = new URLSearchParams(window.location.search);
      var page = params.get('page') || 'account';
      // Toggle active class on sidebar items
      try {
        document.querySelectorAll('.menu .menu-item[data-page]').forEach(function(mi){
          var isActive = mi.getAttribute('data-page') === page;
          mi.classList.toggle('active', isActive);
        });
      } catch(_){}
      function showTelegram(){
        if (pageTitle) pageTitle.textContent = 'XREX Pay · Telegram bot';
        if (statusRow) statusRow.style.display = '';
        if (tabs) tabs.style.display = '';
        if (panelAccount) panelAccount.style.display = 'none';
        if (shareBtn) shareBtn.style.display = '';
      }
      function showAccount(){
        if (pageTitle) pageTitle.textContent = 'Account';
        if (statusRow) statusRow.style.display = 'none';
        if (tabs) tabs.style.display = 'none';
        if (panelAccount) panelAccount.style.display = '';
        if (panelIntro) panelIntro.style.display = 'none';
        if (panelSetup) panelSetup.style.display = 'none';
        if (shareBtn) shareBtn.style.display = 'none';
      }
      if (page === 'account') {
        showAccount();
      } else {
        showTelegram();
        // Only allow deep-linking to tabs when viewing Telegram content view
        try {
          var viewParam = params.get('view');
          var isDesk = window.matchMedia('(min-width: 1280px)').matches;
          var tabParam = params.get('tab') || params.get('panel'); // allow either name
          if ((viewParam === 'content' || isDesk) && (tabParam === 'intro' || tabParam === 'setup')) {
            activate(tabParam);
          }
        } catch(_) {}
      }
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

  // Initialize Intro Swiper when intro panel is visible and Swiper is available
  (function initIntroSwiper(){
    try {
      if (typeof Swiper === 'undefined') return; // CDN not loaded
      var container = document.querySelector('.intro-slider.swiper');
      if (!container) return;
      // Avoid duplicate init
      if (container.__swiper_inited) return; 
      container.__swiper_inited = true;
      var isDesktop = window.matchMedia('(min-width: 1280px)');
      var swiper = new Swiper(container, {
        slidesPerView: 'auto',
        spaceBetween: 12,
        loop: false,
        slidesOffsetBefore: 20,
        slidesOffsetAfter: 16,
        grabCursor: true,
        simulateTouch: true,
        mousewheel: { forceToAxis: true, sensitivity: 1, releaseOnEdges: true },
        pagination: { el: container.querySelector('.swiper-pagination'), clickable: true },
        navigation: { nextEl: container.querySelector('.swiper-button-next'), prevEl: container.querySelector('.swiper-button-prev') },
        breakpoints: {
          600: { spaceBetween: 14, slidesOffsetBefore: 16, slidesOffsetAfter: 16 },
          900: { spaceBetween: 16, slidesOffsetBefore: 24, slidesOffsetAfter: 24 },
          1280: { spaceBetween: 20, slidesOffsetBefore: 32, slidesOffsetAfter: 32 }
        },
        // Show arrows on desktop; pagination on mobile
        on: {
          afterInit: function(){ toggleControls(); },
          resize: function(){ toggleControls(); }
        }
      });
      function toggleControls(){
        var isDesk = isDesktop.matches;
        var prev = container.querySelector('.swiper-button-prev');
        var next = container.querySelector('.swiper-button-next');
        var pag  = container.querySelector('.swiper-pagination');
        if (prev && next) {
          prev.style.display = isDesk ? '' : 'none';
          next.style.display = isDesk ? '' : 'none';
        }
        if (pag) {
          pag.style.display = isDesk ? 'none' : '';
        }
      }
    } catch(_) {}
  })();

  // Make menu items navigable via data-link on both mobile and desktop
  document.querySelectorAll('.menu .menu-item[data-link]').forEach(function(item){
    var to = item.getAttribute('data-link');
    if (!to) return;
    function go(){ 
      try {
        // Build relative to the current URL to support subpaths and local files
        var url = new URL(to, window.location.href);
        if ((item.getAttribute('data-page')||'') === 'telegram') {
          if (!url.searchParams.has('tab')) url.searchParams.set('tab','intro');
          if (!url.searchParams.has('view')) url.searchParams.set('view','content');
        }
        window.location.href = url.toString();
      } catch(_) { window.location.href = to; }
    }
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



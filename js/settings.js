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

  // Progress storage (prototype): localStorage only
  var PROGRESS_KEY = 'xrex.progress.v1';
  function nowIso(){ try { return new Date().toISOString(); } catch(_) { return '';} }
  function defaultProgress(){ return { version: 1, state: 1, updatedAt: nowIso(), code: null, history: [] }; }
  function getProgress(){
    try {
      var raw = localStorage.getItem(PROGRESS_KEY);
      if (!raw) return defaultProgress();
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return defaultProgress();
      if (!obj.state) obj.state = 1;
      return obj;
    } catch(_) { return defaultProgress(); }
  }
  function saveProgress(next){
    try {
      var prev = getProgress();
      var merged = Object.assign({}, prev, next, { updatedAt: nowIso() });
      merged.history = (prev.history || []).concat([{ state: merged.state, at: merged.updatedAt }]);
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(merged));
      return merged;
    } catch(_) { return next; }
  }
  function setState(newState){
    var s = Math.max(1, Math.min(5, Number(newState)||1));
    // generate a code on entering state 3 if missing
    var p = getProgress();
    if (s === 3 && !p.code) {
      try { p.code = Math.random().toString(36).slice(2, 8).toUpperCase(); } catch(_) {}
    }
    return saveProgress({ state: s, code: p.code || null });
  }

  // Ensure a step has a .step-row.step-content; create if missing (prototype-only)
  function ensureContentRow(stepEl){
    var row = stepEl.querySelector('.step-row.step-content');
    if (row) return row;
    try {
      var titleRow = stepEl.querySelector('.step-row.step-title');
      var created = document.createElement('div');
      created.className = 'step-row step-content';
      created.setAttribute('data-auto-content-row','1');
      var rail = document.createElement('div');
      rail.className = 'track-wrapper';
      var track = document.createElement('div');
      track.className = 'track';
      rail.appendChild(track);
      var cw = document.createElement('div');
      cw.className = 'content-wrapper';
      created.appendChild(rail);
      created.appendChild(cw);
      if (titleRow && titleRow.insertAdjacentElement) {
        titleRow.insertAdjacentElement('afterend', created);
      } else {
        stepEl.appendChild(created);
      }
      return created;
    } catch(_) { return null; }
  }

  // Apply progress to the timeline (no UI text changes yet; class toggles only)
  function applyTimelineFromProgress(){
    try {
      var p = getProgress();
      var steps = document.querySelectorAll('.timeline-steps .step');
      if (!steps || !steps.length) return;
      var activeIdx = Math.max(0, Math.min(steps.length - 1, (p.state|0) - 1));
      steps.forEach(function(stepEl, idx){
        var isActive = idx === activeIdx;
        var isCompleted = idx < activeIdx; // everything before active is completed
        stepEl.classList.toggle('is-active', isActive);
        stepEl.classList.toggle('is-muted', idx > activeIdx);
        stepEl.classList.toggle('is-completed', isCompleted);
        // Add datestamp for completed steps if missing
        if (isCompleted) {
          var contentRow = ensureContentRow(stepEl);
          var wrapper = contentRow ? contentRow.querySelector('.content-wrapper') : stepEl.querySelector('.step-row.step-title .content-wrapper');
          if (wrapper && !wrapper.querySelector('.step-datestamp')) {
            var stamp = document.createElement('div');
            stamp.className = 'step-datestamp';
            try {
              var d = new Date(getProgress().updatedAt);
              var pad = function(n){ return String(n).padStart(2,'0'); };
              var text = pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())+', '+pad(d.getMonth()+1)+'/'+pad(d.getDate())+'/'+d.getFullYear();
              stamp.textContent = text;
            } catch(_) { stamp.textContent = ''; }
            wrapper.appendChild(stamp);
          }
        } else {
          // If step is no longer completed, ensure datestamp is removed and hidden items visible
          var contentRow2 = stepEl.querySelector('.step-row.step-content');
          if (contentRow2) {
            var ds = contentRow2.querySelector('.content-wrapper .step-datestamp');
            if (ds && ds.parentElement) ds.parentElement.removeChild(ds);
            // remove auto-created content row if empty
            if (contentRow2.getAttribute('data-auto-content-row') === '1') {
              var cw2 = contentRow2.querySelector('.content-wrapper');
              if (cw2 && cw2.children.length === 0) {
                contentRow2.parentElement && contentRow2.parentElement.removeChild(contentRow2);
              }
            }
          }
        }
      });
    } catch(_) {}
  }

  // Tiny admin tool to override state (fixed bottom-left)
  function mountAdminStateTool(){
    try {
      var params = new URLSearchParams(window.location.search);
      var page = params.get('page') || 'account';
      // Only show on Telegram page to avoid clutter
      if (page !== 'telegram') return;
      var tool = document.createElement('div');
      tool.id = 'adminStateTool';
      tool.style.position = 'fixed';
      tool.style.left = '16px';
      tool.style.bottom = '16px';
      tool.style.zIndex = '1201';
      tool.style.background = '#111827CC';
      tool.style.color = '#fff';
      tool.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      tool.style.fontSize = '12px';
      tool.style.padding = '10px 12px';
      tool.style.borderRadius = '10px';
      tool.style.boxShadow = '0 8px 18px rgba(0,0,0,0.35)';
      tool.style.display = 'flex';
      tool.style.alignItems = 'center';
      tool.style.gap = '8px';
      tool.setAttribute('role','group');
      var label = document.createElement('span');
      label.textContent = 'State:';
      var val = document.createElement('strong');
      val.id = 'adminStateValue';
      val.style.minWidth = '12px';
      val.style.textAlign = 'center';
      var btnDown = document.createElement('button');
      btnDown.type = 'button';
      btnDown.textContent = '−';
      btnDown.style.cssText = 'background:#fff;color:#111;border:0;border-radius:6px;padding:2px 8px;cursor:pointer;font-weight:700;';
      var btnUp = document.createElement('button');
      btnUp.type = 'button';
      btnUp.textContent = '+';
      btnUp.style.cssText = btnDown.style.cssText;
      function update(){ val.textContent = String(getProgress().state); applyTimelineFromProgress(); }
      btnDown.addEventListener('click', function(){ var s = getProgress().state; setState(Math.max(1, s-1)); update(); });
      btnUp.addEventListener('click', function(){ var s = getProgress().state; setState(Math.min(5, s+1)); update(); });
      tool.appendChild(label); tool.appendChild(val); tool.appendChild(btnDown); tool.appendChild(btnUp);
      document.body.appendChild(tool);
      update();
    } catch(_) {}
  }

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
        // Apply progress-driven timeline and mount admin tool on Telegram page
        applyTimelineFromProgress();
        mountAdminStateTool();
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



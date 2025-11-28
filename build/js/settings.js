// moved from assets/js/settings.js
(function () {
  // Global iOS double-tap and gesture zoom guard (entire page)
  try {
    if (!window.__ios_zoom_guard_all__) {
      var __lastTouchAll = 0;
      document.addEventListener('touchend', function(e){
        try {
          var now = Date.now();
          if ((now - __lastTouchAll) < 300 && e && e.cancelable) e.preventDefault();
          __lastTouchAll = now;
        } catch(_) {}
      }, { passive: false });
      ['gesturestart','gesturechange','gestureend'].forEach(function(evt){
        document.addEventListener(evt, function(e){ try { if (e && e.cancelable) e.preventDefault(); } catch(_) {} }, { passive: false });
      });
      window.__ios_zoom_guard_all__ = true;
    }
  } catch(_) {}
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
  var botCard = document.getElementById('botCard');

  // Progress storage (prototype): localStorage only
  var PROGRESS_KEY = 'xrex.progress.v1';
  var SESSION_KEY = 'xrex.session.id.v1';
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
  // Session id for isolating bot/web state per visitor
  function getSessionId(){
    try {
      var sid = localStorage.getItem(SESSION_KEY);
      if (sid && /^[A-Za-z0-9_-]{8,64}$/.test(sid)) return sid;
      var rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
      var newId = ('s' + Date.now().toString(36) + rand).slice(0, 24).toUpperCase();
      localStorage.setItem(SESSION_KEY, newId);
      return newId;
    } catch(_) { return 'S' + String(Date.now()); }
  }
  function saveProgress(next){
    try {
      var prev = getProgress();
      var merged = Object.assign({}, prev, next, { updatedAt: nowIso() });
      merged.history = (prev.history || []).concat([{ state: merged.state, at: merged.updatedAt }]);
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(merged));
      // No client-side remote write; bot will push to server.
      return merged;
    } catch(_) { return next; }
  }
  function setState(newState){
    var s = Math.max(1, Math.min(7, Number(newState)||1));
    // generate a code on entering state 3 if missing
    var p = getProgress();
    // Do not generate client-side codes; codes come from the bot via server
    if (s <= 3) { try { p.code = null; } catch(_) {} }
    // Only start the 5-minute window from the explicit Generate Link action (not on generic setState)
    var prev = (p.state|0);
    // Clear the window after leaving states 3/4 to any other state
    var leavingWindow = (prev === 3 || prev === 4) && (s !== 3 && s !== 4);
    if (leavingWindow) {
      try { delete p.expiresAtMs; } catch(_) {}
    }
    return saveProgress({ state: s, code: p.code || null, expiresAtMs: p.expiresAtMs || null });
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

  // Illustration helpers for active timeline step
  function mountActiveIllustrations(stepEl){
    try {
      if (!stepEl || !(stepEl.classList && stepEl.classList.contains('step'))) return;
      // If already mounted, just update visibility
      var flex = stepEl.querySelector('.step-flex');
      if (!flex) {
        // Capture original children first
        var original = Array.prototype.slice.call(stepEl.children);
        // Create container and wrapper
        flex = document.createElement('div');
        flex.className = 'step-flex';
        var wrap = document.createElement('div');
        wrap.className = 'step-wrapper';
        var ill = document.createElement('div');
        ill.className = 'step-illustration';
        // Build structure
        stepEl.appendChild(flex);
        flex.appendChild(wrap);
        flex.appendChild(ill);
        // Move original rows into wrapper
        original.forEach(function(ch){ wrap.appendChild(ch); });
        // Also add a mobile illustration above label inside the label content-wrapper
        try {
          var labelCw = wrap.querySelector('.step-row.step-label .content-wrapper');
          if (labelCw && !labelCw.querySelector('.step-illustration-mobile')) {
            var illm = document.createElement('div');
            illm.className = 'step-illustration-mobile';
            labelCw.insertBefore(illm, labelCw.firstChild);
          }
        } catch(_) {}
      }
      updateActiveIllustrationVisibility(stepEl);
    } catch(_) {}
  }

  function unmountActiveIllustrations(stepEl){
    try {
      if (!stepEl) return;
      var flex = stepEl.querySelector('.step-flex');
      if (flex) {
        var wrap = flex.querySelector('.step-wrapper');
        if (wrap) {
          var items = Array.prototype.slice.call(wrap.children);
          items.forEach(function(ch){ stepEl.appendChild(ch); });
        }
        flex.remove();
      }
      // remove mobile illustration if present
      try {
        var illm = stepEl.querySelector('.step-row.step-label .content-wrapper .step-illustration-mobile');
        if (illm && illm.parentElement) illm.parentElement.removeChild(illm);
      } catch(_) {}
    } catch(_) {}
  }

  function updateActiveIllustrationVisibility(stepEl){
    try {
      var isDesktop = window.matchMedia('(min-width: 1280px)').matches;
      var ill = stepEl.querySelector('.step-illustration');
      var illm = stepEl.querySelector('.step-illustration-mobile');
      if (ill) ill.style.display = isDesktop ? 'block' : 'none';
      if (illm) illm.style.display = isDesktop ? 'none' : '';
      // Assign illustration by active step + context
      var steps = Array.prototype.slice.call(document.querySelectorAll('.timeline-steps .step'));
      var index = steps.indexOf(stepEl);
      var deskEl = ill;
      var mobEl = illm;
      function setIll(el, cls){ if (!el) return; el.classList.remove('ill-1','ill-2a','ill-2b','ill-3'); el.classList.add(cls); }
      // Map: step 0 -> ill-1; step 1 -> ill-2a/2b depending on pane; step 3 -> ill-3
      if (index === 0) {
        setIll(deskEl, 'ill-1'); setIll(mobEl, 'ill-1');
      } else if (index === 1) {
        var container = document.getElementById('step-initiate-bot');
        var activePane = (container && container.querySelector('.ib-pane.is-active'));
        var isQr = !!(activePane && activePane.classList.contains('ib-pane-qr'));
        var cls = isQr ? 'ill-2a' : 'ill-2b';
        setIll(deskEl, cls); setIll(mobEl, cls);
      } else if (index === 3) {
        setIll(deskEl, 'ill-3'); setIll(mobEl, 'ill-3');
      } else {
        // default to first illustration
        setIll(deskEl, 'ill-1'); setIll(mobEl, 'ill-1');
      }
    } catch(_) {}
  }

  // Apply progress to the timeline (no UI text changes yet; class toggles only)
  function applyTimelineFromProgress(){
    try {
      var p = getProgress();
      var steps = document.querySelectorAll('.timeline-steps .step');
      if (!steps || !steps.length) return;
      // New rule: the active timeline element is the previous step of the db state
      // e.g., state 1 -> active 0, state 2 -> active 0, state 3 -> active 1, etc.
      var s = (p.state|0);
      var lastIdx = steps.length - 1;
      var activeIdx = Math.max(0, Math.min(lastIdx, s - 2));
      // Special-case: for db state 4 and 5, focus the Verify Code step (index 3)
      if (s === 4 || s === 5) activeIdx = Math.min(lastIdx, 3);
      // Special-case:
      // - for state >=6 and !=7, everything completed, no active step
      // - for state 7 (unlinked), keep first step as active like state 2
      if (s >= 6 && s !== 7) activeIdx = -1;
      if (s === 7) activeIdx = 0;
      steps.forEach(function(stepEl, idx){
        var isActive = activeIdx >= 0 && idx === activeIdx;
        // At state 7 we should mirror state 2 (no completed steps)
        var isCompleted = (s >= 6 && s !== 7) ? true : idx < activeIdx;
        stepEl.classList.toggle('is-active', isActive);
        stepEl.classList.toggle('is-muted', activeIdx >= 0 ? idx > activeIdx : false);
        stepEl.classList.toggle('is-completed', isCompleted);
        // Manage illustration wrappers for the active step only
        try {
          if (isActive) {
            mountActiveIllustrations(stepEl);
          } else {
            unmountActiveIllustrations(stepEl);
          }
        } catch(_) {}
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
      // Update visibility based on viewport
      try {
        var activeStep = document.querySelector('.timeline-steps .step.is-active');
        if (activeStep) updateActiveIllustrationVisibility(activeStep);
        // Re-evaluate on viewport change
        if (!window.__ill_mq) {
          window.__ill_mq = window.matchMedia('(min-width: 1280px)');
          window.__ill_mq.addEventListener('change', function(){
            try {
              var as = document.querySelector('.timeline-steps .step.is-active');
              if (as) updateActiveIllustrationVisibility(as);
            } catch(_) {}
          });
        }
      } catch(_) {}

      // Update first step wording (always the same copy regardless of state)
      updateFirstStepText(p.state|0);
      // Toggle timeline layout: hide aside until state >= 6 (also compact for state 7)
      try {
        var timeline = document.querySelector('.timeline');
        if (timeline) {
          timeline.classList.toggle('is-compact', (p.state|0) < 6 || (p.state|0) === 7);
          timeline.classList.toggle('is-linked', (p.state|0) >= 6);
        }
      } catch(_) {}
    } catch(_) {}
  }

  // Sync the Account panel's authenticator UI with current state
  function syncAuthenticatorUI(){
    try {
      var p2 = getProgress();
      var acct = document.getElementById('panel-account');
      if (!acct) return;
      var stateEl = acct.querySelector('.auth-state');
      var toggle = acct.querySelector('.input-card.input-card-split label.switch input[type="checkbox"]');
      var enabled = (p2.state|0) >= 2;
      if (stateEl) {
        stateEl.textContent = enabled ? 'Enabled' : 'Disabled';
        stateEl.classList.toggle('enabled', enabled);
        stateEl.classList.toggle('disabled', !enabled);
      }
      if (toggle) {
        toggle.checked = enabled;
        toggle.disabled = true; // prevent user toggle
        toggle.setAttribute('aria-disabled','true');
      }
    } catch(_) {}
  }

  // Helper: refresh timeline and admin tool display
  function refreshStateUI(){
    try {
      applyTimelineFromProgress();
      var val = document.getElementById('adminStateValue');
      if (val) val.textContent = String(getProgress().state);
      // Intro info banner: always visible; hide 2FA requirement note only at state 2
      try {
        var banner = document.getElementById('introInfoBanner');
        var btn = document.getElementById('iibSetup2faBtn');
        var req = document.getElementById('iibReq');
        if (banner) {
          var s = (getProgress().state|0);
          banner.hidden = false;
          banner.setAttribute('aria-hidden','false');
          if (req) {
            // Show requirement only in state 1; hide for >=2 (including 6 and 7)
            var hideReq = (s >= 2);
            req.style.display = hideReq ? 'none' : '';
          }
          // Adjust bullet for the bot handle line based on state
          try {
            var line = banner.querySelector('.iib-line');
            if (line) {
              var strong = line.querySelector('strong');
              var strongHtml = strong ? strong.outerHTML : '';
              if (s >= 2) {
                line.innerHTML = 'Always make sure you’re interacting with our verified Telegram bot ' + strongHtml;
              } else {
                line.innerHTML = '• Always make sure you’re interacting with our verified Telegram bot ' + strongHtml;
              }
            }
          } catch(_) {}
          if (btn && !btn.__wired) { btn.__wired = true; btn.addEventListener('click', function(e){ e.preventDefault(); openRequire2faModal(); }); }
        }
      } catch(_) {}
      // Sync Account panel authenticator UI with state
      syncAuthenticatorUI();
      // Sync the Status row visual state
      try { updateStatusRowUI(); } catch(_) {}
      // Keep the bot-card CTA visibility in sync with current state/tab
      try { updateBotCardCtaVisibility(); } catch(_) {}
      // Toggle linked account section (and connector) when state is 6
      try {
        var linked = document.getElementById('linkedAccountSection');
        var connector = document.querySelector('.bot-row-divider');
        var actions = document.querySelector('.la-actions');
        var botRow = document.querySelector('.bot-row');
        if (linked || actions) {
          var st = (getProgress().state|0);
          var show = (st === 6);
          try {
            var params = new URLSearchParams(window.location.search);
            var pageParam = params.get('page') || '';
            if (String(pageParam).toLowerCase() === 'account') {
              show = false;
            }
          } catch(_) {}
          // When hidden, also clear any previous values to avoid stale UI on fast-forward
          if (!show) {
            try {
              var nameEl0 = linked.querySelector('.la-name');
              var userEl0 = linked.querySelector('.la-username');
              var avatarImg0 = linked.querySelector('.la-avatar .la-avatar-img');
              var avatarPhImg0 = linked.querySelector('.la-avatar .la-avatar-phimg');
              if (nameEl0) nameEl0.textContent = '--';
              if (userEl0) { userEl0.textContent = '--'; userEl0.hidden = false; }
              if (avatarPhImg0) avatarPhImg0.hidden = false;
              if (avatarImg0) { try { avatarImg0.removeAttribute('src'); } catch(_){} avatarImg0.hidden = true; }
            } catch(_) {}
          }
          if (linked) {
            linked.hidden = !show;
            linked.setAttribute('aria-hidden', show ? 'false' : 'true');
          }
          if (connector) {
            connector.style.display = show ? '' : 'none';
          }
          if (actions) {
            var btnUnlink = document.getElementById('laUnlinkBtn');
            var btnTest = document.getElementById('laSendTest');
            var btnGo = document.getElementById('laGoToBot');
            var btnGoDesktop = document.getElementById('laGoToBotDesktop');
            if (st === 6) {
              if (btnUnlink) btnUnlink.style.display = 'inline-flex';
              if (btnTest) btnTest.style.display = 'inline-flex';
              if (btnGo) btnGo.style.display = 'none';
              if (btnGoDesktop) btnGoDesktop.style.display = 'inline-flex';
            } else {
              if (btnUnlink) btnUnlink.style.display = 'none';
              if (btnTest) btnTest.style.display = 'none';
              if (btnGo) btnGo.style.display = 'inline-flex';
              if (btnGoDesktop) btnGoDesktop.style.display = 'none';
            }
          }
          // Toggle a helper class on bot-row so CSS can hide bot-card-right on desktop
          if (botRow) {
            botRow.classList.toggle('bot-row--linked', st === 6 && show);
          }
          if (show) {
            var v = linked.querySelector('#linkedTgValue');
            // Fetch latest session state to fill profile fields when linked (no single-load cache; avatar may arrive later)
            try {
              var sid = (function(){ try { return localStorage.getItem('xrex.session.id.v1'); } catch(_) { return null; } })();
              var syncBase = (function(){ try { return (new URLSearchParams(window.location.search).get('sync')) || (typeof window !== 'undefined' && window.XREX_SYNC_URL) || '/api/state'; } catch(_) { return '/api/state'; } })();
              if (sid) {
                var url = syncBase + (syncBase.indexOf('?') === -1 ? '?session=' + encodeURIComponent(sid) : '&session=' + encodeURIComponent(sid));
                fetch(url, { method: 'GET' })
                  .then(function(r){ return r.ok ? r.json() : {}; })
                  .then(function(d){
                    try {
                      var nameEl = linked.querySelector('.la-name');
                      var userEl = linked.querySelector('.la-username');
                      var avatarImg = linked.querySelector('.la-avatar .la-avatar-img');
                      var avatarPhImg = linked.querySelector('.la-avatar .la-avatar-phimg');
                      var tgIdEl = v;
                      var dname = (d && d.tg_display_name) ? String(d.tg_display_name) : '';
                      var uname = (d && d.tg_username) ? String(d.tg_username) : '';
                      var photo = (d && d.tg_photo_url) ? String(d.tg_photo_url) : '';
                      var tgId = (d && d.actor_tg_user_id) ? String(d.actor_tg_user_id) : '';
                      // Fallbacks:
                      // - Display name: "Telegram user" when not provided
                      // - Username (@handle): "--" when not provided
                      if (nameEl) nameEl.textContent = dname || 'Telegram user';
                      if (userEl) {
                        if (uname) { userEl.textContent = '@' + uname; userEl.hidden = false; }
                        else { userEl.textContent = '- -'; userEl.hidden = false; }
                      }
                      if (tgIdEl) tgIdEl.textContent = 'Telegram ID: ' + (tgId || '736135332');
                      if (avatarImg) {
                        if (photo) {
                          avatarImg.hidden = true;
                          try {
                            avatarImg.onload = function() {
                              try { if (avatarPhImg) avatarPhImg.hidden = true; } catch(_){ }
                              avatarImg.hidden = false;
                            };
                            avatarImg.onerror = function(){
                              try { if (avatarPhImg) avatarPhImg.hidden = false; } catch(_){ }
                              avatarImg.hidden = true;
                            };
                          } catch(_){ }
                          avatarImg.src = photo;
                        } else {
                          if (avatarPhImg) avatarPhImg.hidden = false;
                          avatarImg.hidden = true;
                          // Retry a few times; avatar upload may complete slightly after we first render
                          var key = '__avatarRetry';
                          var tries = (linked[key] | 0);
                          if (tries < 3) {
                            linked[key] = tries + 1;
                            setTimeout(function(){ try { /* trigger a refresh */ refreshStateUI(); } catch(_) {} }, 1200);
                          }
                        }
                      }
                    } catch(_) {}
                  })
                  .catch(function(){ /* ignore */ });
              }
            } catch(_) {}
            // wire actions
            var send = document.getElementById('laSendTest');
            if (send && !send.__wired) {
              send.__wired = true;
              send.addEventListener('click', function(e){
                e.preventDefault();
                try {
                  var sid = (function(){ try { return localStorage.getItem('xrex.session.id.v1'); } catch(_) { return null; } })();
                  var sync = (function(){ try { return (new URLSearchParams(window.location.search).get('sync')) || (typeof window !== 'undefined' && window.XREX_SYNC_URL) || '/api/state'; } catch(_) { return '/api/state'; } })();
                  if (!sid || !sync) { try { if (typeof showSnackbar === 'function') showSnackbar('Could not trigger test message'); } catch(_) {} return; }
                  var url = sync + (sync.indexOf('?') === -1 ? '?session=' + encodeURIComponent(sid) : '&session=' + encodeURIComponent(sid));
                  fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Client-Stage': '6' }, body: JSON.stringify({ test_message: true }) })
                    .then(function(r){ if (!r.ok) throw new Error('bad status'); return r.json().catch(function(){ return {}; }); })
                    .then(function(body){
                      try {
                        if (body && body.ok) { if (typeof showSnackbar === 'function') showSnackbar('Test message sent to linked account!'); }
                        else { if (typeof showSnackbar === 'function') showSnackbar('Failed to send test message'); }
                      } catch(_) {}
                    })
                    .catch(function(){ try { if (typeof showSnackbar === 'function') showSnackbar('Failed to send test message'); } catch(_) {} });
                } catch(_) { try { if (typeof showSnackbar === 'function') showSnackbar('Failed to send test message'); } catch(__) {} }
              });
            }
            var unb = document.getElementById('laUnlinkBtn');
            if (unb && !unb.__wired) { unb.__wired = true; unb.addEventListener('click', function(e){ e.preventDefault(); if (window.__openUnlinkModal) window.__openUnlinkModal(); }); }
          }
        }
      } catch(_) {}
      // Sync Start/Go-to-bot CTA depending on state
      try { updateTopCta(); } catch(_) {}
      // Sync inline Introduction CTA label
      try { updateInlineIntroCta(); } catch(_) {}
      // If state is 1, and we're on Telegram Setup tab, force switch to Intro
      try {
        var p = getProgress();
        if ((p.state|0) === 1) {
          var params = new URLSearchParams(window.location.search);
          var page = params.get('page') || '';
          var tabParam = params.get('tab') || '';
          var isSetupActive = tabSetup && tabSetup.classList.contains('active');
          if (page === 'telegram' && (tabParam === 'setup' || isSetupActive)) {
            activate('intro');
            params.set('tab','intro');
            window.history.replaceState({}, '', window.location.pathname + '?' + params.toString());
          }
        }
      } catch(_) {}
      // If we are at state 5, always show loading modal for 2s then advance to 6
      try {
        var p = getProgress();
        // If user is not yet linked (<=4), clear one-time finalize guard so a new flow can finalize to 6 again
        try { if (p && (p.state|0) <= 4) { window.__xrex_finalized_6 = false; } } catch(_) {}
        var lm = document.getElementById('loadingModal');
        if (p && p.state === 5) {
          // Prefill verify code input with the actual server-provided code
          try {
            var vcInput = document.getElementById('vcCodeInput');
            var codeNow = '';
            try { codeNow = String((getProgress().code||'')).toUpperCase(); } catch(_) { codeNow = ''; }
            if (vcInput) vcInput.value = codeNow;
            // ensure submit enabled only when we have a real code
            var vcBtn = document.getElementById('vcSubmitBtn');
            if (vcBtn) vcBtn.disabled = !(codeNow && codeNow.length > 0);
            var vcError = document.getElementById('vcError');
            if (vcError) vcError.hidden = true;
          } catch(_) {}
          if (lm) { lm.hidden = false; lm.setAttribute('aria-hidden','false'); }
          if (window.__loading_timer) { clearTimeout(window.__loading_timer); }
          window.__loading_timer = setTimeout(function(){
            if (lm) { lm.setAttribute('aria-hidden','true'); lm.hidden = true; }
            // Show success message as part of state 5 completion
            try { if (typeof showSnackbar === 'function') showSnackbar('Telegram Bot successfully linked to your XREX Pay account'); } catch(_) {}
            window.__loading_timer = null;
            setState(6);
            applyTimelineFromProgress();
            try { updateStatusRowUI(); } catch(_) {}
            try { updateTopCta(); } catch(_) {}
            try { updateInlineIntroCta(); } catch(_) {}
            // Make sure linked account section mounts immediately
            try { refreshStateUI(); } catch(_) {}
            var val2 = document.getElementById('adminStateValue');
            if (val2) val2.textContent = String(getProgress().state);
            // Finalize server state to 6 so the bot can see success immediately
            try {
              if (!window.__xrex_finalized_6) {
                var sidF = (function(){ try { return localStorage.getItem('xrex.session.id.v1'); } catch(_) { return null; } })();
                var syncF = (function(){ try { return (new URLSearchParams(window.location.search).get('sync')) || (typeof window !== 'undefined' && window.XREX_SYNC_URL) || '/api/state'; } catch(_) { return '/api/state'; } })();
                if (sidF) {
                  var finUrl = syncF + (syncF.indexOf('?') === -1 ? '?session=' + encodeURIComponent(sidF) : '&session=' + encodeURIComponent(sidF));
                  fetch(finUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Client-Stage': '6' }, body: JSON.stringify({ stage: 6 }) }).catch(function(){});
                  window.__xrex_finalized_6 = true;
                }
              }
            } catch(_) {}
          }, 2000);
        } else {
          // ensure loader is hidden when not in state 5
          if (window.__loading_timer) { clearTimeout(window.__loading_timer); window.__loading_timer = null; }
          if (lm) { lm.setAttribute('aria-hidden','true'); lm.hidden = true; }
          // If at state 4 (e.g., via admin tool), clear verify input and hide error
          if (p && p.state === 4) {
            // Clear one-time finalize guard upon re-entering state 4
            try { window.__xrex_finalized_6 = false; } catch(_) {}
            try {
              var vcInput2 = document.getElementById('vcCodeInput');
              if (vcInput2) {
                vcInput2.value = '';
                // Focus and select for immediate typing
                vcInput2.focus();
                if (vcInput2.select) vcInput2.select();
              }
              var vcError2 = document.getElementById('vcError');
              if (vcError2) vcError2.hidden = true;
              // Re-apply disabled state to submit when input cleared programmatically
              var vcBtn2 = document.getElementById('vcSubmitBtn');
              if (vcBtn2) vcBtn2.disabled = true;
            } catch(_) {}
          }
        }
      } catch(_) {}
      // Update/mount countdown after status/timeline updates
      try { mountSessionCountdown(); } catch(_) {}

      // When entering state 3 (Initiate Bot), reset the switch to default once per entry
      try {
        var sNow = (getProgress().state|0);
        var cont = document.getElementById('step-initiate-bot');
        if (cont) {
          if (sNow === 3) {
            var mark = cont.getAttribute('data-reset-for');
            if (mark !== '3') { resetInitiateBotDefault(); cont.setAttribute('data-reset-for','3'); }
          } else {
            if (cont.hasAttribute('data-reset-for')) cont.removeAttribute('data-reset-for');
          }
        }
      } catch(_) {}
    } catch(_) {}
  }

  // Update the Status row (top of Telegram page) based on progress state
  function updateStatusRowUI(){
    try {
      var row = document.getElementById('statusRow');
      if (!row) return;
      var p = getProgress();
      var s = (p.state|0);
      var statusValue = row.querySelector('.status-value');
      var statusIcon = row.querySelector('#statusInfoIcon');
      var infoBtn = row.querySelector('#statusInfoBtn');
      var tip = row.querySelector('#statusTip');
      // Ensure a subline wrapper exists for meta + unlink (breaks to next line on mobile)
      var sub = row.querySelector('.status-subline');
      if (!sub) {
        sub = document.createElement('span');
        sub.className = 'status-subline';
        var tipWrap = row.querySelector('.status-tip-wrap');
        var line = row.querySelector('.status-line');
        if (tipWrap && tipWrap.parentElement) {
          tipWrap.parentElement.insertBefore(sub, tipWrap.nextSibling);
        } else if (line) {
          line.appendChild(sub);
        }
      }
      // Ensure meta container exists (date)
      var meta = row.querySelector('.status-meta');
      if (!meta) {
        meta = document.createElement('span');
        meta.className = 'status-meta';
        sub.appendChild(meta);
      }
      // Remove legacy inline unlink; we'll use the card action instead
      var unlink = row.querySelector('.status-unlink');
      if (unlink && unlink.parentElement) unlink.parentElement.removeChild(unlink);
      // Hide any legacy inline countdown badge; floating tool will be used instead
      var countdown = row.querySelector('.status-countdown');
      if (countdown) countdown.style.display = 'none';
      // Wire unlink click to open the unlink modal (once)
      try {
        if (unlink && !unlink.__wired) {
          unlink.__wired = true;
          unlink.addEventListener('click', function(e){
            e.preventDefault();
            if (window.__openUnlinkModal) window.__openUnlinkModal();
          });
        }
      } catch(_) {}

      // Format date from updatedAt (match timeline datestamp: HH:MM:SS, MM/DD/YYYY)
      function formatDate(iso){
        try {
          var d = new Date(iso || '');
          var pad = function(n){ return String(n).padStart(2,'0'); };
          var hh = pad(d.getHours());
          var mm = pad(d.getMinutes());
          var mo = pad(d.getMonth() + 1);
          var da = pad(d.getDate());
          var yr = d.getFullYear();
          // Format without seconds: HH:MM, MM/DD/YYYY
          return hh + ':' + mm + ', ' + mo + '/' + da + '/' + yr;
        } catch(_) { return ''; }
      }

      if (s >= 6 && s !== 7) {
        // Linked visual state
        if (statusValue) {
          statusValue.textContent = 'Linked';
          statusValue.classList.add('linked');
        }
        if (infoBtn) { infoBtn.classList.add('linked'); }
        if (tip) {
          var title = tip.querySelector('.tip-title');
          var body = tip.querySelector('.tip-body');
          if (title) title.textContent = 'Linked';
          if (body) body.textContent = 'Your XREX Pay account is linked to your Telegram account';
        }
        if (statusIcon) statusIcon.src = 'assets/icon_info_linked.svg';
        if (meta) {
          meta.textContent = 'Authorized on ' + formatDate(p.updatedAt);
        }
        // Update linked account card datestamp (state 6)
        try {
          var dateEl = document.getElementById('linkedDateLabel');
          if (dateEl) dateEl.textContent = formatDate(p.updatedAt);
        } catch(_) {}
        // no inline unlink
      } else if (s === 7) {
        // Stage 7: show Not linked visuals (like state 2) but with Unlinked date
        if (statusValue) {
          statusValue.textContent = 'Not linked';
          statusValue.classList.remove('linked');
        }
        if (infoBtn) { infoBtn.classList.remove('linked'); }
        if (tip) {
          var title3 = tip.querySelector('.tip-title');
          var body3 = tip.querySelector('.tip-body');
          if (title3) title3.textContent = 'Not linked to bot';
          if (body3) body3.textContent = 'Link your Telegram account to the bot and access XREX features directly in Telegram';
        }
        if (statusIcon) statusIcon.src = 'assets/icon_info_unlinked.svg';
        if (meta) meta.textContent = 'Unlinked on ' + formatDate(p.updatedAt);
        try {
          var dateEl2 = document.getElementById('linkedDateLabel');
          if (dateEl2) dateEl2.textContent = formatDate(p.updatedAt);
        } catch(_) {}
        // no inline unlink
      } else {
        // Default Not linked visual state
        if (statusValue) {
          statusValue.textContent = 'Not linked';
          statusValue.classList.remove('linked');
        }
        if (infoBtn) { infoBtn.classList.remove('linked'); }
        if (tip) {
          var title2 = tip.querySelector('.tip-title');
          var body2 = tip.querySelector('.tip-body');
          if (title2) title2.textContent = 'Not linked to bot';
          if (body2) body2.textContent = 'Link your Telegram account to the bot and access XREX features directly in Telegram';
        }
        if (statusIcon) statusIcon.src = 'assets/icon_info_unlinked.svg';
        if (meta) meta.textContent = '';
        // no inline unlink
      }
      // Hide bot-card status wrapper once linked (state 6), show otherwise
      try {
        var botStatusWrap = document.getElementById('botCardStatus');
        if (botStatusWrap) {
          if (s >= 6 && s !== 7) {
            botStatusWrap.style.display = 'none';
          } else {
            botStatusWrap.style.display = '';
          }
        }
      } catch(_) {}
    } catch(_) {}
  }

  // Mount/update a tiny countdown while in stage 3/4 using local expiresAtMs
  function mountSessionCountdown(){
    try {
      // Create floating tool near adminStateTool
      var id = 'sessionTimerTool';
      var tool = document.getElementById(id);
      if (!tool) {
        tool = document.createElement('div');
        tool.id = id;
        tool.setAttribute('role','status');
        var label = document.createElement('span');
        label.className = 'label';
        label.textContent = 'Expires in:';
        var val = document.createElement('strong');
        val.id = 'sessionTimerValue';
        tool.appendChild(label);
        tool.appendChild(val);
        document.body.appendChild(tool);
      }
      var valueEl = document.getElementById('sessionTimerValue');
      function fmt(ms){
        var sec = Math.max(0, Math.floor(ms/1000));
        var m = Math.floor(sec/60);
        var s = sec % 60;
        return String(m) + ':' + (s < 10 ? ('0' + s) : String(s));
      }
      function tick(){
        try {
          var p = getProgress();
          var s = (p.state|0);
          var t = Number(p.expiresAtMs||0);
          var now = Date.now();
          var active = (s === 3 || s === 4) && t && t > now;
          if (active) {
            var remain = Math.max(0, t - now);
            if (valueEl) valueEl.textContent = fmt(remain);
            tool.style.display = 'flex';
          } else {
            tool.style.display = 'none';
          }
          if (!active && window.__countdown_timer) {
            clearInterval(window.__countdown_timer);
            window.__countdown_timer = null;
          }
        } catch(_) {}
      }
      if (window.__countdown_timer) { tick(); return; }
      tick();
      window.__countdown_timer = setInterval(tick, 1000);
    } catch(_) {}
  }

  function updateFirstStepText(state){
    try {
      var first = document.querySelector('.timeline-steps .step');
      if (!first) return;
      var labelEl = first.querySelector('.step-row.step-label .label');
      var titleEl = first.querySelector('.step-row.step-title .title');
      var descWrap = first.querySelector('.step-row.step-content .step-desc');
      var btn = first.querySelector('.step-row.step-content .step-actions .btn');
      if (!labelEl || !titleEl || !btn) return;
      // Always show the same wording for step 1 regardless of state
      labelEl.textContent = 'XREX Pay';
      titleEl.textContent = 'Start';
      if (descWrap) {
        descWrap.textContent = 'Generate unique QR code and link';
        descWrap.style.display = '';
        descWrap.removeAttribute('aria-hidden');
      }
      btn.textContent = 'Generate link';
    } catch(_) {}
  }

  // Toggle initiate-bot segmented control (visual only)
  function initInitiateBotUI(){
    try {
      var container = document.getElementById('step-initiate-bot');
      if (!container) return;
      if (container.__wired) return; container.__wired = true;
      // Populate link and copy behavior
      var linkEl = container.querySelector('#ibLink');
      var copyBtn = container.querySelector('#ibCopyBtn');
      var sid = getSessionId();
      var baseToken = 'BOTC1583';
      try {
        var code = (getProgress().code || '').trim();
        if (code) baseToken = 'BOTC158';
      } catch(_) {}
      var token = baseToken + '_s' + sid;
      var url = 'https://t.me/SanneXREX_bot?start=' + token; // used for QR only
      var baseUrl = 'https://t.me/SanneXREX_bot'; // plain bot link for the link button
      try {
        var code2 = (getProgress().code || '').trim();
        // keep same token logic; code presence already captured
      } catch(_) {}
      if (linkEl) {
        linkEl.href = url;
        var textSpan = linkEl.querySelector('.ib-pill-text');
        // ensure accessible label has full URL
        linkEl.setAttribute('aria-label', 'Open Telegram link ' + url);
        if (textSpan) textSpan.textContent = url;
      }
      // Generate QR from the same dynamic link using inline SVG (qrcode-generator)
      try {
        var qrEl = document.getElementById('ibQr');
        if (qrEl && typeof window.qrcode === 'function') {
          var qr = window.qrcode(0, 'L');
          qr.addData(url);
          qr.make();
          var svg = qr.createSvgTag(4, 0);
          // Replace the <img> with SVG for sharper rendering
          var wrap = qrEl.parentElement;
          if (wrap) {
            wrap.innerHTML = svg;
            var svgEl = wrap.querySelector('svg');
            if (svgEl) { svgEl.setAttribute('width', '180'); svgEl.setAttribute('height', '180'); svgEl.setAttribute('aria-label', 'QR to open ' + url); }
          }
        }
      } catch(_) {}

      function copyLink(){
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url);
          if (typeof showSnackbar === 'function') showSnackbar('Link copied to clipboard');
        } catch(_) {}
      }
      if (copyBtn) copyBtn.addEventListener('click', function(e){ e.preventDefault(); copyLink(); });

      // Segmented control behavior
      var seg = container.querySelector('.ib-segment');
      function activatePane(which){
        try {
          container.querySelectorAll('.ib-tab').forEach(function(t){
            var on = t.getAttribute('data-pane') === which;
            t.classList.toggle('is-active', on);
            t.setAttribute('aria-selected', String(on));
          });
          container.querySelectorAll('.ib-pane').forEach(function(p){
            var on2 = p.classList.contains('ib-pane-' + which);
            p.classList.toggle('is-active', on2);
          });
        } catch(_) {}
      }
      if (seg) seg.addEventListener('click', function(e){
        var btn = e.target.closest('.ib-tab');
        if (!btn) return;
        activatePane(btn.getAttribute('data-pane'));
        // Refresh illustration (2a/2b) when switching QR/Link
        try {
          var activeStep = document.querySelector('.timeline-steps .step.is-active');
          if (activeStep) updateActiveIllustrationVisibility(activeStep);
        } catch(_) {}
      });
      // Allow hint links to switch panes
      container.addEventListener('click', function(e){
        var link = e.target.closest('.ib-switch-to');
        if (!link) return;
        e.preventDefault();
        var to = link.getAttribute('data-pane');
        if (to) activatePane(to);
      });
      // On mobile breakpoint, default to link; desktop default to QR
      function syncDefaultPane(){
        var isMobile = !window.matchMedia('(min-width: 1280px)').matches;
        activatePane(isMobile ? 'link' : 'qr');
      }
      syncDefaultPane();
      window.addEventListener('resize', syncDefaultPane);
    } catch(_) {}
  }

  // Reset Initiate Bot switch to breakpoint-specific default
  function resetInitiateBotDefault(){
    try {
      var container = document.getElementById('step-initiate-bot');
      if (!container) return;
      var isMobile = !window.matchMedia('(min-width: 1280px)').matches;
      var target = isMobile ? 'link' : 'qr';
      container.querySelectorAll('.ib-tab').forEach(function(t){ var on=t.getAttribute('data-pane')===target; t.classList.toggle('is-active', on); t.setAttribute('aria-selected', String(on)); });
      container.querySelectorAll('.ib-pane').forEach(function(p){ var on=p.classList.contains('ib-pane-'+target); p.classList.toggle('is-active', on); });
      // Also refresh illustration for the active step
      try { var activeStep = document.querySelector('.timeline-steps .step.is-active'); if (activeStep) updateActiveIllustrationVisibility(activeStep); } catch(_) {}
    } catch(_) {}
  }

  // Verify Code (state 4) interactions
  (function initVerifyCode(){
    try {
      var wrap = document.getElementById('step-verify-code');
      if (!wrap) return;
      var input = document.getElementById('vcCodeInput');
      var submit = document.getElementById('vcSubmitBtn');
      var clearBtn = document.getElementById('vcClearBtn');
      var group = (function(){ try { return document.querySelector('#step-verify-code .vc-input-group'); } catch(_) { return null; } })();
      var errorEl = document.getElementById('vcError');
      var botLink = document.getElementById('vcBotLink');
      if (botLink) {
        var url = 'https://t.me/SanneXREX_bot';
        botLink.href = url;
        try {
          botLink.addEventListener('click', function(e){ e.preventDefault(); openGoToBotModal(); });
        } catch(_) {}
      }
      // Enable/disable submit based on input presence
      if (input && submit) {
        var syncVcBtn = function(){
          try {
            var v = (input.value||'').trim();
            submit.disabled = (v.length < 1);
            if (clearBtn) { clearBtn.classList.toggle('is-visible', v.length > 0); }
            // Clear error styling and message when user edits
            try { if (group) group.classList.remove('is-error'); } catch(_) {}
            try { var err = document.getElementById('vcError'); if (err) err.hidden = true; } catch(_) {}
          } catch(_) {}
        };
        input.addEventListener('input', syncVcBtn);
        syncVcBtn();
      }
      if (clearBtn && input) {
        clearBtn.addEventListener('click', function(e){
          e.preventDefault();
          try {
            input.value = '';
            input.focus();
          } catch(_) {}
          try { if (typeof Event === 'function') input.dispatchEvent(new Event('input', { bubbles: true })); } catch(_) {}
        });
      }

      function handle(){
        try {
          var val = (input && input.value || '').trim().toUpperCase();
          var expected = (function(){ try { return String((getProgress().code||'')).toUpperCase(); } catch(_) { return ''; } })();
          if (expected && val === expected) {
            if (errorEl) errorEl.hidden = true;
            setState(5); refreshStateUI();
          } else {
            if (errorEl) errorEl.hidden = false;
            try { if (group) group.classList.add('is-error'); } catch(_) {}
          }
        } catch(_) {}
      }
      if (submit) submit.addEventListener('click', handle);
      if (input) input.addEventListener('keydown', function(e){ if (e.key === 'Enter') handle(); });
    } catch(_) {}
  })();

  // Modal wiring (prototype)
  (function initModal(){
    try {
      var modal = document.getElementById('modal');
      if (!modal) return;
      var openBtn = document.getElementById('btnEnable2FA');
      var btnClose = document.getElementById('modalClose');
      var btnCancel = document.getElementById('modalCancel');
      var btnConfirm = document.getElementById('modalConfirm');
      var secKeyInput = document.getElementById('secKeyInput');
      var copyKeyBtn = document.getElementById('copyKeyBtn');
      var secKeyField = document.getElementById('secKeyField');
      var authCodeInput = document.getElementById('authCodeInput');
      var authCodeError = document.getElementById('authCodeError');
      var successModal = document.getElementById('successModal');
      var successClose = document.getElementById('successClose');
      var successCta = document.getElementById('successCta');
      // Live enable/disable of confirm button based on input presence
      if (authCodeInput && btnConfirm) {
        var syncConfirmState = function(){
          try {
            var v = (authCodeInput.value||'').trim();
            btnConfirm.disabled = (v.length < 1);
          } catch(_) {}
        };
        authCodeInput.addEventListener('input', syncConfirmState);
        // initialize state on script load
        syncConfirmState();
      }
      function open(){
        modal.hidden = false; modal.setAttribute('aria-hidden','false');
        try {
          var y = window.scrollY || window.pageYOffset || 0;
          document.body.dataset.scrollY = String(y);
          document.body.style.top = '-' + y + 'px';
          document.body.classList.add('modal-locked');
        } catch(_) {}
        // Reset and focus auth code input on open
        try {
          if (authCodeInput) {
            authCodeInput.value = '';
            authCodeInput.focus();
            if (authCodeInput.select) authCodeInput.select();
          }
          if (authCodeError) authCodeError.hidden = true;
          if (btnConfirm) btnConfirm.disabled = true;
        } catch(_) {}
      }
      function close(){
        modal.setAttribute('aria-hidden','true'); modal.hidden = true;
        try {
          var y = parseInt(document.body.dataset.scrollY || '0', 10) || 0;
          document.body.classList.remove('modal-locked');
          document.body.style.top = '';
          delete document.body.dataset.scrollY;
          window.scrollTo(0, y);
        } catch(_) {}
      }
      // Generate a random-looking key and fake QR when opening
      function prime(){
        try {
          var base = Math.random().toString(36).slice(2, 10).toUpperCase() + Math.random().toString(36).slice(2, 10).toUpperCase();
          var key = (base + 'JYJHYGW23').slice(0, 24);
          if (secKeyInput) secKeyInput.value = key;
        } catch(_) {}
      }
      if (openBtn) openBtn.addEventListener('click', function(e){
        try {
          var s = (getProgress().state|0);
          if (s >= 2) {
            // "Generate link" path -> show loader for 1s before moving to state 3
            e.preventDefault();
            try {
              var lm0 = document.getElementById('loadingModal');
              if (lm0) { lm0.hidden = false; lm0.setAttribute('aria-hidden','false'); }
              setTimeout(function(){
                if (lm0) { lm0.setAttribute('aria-hidden','true'); lm0.hidden = true; }
                // Start a fresh 5-minute window only from this action
                try {
                  var p = getProgress();
                  p.expiresAtMs = Date.now() + (5 * 60 * 1000);
                  saveProgress({ state: 3, expiresAtMs: p.expiresAtMs, code: p.code || null });
                } catch(_) { setState(3); }
                refreshStateUI();
                try { if (typeof showSnackbar === 'function') showSnackbar('Unique QR code and link generated successfully'); } catch(_) {}
                // Reset server-side state for a fresh session (clear flags, actors, codes)
                try {
                  var sidG = (function(){ try { return localStorage.getItem('xrex.session.id.v1'); } catch(_) { return null; } })();
                  var syncG = (function(){ try { return (new URLSearchParams(window.location.search).get('sync')) || (typeof window !== 'undefined' && window.XREX_SYNC_URL) || '/api/state'; } catch(_) { return '/api/state'; } })();
                  if (sidG) {
                    var urlG = syncG + (syncG.indexOf('?') === -1 ? '?session=' + encodeURIComponent(sidG) : '&session=' + encodeURIComponent(sidG));
                    try { window.__xrex_reset_guard_until = Date.now() + 3000; } catch(_) {}
                    fetch(urlG, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Admin-Reset': '1' }, body: JSON.stringify({ stage: 3 }) }).catch(function(){});
                  }
                } catch(_) {}
              }, 1000);
            } catch(_) { setState(3); refreshStateUI(); }
            return;
          }
        } catch(_) {}
        prime(); open();
      });
      if (btnClose) btnClose.addEventListener('click', close);
      if (btnCancel) btnCancel.addEventListener('click', close);
      if (btnConfirm) btnConfirm.addEventListener('click', function(){
        // Validate 6-digit code
        try {
          var v = (authCodeInput && authCodeInput.value || '').trim();
          var ok = v.length >= 1; // accept any non-empty input per prototype spec
          if (!ok) {
            if (authCodeError) { authCodeError.hidden = false; }
            if (authCodeInput) authCodeInput.focus();
            return;
          }
        } catch(_) {}
        if (authCodeError) authCodeError.hidden = true;
        // Close 2FA modal, show loader for 1s, then show success confirmation modal
        close();
        try {
          var lm1 = document.getElementById('loadingModal');
          if (lm1) { lm1.hidden = false; lm1.setAttribute('aria-hidden','false'); }
          setTimeout(function(){
            if (lm1) { lm1.setAttribute('aria-hidden','true'); lm1.hidden = true; }
            if (successModal) { successModal.hidden = false; successModal.setAttribute('aria-hidden','false'); }
          }, 1000);
        } catch(_) { if (successModal) { successModal.hidden = false; successModal.setAttribute('aria-hidden','false'); } }
      });
      function finalizeSuccess(){
        // Advance state and refresh UI, hide success modal, then show loader before redirect
        setState(2); refreshStateUI();
        if (successModal) { successModal.setAttribute('aria-hidden','true'); successModal.hidden = true; }
        try {
          var lm = document.getElementById('loadingModal');
          if (lm) { lm.hidden = false; lm.setAttribute('aria-hidden','false'); }
          setTimeout(function(){
            if (lm) { lm.setAttribute('aria-hidden','true'); lm.hidden = true; }
            try { window.location.href = 'login.html'; } catch(_) {}
          }, 1000);
        } catch(_) { try { window.location.href = 'login.html'; } catch(__) {} }
      }
      if (successClose) successClose.addEventListener('click', finalizeSuccess);
      if (successModal) successModal.addEventListener('click', function(e){ if (e.target === successModal) finalizeSuccess(); });
      if (successCta) successCta.addEventListener('click', finalizeSuccess);
      modal.addEventListener('click', function(e){ if (e.target === modal) close(); });
      document.addEventListener('keydown', function(e){ if (e.key === 'Escape') close(); });
      // Copy key and show snackbar
      function copyKey(){
        try {
          var key = (secKeyInput && secKeyInput.value) || '';
          if (key && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(key);
          }
        } catch(_) {}
        try { if (typeof showSnackbar === 'function') showSnackbar('Security key copied'); } catch(_) {}
      }
      if (copyKeyBtn) copyKeyBtn.addEventListener('click', function(e){ e.preventDefault(); copyKey(); });
      if (secKeyField) secKeyField.addEventListener('click', function(){ copyKey(); });
    } catch(_) {}
  })();

  // Tiny admin tool to override state (fixed bottom-left)
  function mountAdminStateTool(){
    try {
      if (document.getElementById('adminStateTool')) return; // already mounted
      var tool = document.createElement('div');
      tool.id = 'adminStateTool';
      tool.style.position = 'fixed';
      tool.style.left = '16px';
      tool.style.bottom = '16px';
      tool.style.zIndex = '1201';
      tool.style.width = '145px';
      tool.style.height = '40px';
      tool.style.background = '#111827CC';
      tool.style.color = '#fff';
      tool.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      tool.style.fontSize = '12px';
      tool.style.padding = '10px 12px';
      tool.style.borderRadius = '10px';

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
      function __setResetGuard(){ try { window.__xrex_reset_guard_until = Date.now() + 3000; } catch(_) {} }
      function update(){ refreshStateUI(); }
      btnDown.addEventListener('click', function(){
        var s = getProgress().state;
        var next = Math.max(1, s-1);
        setState(next); update();
        // Show local snackbar when dropping an active session (>=3) to 2 or lower
        try { if ((s|0) >= 3 && next <= 2 && typeof showSnackbar === 'function') showSnackbar('Session expired'); } catch(_) {}
        // If lowering to <=3, send admin reset to server to clear verification
        try {
          var sid = (function(){ try { return localStorage.getItem('xrex.session.id.v1'); } catch(_) { return null; } })();
          var sync = (function(){ try { return (new URLSearchParams(window.location.search).get('sync')) || (typeof window !== 'undefined' && window.XREX_SYNC_URL) || '/api/state'; } catch(_) { return '/api/state'; } })();
          if (next <= 3 && sid) {
            var url = sync + (sync.indexOf('?') === -1 ? '?session=' + encodeURIComponent(sid) : '&session=' + encodeURIComponent(sid));
            __setResetGuard();
            fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Admin-Reset': '1' }, body: JSON.stringify({ stage: next }) }).catch(function(){});
          }
        } catch(_) {}
      });
      btnUp.addEventListener('click', function(){
        var s = getProgress().state;
        var next = Math.min(7, s+1);
        if ((s === 2 || s === 7) && next === 3) {
          // Mimic "Generate link": start a fresh 5-minute window
          try {
            var p = getProgress();
            p.expiresAtMs = Date.now() + (5 * 60 * 1000);
            saveProgress({ state: 3, expiresAtMs: p.expiresAtMs, code: p.code || null });
          } catch(_) { setState(next); }
          // Also reset server-side state cleanly when jumping to 3 via admin tool
          try {
            var sidA = (function(){ try { return localStorage.getItem('xrex.session.id.v1'); } catch(_) { return null; } })();
            var syncA = (function(){ try { return (new URLSearchParams(window.location.search).get('sync')) || (typeof window !== 'undefined' && window.XREX_SYNC_URL) || '/api/state'; } catch(_) { return '/api/state'; } })();
            if (sidA) {
              var urlA = syncA + (syncA.indexOf('?') === -1 ? '?session=' + encodeURIComponent(sidA) : '&session=' + encodeURIComponent(sidA));
              __setResetGuard();
              fetch(urlA, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Admin-Reset': '1' }, body: JSON.stringify({ stage: 3 }) }).catch(function(){});
            }
          } catch(_) {}
          update();
          return;
        }
        setState(next);
        update();
      });
      tool.appendChild(label); tool.appendChild(val); tool.appendChild(btnDown); tool.appendChild(btnUp);
      document.body.appendChild(tool);
      update();
      // iOS double-tap/gesture zoom guard scoped to adminStateTool only
      try {
        if (!tool.__preventZoomWired) {
          var __lastTouch_ts = 0;
          tool.addEventListener('touchend', function(e){
            try {
              var now = Date.now();
              if ((now - __lastTouch_ts) < 300 && e && e.cancelable) e.preventDefault();
              __lastTouch_ts = now;
            } catch(_) {}
          }, { passive: false });
          ['gesturestart','gesturechange','gestureend'].forEach(function(evt){
            tool.addEventListener(evt, function(e){ try { if (e && e.cancelable) e.preventDefault(); } catch(_) {} }, { passive: false });
          });
          tool.__preventZoomWired = true;
        }
      } catch(_) {}
    } catch(_) {}
  }

  // Helper to open 2FA modal via the existing button wiring
  function openTwoFaModal(scrollToTop){
    try {
      var openBtn = document.getElementById('btnEnable2FA');
      if (openBtn) openBtn.click();
      else if (typeof showSnackbar === 'function') showSnackbar('Two-factor authentication is required');
      // After opening, ensure the 2FA modal content is scrolled to the top with no animation
      setTimeout(function(){
        try {
          var big = document.getElementById('modal');
          if (big) {
            var content = big.querySelector('.modal-content');
            if (content) { content.scrollTop = 0; }
          }
        } catch(_) {}
      }, 0);
    } catch(_) {}
  }

  // Helper: unlock body scroll if no modal is currently open
  function unlockModalScrollIfNoOpen(){
    try {
      var anotherOpen = document.querySelector('.modal[aria-hidden="false"]');
      if (!anotherOpen) {
        var y = parseInt(document.body.dataset.scrollY || '0', 10) || 0;
        document.body.classList.remove('modal-locked');
        document.body.style.top = '';
        delete document.body.dataset.scrollY;
        window.scrollTo(0, y);
      }
    } catch(_) {}
  }

  // Lightweight small modal to prompt enabling 2FA (state 1 gate)
  (function initRequire2faModal(){
    try {
      var modal = document.getElementById('require2faModal');
      if (!modal) return;
      var btnCancel = document.getElementById('require2faCancel');
      var btnConfirm = document.getElementById('require2faConfirm');
      var btnClose = document.getElementById('require2faClose');
      function open(){
        try {
          modal.hidden = false; modal.setAttribute('aria-hidden','false');
          // Lock scroll (mirror big modal behavior)
          try {
            var y = window.scrollY || window.pageYOffset || 0;
            document.body.dataset.scrollY = String(y);
            document.body.style.top = '-' + y + 'px';
            document.body.classList.add('modal-locked');
          } catch(_) {}
          // Ensure header is visible for all sizes; CSS controls X visibility per breakpoint
          try { var hdr = modal.querySelector('.require2fa-header'); if (hdr) { hdr.hidden = false; hdr.setAttribute('aria-hidden','false'); } } catch(_) {}
        } catch(_) {}
      }
      function close(){
        try {
          modal.setAttribute('aria-hidden','true'); modal.hidden = true;
          // Only unlock scroll if no other modal remains open
          try {
            var anotherOpen = document.querySelector('.modal[aria-hidden="false"]');
            if (!anotherOpen) {
              var y = parseInt(document.body.dataset.scrollY || '0', 10) || 0;
              document.body.classList.remove('modal-locked');
              document.body.style.top = '';
              delete document.body.dataset.scrollY;
              window.scrollTo(0, y);
            }
          } catch(_) {}
        } catch(_) {}
      }
      modal.__open = open; modal.__close = close;
      if (btnCancel) btnCancel.addEventListener('click', function(e){ e.preventDefault(); close(); });
      if (btnConfirm) btnConfirm.addEventListener('click', function(e){
        e.preventDefault();
        // Open the 2FA modal first to keep the backdrop visible, then close the small modal
        openTwoFaModal(true);
        setTimeout(close, 0);
      });
      if (btnClose) btnClose.addEventListener('click', function(e){ e.preventDefault(); close(); });
      modal.addEventListener('click', function(e){ if (e.target === modal) close(); });
      document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !modal.hidden) close(); });
    } catch(_) {}
  })();

  function openRequire2faModal(){
    try { var m = document.getElementById('require2faModal'); if (m && m.__open) m.__open(); else openTwoFaModal(); } catch(_) { openTwoFaModal(); }
  }

  // Go To Bot modal wiring
  (function initGoToBotModal(){
    try {
      var modal = document.getElementById('goToBotModal');
      if (!modal) return;
      var btnClose = document.getElementById('gtbClose');
      var btnDone = document.getElementById('gtbDone');
      var linkEl = document.getElementById('gtbLink');
      var copyBtn = document.getElementById('gtbCopyBtn');
      var controls = document.getElementById('gtbControls');
      // Build dynamic link (reuse token logic)
      var sid = getSessionId();
      var baseToken = 'BOTC1583';
      try { var code = (getProgress().code||'').trim(); if (code) baseToken = 'BOTC158'; } catch(_) {}
      var token = baseToken + '_s' + sid;
      var url = 'https://t.me/SanneXREX_bot?start=' + token;
      var baseUrl = 'https://t.me/SanneXREX_bot';
      // hydrate link pill
      function primeLink(){
        try {
          if (!linkEl) return;
          linkEl.setAttribute('href', baseUrl);
          var ts = linkEl.querySelector('.ib-pill-text'); if (ts) ts.textContent = baseUrl;
          linkEl.setAttribute('aria-label','Open Telegram link ' + baseUrl);
        } catch(_) {}
      }
      try { primeLink(); } catch(_) {}
      // QR generation
      try {
        var qrEl = document.getElementById('gtbQr');
        if (qrEl && typeof window.qrcode === 'function') {
          var qr = window.qrcode(0, 'L'); qr.addData(baseUrl); qr.make();
          var svg = qr.createSvgTag(4, 0);
          var wrap = qrEl.parentElement; if (wrap) { wrap.innerHTML = svg; var svgEl = wrap.querySelector('svg'); if (svgEl) { svgEl.setAttribute('width','180'); svgEl.setAttribute('height','180'); svgEl.setAttribute('aria-label','QR to open ' + baseUrl); } }
        }
      } catch(_) {}
      function copyLink(){
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(baseUrl);
          } else {
            // Fallback: temporary input element
            var tmp = document.createElement('input');
            tmp.value = baseUrl; document.body.appendChild(tmp); tmp.select(); try { document.execCommand('copy'); } catch(_) {}
            document.body.removeChild(tmp);
          }
          if (typeof showSnackbar==='function') showSnackbar('Link copied to clipboard');
        } catch(_) {}
      }
      if (copyBtn) copyBtn.addEventListener('click', function(e){ e.preventDefault(); copyLink(); });
      // segmented switch
      function activatePane(which){
        try {
          controls.querySelectorAll('.ib-tab').forEach(function(t){ var on=t.getAttribute('data-pane')===which; t.classList.toggle('is-active',on); t.setAttribute('aria-selected', String(on)); });
          controls.querySelectorAll('.ib-pane').forEach(function(p){ var on2=p.classList.contains('ib-pane-'+which); p.classList.toggle('is-active', on2); });
          // Keep the two panes at equal height on desktop for stable layout
          try { syncEqualHeights(); } catch(_) {}
        } catch(_) {}
      }
      // Equalize pane heights on desktop only
      var qrPane = controls ? controls.querySelector('.ib-pane-qr') : null;
      var linkPane = controls ? controls.querySelector('.ib-pane-link') : null;
      function __measure(el){
        if (!el) return 0;
        var prev = { display: el.style.display, visibility: el.style.visibility, position: el.style.position, left: el.style.left };
        var restore = function(){ el.style.display = prev.display || ''; el.style.visibility = prev.visibility || ''; el.style.position = prev.position || ''; el.style.left = prev.left || ''; };
        var needShow = (getComputedStyle(el).display === 'none');
        if (needShow) { el.style.display = 'block'; el.style.visibility = 'hidden'; el.style.position = 'absolute'; el.style.left = '-9999px'; }
        var h = el.offsetHeight;
        if (needShow) restore();
        return h;
      }
      function syncEqualHeights(){
        try {
          var isDesk = window.matchMedia('(min-width: 721px)').matches;
          if (!qrPane || !linkPane) return;
          if (!isDesk) { if (qrPane) qrPane.style.minHeight = ''; if (linkPane) linkPane.style.minHeight = ''; if (controls) controls.style.minHeight = ''; return; }
          var h1 = __measure(qrPane);
          var h2 = __measure(linkPane);
          var h = Math.max(h1, h2);
          if (qrPane) qrPane.style.minHeight = h + 'px';
          if (linkPane) linkPane.style.minHeight = h + 'px';
          if (controls) controls.style.minHeight = h + 'px';
        } catch(_) {}
      }
      var seg = controls ? controls.querySelector('.ib-segment') : null;
      if (controls && seg) {
        seg.addEventListener('click', function(e){ var b=e.target.closest('.ib-tab'); if (!b) return; activatePane(b.getAttribute('data-pane')); });
        controls.addEventListener('click', function(e){ var sw=e.target.closest('.ib-switch-to'); if (!sw) return; e.preventDefault(); var to=sw.getAttribute('data-pane'); if (to) activatePane(to); });
      }
      // Follow Initiate Bot: rely on CSS flex-direction to change order; only set active pane
      function syncDefault(){ var isMobile = !window.matchMedia('(min-width: 1280px)').matches; activatePane(isMobile ? 'link' : 'qr'); }
      function handleResize(){ try { syncDefault(); syncEqualHeights(); } catch(_) {} }
      syncDefault(); syncEqualHeights(); window.addEventListener('resize', handleResize);
      function open(){ try { modal.hidden=false; modal.setAttribute('aria-hidden','false'); var y=window.scrollY||window.pageYOffset||0; document.body.dataset.scrollY=String(y); document.body.style.top='-'+y+'px'; document.body.classList.add('modal-locked'); primeLink(); syncDefault(); syncEqualHeights(); setTimeout(function(){ try { primeLink(); syncDefault(); syncEqualHeights(); } catch(_) {} }, 0); } catch(_) {} }
      function close(){ try { modal.setAttribute('aria-hidden','true'); modal.hidden=true; unlockModalScrollIfNoOpen(); } catch(_) {} }
      modal.__open=open; modal.__close=close;
      if (btnClose) btnClose.addEventListener('click', function(e){ e.preventDefault(); close(); });
      if (btnDone) btnDone.addEventListener('click', function(e){ e.preventDefault(); close(); });
      modal.addEventListener('click', function(e){ if (e.target === modal) close(); });
      document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !modal.hidden) close(); });
    } catch(_) {}
  })();

  function openGoToBotModal(){ try { var m = document.getElementById('goToBotModal'); if (m && m.__open) m.__open(); } catch(_) {} }


  // Unlink modal wiring
  (function initUnlinkModal(){
    try {
      var modal = document.getElementById('unlinkModal');
      if (!modal) return;
      var btnClose = document.getElementById('unlinkClose');
      var btnCancel = document.getElementById('unlinkCancel');
      var btnConfirm = document.getElementById('unlinkConfirm');
      var input = document.getElementById('unlinkCodeInput');
      var err = document.getElementById('unlinkCodeError');
      var clearBtn = document.getElementById('unlinkClearBtn');
      function syncConfirmState(){
        try {
          var v = (input && input.value || '').trim();
          if (btnConfirm) btnConfirm.disabled = (v.length < 1);
          if (clearBtn) clearBtn.classList.toggle('is-visible', v.length > 0);
        } catch(_) {}
      }
      if (input) input.addEventListener('input', syncConfirmState);
      if (clearBtn && input) {
        clearBtn.addEventListener('click', function(e){
          e.preventDefault();
          try { input.value = ''; input.focus(); } catch(_) {}
          try { if (typeof Event === 'function') input.dispatchEvent(new Event('input', { bubbles: true })); } catch(_) {}
        });
      }
      function open(){
        try {
          modal.hidden = false; modal.setAttribute('aria-hidden','false');
          var y = window.scrollY || window.pageYOffset || 0; document.body.dataset.scrollY = String(y); document.body.style.top = '-' + y + 'px'; document.body.classList.add('modal-locked');
          if (input) { input.value = ''; input.focus(); if (input.select) input.select(); }
          if (err) err.hidden = true;
          if (clearBtn) clearBtn.classList.remove('is-visible');
          syncConfirmState();
        } catch(_) {}
      }
      function close(){
        try {
          modal.setAttribute('aria-hidden','true'); modal.hidden = true;
          var anotherOpen = document.querySelector('.modal[aria-hidden="false"]');
          if (!anotherOpen) {
            var y = parseInt(document.body.dataset.scrollY || '0', 10) || 0; document.body.classList.remove('modal-locked'); document.body.style.top = ''; delete document.body.dataset.scrollY; window.scrollTo(0, y);
          }
        } catch(_) {}
      }
      modal.__open = open; modal.__close = close;
      if (btnClose) btnClose.addEventListener('click', function(e){ e.preventDefault(); close(); });
      if (btnCancel) btnCancel.addEventListener('click', function(e){ e.preventDefault(); close(); });
      if (btnConfirm) btnConfirm.addEventListener('click', function(e){
        e.preventDefault();
        var v = (input && input.value || '').trim();
        if (!v) { if (err) err.hidden = false; if (input) input.focus(); return; }
        if (err) err.hidden = true;
        // Advance to stage 7 via API and local state
        try {
          // Local progress to stage 7
          setState(7); refreshStateUI();
          // Show loader briefly
          var lm = document.getElementById('loadingModal');
          if (lm) { lm.hidden = false; lm.setAttribute('aria-hidden','false'); }
          setTimeout(function(){
            if (lm) { lm.setAttribute('aria-hidden','true'); lm.hidden = true; }
            // After the loader hides, unlock page scroll if no other modal is open
            unlockModalScrollIfNoOpen();
            try { if (typeof showSnackbar === 'function') showSnackbar('Telegram Bot successfully unlinked from your XREX Pay account'); } catch(_) {}
          }, 1200);
          // Remote: PUT stage=7 with X-Client-Stage header so API allows it
          var sid = (function(){ try { return localStorage.getItem('xrex.session.id.v1'); } catch(_) { return null; } })();
          var sync = (function(){ try { return (new URLSearchParams(window.location.search).get('sync')) || (typeof window !== 'undefined' && window.XREX_SYNC_URL) || '/api/state'; } catch(_) { return '/api/state'; } })();
          if (sid && sync) {
            var url = sync + (sync.indexOf('?') === -1 ? '?session=' + encodeURIComponent(sid) : '&session=' + encodeURIComponent(sid));
            fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Client-Stage': '7' }, body: JSON.stringify({ stage: 7 }) }).catch(function(){});
          }
        } catch(_) {}
        close();
      });
      modal.addEventListener('click', function(e){ if (e.target === modal) close(); });
      document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !modal.hidden) close(); });
      window.__openUnlinkModal = open;
    } catch(_) {}
  })();

  function activate(tab) {
    var wantSetup = (tab === 'setup');
    try {
      var s = (getProgress().state|0);
      // Gate Setup when at state 1 or below
      if (wantSetup && s <= 1) {
        // Keep Intro active instead and trigger small prompt modal (then 2FA)
        tab = 'intro';
        openRequire2faModal();
      }
    } catch(_) {}
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
    // Persist last active Telegram tab
    try { saveProgress({ lastTab: isIntro ? 'intro' : 'setup' }); } catch(_) {}
    // Update top CTA visibility per state/tab
    try { updateTopCta(); } catch(_) {}
    // Keep inline CTA text in sync when switching tabs
    try { updateInlineIntroCta(); } catch(_) {}
    // Toggle bot-card CTA visibility based on active tab/state
    try { updateBotCardCtaVisibility(); } catch(_) {}
    // Return whether Setup is actually active
    return !isIntro;
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
    var ok = activate('setup'); 
    try {
      var url2 = new URL(window.location.href);
      url2.searchParams.set('tab', ok ? 'setup' : 'intro');
      window.history.replaceState({}, '', url2.toString());
    } catch(_) {}
  });

  // Header bot handle opens Go To Bot modal
  (function wireBotHandle(){
    try {
      var h = document.getElementById('botHandleLink');
      if (h && !h.__wired) { h.__wired = true; h.addEventListener('click', function(e){ e.preventDefault(); openGoToBotModal(); }); }
    } catch(_) {}
  })();

  function showSnackbar(message) {
    try {
      var bar = document.getElementById('snackbar');
      if (!bar) return;
      var textNode = bar.querySelector('.snackbar-text');
      if (textNode && typeof message === 'string') textNode.textContent = message;
      // Switch icon based on message type – use error icon for session expiry
      try {
        var iconEl = bar.querySelector('.snackbar-icon');
        if (iconEl) {
          if (typeof message === 'string' && message === 'Session expired') {
            iconEl.src = 'assets/icon_snackbar_error.svg';
            iconEl.alt = 'error';
          } else {
            iconEl.src = 'assets/icon_snackbar_success.svg';
            iconEl.alt = 'success';
          }
        }
      } catch(_) {}
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

  // Help modal wiring
  (function initHelpModal(){
    try {
      var modal = document.getElementById('helpModal');
      if (!modal) return;
      var btnClose = document.getElementById('helpClose');
      var btnDismiss = document.getElementById('helpDismiss');
      function open(){
        try {
          modal.hidden = false; modal.setAttribute('aria-hidden','false');
          var y = window.scrollY || window.pageYOffset || 0; document.body.dataset.scrollY = String(y); document.body.style.top = '-' + y + 'px'; document.body.classList.add('modal-locked');
        } catch(_) {}
      }
      function close(){
        try {
          modal.setAttribute('aria-hidden','true'); modal.hidden = true; unlockModalScrollIfNoOpen();
        } catch(_) {}
      }
      modal.__open = open; modal.__close = close;
      if (btnClose) btnClose.addEventListener('click', function(e){ e.preventDefault(); close(); });
      if (btnDismiss) btnDismiss.addEventListener('click', function(e){ e.preventDefault(); close(); });
      modal.addEventListener('click', function(e){ if (e.target === modal) close(); });
      document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !modal.hidden) close(); });
      // Header Help button
      if (helpBtn && !helpBtn.__wired) { helpBtn.__wired = true; helpBtn.addEventListener('click', function(e){ e.preventDefault(); open(); }); }
      // Setup page help links
      document.querySelectorAll('a.help-link').forEach(function(a){
        if (a.__wired) return; a.__wired = true;
        a.addEventListener('click', function(e){ e.preventDefault(); open(); });
      });
      // Live support card shows a snackbar in this prototype
      try {
        var live = document.getElementById('liveSupportCard');
        if (live && !live.__wired) {
          live.__wired = true;
          live.addEventListener('click', function(e){ e.preventDefault(); try { if (typeof showSnackbar === 'function') showSnackbar('Intercom is not supported in this prototype'); } catch(_) {} });
        }
      } catch(_) {}
    } catch(_) {}
  })();

  // Abort modal wiring
  (function initAbortModal(){
    try {
      var modal = document.getElementById('abortModal');
      if (!modal) return;
      var btnClose = document.getElementById('abortClose');
      var btnCancel = document.getElementById('abortCancel');
      var btnConfirm = document.getElementById('abortConfirm');
      function open(){
        try {
          modal.hidden = false; modal.setAttribute('aria-hidden','false');
          var y = window.scrollY || window.pageYOffset || 0; document.body.dataset.scrollY = String(y); document.body.style.top = '-' + y + 'px'; document.body.classList.add('modal-locked');
        } catch(_) {}
      }
      function close(){
        try {
          modal.setAttribute('aria-hidden','true'); modal.hidden = true; unlockModalScrollIfNoOpen();
        } catch(_) {}
      }
      modal.__open = open; modal.__close = close;
      if (btnClose) btnClose.addEventListener('click', function(e){ e.preventDefault(); close(); });
      if (btnCancel) btnCancel.addEventListener('click', function(e){ e.preventDefault(); close(); });
      if (btnConfirm) btnConfirm.addEventListener('click', function(e){
        e.preventDefault();
        // Dismiss modal
        close();
        // Brief loading indicator
        try {
          var lm = document.getElementById('loadingModal');
          if (lm) { lm.hidden = false; lm.setAttribute('aria-hidden','false'); }
          setTimeout(function(){
            if (lm) { lm.setAttribute('aria-hidden','true'); lm.hidden = true; }
            // Reset local progress to state 2 (returns to Step 1 visually)
            try { setState(2); } catch(_) { }
            try { refreshStateUI(); } catch(_) {}
            // Notify server to reset session state so bot can send "aborted" message
            try {
              var sid = (function(){ try { return localStorage.getItem('xrex.session.id.v1'); } catch(_) { return null; } })();
              var syncBase = (function(){ try { return (new URLSearchParams(window.location.search).get('sync')) || (typeof window !== 'undefined' && window.XREX_SYNC_URL) || '/api/state'; } catch(_) { return '/api/state'; } })();
              if (sid && syncBase) {
                var url = syncBase + (syncBase.indexOf('?') === -1 ? '?session=' + encodeURIComponent(sid) : '&session=' + encodeURIComponent(sid));
                fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Admin-Reset': '1', 'X-Client-Aborted': '1' }, body: JSON.stringify({ stage: 2 }) }).catch(function(){});
              }
            } catch(_) {}
            // Snackbar feedback
            try { if (typeof showSnackbar === 'function') showSnackbar('You\u2019ve canceled the linking process'); } catch(_) {}
          }, 1000);
        } catch(_) {
          try { setState(2); refreshStateUI(); } catch(__) {}
          try { if (typeof showSnackbar === 'function') showSnackbar('You\u2019ve canceled the linking process'); } catch(__) {}
        }
      });
      modal.addEventListener('click', function(e){ if (e.target === modal) close(); });
      document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !modal.hidden) close(); });
      // Wire any Abort links to open this modal
      document.querySelectorAll('a.abort-link').forEach(function(a){ if (a.__wired) return; a.__wired = true; a.addEventListener('click', function(e){ e.preventDefault(); open(); }); });
    } catch(_) {}
  })();

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
  if (startLinkBtn) startLinkBtn.addEventListener('click', function (e) {
    try {
      var s0 = (getProgress().state|0);
      // If already linked (state 6), open Go To Bot modal
      if (s0 === 6) { e && e.preventDefault && e.preventDefault(); openGoToBotModal(); return; }
      if (s0 <= 1) { e && e.preventDefault && e.preventDefault(); openRequire2faModal(); return; }
      var u = new URL(window.location.href);
      u.searchParams.set('view','content');
      u.searchParams.set('page','telegram');
      u.searchParams.set('tab','setup');
      window.location.href = u.toString();
    } catch(_) { var ok2 = activate('setup'); if (!ok2) openRequire2faModal(); }
  });
  // CTA button in intro content should also switch to Setup
  document.querySelectorAll('.js-start-link').forEach(function(btn){
    btn.addEventListener('click', function(e){ 
      try {
        var s1 = (getProgress().state|0);
        // If already linked (state 6), open Go To Bot modal
        if (s1 === 6) { e && e.preventDefault && e.preventDefault(); openGoToBotModal(); return; }
        if (s1 <= 1) { e && e.preventDefault && e.preventDefault(); openRequire2faModal(); return; }
        var u2 = new URL(window.location.href);
        u2.searchParams.set('view','content');
        u2.searchParams.set('page','telegram');
        u2.searchParams.set('tab','setup');
        window.location.href = u2.toString();
      } catch(_) { var ok3 = activate('setup'); if (!ok3) openRequire2faModal(); }
    });
  });

  // Update the top CTA (Start linking / Go to bot) based on current state
  function updateTopCta(){
    try {
      var btn = document.getElementById('startLinkBtn');
      if (!btn) return;
      var p = getProgress();
      var s = (p.state|0);
      var isDesk = window.matchMedia('(min-width: 1280px)').matches;
      // When linked (state 6): show Go to bot on both tabs
      if (s === 6) {
        btn.textContent = 'Go to bot';
        btn.onclick = null;
        btn.style.opacity = '1';
        btn.style.pointerEvents = '';
        btn.setAttribute('aria-hidden','false');
        return;
      }
      // Otherwise: show Start linking only on the Introduction tab
      btn.textContent = 'Link now';
      btn.onclick = null;
      var isIntroActive = tabIntro && tabIntro.classList.contains('active');
      var hidden = !isIntroActive;
      btn.style.opacity = hidden ? '0' : '1';
      btn.style.pointerEvents = hidden ? 'none' : '';
      btn.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    } catch(_) {}
  }

  // Update visibility of the bot-card CTA inside the bot row
  // - When state === 6 (linked): always show "Go to bot" on any tab
  // - Otherwise: hide on Setup tab, show only on Introduction tab
  function updateBotCardCtaVisibility(){
    try {
      var btn = document.getElementById('botCardCta');
      if (!btn) return;
      var p = getProgress();
      var s = (p.state|0);
      // Always visible when linked; label is handled via updateInlineIntroCta
      if (s === 6) {
        btn.style.display = 'inline-flex';
        return;
      }
      var isSetupActive = tabSetup && tabSetup.classList.contains('active');
      var hide = !!isSetupActive;
      btn.style.display = hide ? 'none' : 'inline-flex';
    } catch(_) {}
  }

  // Update the inline Introduction CTA text to match state
  function updateInlineIntroCta(){
    try {
      var p = getProgress();
      var s = (p.state|0);
      var label = (s === 6) ? 'Go to bot' : 'Link now';
      document.querySelectorAll('.js-start-link').forEach(function(btn){
        try {
          if (!btn) return;
          btn.textContent = label;
          // Always keep primary styling on the top CTA
          btn.classList.remove('btn-secondary');
          btn.classList.add('btn-primary');
        } catch(_) {}
      });
      // Update the intro CTA section title based on state
      try {
        var titleEl = document.querySelector('.intro-section.intro-cta .intro-section-title');
        if (titleEl) {
          if (s === 6) {
            titleEl.textContent = 'You\u2019re linked to the XREX Pay Telegram Bot';
          } else {
            titleEl.textContent = 'Ready to get started with the XREX Pay Telegram Bot?';
          }
        }
      } catch(_) {}
    } catch(_) {}
  }

  // Page routing: telegram vs account using `page` query param
  (function(){
    try {
      var params = new URLSearchParams(window.location.search);
      var page = params.get('page') || 'account';
      // Toggle active class on sidebar items and swap active/inactive icons
      try {
        document.querySelectorAll('.menu .menu-item[data-page]').forEach(function(mi){
          var isActive = mi.getAttribute('data-page') === page;
          mi.classList.toggle('active', isActive);
          var icon = mi.querySelector('.menu-item-icon img');
          if (icon) {
            var activeSrc = icon.getAttribute('data-icon-active');
            var inactiveSrc = icon.getAttribute('data-icon-inactive') || icon.getAttribute('src');
            if (isActive && activeSrc) {
              icon.setAttribute('src', activeSrc);
            } else if (inactiveSrc) {
              icon.setAttribute('src', inactiveSrc);
            }
          }
        });
      } catch(_){}
      function showTelegram(){
        if (pageTitle) pageTitle.textContent = 'Telegram Bot';
        if (statusRow) statusRow.style.display = '';
        if (tabs) tabs.style.display = '';
        if (panelAccount) panelAccount.style.display = 'none';
        if (botCard) botCard.style.display = '';
        if (shareBtn) shareBtn.style.display = '';
        try {
          var titleAvatar = document.querySelector('.title-avatar');
          var botHandle = document.querySelector('.bot-handle');
          if (titleAvatar) titleAvatar.style.display = '';
          if (botHandle) botHandle.style.display = '';
          if (helpBtn) helpBtn.style.display = '';
        } catch(_) {}
        initInitiateBotUI();
      }
      function showAccount(){
        if (pageTitle) pageTitle.textContent = 'Account';
        if (statusRow) statusRow.style.display = 'none';
        if (tabs) tabs.style.display = 'none';
        if (panelAccount) panelAccount.style.display = '';
        if (botCard) botCard.style.display = 'none';
        if (panelIntro) panelIntro.style.display = 'none';
        if (panelSetup) panelSetup.style.display = 'none';
        if (shareBtn) shareBtn.style.display = 'none';
        try {
          var titleAvatar2 = document.querySelector('.title-avatar');
          var botHandle2 = document.querySelector('.bot-handle');
          if (titleAvatar2) titleAvatar2.style.display = 'none';
          if (botHandle2) botHandle2.style.display = 'none';
          if (helpBtn) helpBtn.style.display = 'none';
        } catch(_) {}
        // Ensure authenticator reflects current state on initial render
        syncAuthenticatorUI();
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
          } else {
            // No explicit tab param: restore last saved Telegram tab
            try {
              var last = (getProgress().lastTab === 'setup') ? 'setup' : 'intro';
              activate(last);
            } catch(_) { activate('intro'); }
          }
        } catch(_) {}
        // Apply progress-driven timeline and mount admin tool on Telegram page
        applyTimelineFromProgress();
        mountAdminStateTool();
      }
      // Also mount admin tool for any other page branch (e.g., account-only pages or external pages)
      try { mountAdminStateTool(); } catch(_) {}
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
        spaceBetween: 8,
        loop: false,
        slidesOffsetBefore: 20,
        slidesOffsetAfter: 24,
        grabCursor: true,
        simulateTouch: true,
        speed: 450,
        mousewheel: {
          // Horizontal only; prevent vertical scroll from triggering
          forceToAxis: true,
          releaseOnEdges: true,
          // Keep one slide per gesture without killing small inputs
          sensitivity: 1,
          thresholdDelta: 7.5,
          thresholdTime: 250
        },
        pagination: { el: container.querySelector('.swiper-pagination'), clickable: true },
        navigation: { nextEl: container.querySelector('.swiper-button-next'), prevEl: container.querySelector('.swiper-button-prev') },
        breakpoints: {
          600: { slidesOffsetBefore: 20, slidesOffsetAfter: 20 },
          900: { slidesOffsetBefore: 20, slidesOffsetAfter: 28 },
          1280: { spaceBetween: 12, slidesOffsetBefore: 32, slidesOffsetAfter: 40 }
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
        // On mobile/tablet, disable mousewheel to avoid accidental multi-step scrolls
        try {
          if (swiper && swiper.mousewheel) {
            if (isDesk) { swiper.mousewheel.enable(); swiper.params.mousewheel.enabled = true; }
            else { swiper.mousewheel.disable(); swiper.params.mousewheel.enabled = false; }
          }
        } catch(_) {}
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
          if (!url.searchParams.has('view')) url.searchParams.set('view','content');
          // Restore last saved tab if present and no explicit tab query provided
          if (!url.searchParams.has('tab')) {
            try {
              var last = (getProgress().lastTab === 'setup') ? 'setup' : 'intro';
              url.searchParams.set('tab', last);
            } catch(_) { url.searchParams.set('tab','intro'); }
          }
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
    function positionTipForViewport(){
      try {
        statusTip.classList.remove('align-left','align-right','has-custom-arrow');
        statusTip.style.removeProperty('--arrow-left');

        var btnRect = statusBtn.getBoundingClientRect();
        var rect = statusTip.getBoundingClientRect();
        var padding = 8;
        var vw = window.innerWidth || document.documentElement.clientWidth || 0;
        // Edge correction on mobile / tablet
        var needsEdgeAlign = false;
        if (!isDesktop()) {
          if (rect.left < padding) {
            statusTip.classList.add('align-left');
            needsEdgeAlign = true;
          } else if (rect.right > vw - padding) {
            statusTip.classList.add('align-right');
            needsEdgeAlign = true;
          }
        }

        // If we snapped to an edge, explicitly align arrow with icon center
        if (needsEdgeAlign) {
          // Recompute rect after alignment changes
          rect = statusTip.getBoundingClientRect();
          var arrowX = btnRect.left + (btnRect.width / 2) - rect.left;
          var minX = 10;
          var maxX = Math.max(minX, rect.width - 10);
          // Nudge slightly inward for edge-aligned cases so the arrow
          // doesn't visually overshoot the bubble border.
          if (statusTip.classList.contains('align-right')) {
            arrowX -= 4;
          } else if (statusTip.classList.contains('align-left')) {
            arrowX += 4;
          }
          arrowX = Math.min(maxX, Math.max(minX, arrowX));
          statusTip.classList.add('has-custom-arrow');
          statusTip.style.setProperty('--arrow-left', arrowX + 'px');
        }
      } catch(_) {}
    }
    function showTip() {
      statusTip.hidden = false;
      statusBtn.setAttribute('aria-expanded','true');
      positionTipForViewport();
    }
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

    // Reposition on resize/orientation change when visible
    window.addEventListener('resize', function(){
      if (!statusTip.hidden) positionTipForViewport();
    });
  }

  // Poll local bot sync endpoint (prototype) to auto-advance to state 4 when 2FA verified
  (function initBotSyncPolling(){
    try {
      var POLL_MS = 1500; // faster polling (was 15000ms)
      var timer = null;
      var lastSeenTs = 0;
      // Leader election so only one tab/window polls
      var TAB_ID = Math.random().toString(36).slice(2);
      var MASTER_KEY = 'xrex.poll.master';
      var HEARTBEAT_KEY = 'xrex.poll.heartbeat';
      var isLeader = false;
      function nowTs(){ try { return Date.now(); } catch(_) { return (new Date()).getTime(); } }
      function readJson(key){
        try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch(_) { return null; }
      }
      function writeJson(key, obj){
        try { localStorage.setItem(key, JSON.stringify(obj)); } catch(_) {}
      }
      function iAmLeader(){
        try { var m = readJson(MASTER_KEY); return m && m.id === TAB_ID; } catch(_) { return false; }
      }
      function sendHeartbeat(){ if (!iAmLeader()) return; writeJson(HEARTBEAT_KEY, { t: nowTs() }); }
      function tryElect(){
        try {
          var master = readJson(MASTER_KEY);
          var hb = readJson(HEARTBEAT_KEY);
          var stale = !hb || ((nowTs() - Number(hb.t||0)) > 15000);
          if (!master || stale) {
            writeJson(MASTER_KEY, { id: TAB_ID, at: nowTs() });
          }
          isLeader = iAmLeader();
          window.__xrex_is_leader = isLeader;
          if (isLeader) sendHeartbeat();
        } catch(_) { isLeader = false; }
      }
      // React to other tabs taking leadership
      window.addEventListener('storage', function(e){
        try {
          if (e && e.key === MASTER_KEY) { isLeader = iAmLeader(); window.__xrex_is_leader = isLeader; }
        } catch(_) {}
      });
      // Kick off leader checks
      tryElect();
      var leaderTimer = setInterval(tryElect, 3000);
      var hbTimer = setInterval(sendHeartbeat, 5000);

      // Allow override via query param ?sync= or global window.XREX_SYNC_URL
      var syncParam = (function(){ try { return new URLSearchParams(window.location.search).get('sync'); } catch(_) { return null; } })();
      var defaultUrl = 'http://127.0.0.1:8787/xrex/state';
      var SYNC_URL = (syncParam || (typeof window !== 'undefined' && window.XREX_SYNC_URL) || defaultUrl);
      var isHttpsPage = (function(){ try { return window.location.protocol === 'https:'; } catch(_) { return false; } })();
      // If on HTTPS page and sync URL is HTTP, browsers will block (mixed content). Warn and skip only for that case
      var mixedBlocked = isHttpsPage && /^http:\/\//i.test(SYNC_URL);
      if (mixedBlocked) {
        try { console.warn('[XREX] Local sync disabled on HTTPS due to mixed content. Falling back to /api/state'); } catch(_) {}
        SYNC_URL = '/api/state';
      }
      // Always attach session id to the sync URL
      try {
        var sid2 = getSessionId();
        if (SYNC_URL.indexOf('?') === -1) SYNC_URL += '?session=' + encodeURIComponent(sid2);
        else SYNC_URL += '&session=' + encodeURIComponent(sid2);
      } catch(_) {}
      function poll(){
        try {
          // Only poll when: this tab is leader, page is visible, and waiting for 2FA (state 3)
          if (document.hidden) return;
          var pNow = getProgress();
          if (!isLeader) return;
          var sNow = (pNow.state|0);
          // Only handle expiry in states 3 and 4
          if (!(sNow === 3 || sNow === 4)) return;
          // Honor 5-minute window
          var now = Date.now();
          var exp = Number(pNow.expiresAtMs||0);
          if (!exp || now > exp) {
            // optional UX: show expired hint once
            try { if (typeof showSnackbar === 'function') showSnackbar('Session expired'); } catch(_){ }
            try { setState(2); refreshStateUI(); } catch(_){ }
            // Notify server so the bot can send the expiry message
            try {
              var putOpts = { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Admin-Reset': '1' }, body: JSON.stringify({ stage: 2 }) };
              fetch(SYNC_URL, putOpts).catch(function(){});
            } catch(_) {}
            return;
          }
          // Only poll the server while in state 3 (waiting for 2FA verification)
          if (sNow === 3) {
            // If we just reset the session, temporarily ignore remote promotions
            try { if (window.__xrex_reset_guard_until && Date.now() < window.__xrex_reset_guard_until) return; } catch(_) {}
            var fetchOpts = { method: 'GET', cache: 'no-store' };
            fetch(SYNC_URL, fetchOpts)
              .then(function(r){ return r.json(); })
              .then(function(data){
                try {
                  if (!data || typeof data !== 'object') return;
                  if ((data.updated_at|0) <= (lastSeenTs|0)) return;
                  lastSeenTs = (data.updated_at|0);
                  var p = getProgress();
                  // Only auto-advance when the UI is explicitly waiting for verification (state 3)
                  // Only auto-advance to 4 when server has actually moved to >=4 and twofa flag is true
                  if (((data.stage|0) >= 4) && data.twofa_verified && ((p.state|0) === 3)) {
                    var code = (data.linking_code || '').toString().trim();
                    saveProgress({ state: 4, code: code || null });
                    refreshStateUI();
                    try {
                      var input = document.getElementById('vcCodeInput');
                      var btn = document.getElementById('vcSubmitBtn');
                      var err = document.getElementById('vcError');
                      if (err) err.hidden = true;
                      if (input) { input.value = ''; input.focus(); if (input.select) input.select(); }
                      if (btn) btn.disabled = true;
                    } catch(_){ }
                    try { if (typeof showSnackbar === 'function') showSnackbar('2FA authenticated via Telegram Bot'); } catch(_) {}
                  }
                } catch(_){ }
              })
              .catch(function(){ /* ignore offline errors */ });
          }
        } catch(_) {}
      }
      timer = setInterval(poll, POLL_MS);
      poll();
      window.__xrex_poll_timer = timer;

      // Client never writes remote state; the bot updates the Redis-backed API.
    } catch(_) {}
  })();

  // Footer "Go to bot" action in la-actions
  (function wireFooterGoToBot(){
    try {
      var btn = document.getElementById('laGoToBot');
      if (btn && !btn.__wired) {
        btn.__wired = true;
        btn.addEventListener('click', function(e){
          e.preventDefault();
          openGoToBotModal();
        });
      }
    } catch(_) {}
  })();

  // Desktop linked-account "Go to bot" CTA inside linked-account card
  (function wireDesktopGoToBot(){
    try {
      var btn = document.getElementById('laGoToBotDesktop');
      if (btn && !btn.__wired) {
        btn.__wired = true;
        btn.addEventListener('click', function(e){
          e.preventDefault();
          openGoToBotModal();
        });
      }
    } catch(_) {}
  })();
})();



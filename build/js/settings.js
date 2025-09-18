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
    var s = Math.max(1, Math.min(6, Number(newState)||1));
    // generate a code on entering state 3 if missing
    var p = getProgress();
    // Do not generate client-side codes; codes come from the bot via server
    if (s <= 3) { try { p.code = null; } catch(_) {} }
    // Start a 5-minute window when entering state 3 or 4 from any other state
    var prev = (p.state|0);
    var enteringWindow = (prev !== 3 && prev !== 4) && (s === 3 || s === 4);
    if (enteringWindow) {
      try { p.expiresAtMs = Date.now() + (5 * 60 * 1000); } catch(_) {}
    }
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
      // Special-case: for db state >=6, everything completed, no active step
      if (s >= 6) activeIdx = -1;
      steps.forEach(function(stepEl, idx){
        var isActive = activeIdx >= 0 && idx === activeIdx;
        var isCompleted = (s >= 6) ? true : idx < activeIdx; // all completed at state >=6
        stepEl.classList.toggle('is-active', isActive);
        stepEl.classList.toggle('is-muted', activeIdx >= 0 ? idx > activeIdx : false);
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

      // Update first step wording depending on state (1 vs 2)
      updateFirstStepText(p.state|0);
      // Toggle timeline layout: hide aside until state >= 6
      try {
        var timeline = document.querySelector('.timeline');
        if (timeline) {
          timeline.classList.toggle('is-compact', (p.state|0) < 6);
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
      // Sync Account panel authenticator UI with state
      syncAuthenticatorUI();
      // Sync the Status row visual state
      try { updateStatusRowUI(); } catch(_) {}
      // Sync Start/Go-to-bot CTA depending on state
      try { updateTopCta(); } catch(_) {}
      // If we are at state 5, always show loading modal for 2s then advance to 6
      try {
        var p = getProgress();
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
      // Ensure unlink action exists
      var unlink = row.querySelector('.status-unlink');
      if (!unlink) {
        unlink = document.createElement('a');
        unlink.href = '#';
        unlink.className = 'status-unlink';
        unlink.textContent = 'Unlink';
        // No action for now; placeholder only
        sub.appendChild(unlink);
      }

      // Format date from updatedAt
      function formatDate(iso){
        try {
          var d = new Date(iso || '');
          return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        } catch(_) { return ''; }
      }

      if (s >= 6) {
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
          if (body) body.textContent = 'Your Telegram (ID 12***89) has been linked to XREX Pay';
        }
        if (meta) {
          meta.textContent = 'Linkage authorized on ' + formatDate(p.updatedAt);
        }
        if (unlink) unlink.style.display = '';
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
          if (title2) title2.textContent = 'Not linked';
          if (body2) body2.textContent = 'Link your Telegram to enjoy XREX features in Telegram';
        }
        if (meta) meta.textContent = '';
        if (unlink) unlink.style.display = 'none';
      }
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
      if (state >= 2) {
        labelEl.textContent = 'XREX Pay';
        titleEl.textContent = 'Start';
        descWrap.textContent = 'Generate unique QR code and link';
        if (descWrap) { descWrap.style.display = ''; descWrap.removeAttribute('aria-hidden'); }
        btn.textContent = 'Generate link';
      } else {
        // default for state 1 and others
        labelEl.textContent = 'XREX Pay';
        titleEl.textContent = 'Enable 2FA';
        descWrap.textContent = 'Two-factor authentication is required';
        if (descWrap) { descWrap.style.display = ''; descWrap.removeAttribute('aria-hidden'); }
        btn.textContent = 'Enable 2FA';
      }
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
      var url = 'https://t.me/SanneXREX_bot?start=' + token;
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

  // Verify Code (state 4) interactions
  (function initVerifyCode(){
    try {
      var wrap = document.getElementById('step-verify-code');
      if (!wrap) return;
      var input = document.getElementById('vcCodeInput');
      var submit = document.getElementById('vcSubmitBtn');
      var errorEl = document.getElementById('vcError');
      var botLink = document.getElementById('vcBotLink');
      if (botLink) {
        var url = 'https://t.me/SanneXREX_bot';
        botLink.href = url;
      }
      // Enable/disable submit based on input presence
      if (input && submit) {
        var syncVcBtn = function(){
          try {
            var v = (input.value||'').trim();
            submit.disabled = (v.length < 1);
          } catch(_) {}
        };
        input.addEventListener('input', syncVcBtn);
        syncVcBtn();
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
                setState(3); refreshStateUI();
                try { if (typeof showSnackbar === 'function') showSnackbar('Unique QR code and link generated successfully'); } catch(_) {}
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
      function update(){ refreshStateUI(); }
      btnDown.addEventListener('click', function(){
        var s = getProgress().state;
        var next = Math.max(1, s-1);
        setState(next); update();
        // If lowering to <=3, send admin reset to server to clear verification
        try {
          var sid = (function(){ try { return localStorage.getItem('xrex.session.id.v1'); } catch(_) { return null; } })();
          var sync = (function(){ try { return (new URLSearchParams(window.location.search).get('sync')) || (typeof window !== 'undefined' && window.XREX_SYNC_URL) || '/api/state'; } catch(_) { return '/api/state'; } })();
          if (next <= 3 && sid) {
            var url = sync + (sync.indexOf('?') === -1 ? '?session=' + encodeURIComponent(sid) : '&session=' + encodeURIComponent(sid));
            fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Admin-Reset': '1' }, body: JSON.stringify({ stage: next }) }).catch(function(){});
          }
        } catch(_) {}
      });
      btnUp.addEventListener('click', function(){ var s = getProgress().state; var next = Math.min(6, s+1); setState(next); update(); });
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
    // Persist last active Telegram tab
    try { saveProgress({ lastTab: isIntro ? 'intro' : 'setup' }); } catch(_) {}
    // Update top CTA visibility per state/tab
    try { updateTopCta(); } catch(_) {}
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

  // Update the top CTA (Start linking / Go to bot) based on current state
  function updateTopCta(){
    try {
      var btn = document.getElementById('startLinkBtn');
      if (!btn) return;
      var p = getProgress();
      var s = (p.state|0);
      var isDesk = window.matchMedia('(min-width: 1280px)').matches;
      // When linked (state 6): show Go to bot on both tabs
      if (s >= 6) {
        btn.textContent = 'Go to bot';
        try {
          var url = 'https://t.me/SanneXREX_bot';
          // Turn the CTA into a link-like navigation
          btn.onclick = function(){ window.open(url, '_blank', 'noopener'); };
        } catch(_) {}
        btn.style.opacity = '1';
        btn.style.pointerEvents = '';
        btn.setAttribute('aria-hidden','false');
        return;
      }
      // Otherwise: show Start linking only on the Introduction tab
      btn.textContent = 'Start linking';
      btn.onclick = null;
      var isIntroActive = tabIntro && tabIntro.classList.contains('active');
      var hidden = !isIntroActive;
      btn.style.opacity = hidden ? '0' : '1';
      btn.style.pointerEvents = hidden ? 'none' : '';
      btn.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    } catch(_) {}
  }

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
        initInitiateBotUI();
      }
      function showAccount(){
        if (pageTitle) pageTitle.textContent = 'Account';
        if (statusRow) statusRow.style.display = 'none';
        if (tabs) tabs.style.display = 'none';
        if (panelAccount) panelAccount.style.display = '';
        if (panelIntro) panelIntro.style.display = 'none';
        if (panelSetup) panelSetup.style.display = 'none';
        if (shareBtn) shareBtn.style.display = 'none';
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
            try { if (typeof showSnackbar === 'function') showSnackbar('Verification window expired. Generate a new link.'); } catch(_){ }
            try { setState(2); refreshStateUI(); } catch(_){ }
            return;
          }
          // Only poll the server while in state 3 (waiting for 2FA verification)
          if (sNow === 3) {
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
                  if (data.twofa_verified && (p.state|0) === 3) {
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
                    try { if (typeof showSnackbar === 'function') showSnackbar('2FA verified on Telegram. Enter the linking code to continue.'); } catch(_) {}
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
})();



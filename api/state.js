const { createClient } = require('@supabase/supabase-js');

function allowCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Client-Stage, X-Admin-Reset');
}

module.exports = async (req, res) => {
  allowCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // Supabase client
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE || SUPABASE_ANON, { auth: { persistSession: false } });
  if (!SUPABASE_URL || !(SUPABASE_SERVICE || SUPABASE_ANON)) {
    res.status(500).json({ error: 'Supabase not configured' });
    return;
  }

  try {
    // Derive session id: support optional per-session isolation s
    let session = '';
    try {
      const q = (req.query && (req.query.session || req.query.s)) || '';
      if (q && typeof q === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(q)) session = q;
    } catch(_) {}
    const sessionId = session || 'default';

      if (req.method === 'GET') {
      // Optional: lookup by Telegram user id for quick status checks
      try {
        const tgParam = (req.query && (req.query.tg || req.query.tg_user_id));
        const tgStr = (tgParam !== undefined && tgParam !== null) ? String(tgParam).trim() : '';
        if (tgStr) {
          const { data: latest, error: errLatest } = await supabase
            .from('xrex_session')
            .select('session_id,current_state,twofa_verified,linking_code,last_updated_at,last_actor_tg_id,last_actor_chat_id,tg_user_id,tg_chat_id,tg_username,tg_display_name,tg_photo_url,send_test_at')
            .or(`tg_user_id.eq.${tgStr},last_actor_tg_id.eq.${tgStr}`)
            .order('last_updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (errLatest && errLatest.code !== 'PGRST116') {
            res.status(500).json({ error: 'DB read error', detail: errLatest.message });
            return;
          }
          if (!latest) {
            res.setHeader('Content-Type', 'application/json');
            res.status(200).send('{}');
            return;
          }
          const ts2 = (latest.last_updated_at ? Math.floor(new Date(latest.last_updated_at).getTime() / 1000) : Math.floor(Date.now()/1000));
          let sendTestAt = latest && latest.send_test_at ? latest.send_test_at : null;
          res.setHeader('Content-Type', 'application/json');
          res.status(200).send(JSON.stringify({
            session_id: latest.session_id,
            stage: Number(latest.current_state || 1),
            twofa_verified: !!latest.twofa_verified,
            linking_code: latest.linking_code || null,
            updated_at: ts2,
            actor_tg_user_id: latest.last_actor_tg_id || latest.tg_user_id || null,
            actor_chat_id: latest.last_actor_chat_id || latest.tg_chat_id || null,
            tg_username: latest.tg_username || null,
            tg_display_name: latest.tg_display_name || null,
            tg_photo_url: latest.tg_photo_url || null,
            send_test_at: sendTestAt || null
          }));
          return;
        }
      } catch(_) {}

      // Default: lookup by session id
      const { data, error, status } = await supabase
        .from('xrex_session')
        .select('current_state,twofa_verified,linking_code,last_updated_at,last_actor_tg_id,last_actor_chat_id,tg_username,tg_display_name,tg_photo_url,send_test_at')
        .eq('session_id', sessionId)
        .single();
      if (error && status !== 406) {
        if (error.code === 'PGRST116') { // No rows
          res.setHeader('Content-Type', 'application/json');
          res.status(200).send('{}');
          return;
        }
        res.status(500).json({ error: 'DB read error', detail: error.message });
        return;
      }
      let bodyObj = {};
      if (data) {
        const ts = (data.last_updated_at ? Math.floor(new Date(data.last_updated_at).getTime() / 1000) : Math.floor(Date.now()/1000));
        bodyObj = {
          stage: Number(data.current_state || 1),
          twofa_verified: !!data.twofa_verified,
          linking_code: data.linking_code || null,
          updated_at: ts,
          actor_tg_user_id: data.last_actor_tg_id || null,
          actor_chat_id: data.last_actor_chat_id || null,
          tg_username: data.tg_username || null,
          tg_display_name: data.tg_display_name || null,
          tg_photo_url: data.tg_photo_url || null,
          send_test_at: data.send_test_at || null
        };
      }
      // No KV usage in reverted version
      const body = JSON.stringify(bodyObj);
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send(body);
      return;
    }

    // No POST handler in reverted version

    if (req.method === 'PUT') {
      // Parse body FIRST so auth logic can inspect stage
      let payload = {};
      try {
        payload = req.body || {};
        if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch(_) { payload = {}; } }
      } catch (e) { payload = {}; }
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const isAdminReset = String(req.headers['x-admin-reset'] || '').trim() === '1';
      const isProfileOnly = String(req.headers['x-profile-only'] || '').trim() === '1';
      const hdrStage = String(req.headers['x-client-stage'] || '').trim();
      const isClientFinalize = (hdrStage === '6' && Number(payload.stage || 0) === 6);
      const isClientUnlink = (hdrStage === '7' && Number(payload.stage || 0) === 7);
      const isClientTestMsg = (hdrStage === '6' && payload && payload.test_message === true);
      if (!isAdminReset && !isProfileOnly) {
        if (!isClientFinalize && !isClientUnlink && !isClientTestMsg && (!token || token !== process.env.STATE_WRITE_TOKEN)) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
      }
      // Profile-only update path: updates tg_* fields without touching stage or other fields
      if (isProfileOnly) {
        if (!token || token !== process.env.STATE_WRITE_TOKEN) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
        const updates = {};
        if (Object.prototype.hasOwnProperty.call(payload, 'tg_username')) updates.tg_username = payload.tg_username ?? null;
        if (Object.prototype.hasOwnProperty.call(payload, 'tg_display_name')) updates.tg_display_name = payload.tg_display_name ?? null;
        if (Object.prototype.hasOwnProperty.call(payload, 'tg_photo_url')) updates.tg_photo_url = payload.tg_photo_url ?? null;
        updates.last_updated_at = nowIso;
        const upd = await supabase.from('xrex_session').update(updates).eq('session_id', sessionId);
        if (upd.error) {
          res.status(500).json({ error: 'DB write error', detail: upd.error.message });
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.status(200).send(JSON.stringify({ ok: true }));
        return;
      }

      if (!payload || typeof payload !== 'object') {
        res.status(400).json({ error: 'Bad JSON' });
        return;
      }
      const nowIso = new Date().toISOString();
      let nextState = Number(payload.stage || 1);
      // Authenticated simple field update: allow clearing or setting send_test_at without touching state
      if (!isAdminReset && !isProfileOnly && (Object.prototype.hasOwnProperty.call(payload, 'send_test_at')) && token && token === process.env.STATE_WRITE_TOKEN && !isClientFinalize && !isClientUnlink) {
        const row = { session_id: sessionId, send_test_at: (payload.send_test_at ?? null), last_updated_at: nowIso };
        const up = await supabase.from('xrex_session').upsert(row, { onConflict: 'session_id' });
        if (up.error) {
          res.status(500).json({ error: 'DB write error', detail: up.error.message });
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.status(200).send(JSON.stringify({ ok: true }));
        return;
      }
      // Admin reset path: only allow lowering to <=3, clear verification/linking
      if (isAdminReset) {
        if (!(nextState <= 3)) {
          res.status(400).json({ error: 'Admin reset only allows stage <= 3' });
          return;
        }
        const row = {
          session_id: sessionId,
          current_state: nextState,
          twofa_verified: false,
          linking_code: null,
          last_actor_tg_id: null,
          last_actor_chat_id: null,
          tg_username: null,
          tg_display_name: null,
          tg_photo_url: null,
          last_updated_at: nowIso
        };
        const up1 = await supabase.from('xrex_session').upsert(row, { onConflict: 'session_id' });
        if (up1.error) {
          res.status(500).json({ error: 'DB write error', detail: up1.error.message });
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.status(200).send(JSON.stringify({ ok: true }));
        return;
      }
      // Authenticated path OR limited client finalize
      let row;
      if (isClientFinalize || isClientUnlink) {
        // Preserve existing linking_code and twofa flag; bump to 6/7
        // For unlink (7), also preserve last_actor ids so the bot can target the right user
        let existing = null;
        try {
          const r = await supabase.from('xrex_session').select('twofa_verified,linking_code,last_actor_tg_id,last_actor_chat_id,tg_user_id,tg_chat_id').eq('session_id', sessionId).single();
          if (!r.error) existing = r.data;
        } catch(_) {}
        // Fallback actor ids from persistent tg_user_id/chat_id if last_actor is missing
        const fallbackUserId = existing && existing.last_actor_tg_id ? existing.last_actor_tg_id : (existing && existing.tg_user_id ? existing.tg_user_id : null);
        const fallbackChatId = existing && existing.last_actor_chat_id ? existing.last_actor_chat_id : (existing && existing.tg_chat_id ? existing.tg_chat_id : null);
        row = {
          session_id: sessionId,
          current_state: isClientUnlink ? 7 : 6,
          twofa_verified: existing ? !!existing.twofa_verified : true,
          linking_code: existing ? (existing.linking_code || null) : null,
          last_actor_tg_id: fallbackUserId,
          last_actor_chat_id: fallbackChatId,
          last_updated_at: nowIso
        };
        // Allow clients to backfill tg profile fields during finalize/unlink without auth
        if (payload && typeof payload === 'object') {
          if (Object.prototype.hasOwnProperty.call(payload, 'tg_username')) {
            row.tg_username = payload.tg_username ?? null;
          }
          if (Object.prototype.hasOwnProperty.call(payload, 'tg_display_name')) {
            row.tg_display_name = payload.tg_display_name ?? null;
          }
          if (Object.prototype.hasOwnProperty.call(payload, 'tg_photo_url')) {
            row.tg_photo_url = payload.tg_photo_url ?? null;
          }
        }
      } else if (isClientTestMsg) {
        // Stage 6 client requests a test message; set send_test_at to now
        const nowIso2 = new Date().toISOString();
        row = { session_id: sessionId, send_test_at: nowIso2, last_updated_at: nowIso2 };
        // Additionally, attempt to send the test message directly via Telegram as a fallback
        try {
          // Look up latest actor/tg chat ids for this session
          const r = await supabase
            .from('xrex_session')
            .select('last_actor_chat_id,tg_chat_id')
            .eq('session_id', sessionId)
            .single();
          const chatId = (r && r.data && (r.data.last_actor_chat_id || r.data.tg_chat_id)) || null;
          const BOT_TOKEN = process.env.BOT_TOKEN || '';
          if (chatId && BOT_TOKEN) {
            const tgUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
            const body = { chat_id: Number(chatId), text: '🧪 Test message from XREX Pay Bot\nYour bot is correctly linked and reachable.' };
            try {
              const resp = await fetch(tgUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
              // Ignore response errors; the poller path still exists
            } catch (e) { /* ignore network errors */ }
          }
        } catch (_) { /* ignore lookup errors */ }
      } else {
        row = {
          session_id: sessionId,
          current_state: nextState,
          twofa_verified: !!payload.twofa_verified,
          linking_code: payload.linking_code || null,
          tg_user_id: payload.actor_tg_user_id ? Number(payload.actor_tg_user_id) : null,
          tg_chat_id: payload.actor_chat_id ? Number(payload.actor_chat_id) : null,
          last_actor_tg_id: payload.actor_tg_user_id ? Number(payload.actor_tg_user_id) : null,
          last_actor_chat_id: payload.actor_chat_id ? Number(payload.actor_chat_id) : null,
          tg_username: (payload.tg_username ?? null),
          tg_display_name: (payload.tg_display_name ?? null),
          tg_photo_url: (payload.tg_photo_url ?? null),
          last_updated_at: nowIso
        };
      }
      const upsert = await supabase.from('xrex_session').upsert(row, { onConflict: 'session_id' });
      if (upsert.error) {
        res.status(500).json({ error: 'DB write error', detail: upsert.error.message });
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send(JSON.stringify({ ok: true }));
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: 'Server error', detail: (e && e.message) ? e.message : String(e) });
  }
};

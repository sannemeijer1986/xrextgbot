const { createClient } = require('@supabase/supabase-js');

function allowCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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
    // Derive session id: support optional per-session isolation
    let session = '';
    try {
      const q = (req.query && (req.query.session || req.query.s)) || '';
      if (q && typeof q === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(q)) session = q;
    } catch(_) {}
    const sessionId = session || 'default';

    if (req.method === 'GET') {
      const { data, error, status } = await supabase
        .from('xrex_session')
        .select('current_state,twofa_verified,linking_code,last_updated_at')
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
          updated_at: ts
        };
      }
      const body = JSON.stringify(bodyObj);
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send(body);
      return;
    }

    if (req.method === 'PUT') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!token || token !== process.env.STATE_WRITE_TOKEN) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      let payload = {};
      try {
        payload = req.body || {};
        if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch(_) { payload = {}; } }
      } catch (e) { payload = {}; }
      if (!payload || typeof payload !== 'object') {
        res.status(400).json({ error: 'Bad JSON' });
        return;
      }
      const nowIso = new Date().toISOString();
      const row = {
        session_id: sessionId,
        current_state: Number(payload.stage || 1),
        twofa_verified: !!payload.twofa_verified,
        linking_code: payload.linking_code || null,
        tg_user_id: payload.actor_tg_user_id ? Number(payload.actor_tg_user_id) : null,
        tg_chat_id: payload.actor_chat_id ? Number(payload.actor_chat_id) : null,
        last_actor_tg_id: payload.actor_tg_user_id ? Number(payload.actor_tg_user_id) : null,
        last_actor_chat_id: payload.actor_chat_id ? Number(payload.actor_chat_id) : null,
        last_updated_at: nowIso
      };
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



const { createClient } = require('redis');

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

  const redisUrl = process.env.REDIS_URL_TLS || process.env.REDIS_URL;
  if (!redisUrl) {
    res.status(500).json({ error: 'Missing Redis URL' });
    return;
  }
  const isRediss = /^rediss:\/\//i.test(redisUrl);
  const socketOpts = isRediss ? { tls: true } : {};
  try { if (String(process.env.REDIS_TLS_INSECURE) === '1') socketOpts.rejectUnauthorized = false; } catch(_) {}
  const client = createClient({ url: redisUrl, socket: socketOpts });
  try {
    await client.connect();
  } catch (e) {
    res.status(500).json({ error: 'Redis connect failed', detail: (e && e.message) ? e.message : String(e) });
    return;
  }

  try {
    // Derive the Redis key: support optional per-session isolation
    let session = '';
    try {
      const q = (req.query && (req.query.session || req.query.s)) || '';
      if (q && typeof q === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(q)) session = q;
    } catch(_) {}
    const redisKey = session ? `xrex:state:${session}` : 'xrex:state';

    if (req.method === 'GET') {
      const raw = await client.get(redisKey);
      const body = raw ? raw : '{}';
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
      try { payload = req.body || {}; } catch (e) { payload = {}; }
      if (!payload || typeof payload !== 'object') {
        res.status(400).json({ error: 'Bad JSON' });
        return;
      }
      payload.updated_at = Math.floor(Date.now() / 1000);
      await client.set(redisKey, JSON.stringify(payload));
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send(JSON.stringify({ ok: true }));
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: 'Server error', detail: (e && e.message) ? e.message : String(e) });
  } finally {
    try { await client.quit(); } catch (e) {}
  }
};



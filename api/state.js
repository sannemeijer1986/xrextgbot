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

  const client = createClient({ url: process.env.REDIS_URL });
  try {
    await client.connect();
  } catch (e) {
    res.status(500).json({ error: 'Redis connect failed' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const raw = await client.get('xrex:state');
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
      await client.set('xrex:state', JSON.stringify(payload));
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send(JSON.stringify({ ok: true }));
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  } finally {
    try { await client.quit(); } catch (e) {}
  }
};



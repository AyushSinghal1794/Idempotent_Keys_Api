// index.js
require('dotenv').config();
const express = require('express');
const pool = require('./db');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const KEY_TTL_MINUTES = process.env.KEY_TTL_MINUTES ? parseInt(process.env.KEY_TTL_MINUTES) : 1440;

function makeKey() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

// helper sleep
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

/**
 * POST /idempotency-keys
 * body: { user_id, operation }
 * returns: { idempotencyKey, reserved_until }
 */
app.post('/idempotency-keys', async (req, res) => {
  const { user_id, operation } = req.body || {};
  try {
    const key = makeKey();
    const reservedUntil = new Date(Date.now() + KEY_TTL_MINUTES * 60 * 1000).toISOString();

    await pool.query(
      `INSERT INTO idempotency_keys(key, status, response, user_id, operation, reserved_until, created_at, updated_at)
       VALUES ($1, 'reserved', null, $2, $3, $4, now(), now())`,
      [key, user_id || null, operation || null, reservedUntil]
    );

    return res.json({ idempotencyKey: key, reserved_until: reservedUntil });
  } catch (err) {
    console.error('Failed to create idempotency key', err);
    return res.status(500).json({ error: 'failed to create idempotency key' });
  }
});

// helper: try to claim a reserved key (atomic update)
async function tryClaimKey(key, user_id) {
  const q = await pool.query(
    `UPDATE idempotency_keys
     SET status='processing', updated_at = now()
     WHERE key = $1
       AND status = 'reserved'
       AND (user_id IS NULL OR user_id = $2)
       AND (reserved_until IS NULL OR reserved_until > now())
     RETURNING key`,
    [key, user_id || null]
  );
  return q.rowCount === 1;
}

/**
 * POST /pay
 * Header: Idempotency-Key
 * body: { user_id, amount }
 */
app.post('/pay', async (req, res) => {
  const idempKey = req.header('Idempotency-Key');
  const { user_id, amount } = req.body || {};

  if (!idempKey) return res.status(400).json({ error: 'Missing Idempotency-Key header' });
  if (!user_id || !amount) return res.status(400).json({ error: 'Missing user_id or amount' });

  try {
    // 1) Validate key exists
    const existing = await pool.query('SELECT status, response FROM idempotency_keys WHERE key=$1', [idempKey]);
    if (existing.rowCount === 0) {
      return res.status(400).json({ error: 'Unknown idempotency key. Acquire a key first.' });
    }

    const row = existing.rows[0];
    if (row.status === 'completed') {
      return res.json(row.response);
    }

    // 2) Try to claim
    const claimed = await tryClaimKey(idempKey, user_id);
    if (claimed) {
      // Owned: do business
      let client;
      try {
        client = await pool.connect();
        await client.query('BEGIN');

        const payRes = await client.query(
          'INSERT INTO payments (user_id, amount) VALUES ($1, $2) RETURNING id, created_at',
          [user_id, amount]
        );

        await client.query('COMMIT');

        const responsePayload = {
          success: true,
          paymentId: payRes.rows[0].id,
          created_at: payRes.rows[0].created_at
        };

        await pool.query(
          'UPDATE idempotency_keys SET status=$2, response=$3, updated_at=now() WHERE key=$1',
          [idempKey, 'completed', responsePayload]
        );

        return res.json(responsePayload);
      } catch (err) {
        if (client) {
          try { await client.query('ROLLBACK'); } catch (e) {}
        }
        await pool.query(
          'UPDATE idempotency_keys SET status=$2, response=$3, updated_at=now() WHERE key=$1',
          [idempKey, 'failed', { error: err.message }]
        );
        console.error('Payment processing error:', err);
        return res.status(500).json({ error: 'Payment failed', detail: err.message });
      } finally {
        if (client) client.release();
      }
    } else {
      // Someone else reserved/processing the key — short-poll for result
      const maxWaitMs = 5000;
      const intervalMs = 100;
      let waited = 0;
      while (waited < maxWaitMs) {
        const q = await pool.query('SELECT status, response FROM idempotency_keys WHERE key=$1', [idempKey]);
        const r = q.rows[0];
        if (r.status === 'completed') return res.json(r.response);
        if (r.status === 'failed') return res.status(500).json({ error: 'Previous attempt failed', detail: r.response });
        await sleep(intervalMs);
        waited += intervalMs;
      }
      return res.status(202).json({ status: 'processing', message: 'Request being processed; check status endpoint.' });
    }

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
});

// GET endpoints for inspection
app.get('/payments', async (req, res) => {
  const q = await pool.query('SELECT * FROM payments ORDER BY id DESC LIMIT 100');
  res.json(q.rows);
});

app.get('/idempotency/:key', async (req, res) => {
  const key = req.params.key;
  const q = await pool.query('SELECT * FROM idempotency_keys WHERE key=$1', [key]);
  if (q.rowCount === 0) return res.status(404).json({ error: 'not found' });
  res.json(q.rows[0]);
});

app.listen(PORT, () => {
  console.log(`Idempotency server (server-issued keys) listening on ${PORT}`);
});

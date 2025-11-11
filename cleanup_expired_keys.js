// cleanup_expired_keys.js
// Deletes 'reserved' keys that have passed reserved_until
require('dotenv').config();
const pool = require('./db');

async function cleanup() {
  try {
    const q = await pool.query(
      `DELETE FROM idempotency_keys WHERE status='reserved' AND reserved_until IS NOT NULL AND reserved_until < now() RETURNING key`
    );
    console.log('Deleted expired keys:', q.rowCount);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

cleanup();

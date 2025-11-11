-- payments table
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    amount INT NOT NULL,
    created_at TIMESTAMP DEFAULT now()
);

-- idempotency_keys table (server-issued keys + lifecycle)
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    status TEXT NOT NULL,               -- 'reserved'|'processing'|'completed'|'failed'
    response JSONB,
    user_id INT,
    operation TEXT,
    reserved_until TIMESTAMP,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idemp_user ON idempotency_keys(user_id);

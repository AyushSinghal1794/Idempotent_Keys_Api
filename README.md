# idempotent-payments-api

A production-grade **idempotent API** implementation designed to prevent duplicate side-effects (such as double charges) when clients retry requests due to network failures, UI multi-clicks, or concurrency races.  
This project demonstrates **server-issued idempotency keys** with atomic claim semantics and response caching to ensure **exactly-one** execution of operations that modify state.

## 🚀 Key Features

- **Server-issued idempotency keys** with TTL and cleanup logic
- **Atomic key claim** using PostgreSQL `UPDATE ... WHERE` to safely handle concurrent requests
- **Zero duplicate database writes**, even under simultaneous identical requests
- **Stored canonical responses** (`JSONB`) to ensure deterministic retries
- **Short-poll waiting strategy** for in-progress operations
- Minimal setup — runs locally with Node.js & PostgreSQL

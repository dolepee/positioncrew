CREATE TABLE IF NOT EXISTS fresh_marketplace_hires (
  hire_id TEXT PRIMARY KEY NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_slug TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  benchmark_slug TEXT NOT NULL,
  service TEXT NOT NULL,
  evidence_mode TEXT NOT NULL CHECK (evidence_mode = 'HISTORICAL_FIXTURE'),
  direct_cost_usd TEXT NOT NULL CHECK (direct_cost_usd = '0.00'),
  wallet_required INTEGER NOT NULL CHECK (wallet_required = 0),
  request_json TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 71 AND substr(request_hash, 1, 7) = 'sha256:'),
  created_at TEXT NOT NULL,
  CHECK (
    (benchmark_slug = 'lending-rescue' AND provider_slug = 'lending-rescue' AND service = 'LENDING_RESCUE') OR
    (benchmark_slug = 'lp-rebalance' AND provider_slug = 'lp-rebalance' AND service = 'LP_REBALANCE') OR
    (benchmark_slug = 'bounded-grid' AND provider_slug = 'bounded-grid' AND service = 'BOUNDED_GRID')
  )
) STRICT;

CREATE TABLE IF NOT EXISTS fresh_marketplace_jobs (
  job_id TEXT PRIMARY KEY NOT NULL,
  hire_id TEXT NOT NULL UNIQUE REFERENCES fresh_marketplace_hires(hire_id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('CREATED', 'RUNNING', 'COMPLETED', 'FAILED')),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  api_duration_milliseconds INTEGER CHECK (api_duration_milliseconds IS NULL OR api_duration_milliseconds > 0),
  error_code TEXT,
  error_message TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS fresh_marketplace_receipts (
  receipt_id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL UNIQUE REFERENCES fresh_marketplace_jobs(job_id) ON DELETE RESTRICT,
  hire_id TEXT NOT NULL UNIQUE REFERENCES fresh_marketplace_hires(hire_id) ON DELETE RESTRICT,
  response_json TEXT NOT NULL,
  response_hash TEXT NOT NULL CHECK (length(response_hash) = 71 AND substr(response_hash, 1, 7) = 'sha256:'),
  deliverable_hash TEXT NOT NULL CHECK (length(deliverable_hash) = 71 AND substr(deliverable_hash, 1, 7) = 'sha256:'),
  evaluation_hash TEXT NOT NULL CHECK (length(evaluation_hash) = 71 AND substr(evaluation_hash, 1, 7) = 'sha256:'),
  created_at TEXT NOT NULL
) STRICT;

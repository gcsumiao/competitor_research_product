CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id BIGSERIAL PRIMARY KEY,
  source_name TEXT NOT NULL,
  category_id TEXT,
  month_key TEXT,
  snapshot_date DATE,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS category_snapshots (
  id BIGSERIAL PRIMARY KEY,
  category_id TEXT NOT NULL,
  label TEXT NOT NULL,
  month_key TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  source_mode TEXT,
  totals_revenue DOUBLE PRECISION NOT NULL DEFAULT 0,
  totals_units DOUBLE PRECISION NOT NULL DEFAULT 0,
  totals_asin_count INTEGER NOT NULL DEFAULT 0,
  snapshot_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (category_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS source_artifacts (
  id BIGSERIAL PRIMARY KEY,
  artifact_path TEXT NOT NULL UNIQUE,
  category_id TEXT,
  month_key TEXT,
  snapshot_date DATE,
  artifact_kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  byte_size BIGINT NOT NULL,
  sha256 TEXT,
  modified_at TIMESTAMPTZ,
  content BYTEA NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS snapshot_rows (
  id BIGSERIAL PRIMARY KEY,
  snapshot_id BIGINT NOT NULL REFERENCES category_snapshots(id) ON DELETE CASCADE,
  row_source TEXT NOT NULL,
  asin TEXT,
  title TEXT,
  brand TEXT,
  type_label TEXT,
  price DOUBLE PRECISION,
  revenue DOUBLE PRECISION,
  units DOUBLE PRECISION,
  review_count DOUBLE PRECISION,
  rating DOUBLE PRECISION,
  fulfillment TEXT,
  size_tier TEXT,
  subcategory TEXT,
  url TEXT,
  image_url TEXT,
  monthly_revenue DOUBLE PRECISION,
  monthly_units DOUBLE PRECISION,
  estimated_revenue_12mo DOUBLE PRECISION,
  estimated_units_12mo DOUBLE PRECISION,
  rank_revenue INTEGER,
  rank_units INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS snapshot_products (
  id BIGSERIAL PRIMARY KEY,
  snapshot_id BIGINT NOT NULL REFERENCES category_snapshots(id) ON DELETE CASCADE,
  product_group TEXT NOT NULL,
  rank_position INTEGER,
  brand_sheet TEXT,
  asin TEXT,
  title TEXT,
  brand TEXT,
  price DOUBLE PRECISION,
  revenue DOUBLE PRECISION,
  units DOUBLE PRECISION,
  review_count DOUBLE PRECISION,
  rating DOUBLE PRECISION,
  tool_type TEXT,
  avg_price DOUBLE PRECISION,
  estimated_revenue_12mo DOUBLE PRECISION,
  monthly_revenue DOUBLE PRECISION,
  estimated_units_12mo DOUBLE PRECISION,
  monthly_units DOUBLE PRECISION,
  tool_rating DOUBLE PRECISION,
  fulfillment TEXT,
  size_tier TEXT,
  subcategory TEXT,
  url TEXT,
  image_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS snapshot_brand_totals (
  id BIGSERIAL PRIMARY KEY,
  snapshot_id BIGINT NOT NULL REFERENCES category_snapshots(id) ON DELETE CASCADE,
  brand TEXT NOT NULL,
  revenue DOUBLE PRECISION NOT NULL DEFAULT 0,
  units DOUBLE PRECISION NOT NULL DEFAULT 0,
  share DOUBLE PRECISION NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS snapshot_price_tiers (
  id BIGSERIAL PRIMARY KEY,
  snapshot_id BIGINT NOT NULL REFERENCES category_snapshots(id) ON DELETE CASCADE,
  scope_key TEXT NOT NULL,
  label TEXT NOT NULL,
  revenue DOUBLE PRECISION NOT NULL DEFAULT 0,
  revenue_share DOUBLE PRECISION NOT NULL DEFAULT 0,
  units DOUBLE PRECISION NOT NULL DEFAULT 0,
  units_share DOUBLE PRECISION NOT NULL DEFAULT 0,
  revenue_mom DOUBLE PRECISION,
  revenue_yoy DOUBLE PRECISION,
  units_mom DOUBLE PRECISION,
  units_yoy DOUBLE PRECISION,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS snapshot_rolling_12 (
  id BIGSERIAL PRIMARY KEY,
  snapshot_id BIGINT NOT NULL REFERENCES category_snapshots(id) ON DELETE CASCADE,
  metric_name TEXT NOT NULL,
  brand TEXT NOT NULL,
  rank INTEGER,
  monthly DOUBLE PRECISION,
  grand_total DOUBLE PRECISION,
  month_labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_month_label TEXT,
  market_series JSONB NOT NULL DEFAULT '[]'::jsonb,
  market_total_monthly DOUBLE PRECISION,
  overall_total_monthly DOUBLE PRECISION,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS snapshot_type_breakdowns (
  id BIGSERIAL PRIMARY KEY,
  snapshot_id BIGINT NOT NULL REFERENCES category_snapshots(id) ON DELETE CASCADE,
  metric_set TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  label TEXT NOT NULL,
  avg_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  avg_price_mom DOUBLE PRECISION,
  avg_price_yoy DOUBLE PRECISION,
  units DOUBLE PRECISION NOT NULL DEFAULT 0,
  units_share DOUBLE PRECISION NOT NULL DEFAULT 0,
  units_mom DOUBLE PRECISION,
  units_yoy DOUBLE PRECISION,
  revenue DOUBLE PRECISION NOT NULL DEFAULT 0,
  revenue_share DOUBLE PRECISION NOT NULL DEFAULT 0,
  revenue_mom DOUBLE PRECISION,
  revenue_yoy DOUBLE PRECISION,
  source_kind TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS snapshot_category_brand_mix (
  id BIGSERIAL PRIMARY KEY,
  snapshot_id BIGINT NOT NULL REFERENCES category_snapshots(id) ON DELETE CASCADE,
  scope_key TEXT NOT NULL,
  scope_label TEXT NOT NULL,
  brand TEXT NOT NULL,
  avg_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  units DOUBLE PRECISION NOT NULL DEFAULT 0,
  units_share DOUBLE PRECISION NOT NULL DEFAULT 0,
  revenue DOUBLE PRECISION NOT NULL DEFAULT 0,
  revenue_share DOUBLE PRECISION NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS snapshot_feature_premiums (
  id BIGSERIAL PRIMARY KEY,
  snapshot_id BIGINT NOT NULL REFERENCES category_snapshots(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  with_feature_avg_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  without_feature_avg_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  premium_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  with_feature_revenue_share DOUBLE PRECISION NOT NULL DEFAULT 0,
  with_feature_unit_share DOUBLE PRECISION NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS consult_me_history_records (
  task_id TEXT PRIMARY KEY,
  company_key TEXT NOT NULL DEFAULT '',
  company_label TEXT NOT NULL DEFAULT '',
  research_type TEXT NOT NULL DEFAULT 'custom',
  research_subject TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  has_report BOOLEAN NOT NULL DEFAULT FALSE,
  deliverables JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS consult_me_hidden_seed_tasks (
  task_id TEXT PRIMARY KEY,
  hidden_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_category_snapshots_category_date
  ON category_snapshots (category_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_source_artifacts_category_date
  ON source_artifacts (category_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_source_artifacts_kind
  ON source_artifacts (artifact_kind);

CREATE INDEX IF NOT EXISTS idx_snapshot_rows_snapshot_source
  ON snapshot_rows (snapshot_id, row_source);

CREATE INDEX IF NOT EXISTS idx_snapshot_products_snapshot_group
  ON snapshot_products (snapshot_id, product_group);

CREATE INDEX IF NOT EXISTS idx_snapshot_brand_totals_snapshot
  ON snapshot_brand_totals (snapshot_id);

CREATE INDEX IF NOT EXISTS idx_snapshot_price_tiers_snapshot
  ON snapshot_price_tiers (snapshot_id);

CREATE INDEX IF NOT EXISTS idx_snapshot_rolling_12_snapshot_metric
  ON snapshot_rolling_12 (snapshot_id, metric_name);

CREATE INDEX IF NOT EXISTS idx_snapshot_type_breakdowns_snapshot_metric
  ON snapshot_type_breakdowns (snapshot_id, metric_set);

CREATE INDEX IF NOT EXISTS idx_snapshot_category_brand_mix_snapshot
  ON snapshot_category_brand_mix (snapshot_id);

CREATE INDEX IF NOT EXISTS idx_snapshot_feature_premiums_snapshot
  ON snapshot_feature_premiums (snapshot_id);

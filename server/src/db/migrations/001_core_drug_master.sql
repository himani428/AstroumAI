-- 001: ingestion provenance + drug master core.
CREATE TABLE ingestion_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset TEXT NOT NULL,
  source_file TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  source_version TEXT,
  source_date TEXT,
  pipeline_version TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('COMMIT','DRY_RUN')),
  status TEXT NOT NULL CHECK (status IN ('RUNNING','COMPLETED','SKIPPED_UNCHANGED','FAILED')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_imported INTEGER NOT NULL DEFAULT 0,
  rows_rejected INTEGER NOT NULL DEFAULT 0,
  rows_duplicate INTEGER NOT NULL DEFAULT 0,
  rows_unresolved INTEGER NOT NULL DEFAULT 0,
  queue_items_created INTEGER NOT NULL DEFAULT 0,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  error TEXT
);
CREATE INDEX idx_batches_dataset ON ingestion_batches(dataset, id);

-- Original source rows are preserved verbatim (raw_json) and never mutated.
CREATE TABLE source_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES ingestion_batches(id),
  dataset TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  raw_json TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('IMPORTED','REJECTED','DUPLICATE')),
  reason_code TEXT,
  detail TEXT
);
CREATE INDEX idx_source_rows_batch ON source_rows(batch_id, status);
CREATE INDEX idx_source_rows_dataset ON source_rows(dataset, row_hash);

CREATE TABLE dataset_versions (
  dataset TEXT PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES ingestion_batches(id),
  version_label TEXT,
  source_date TEXT,
  freshness_basis TEXT NOT NULL,         -- DECLARED_SOURCE_DATE | LOAD_TIME_ONLY
  loaded_at TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  max_age_days INTEGER NOT NULL,
  source_sha256 TEXT NOT NULL
);

CREATE TABLE drug_products (
  product_id TEXT PRIMARY KEY,
  brand_name TEXT NOT NULL,
  brand_norm TEXT NOT NULL,
  manufacturer TEXT,
  dose_form TEXT,
  strength_text TEXT,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  effective_from TEXT,
  is_fdc INTEGER NOT NULL DEFAULT 0,
  ingredient_count INTEGER NOT NULL,
  anomaly_flags TEXT NOT NULL DEFAULT '[]',
  batch_id INTEGER NOT NULL REFERENCES ingestion_batches(id),
  source_row_id INTEGER NOT NULL REFERENCES source_rows(id)
);
CREATE INDEX idx_products_brand ON drug_products(brand_norm);
CREATE INDEX idx_products_fdc ON drug_products(is_fdc);

CREATE TABLE product_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES drug_products(product_id),
  position INTEGER NOT NULL,
  ingredient_name TEXT NOT NULL,
  ingredient_norm TEXT NOT NULL,
  strength_value REAL,
  strength_unit TEXT,
  strength_unit_note TEXT,
  decomposition_method TEXT NOT NULL,
  decomposition_confidence REAL NOT NULL,
  verification_status TEXT NOT NULL,     -- see DESIGN.md D-006
  verification_detail TEXT,
  batch_id INTEGER NOT NULL,
  source_row_id INTEGER NOT NULL
);
CREATE INDEX idx_pi_product ON product_ingredients(product_id);
CREATE INDEX idx_pi_ingredient ON product_ingredients(ingredient_norm);

CREATE TABLE nlem_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  medicine TEXT NOT NULL, medicine_norm TEXT NOT NULL,
  therapeutic_category TEXT, care_levels TEXT, nlem_edition TEXT,
  batch_id INTEGER NOT NULL, source_row_id INTEGER NOT NULL
);
CREATE INDEX idx_nlem_norm ON nlem_entries(medicine_norm);

CREATE TABLE jan_aushadhi_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generic_name TEXT NOT NULL, generic_norm TEXT NOT NULL,
  strength TEXT, pack TEXT, mrp_inr REAL, catalog_version TEXT,
  batch_id INTEGER NOT NULL, source_row_id INTEGER NOT NULL
);
CREATE INDEX idx_ja_norm ON jan_aushadhi_entries(generic_norm);

CREATE TABLE stock_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_name_as_billed TEXT NOT NULL,
  parsed_brand TEXT, parsed_brand_norm TEXT, parsed_form_hint TEXT, parsed_pack TEXT,
  qty_units INTEGER, mrp_inr REAL, batch_no TEXT, expiry TEXT,
  mapped_product_id TEXT REFERENCES drug_products(product_id),
  mapping_status TEXT NOT NULL,          -- MAPPED | QUEUED | UNMAPPED
  mapping_method TEXT, mapping_confidence REAL,
  batch_id INTEGER NOT NULL, source_row_id INTEGER NOT NULL
);
CREATE INDEX idx_stock_product ON stock_items(mapped_product_id);

CREATE TABLE regulatory_events (
  event_id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL,
  date_published TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_description TEXT NOT NULL,
  supersedes_event_id TEXT,
  note TEXT,
  target_key TEXT NOT NULL,
  target_json TEXT NOT NULL,
  batch_id INTEGER NOT NULL, source_row_id INTEGER NOT NULL
);
CREATE INDEX idx_reg_target ON regulatory_events(target_key);

CREATE TABLE interaction_pairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_a TEXT NOT NULL, ingredient_b TEXT NOT NULL,
  a_norm TEXT NOT NULL, b_norm TEXT NOT NULL,
  severity TEXT NOT NULL, note TEXT, source_tag TEXT,
  batch_id INTEGER NOT NULL, source_row_id INTEGER NOT NULL
);

CREATE TABLE seed_prescriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rx_id TEXT NOT NULL, item_no INTEGER NOT NULL,
  written_product TEXT NOT NULL, strength_as_written TEXT, dose_frequency TEXT, clinical_note TEXT,
  batch_id INTEGER NOT NULL, source_row_id INTEGER NOT NULL
);

-- 002: ambiguity review queue, decisions, alias confirmations, audit log.
CREATE TABLE review_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type TEXT NOT NULL,               -- BRAND_COLLISION | STOCK_LINE | RX_LINE | FDC_DECOMPOSITION | UNIT_ANOMALY
  dedupe_key TEXT NOT NULL UNIQUE,
  input_text TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  candidates_json TEXT NOT NULL DEFAULT '[]',
  reason_codes_json TEXT NOT NULL,
  confidence REAL,
  method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','REJECTED','DEFERRED')),
  resolution_json TEXT,
  source_dataset TEXT, source_row_id INTEGER, batch_id INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_queue_status ON review_queue(status, item_type);

CREATE TABLE review_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_id INTEGER NOT NULL REFERENCES review_queue(id),
  decided_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  decision TEXT NOT NULL,
  note TEXT,
  before_json TEXT NOT NULL, after_json TEXT NOT NULL
);

CREATE TABLE alias_confirmations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alias_norm TEXT NOT NULL,
  strength_norm TEXT NOT NULL DEFAULT '',
  product_id TEXT NOT NULL REFERENCES drug_products(product_id),
  decision_id INTEGER NOT NULL REFERENCES review_decisions(id),
  created_at TEXT NOT NULL,
  UNIQUE(alias_norm, strength_norm)
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_audit_at ON audit_log(at);

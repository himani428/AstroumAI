-- 004: recorded runs (safety, QA, evaluation, traces). Demo/seeded runs are labelled.
CREATE TABLE safety_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('SEEDED_DEMO','USER','TRACE','SIMULATION')),
  rx_label TEXT,
  as_of TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  data_version TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT NOT NULL
);
CREATE TABLE qa_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  origin TEXT NOT NULL,
  question TEXT NOT NULL,
  outcome TEXT NOT NULL,                 -- ANSWERED | ABSTAINED
  output_json TEXT NOT NULL
);
CREATE TABLE eval_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  versions_json TEXT NOT NULL,
  total INTEGER NOT NULL, correct INTEGER NOT NULL, abstained INTEGER NOT NULL, wrong INTEGER NOT NULL,
  results_json TEXT NOT NULL
);
CREATE TABLE trace_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  origin TEXT NOT NULL,
  trace_json TEXT NOT NULL
);

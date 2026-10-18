-- 003: Module B corpus (STW PDFs + local protocol).
CREATE TABLE corpus_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_code TEXT NOT NULL,
  title TEXT NOT NULL,
  version TEXT NOT NULL,
  effective_date TEXT,
  supersedes TEXT,
  status TEXT NOT NULL,                  -- CURRENT | SUPERSEDED | LOCAL_PROTOCOL
  source_type TEXT NOT NULL,             -- NATIONAL_STW | LOCAL_PROTOCOL
  specialty TEXT, condition_label TEXT, issuer TEXT,
  file_name TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  page_count INTEGER NOT NULL,
  extraction_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  loaded_at TEXT NOT NULL,
  UNIQUE(doc_code, version)
);

CREATE TABLE corpus_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL REFERENCES corpus_documents(id),
  ordinal INTEGER NOT NULL,
  page INTEGER,
  anchor TEXT NOT NULL,                  -- e.g. "p1 / FIRST-LINE MANAGEMENT / bullet 2" or "Step 2"
  section TEXT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL
);
CREATE INDEX idx_chunks_doc ON corpus_chunks(doc_id, ordinal);

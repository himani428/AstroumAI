import type { Db } from '../db/connection.js';
import { all } from '../db/connection.js';
import type { RegEvent } from '../regulatory/types.js';
import type { DatasetVersionInfo, InteractionPair, RailData } from './types.js';

/** SQLite-backed read-only data for the rail. */
export class SqliteRailData implements RailData {
  constructor(private db: Db, private extraEvents: RegEvent[] = []) {}
  getDataVersions(): DatasetVersionInfo[] {
    return all<DatasetVersionInfo>(this.db, 'SELECT dataset, version_label, source_date, freshness_basis, loaded_at, max_age_days, batch_id, source_sha256, row_count FROM dataset_versions ORDER BY dataset');
  }
  getRegulatoryEvents(): RegEvent[] {
    const rows = all<Record<string, unknown>>(this.db, 'SELECT * FROM regulatory_events ORDER BY event_id');
    const evs = rows.map((r) => ({
      event_id: r.event_id as string, notification_id: r.notification_id as string, date_published: r.date_published as string, effective_date: r.effective_date as string,
      action: r.action as string, target_type: r.target_type as string, target_description: r.target_description as string, supersedes_event_id: (r.supersedes_event_id as string) || null,
      note: (r.note as string) || null, target_key: r.target_key as string, target: JSON.parse(r.target_json as string), source_row_id: r.source_row_id as number, batch_id: r.batch_id as number,
    }));
    return [...evs, ...this.extraEvents];
  }
  getInteractionPairs(): InteractionPair[] {
    return all<Record<string, unknown>>(this.db, 'SELECT * FROM interaction_pairs ORDER BY id').map((r) => ({
      a: r.ingredient_a as string, b: r.ingredient_b as string, a_norm: r.a_norm as string, b_norm: r.b_norm as string, severity: r.severity as string,
      note: r.note as string | null, source_tag: r.source_tag as string | null, batch_id: r.batch_id as number, source_row_id: r.source_row_id as number,
    }));
  }
  getIngredientVocab(): Set<string> {
    return new Set(all<{ n: string }>(this.db, 'SELECT DISTINCT ingredient_norm n FROM product_ingredients').map((r) => r.n));
  }
}

/** Wraps any RailData to simulate a dependency outage (demo mode / tests). */
export class OutageRailData implements RailData {
  constructor(private inner: RailData, private failing: 'regulatory' | 'interactions' | 'all') {}
  getDataVersions() { if (this.failing === 'all') throw new Error('simulated data store outage'); return this.inner.getDataVersions(); }
  getRegulatoryEvents(): RegEvent[] { if (this.failing === 'regulatory') throw new Error('simulated regulatory register outage'); return this.inner.getRegulatoryEvents(); }
  getInteractionPairs(): InteractionPair[] { if (this.failing === 'interactions') throw new Error('simulated interaction store outage'); return this.inner.getInteractionPairs(); }
  getIngredientVocab() { return this.inner.getIngredientVocab(); }
}

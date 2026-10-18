export interface RegEvent {
  event_id: string;
  notification_id: string;
  date_published: string;
  effective_date: string;
  action: string;
  target_type: string;
  target_description: string;
  supersedes_event_id: string | null;
  note: string | null;
  target_key: string;
  target: ParsedTarget;
  source_row_id?: number;
  batch_id?: number;
}

export interface ParsedTarget {
  target_type: string;
  components: string[]; // normalized ingredient names, sorted
  forms: string[]; // lower-case dose forms the target is limited to (empty = all)
  paediatric: boolean;
  ratio_specific: boolean;
  descriptive: boolean; // not machine-matchable (class-style description)
  qualifiers: string[]; // raw qualifier text for display
}

export type DerivedState = 'PROHIBITED' | 'RESTRICTED' | 'WITHDRAWN' | 'STAYED' | 'NO_EVENT_IN_FORCE' | 'SOURCE_CONFLICT';

export interface TimelineEntry {
  event_id: string;
  notification_id: string;
  action: string;
  date_published: string;
  effective_date: string;
  supersedes_event_id: string | null;
  in_force: boolean;
  superseded_by: string | null;
  note: string | null;
}

export interface DerivedTarget {
  target_key: string;
  target_description: string;
  target: ParsedTarget;
  as_of: string;
  state: DerivedState;
  /** The event the current state is cited from (notification + effective date). */
  citing_event: TimelineEntry | null;
  active_event_ids: string[];
  pending_events: TimelineEntry[];
  timeline: TimelineEntry[];
  conflicts: string[];
  anomalies: string[];
}

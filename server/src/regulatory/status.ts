import type { DerivedTarget, DerivedState, RegEvent, TimelineEntry } from './types.js';

const ACTION_STATE: Record<string, DerivedState> = {
  PROHIBITED: 'PROHIBITED',
  RESTRICTED: 'RESTRICTED',
  WITHDRAWN: 'WITHDRAWN',
  STAY_GRANTED: 'STAYED',
};

const toEntry = (e: RegEvent, inForce: boolean, supersededBy: string | null): TimelineEntry => ({
  event_id: e.event_id,
  notification_id: e.notification_id,
  action: e.action,
  date_published: e.date_published,
  effective_date: e.effective_date,
  supersedes_event_id: e.supersedes_event_id,
  in_force: inForce,
  superseded_by: supersededBy,
  note: e.note,
});

/**
 * Event-sourced status derivation. There is NO stored banned flag: the state at `asOf` is a pure
 * function of effective-dated events and their supersession links.
 *
 *  1. in force   = effective_date <= asOf
 *  2. superseded = referenced by supersedes_event_id of an in-force event
 *  3. active     = in force and not superseded
 *  4. distinct actions among active events (no link between them) => SOURCE_CONFLICT
 *
 * Data anomalies (dangling links, supersession that predates its target, publication after
 * effectiveness) are returned as findings rather than hidden.
 */
export function deriveTargets(events: RegEvent[], asOf: string): DerivedTarget[] {
  const byId = new Map(events.map((e) => [e.event_id, e]));
  const groups = new Map<string, RegEvent[]>();
  for (const e of events) {
    const g = groups.get(e.target_key) ?? [];
    g.push(e);
    groups.set(e.target_key, g);
  }
  const out: DerivedTarget[] = [];
  for (const [key, evs] of groups) {
    evs.sort((a, b) => a.effective_date.localeCompare(b.effective_date) || a.event_id.localeCompare(b.event_id));
    const anomalies: string[] = [];
    const conflicts: string[] = [];
    for (const e of evs) {
      if (e.supersedes_event_id) {
        const target = byId.get(e.supersedes_event_id);
        if (!target) anomalies.push(`${e.event_id} supersedes ${e.supersedes_event_id}, which is not in the register (DANGLING_SUPERSEDES)`);
        else if (target.effective_date > e.effective_date)
          anomalies.push(`${e.event_id} (effective ${e.effective_date}) supersedes ${target.event_id} which is effective later (${target.effective_date}) (SUPERSESSION_ORDER)`);
        else if (target.target_key !== e.target_key)
          anomalies.push(`${e.event_id} supersedes ${target.event_id} which concerns a different target (CROSS_TARGET_SUPERSESSION)`);
      }
      if (e.date_published > e.effective_date) anomalies.push(`${e.event_id} published ${e.date_published} after its effective date ${e.effective_date} (PUBLISHED_AFTER_EFFECTIVE)`);
    }
    const inForce = evs.filter((e) => e.effective_date <= asOf);
    const supersededBy = new Map<string, string>();
    for (const e of inForce) if (e.supersedes_event_id) supersededBy.set(e.supersedes_event_id, e.event_id);
    const active = inForce.filter((e) => !supersededBy.has(e.event_id));
    const pending = evs.filter((e) => e.effective_date > asOf);
    const timeline = evs.map((e) => toEntry(e, e.effective_date <= asOf, supersededBy.get(e.event_id) ?? null));
    let state: DerivedState = 'NO_EVENT_IN_FORCE';
    let citing: TimelineEntry | null = null;
    if (active.length > 0) {
      const states = new Set(active.map((e) => ACTION_STATE[e.action] ?? 'SOURCE_CONFLICT'));
      const latest = active[active.length - 1]!;
      citing = toEntry(latest, true, null);
      if (states.size > 1 || states.has('SOURCE_CONFLICT')) {
        state = 'SOURCE_CONFLICT';
        conflicts.push(`Active events ${active.map((a) => `${a.event_id}(${a.action})`).join(', ')} disagree and are not linked by supersession`);
      } else {
        state = [...states][0]!;
      }
    }
    out.push({
      target_key: key,
      target_description: evs[0]!.target_description,
      target: evs[0]!.target,
      as_of: asOf,
      state,
      citing_event: citing,
      active_event_ids: active.map((a) => a.event_id),
      pending_events: pending.map((e) => toEntry(e, false, null)),
      timeline,
      conflicts,
      anomalies,
    });
  }
  return out.sort((a, b) => a.target_description.localeCompare(b.target_description));
}

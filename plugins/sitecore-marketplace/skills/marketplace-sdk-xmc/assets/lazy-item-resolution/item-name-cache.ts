// S12 — Module-singleton cache of resolved datasource item names.
//
// Why a singleton (vs atlas-store): names are derived metadata, not
// part of the scan's frozen state. Resolving lazily means we only pay
// the Authoring round-trip when the marketer actually opens a panel
// or drawer that surfaces the items, and the cache survives surface
// remounts (panel ↔ widget) without being bound to a scan.
//
// API:
//   getName(id)            — synchronous lookup. Returns the resolved
//                            name (preferred) or undefined.
//   markPending(ids)       — caller declares "I'd like these resolved";
//                            no-op for already-pending/resolved entries.
//   ingestResolved(map)    — store a batch of id → name pairs and
//                            notify subscribers.
//   subscribe(listener)    — fired on every state change.
//
// The React hook in `core/use-datasource-names.ts` wraps subscribe +
// resolveItemNames + a small concurrency guard so multiple components
// asking for the same id don't double-resolve.

export type DatasourceNameStatus = 'pending' | 'resolved' | 'failed';

type Entry = {
  readonly status: DatasourceNameStatus;
  readonly name?: string;
};

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function getName(id: string): string | undefined {
  return cache.get(id)?.name;
}

export function getStatus(id: string): DatasourceNameStatus | undefined {
  return cache.get(id)?.status;
}

export function snapshot(): ReadonlyMap<string, Entry> {
  return cache;
}

// Caller declares "I'd like these ids resolved." Any id already known
// (status !== undefined) is left alone. Returns the subset that the
// caller should drive a network round-trip for.
export function claimUnresolved(ids: ReadonlyArray<string>): ReadonlyArray<string> {
  const out: string[] = [];
  for (const id of ids) {
    if (cache.has(id)) continue;
    cache.set(id, { status: 'pending' });
    out.push(id);
  }
  if (out.length > 0) notify();
  return out;
}

export function ingestResolved(resolved: ReadonlyMap<string, string>): void {
  if (resolved.size === 0) return;
  for (const [id, name] of resolved) {
    cache.set(id, { status: 'resolved', name });
  }
  notify();
}

export function ingestFailed(ids: ReadonlyArray<string>): void {
  if (ids.length === 0) return;
  for (const id of ids) {
    const existing = cache.get(id);
    // Don't downgrade resolved entries; only pending → failed.
    if (existing && existing.status === 'resolved') continue;
    cache.set(id, { status: 'failed' });
  }
  notify();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Test-only escape hatch — clears the singleton. Production code never
// calls this; the cache is intentionally process-lifetime.
export function __resetForTests(): void {
  cache.clear();
  listeners.clear();
}

// S12 — React hook that drives lazy resolution of datasource item names
// and re-renders consumers when names land.
//
// Usage:
//   const names = useDatasourceNames(client, contextId, dsIds);
//   const display = names.get(dsId) ?? deriveDatasourceDisplayName(dsId);

import { useEffect, useSyncExternalStore } from 'react';
import type { ClientSDK } from '@sitecore-marketplace-sdk/client';
import {
  claimUnresolved,
  getName,
  ingestFailed,
  ingestResolved,
  subscribe,
} from '@/core/datasource-name-cache';
import { resolveItemNames } from '@/lib/sdk/authoring-resolve';

// Filter rule — only attempt to resolve ids that look like Sitecore item
// references (GUIDs or paths). For other shapes (`local:` paths) the
// `deriveDatasourceDisplayName` helper already produces a usable name
// and we should NOT spend an Authoring round-trip on them.
const GUID_RE =
  /^\{?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}?$/i;

function isResolvable(id: string): boolean {
  if (typeof id !== 'string' || id.length === 0) return false;
  if (GUID_RE.test(id)) return true;
  if (id.startsWith('xpath:')) return true;
  if (id.startsWith('/sitecore/')) return true;
  return false;
}

function snapshotMap(ids: ReadonlyArray<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of ids) {
    const name = getName(id);
    if (name) out.set(id, name);
  }
  return out;
}

export function useDatasourceNames(
  client: ClientSDK | null,
  contextId: string | null,
  ids: ReadonlyArray<string>,
): ReadonlyMap<string, string> {
  // Re-render whenever the cache changes; we re-snapshot the slice
  // matching `ids` (cheap — the input list is the per-page set).
  // `getSnapshot` has to be referentially stable across calls when
  // nothing changed; we rebuild a fresh Map each time but
  // useSyncExternalStore detects equality via the listener trigger so
  // this is fine for our scale.
  useSyncExternalStore(
    subscribe,
    () => snapshotKey(ids),
    () => snapshotKey(ids),
  );

  useEffect(() => {
    if (!client || !contextId) return;
    const resolvable = ids.filter(isResolvable);
    if (resolvable.length === 0) return;
    const claimed = claimUnresolved(resolvable);
    if (claimed.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const resolved = await resolveItemNames(client, contextId, claimed);
        if (cancelled) return;
        ingestResolved(resolved);
        const failedIds = claimed.filter((id) => !resolved.has(id));
        if (failedIds.length > 0) ingestFailed(failedIds);
      } catch {
        if (!cancelled) ingestFailed(claimed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, contextId, ids]);

  return snapshotMap(ids);
}

// `useSyncExternalStore` requires a primitive snapshot for change
// detection. We hash the resolved-name string for each id; when any
// name lands the hash changes and React re-renders.
function snapshotKey(ids: ReadonlyArray<string>): string {
  let key = '';
  for (const id of ids) {
    key += `${id}=${getName(id) ?? ''}\u0000`;
  }
  return key;
}

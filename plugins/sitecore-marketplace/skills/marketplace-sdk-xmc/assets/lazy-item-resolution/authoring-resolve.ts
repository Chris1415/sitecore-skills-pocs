// S12 — Resolve a batch of datasource item IDs to their display name via
// the Authoring GraphQL endpoint exposed as `xmc.authoring.graphql`.
//
// SDK contract: `node_modules/@sitecore-marketplace-sdk/xmc/dist/xmc/src/
// client-authoring/types.gen.d.ts` declares a single `Authoring.Graphql*`
// shape — a pass-through endpoint to the Sitecore Authoring GraphQL.
// Request body is `{ query, variables, operationName? }`; response is
// `{ data?: Record<string, unknown>, errors?: ... }`.
//
// We batch all unresolved item IDs into a single multi-aliased query so
// thousands of datasources resolve in one round-trip:
//
//   query Resolve($id0: String, $id1: String, ...) {
//     i0: item(path: $id0) { name displayName itemId }
//     i1: item(path: $id1) { name displayName itemId }
//   }
//
// For Sitecore items, `item(path: ...)` accepts either a path string OR
// an item ID with curly braces. Bare-hex GUIDs are wrapped here. The
// resolver returns a Map only with successfully-resolved names; ids that
// produce a null `data.iN` (item not found / inaccessible) are simply
// absent from the result so callers fall back to their existing label.

import type { ClientSDK } from '@sitecore-marketplace-sdk/client';

// Wrap bare GUIDs with curly braces; leave already-braced or non-GUID
// strings (paths) alone. Authoring `item(path:)` accepts both forms but
// the canonical Sitecore convention is the braced UUID.
const BARE_GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toItemPath(id: string): string {
  if (BARE_GUID_RE.test(id)) return `{${id}}`;
  return id;
}

function logFailure(stage: string, detail: unknown): void {
  // Surface auth/network/shape problems in the browser console — silent
  // failures here are why the editor sees "Item · <short-id>" forever.
  // eslint-disable-next-line no-console
  console.warn(`[CUA authoring-resolve] ${stage}`, detail);
}

// One Authoring.graphql call resolves up to BATCH_SIZE ids. Larger batches
// risk request size limits / timeouts. The atlas walks tenants of
// thousands of items so we slice into chunks and run the chunks
// sequentially (parallel would race unrelated cache writes).
const BATCH_SIZE = 50;

type ItemResponse = {
  readonly name?: string | null;
  readonly displayName?: string | null;
  readonly itemId?: string | null;
} | null;

function buildQuery(count: number): string {
  // GraphQL variable names + aliases must be ASCII identifiers. We use
  // synthetic indexes so the original id (which can be a GUID with
  // hyphens/braces) is never inlined into the query string — the id
  // travels via variables only.
  const varDecls = Array.from({ length: count }, (_, i) => `$id${i}: String`).join(
    ', ',
  );
  const aliases = Array.from(
    { length: count },
    (_, i) => `i${i}: item(path: $id${i}) { name displayName itemId }`,
  ).join('\n  ');
  return `query Resolve(${varDecls}) {\n  ${aliases}\n}`;
}

export async function resolveItemNames(
  client: ClientSDK,
  contextId: string,
  rawIds: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (rawIds.length === 0) return out;

  // De-dup in case the caller didn't.
  const ids = Array.from(new Set(rawIds));

  for (let start = 0; start < ids.length; start += BATCH_SIZE) {
    const slice = ids.slice(start, start + BATCH_SIZE);
    const query = buildQuery(slice.length);
    const variables: Record<string, string> = {};
    slice.forEach((id, i) => {
      variables[`id${i}`] = toItemPath(id);
    });

    let result: unknown;
    try {
      // `xmc.authoring.graphql` is registered on MutationMap (not
      // QueryMap) per `client-authoring/augmentation.gen.d.ts` — a
      // GraphQL pass-through is treated as a mutation by hey-api.
      result = await client.mutate('xmc.authoring.graphql', {
        body: { query, variables },
        params: { query: { sitecoreContextId: contextId } },
      } as unknown as Parameters<typeof client.mutate>[1]);
    } catch (err) {
      // Network or auth error — caller falls back to existing labels.
      logFailure('mutate-threw', err);
      continue;
    }

    // Per `xmc.md` § 7 + `client.md` § 8b: `xmc.authoring.graphql` is a
    // mutation, so `client.mutate` returns the GraphQL response body
    // directly — payload is at `result.data.iN`, NOT `result.data.data.iN`.
    // We still try the double-wrapped shape as a fallback for older SDK
    // builds where mutations were wrapped, and surface GraphQL `errors`
    // to the console so a misconfigured query/permission isn't invisible.
    type Envelope = {
      readonly data?: Record<string, ItemResponse> & {
        readonly data?: Record<string, ItemResponse>;
      };
      readonly errors?: ReadonlyArray<{ readonly message?: string }>;
    };
    const envelope = result as Envelope | undefined;
    const direct = envelope?.data;
    const nested = envelope?.data?.data;
    const data: Record<string, ItemResponse> | undefined =
      (direct && Object.keys(direct).some((k) => k.startsWith('i'))) ? direct
        : (nested && Object.keys(nested).some((k) => k.startsWith('i'))) ? nested
          : undefined;

    if (envelope?.errors && envelope.errors.length > 0) {
      logFailure('graphql-errors', envelope.errors);
    }

    if (!data) {
      logFailure('no-data-in-response', envelope);
      continue;
    }

    let resolvedThisBatch = 0;
    slice.forEach((id, i) => {
      const item = data[`i${i}`];
      const name = item?.displayName ?? item?.name;
      if (name && typeof name === 'string' && name.length > 0) {
        out.set(id, name);
        resolvedThisBatch++;
      }
    });
    if (resolvedThisBatch === 0) {
      logFailure('zero-resolved-in-batch', { sliceSize: slice.length, sample: slice[0], data });
    }
  }

  return out;
}

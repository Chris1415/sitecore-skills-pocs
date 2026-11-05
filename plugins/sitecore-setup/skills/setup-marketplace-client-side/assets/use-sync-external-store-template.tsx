// Template — SSR-safe client-only value detection via useSyncExternalStore.
//
// Drop this pattern into any harness that needs to distinguish "iframed in portal" vs
// "top-level browser" at runtime, or any other client-only check that tripped the
// react-hooks/set-state-in-effect lint rule shipped with Next 16.
//
// Two non-obvious rules the implementation respects:
//   1. getSnapshot (client) and getServerSnapshot (SSR) MUST return a referentially
//      stable value. A fresh object each call triggers "The result of getSnapshot
//      should be cached to avoid an infinite loop" → "Maximum update depth exceeded".
//      Cache at module scope — a const for the SSR snapshot, a lazily-populated
//      let for the client snapshot.
//   2. subscribe can be a no-op (() => () => {}) when the value never changes during
//      the component's lifetime.

// ─── lib/embedding.ts — module-scope cache ────────────────────────────────

export type EmbeddingSnapshot =
  | { readonly isIframed: false; readonly reason: 'ssr' }
  | { readonly isIframed: true; readonly reason: 'iframe' }
  | { readonly isIframed: false; readonly reason: 'top-level' };

export const SSR_EMBEDDING_SNAPSHOT: EmbeddingSnapshot = {
  isIframed: false,
  reason: 'ssr',
};
const IFRAME: EmbeddingSnapshot = { isIframed: true, reason: 'iframe' };
const TOP_LEVEL: EmbeddingSnapshot = { isIframed: false, reason: 'top-level' };

let cached: EmbeddingSnapshot | null = null;
export function detectEmbedding(): EmbeddingSnapshot {
  if (typeof window === 'undefined') return SSR_EMBEDDING_SNAPSHOT;
  if (cached) return cached;
  cached = window.parent !== window.self ? IFRAME : TOP_LEVEL;
  return cached;
}

// ─── component.tsx — consumer ─────────────────────────────────────────────

import { useSyncExternalStore } from 'react';
import { SSR_EMBEDDING_SNAPSHOT, detectEmbedding } from '@/lib/embedding';

const noopSubscribe = () => () => {};
const serverSnapshot = () => SSR_EMBEDDING_SNAPSHOT;

export function useEmbedding() {
  return useSyncExternalStore(noopSubscribe, detectEmbedding, serverSnapshot);
}

// Usage:
//
// function MyComponent() {
//   const embedding = useEmbedding();
//   if (embedding.isIframed) { /* iframe-only UI */ }
//   else { /* top-level fallback */ }
// }

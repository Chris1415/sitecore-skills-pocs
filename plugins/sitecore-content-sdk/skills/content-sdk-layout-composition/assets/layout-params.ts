// Rendering-parameter helpers for SitecoreAI layout components (Container, Row/Column Splitter and
// custom slot components). Copy to src/lib/layout/layout-params.ts: never under src/components/,
// where generate-map would register it as a rendering.
// Source: content-sdk-layout-composition skill, assets/layout-params.ts.

// `object`, not an index-signature type: a component's own params interface (no index signature) must be accepted.
export type LayoutParams = object | undefined;
const read = (params: LayoutParams): Record<string, string | undefined> => (params ?? {}) as Record<string, string | undefined>;

/** Split a delivered class value. Edge joins breakpoints with spaces; migrated literals can be `|`-joined. */
export const classTokens = (value?: string): string[] => (value ?? '').split(/[\s|]+/).filter(Boolean);

/** De-duplicated class string; drops empty and `undefined` parts. */
export const cx = (...parts: Array<string | false | null | undefined>): string =>
  [...new Set(parts.flatMap((p) => (p ? classTokens(p) : [])))].join(' ');

/**
 * The classes an author picked in Pages for this rendering: grid size (GridParameters) plus styles
 * (Styles). The SDK also computes lowercase `styles` from the same two, and omits it when both are
 * empty, so never interpolate `params.styles` directly (it prints "undefined").
 */
export const styleClasses = (params: LayoutParams): string =>
  cx(read(params).styles, read(params).GridParameters, read(params).Styles);

/**
 * Placeholder name for a dynamic slot. Edge delivers the key in wildcard form (`column-1-{*}`) and
 * the SDK matches a requested `column-1-7` against it with `^column-1-\d+$`, so the concrete id is
 * preferred (it is also what the raw layout stores). A missing or non-numeric id falls back to the
 * literal wildcard, which matches the delivered key exactly.
 */
export const slotName = (prefix: string, params: LayoutParams, slot?: number): string => {
  const id = read(params).DynamicPlaceholderId;
  const suffix = id && /^\d+$/.test(id) ? id : '{*}';
  return slot === undefined ? `${prefix}-${suffix}` : `${prefix}-${slot}-${suffix}`;
};

/**
 * Which numbered slots are active. `EnabledPlaceholders` ("1,2" or "1,3,2,4") is authoritative and
 * kept in authored order, as the upstream splitters do. Edge always emits all eight keys, so never
 * derive slots from `rendering.placeholders`. Without it, fall back to the ColumnWidthN keys, then
 * to SplitterSize, then to `fallback`.
 */
export const enabledSlots = (params: LayoutParams, max = 8, fallback = 2): number[] => {
  const inRange = (n: number) => Number.isInteger(n) && n >= 1 && n <= max;
  const listed = (read(params).EnabledPlaceholders ?? '').split(',').map((s) => Number(s.trim())).filter(inRange);
  if (listed.length) return [...new Set(listed)];
  const widths = Object.keys(read(params))
    .map((k) => /^ColumnWidth(\d+)$/.exec(k)?.[1])
    .map(Number)
    .filter(inRange)
    .sort((a, b) => a - b);
  if (widths.length) return widths;
  const size = Number(read(params).SplitterSize);
  const count = inRange(size) ? size : Math.min(fallback, max);
  return Array.from({ length: count }, (_, i) => i + 1);
};

/** Classes of one slot: its width (ColumnWidthN, Column Splitter only) plus its styles (StylesN). */
export const slotClasses = (params: LayoutParams, slot: number, defaultWidth = ''): string =>
  cx(read(params)[`ColumnWidth${slot}`] || defaultWidth, read(params)[`Styles${slot}`]);

/** Container's BackgroundImage param is an image-field XML string; pull out its mediaurl. */
export const backgroundImageUrl = (params: LayoutParams): string | undefined =>
  /mediaurl="([^"]*)"/i.exec(read(params).BackgroundImage ?? '')?.[1] || undefined;

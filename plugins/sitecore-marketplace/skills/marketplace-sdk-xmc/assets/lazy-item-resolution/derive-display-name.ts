// Derive a marketer-readable display name from a raw `dataSource` string.
//
// `dataSource` (per `node_modules/@sitecore-marketplace-sdk/xmc/dist/xmc/src/
// client-agent/types.gen.d.ts` — `ComponentModel.dataSource`) is whatever
// Sitecore put on the layout: typically a `local:/Data/<Item Name>` path,
// occasionally a Sitecore item GUID (`{1D62...}` or bare-hex form), and
// rarely an `xpath:/sitecore/...` reference.
//
// The marketer cares about the item's NAME, not its identifier. v1 cannot
// hit the Authoring API per page during scan (out-of-scope, Phase-2), so we
// derive the best name available from the `dataSource` string itself:
//
//   local:/Data/Home Content Top Banner   → "Home Content Top Banner"
//   /sitecore/content/Home/Foo Bar        → "Foo Bar"
//   1db01d13-2526-4837-ab03-89180e76769e  → "Item · 1db01d13"  (short-id fallback)
//   {1D626D9D-5302-4741-97FD-882DD0A5016D} → "Item · 1d626d9d"
//
// The short-id fallback gives the editor at least one stable identifier to
// recognise even when the Authoring round-trip can't produce a name.
// Callers should display the name as the row title and the raw `dataSource`
// string as the row subtitle so the editor still has the full path/id.

const GUID_RE = /^\{?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}?$/i;

export function isDatasourceGuidOnly(dsId: string): boolean {
  return GUID_RE.test(dsId);
}

export function deriveDatasourceDisplayName(dsId: string): string {
  if (typeof dsId !== 'string' || dsId.length === 0) return 'Unnamed item';

  if (isDatasourceGuidOnly(dsId)) {
    const hex = dsId.replace(/[{}-]/g, '').toLowerCase();
    if (hex.length >= 8) return `Item · ${hex.slice(0, 8)}`;
    return 'Unnamed item';
  }

  const stripped = dsId.replace(/^[a-z]+:/i, '');
  if (stripped.includes('/')) {
    const parts = stripped.split('/').filter((p) => p.length > 0);
    if (parts.length > 0) {
      const raw = parts[parts.length - 1]!;
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return dsId;
}

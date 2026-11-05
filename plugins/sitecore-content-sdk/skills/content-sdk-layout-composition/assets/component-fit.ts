// TEMPLATE: copy to src/lib/layout/component-fit.ts and list EVERY rendering of the app.
// Tiers and placement rules: references/policy-and-fit.md § 3. lint-layout.mjs reads the JSON copy
// (component-fit.json, shape { components, reasons }); keep a unit test that both agree and cover all folders.
// Source: content-sdk-layout-composition skill, assets/component-fit.ts.

export type FitTier = 'chrome' | 'section' | 'wide' | 'flexible' | 'structure';

export const componentFit: Record<string, { tier: FitTier; reason: string }> = {
  Container: { tier: 'structure', reason: 'owns the section' },
  ColumnSplitter: { tier: 'structure', reason: 'owns the horizontal split' },
  RowSplitter: { tier: 'structure', reason: 'styled row bands only' },
  Header: { tier: 'chrome', reason: 'lives in the header Partial Design' },
  Footer: { tier: 'chrome', reason: 'lives in the footer Partial Design' },
  Hero: { tier: 'section', reason: 'full-bleed media, viewport-sized' },
  Quote: { tier: 'wide', reason: 'large type needs at least half the page' },
  StatBand: { tier: 'flexible', reason: 'container-aware: 4 / 2 / 1 columns by its own width' },
};

export const componentFitJson = () => ({
  components: Object.fromEntries(Object.entries(componentFit).map(([k, v]) => [k, v.tier])),
  reasons: Object.fromEntries(Object.entries(componentFit).map(([k, v]) => [k, v.reason])),
});

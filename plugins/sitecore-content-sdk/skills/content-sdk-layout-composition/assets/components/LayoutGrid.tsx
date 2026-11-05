// TEMPLATE for a custom slot layout component. Copy to src/components/<Name>/<Name>.tsx, rename the
// component, PREFIX and PRESETS. The CM side (rendering, params template, one Placeholder Settings
// item per slot) is in references/custom-layout-component.md; PREFIX must equal the key stem there.
import { JSX } from 'react';
import { AppPlaceholder } from '@sitecore-content-sdk/nextjs';
import componentMap from '.sitecore/component-map';
import { ComponentWithContextProps } from 'lib/component-props';
import { classTokens, cx, slotName, styleClasses } from 'lib/layout/layout-params';

const PREFIX = 'layout-grid';

// Preset = a class token the author picks in Pages > Styling (a Style item whose Value is the token).
// Each preset names its slot count; the CSS for each preset lives with the component's styles.
const PRESETS: Record<string, number> = {
  'layout-grid--halves': 2,
  'layout-grid--two-one': 2,
  'layout-grid--thirds': 3,
  'layout-grid--bento-5': 5,
};
const DEFAULT_PRESET = 'layout-grid--halves';

export const Default = ({ params, rendering, page }: ComponentWithContextProps): JSX.Element => {
  const preset = classTokens(params?.Styles).find((t) => t in PRESETS) ?? DEFAULT_PRESET;
  const slots = Array.from({ length: PRESETS[preset] }, (_, i) => i + 1);
  return (
    <section className={cx('component layout-grid', preset, styleClasses(params))} id={params?.RenderingIdentifier || undefined}>
      {slots.map((n) => (
        <div key={n} className={`layout-grid__slot layout-grid__slot--${n}`}>
          <AppPlaceholder name={slotName(PREFIX, params, n)} rendering={rendering} page={page} componentMap={componentMap} />
        </div>
      ))}
    </section>
  );
};

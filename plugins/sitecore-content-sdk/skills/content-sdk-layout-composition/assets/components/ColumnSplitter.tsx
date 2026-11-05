// Copy to src/components/ColumnSplitter/ColumnSplitter.tsx (componentName `ColumnSplitter`).
// Hardened port of xmcloud-starter-js kit-nextjs-article-starter src/components/sxa/ColumnSplitter.tsx.
import { JSX } from 'react';
import { AppPlaceholder } from '@sitecore-content-sdk/nextjs';
import componentMap from '.sitecore/component-map';
import { ComponentWithContextProps } from 'lib/component-props';
import { cx, enabledSlots, slotClasses, slotName, styleClasses } from 'lib/layout/layout-params';

export const Default = ({ params, rendering, page }: ComponentWithContextProps): JSX.Element => (
  <div className={cx('row component column-splitter', styleClasses(params))} id={params?.RenderingIdentifier || undefined}>
    {enabledSlots(params).map((n) => (
      <div key={n} className={slotClasses(params, n, 'col-12')}>
        <div className="row">
          <AppPlaceholder name={slotName('column', params, n)} rendering={rendering} page={page} componentMap={componentMap} />
        </div>
      </div>
    ))}
  </div>
);

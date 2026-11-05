// Copy to src/components/RowSplitter/RowSplitter.tsx (componentName `RowSplitter`).
// Hardened port of xmcloud-starter-js kit-nextjs-article-starter src/components/sxa/RowSplitter.tsx.
import { JSX } from 'react';
import { AppPlaceholder } from '@sitecore-content-sdk/nextjs';
import componentMap from '.sitecore/component-map';
import { ComponentWithContextProps } from 'lib/component-props';
import { cx, enabledSlots, slotClasses, slotName, styleClasses } from 'lib/layout/layout-params';

export const Default = ({ params, rendering, page }: ComponentWithContextProps): JSX.Element => (
  <div className={cx('component row-splitter', styleClasses(params))} id={params?.RenderingIdentifier || undefined}>
    {enabledSlots(params).map((n) => (
      <div key={n} className={cx('container-fluid', slotClasses(params, n))}>
        <div>
          <div className="row">
            <AppPlaceholder name={slotName('row', params, n)} rendering={rendering} page={page} componentMap={componentMap} />
          </div>
        </div>
      </div>
    ))}
  </div>
);

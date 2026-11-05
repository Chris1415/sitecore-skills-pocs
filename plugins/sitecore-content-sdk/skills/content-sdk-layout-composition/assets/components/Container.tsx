// Copy to src/components/Container/Container.tsx (map key must equal componentName `Container`).
// Hardened port of xmcloud-starter-js kit-nextjs-article-starter src/components/sxa/Container.tsx.
import { JSX } from 'react';
import { AppPlaceholder } from '@sitecore-content-sdk/nextjs';
import componentMap from '.sitecore/component-map';
import { ComponentWithContextProps } from 'lib/component-props';
import { backgroundImageUrl, cx, slotName, styleClasses } from 'lib/layout/layout-params';

const ContainerBody = ({ params, rendering, page }: ComponentWithContextProps): JSX.Element => {
  const bg = backgroundImageUrl(params);
  return (
    <div className={cx('component container-default', styleClasses(params))} id={params?.RenderingIdentifier || undefined}>
      <div className="component-content" style={bg ? { backgroundImage: `url('${bg}')` } : undefined}>
        <div className="row">
          <AppPlaceholder name={slotName('container', params)} rendering={rendering} page={page} componentMap={componentMap} />
        </div>
      </div>
    </div>
  );
};

// A `container` style token (Pages > Styling) asks for the fixed-width wrapper, as upstream does.
export const Default = (props: ComponentWithContextProps): JSX.Element =>
  props.params?.Styles?.split(' ').includes('container') ? (
    <div className="container-wrapper">
      <ContainerBody {...props} />
    </div>
  ) : (
    <ContainerBody {...props} />
  );

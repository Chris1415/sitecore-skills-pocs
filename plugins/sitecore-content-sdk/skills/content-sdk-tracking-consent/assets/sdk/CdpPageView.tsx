'use client';
// Scaffold src/components/content-sdk/CdpPageView.tsx with the analytics gate. `analytics` is in the
// deps so a mid-session grant sends the CURRENT page's VIEW once Bootstrap has re-initialized.
import { CdpHelper, useSitecore } from '@sitecore-content-sdk/nextjs';
import { useEffect, JSX } from 'react';
import { pageView } from '@sitecore-content-sdk/events';
import config from 'sitecore.config';
import { useAllows } from 'lib/consent/consent-store';

const CdpPageView = (): JSX.Element => {
  const {
    page: { layout, siteName, mode },
  } = useSitecore();
  const { route, context } = layout.sitecore;
  const analytics = useAllows('analytics');

  const disabled = () => process.env.NODE_ENV === 'development' || !analytics;

  useEffect(() => {
    if (!mode.isNormal || !route?.itemId) return;
    if (disabled()) return;

    const language = route.itemLanguage || config.defaultLanguage;
    const scope = config.personalize?.scope;
    const pageVariantId = CdpHelper.getPageVariantId(
      route.itemId,
      language,
      context.variantId as string,
      scope
    );
    // IE-002 (not initialized) is swallowed here; the acceptance test, not the console, proves VIEWs.
    pageView({
      channel: 'WEB',
      currency: 'USD', // scaffold default; set per brand
      page: route.name,
      pageVariantId,
      language,
    }).catch((e) => console.debug(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, route, context.variantId, siteName, analytics]);

  return <></>;
};

export default CdpPageView;

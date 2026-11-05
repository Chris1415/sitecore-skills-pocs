'use client';
// Scaffold src/Bootstrap.tsx with the analytics gate. Re-runs on grant: the scaffold effect depended
// only on [siteName, isPreviewMode], so a mid-session grant left tracking dead until a reload.
import { useEffect, JSX } from 'react';
import { initContentSdk } from '@sitecore-content-sdk/nextjs';
import { eventsPlugin } from '@sitecore-content-sdk/events';
import { analyticsBrowserAdapter, analyticsPlugin } from '@sitecore-content-sdk/analytics-core';
import config from 'sitecore.config';
import { useAllows } from 'lib/consent/consent-store';

const Bootstrap = ({
  siteName,
  isPreviewMode,
}: {
  siteName: string;
  isPreviewMode: boolean;
}): JSX.Element | null => {
  const analytics = useAllows('analytics');

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.debug('Browser Events SDK is not initialized in development environment');
      return;
    }
    if (isPreviewMode) {
      console.debug('Browser Events SDK is not initialized in edit and preview modes');
      return;
    }
    // No init = no create.json, no sc_cid, no VIEW. Gating only CdpPageView leaves the cookie on.
    if (!analytics) {
      console.debug('Browser Events SDK is not initialized: no analytics consent');
      return;
    }
    if (!config.api.edge?.clientContextId) {
      console.error('Client Edge API settings missing from configuration');
      return;
    }
    initContentSdk({
      config: {
        contextId: config.api.edge.clientContextId,
        edgeUrl: config.api.edge.edgeUrl,
        siteName: siteName || config.defaultSite,
      },
      plugins: [
        analyticsPlugin({
          options: {
            enableCookie: true,
            cookieDomain: window.location.hostname.replace(/^www\./, ''),
          },
          adapter: analyticsBrowserAdapter(),
        }),
        eventsPlugin(),
      ],
    });
  }, [siteName, isPreviewMode, analytics]);

  return null;
};

export default Bootstrap;

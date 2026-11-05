'use client';
// The ONLY sanctioned way app code sends custom events or identity. Place at src/lib/consent/track.ts.
// Never import event()/identity() from @sitecore-content-sdk/events directly in a component.
import { event, identity, type EventData, type IdentityData } from '@sitecore-content-sdk/events';
import { hasConsentClient } from './consent-store';

/** Custom events (clicks, conversions, non-Sitecore form submits): analytics category. */
export async function trackEvent(data: EventData) {
  if (!hasConsentClient('analytics')) return null;
  // Rejects with IE-002 in editing/preview (Bootstrap does not init there): expected, swallowed.
  return event(data).catch((e) => {
    console.debug(e);
    return null;
  });
}

/** IDENTITY carries PII and feeds identity resolution: marketing category (implies analytics). */
export async function trackIdentity(data: IdentityData) {
  if (!hasConsentClient('marketing')) return null;
  return identity(data).catch((e) => {
    console.debug(e);
    return null;
  });
}

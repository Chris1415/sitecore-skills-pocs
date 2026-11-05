'use client';
// Browser consent store: useSyncExternalStore over the consent cookie (hydration-safe; see
// content-sdk-app-router-theme-hydration-pattern). Place at src/lib/consent/consent-store.ts.
import { useMemo, useSyncExternalStore } from 'react';
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_S,
  allows,
  consentCookieDomain,
  normalize,
  parseConsent,
  serializeConsent,
  type Category,
  type Choices,
  type ConsentState,
} from './consent';

const CHANGE = 'consentchange';
const SETTINGS = 'consentsettings';

// The SDK never deletes these (measured 2026-10-01: sc_cid survives withdrawal; Max-Age 730 d, capped to 400 d by Chromium).
const ANALYTICS_COOKIES = ['sc_cid', 'sc_cid_personalize'];
const MARKETING_COOKIES = ['sc_cid_personalize'];

function readRaw(): string {
  const prefix = `${CONSENT_COOKIE}=`;
  return document.cookie.split('; ').find((c) => c.startsWith(prefix))?.slice(prefix.length) ?? '';
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(CHANGE, cb);
  document.addEventListener('visibilitychange', cb); // picks up a decision made in another tab
  return () => {
    window.removeEventListener(CHANGE, cb);
    document.removeEventListener('visibilitychange', cb);
  };
}

/** Snapshot is the raw cookie string (a stable primitive); server snapshot = "no decision". */
export function useConsent(): ConsentState | null {
  const raw = useSyncExternalStore(subscribe, readRaw, () => '');
  return useMemo(() => parseConsent(raw), [raw]);
}

export function useAllows(category: Category): boolean {
  return allows(useConsent(), category);
}

/** For non-React callers (event helpers). */
export function hasConsentClient(category: Category): boolean {
  return typeof document !== 'undefined' && allows(parseConsent(readRaw()), category);
}

/** Deletes each name for every domain variant a writer may have used (host-only, apex, www). */
export function clearCookies(names: string[], legacyContextId?: string): void {
  const host = window.location.hostname;
  const apex = consentCookieDomain(host);
  const domains = Array.from(new Set<string | undefined>([undefined, host, apex, `www.${apex}`]));
  const all = legacyContextId ? [...names, `sc_${legacyContextId}`, `sc_${legacyContextId}_personalize`] : names;
  for (const name of all) {
    for (const d of domains) {
      document.cookie = `${name}=; Max-Age=0; Path=/; Secure; SameSite=None${d ? `; Domain=${d}` : ''}`;
    }
  }
  const left = document.cookie.split('; ').filter((c) => all.some((n) => c.startsWith(`${n}=`)));
  if (left.length) console.warn('[consent] tracking cookies survived deletion', left);
}

export function saveConsent(choices: Partial<Choices>, policyVersion: string, legacyContextId?: string): void {
  const prev = parseConsent(readRaw());
  const next = normalize(choices);
  const domain = consentCookieDomain(window.location.hostname);
  document.cookie =
    `${CONSENT_COOKIE}=${serializeConsent(next, policyVersion)}; Max-Age=${CONSENT_MAX_AGE_S}; ` +
    `Path=/; SameSite=Lax; Secure; Domain=${domain}`;

  // Delete on EVERY save without the category, not only on a transition: an expired (180 d) or
  // old-schema consent cookie parses as null while sc_cid (400 d in Chromium) is still there.
  if (!next.analytics) clearCookies(ANALYTICS_COOKIES, legacyContextId);
  else if (!next.marketing) clearCookies(MARKETING_COOKIES);
  // Reload only when the SDK may be initialized: it has no de-init, and the live core context
  // stays reachable for <Form> and BYOC Events.
  if (prev?.c.analytics === true && !next.analytics) {
    window.location.reload();
    return;
  }
  window.dispatchEvent(new Event(CHANGE));
  closeConsentSettings();
}

// Re-open state for the footer "Cookie settings" trigger.
let settingsOpen = false;
const subscribeSettings = (cb: () => void) => {
  window.addEventListener(SETTINGS, cb);
  return () => window.removeEventListener(SETTINGS, cb);
};
export function openConsentSettings(): void {
  settingsOpen = true;
  window.dispatchEvent(new Event(SETTINGS));
}
export function closeConsentSettings(): void {
  settingsOpen = false;
  window.dispatchEvent(new Event(SETTINGS));
}
export function useConsentSettingsOpen(): boolean {
  return useSyncExternalStore(subscribeSettings, () => settingsOpen, () => false);
}

// Consent state contract. Runtime-agnostic (proxy, server, browser): no 'use client', no DOM.
// Place at src/lib/consent/consent.ts — NOT under src/components/ (auto-registered as a rendering).

export const CONSENT_COOKIE = 'site_consent';

// Bump when the CATEGORY SET changes. An old-schema cookie reads as "no consent" everywhere.
export const CONSENT_SCHEMA = 1;

// Consent retention is a legal decision; confirm with counsel.
export const CONSENT_MAX_AGE_S = 180 * 24 * 60 * 60;

export type Category = 'necessary' | 'functional' | 'analytics' | 'marketing';

export interface Choices {
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
}

export interface ConsentState {
  v: number; // CONSENT_SCHEMA at write time
  pv: string; // authored PolicyVersion the visitor answered
  c: Choices;
  t: number; // epoch ms of the decision (audit trail)
}

export const NECESSARY_ONLY: Choices = { functional: false, analytics: false, marketing: false };
export const ALL: Choices = { functional: true, analytics: true, marketing: true };

/** Marketing requires analytics: the proxy sets sc_cid on every decision. Fail closed. */
export function normalize(c: Partial<Choices>): Choices {
  const analytics = c.analytics === true;
  return { functional: c.functional === true, analytics, marketing: analytics && c.marketing === true };
}

export function parseConsent(raw: string | undefined | null): ConsentState | null {
  if (!raw) return null;
  try {
    const json = raw.startsWith('%') ? decodeURIComponent(raw) : raw;
    const s = JSON.parse(json) as Partial<ConsentState>;
    if (s.v !== CONSENT_SCHEMA || typeof s.pv !== 'string' || typeof s.t !== 'number' || !s.c) return null;
    return { v: s.v, pv: s.pv, t: s.t, c: normalize(s.c) };
  } catch {
    return null;
  }
}

export function serializeConsent(c: Partial<Choices>, policyVersion: string, now = Date.now()): string {
  const state: ConsentState = { v: CONSENT_SCHEMA, pv: policyVersion, c: normalize(c), t: now };
  return encodeURIComponent(JSON.stringify(state));
}

export function allows(state: ConsentState | null, category: Category): boolean {
  if (category === 'necessary') return true;
  return state?.c[category] === true;
}

/** Same rule as the scaffold Bootstrap's sc_cid cookieDomain, so www and apex share one decision. */
export function consentCookieDomain(hostname: string): string {
  return hostname.replace(/^www\./, '');
}

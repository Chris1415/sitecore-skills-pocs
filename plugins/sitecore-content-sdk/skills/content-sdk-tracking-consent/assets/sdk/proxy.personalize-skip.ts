// Fragment for src/proxy.ts — replace the scaffold PersonalizeProxy `skip: () => false`.
// skip runs in disabled() BEFORE initPersonalizeServer and before the Edge variantIds lookup,
// so a non-consented request sets no sc_cid / sc_cid_personalize and costs no Edge call.
import type { NextRequest } from 'next/server';
import { CONSENT_COOKIE, allows, parseConsent } from './lib/consent/consent';

export const skipWithoutMarketingConsent = (req: NextRequest): boolean =>
  !allows(parseConsent(req.cookies.get(CONSENT_COOKIE)?.value), 'marketing');

/*
  const personalize = new PersonalizeProxy({
    sites,
    ...scConfig.api.edge,
    ...scConfig.personalize,
    skip: skipWithoutMarketingConsent, // no marketing consent -> default variant, no cookies
  });

  BotTrackingProxy stays ungated: it acts only on bot UAs (sc_bot + a server-side bot page view).
*/

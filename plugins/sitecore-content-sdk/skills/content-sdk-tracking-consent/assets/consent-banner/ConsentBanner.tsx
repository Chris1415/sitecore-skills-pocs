'use client';
// Rendering `ConsentBanner` (src/components/ConsentBanner/ConsentBanner.tsx). Placed once in the
// site's footer Partial Design with ONE shared datasource; content model: references/banner-content-model.md.
import { useId, useRef, useState, useEffect, useSyncExternalStore, JSX } from 'react';
import { createPortal } from 'react-dom';
import { Text, RichText, Link, useSitecore, withDatasourceCheck } from '@sitecore-content-sdk/nextjs';
import type { ComponentRendering, TextField, RichTextField, LinkField } from '@sitecore-content-sdk/nextjs';
import config from 'sitecore.config';
import { ALL, NECESSARY_ONLY, normalize, type Choices } from 'lib/consent/consent';
import {
  closeConsentSettings,
  openConsentSettings,
  saveConsent,
  useConsent,
  useConsentSettingsOpen,
} from 'lib/consent/consent-store';

export interface ConsentBannerFields {
  Title?: TextField;
  Body?: RichTextField;
  PolicyLink?: LinkField;
  NecessaryLabel?: TextField;
  NecessaryDescription?: TextField;
  FunctionalLabel?: TextField;
  FunctionalDescription?: TextField;
  AnalyticsLabel?: TextField;
  AnalyticsDescription?: TextField;
  MarketingLabel?: TextField;
  MarketingDescription?: TextField;
  AcceptAllLabel?: TextField;
  RejectAllLabel?: TextField;
  CustomizeLabel?: TextField;
  SaveLabel?: TextField;
  ReopenLabel?: TextField;
  PolicyVersion?: TextField;
}

type Props = { rendering: ComponentRendering; fields?: ConsentBannerFields };
type Toggle = 'functional' | 'analytics' | 'marketing';

const noop = () => () => {};
const useHydrated = () => useSyncExternalStore(noop, () => true, () => false);

// Editing only: a placement with no (or a deleted) datasource arrives with `fields` ABSENT, so a bare
// `return null` makes the rendering invisible and unselectable in Pages (measured on Edge preview).
const MissingDatasource = () => (
  <div className="consent-banner consent-banner--missing" role="alert" data-consent-missing-datasource="">
    Consent banner: choose its datasource (the shared item under Data / Consent Banner).
  </div>
);

const ConsentBanner = ({ fields }: Props): JSX.Element | null => {
  const { page } = useSitecore();
  if (page.mode.isPreview) return null;
  // Editing + Design Library: inline and static so every field stays selectable.
  if (!page.mode.isNormal) return fields ? <AuthoringPanel fields={fields} /> : <MissingDatasource />;
  if (!fields) return null;
  return <LiveBanner fields={fields} />;
};

// SDK HOC: missing / unresolved datasource → null in normal mode, MissingDatasource in editing.
export const Default = withDatasourceCheck({ editingErrorComponent: MissingDatasource })(ConsentBanner);

function LiveBanner({ fields }: { fields: ConsentBannerFields }) {
  const hydrated = useHydrated();
  const consent = useConsent();
  const settingsOpen = useConsentSettingsOpen();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const policyVersion = String(fields.PolicyVersion?.value ?? '');
  const undecided = !consent || consent.pv !== policyVersion;

  const decide = (c: Partial<Choices>) => {
    saveConsent(c, policyVersion, config.api.edge?.clientContextId);
    if (settingsOpen) triggerRef.current?.focus();
  };
  const dismiss = () => {
    closeConsentSettings();
    triggerRef.current?.focus();
  };

  return (
    <>
      <button type="button" ref={triggerRef} data-consent-action="reopen" onClick={openConsentSettings}>
        <Text field={fields.ReopenLabel} tag="span" />
      </button>
      {hydrated &&
        (undecided || settingsOpen) &&
        createPortal(
          <Panel
            key={settingsOpen ? 'reopened' : 'first'}
            fields={fields}
            initial={consent?.c ?? NECESSARY_ONLY}
            startCustomizing={settingsOpen}
            onDecide={decide}
            onDismiss={settingsOpen && !undecided ? dismiss : undefined}
          />,
          document.body
        )}
    </>
  );
}

function Panel(props: {
  fields: ConsentBannerFields;
  initial: Choices;
  startCustomizing: boolean;
  onDecide: (c: Partial<Choices>) => void;
  onDismiss?: () => void;
}) {
  const { fields, initial, startCustomizing, onDecide, onDismiss } = props;
  const [draft, setDraft] = useState<Choices>(initial);
  const [customizing, setCustomizing] = useState(startCustomizing);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    if (startCustomizing) headingRef.current?.focus();
  }, [startCustomizing]);

  // Marketing requires analytics (the proxy sets sc_cid on decisions): keep the pair consistent.
  const toggle = (k: Toggle, on: boolean) =>
    setDraft((d) =>
      normalize(
        k === 'marketing' && on ? { ...d, marketing: true, analytics: true } : k === 'analytics' && !on
          ? { ...d, analytics: false, marketing: false }
          : { ...d, [k]: on }
      )
    );

  const rows: Array<[Toggle, TextField | undefined, TextField | undefined]> = [
    ['functional', fields.FunctionalLabel, fields.FunctionalDescription],
    ['analytics', fields.AnalyticsLabel, fields.AnalyticsDescription],
    ['marketing', fields.MarketingLabel, fields.MarketingDescription],
  ];

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="consent-banner"
      data-consent-banner=""
      onKeyDown={(e) => e.key === 'Escape' && onDismiss?.()}
    >
      <h2 id={titleId} ref={headingRef} tabIndex={-1}>
        <Text field={fields.Title} tag="span" />
      </h2>
      <div id={bodyId}>
        <RichText field={fields.Body} />
        {fields.PolicyLink && <Link field={fields.PolicyLink} />}
      </div>

      {customizing && (
        <fieldset>
          <label>
            <input type="checkbox" checked disabled aria-describedby={`${titleId}-necessary`} />
            <Text field={fields.NecessaryLabel} tag="span" />
          </label>
          <p id={`${titleId}-necessary`}>
            <Text field={fields.NecessaryDescription} tag="span" />
          </p>
          {rows.map(([k, label, desc]) => (
            <div key={k}>
              <label>
                <input
                  type="checkbox"
                  data-consent-category={k}
                  checked={draft[k]}
                  onChange={(e) => toggle(k, e.target.checked)}
                  aria-describedby={`${titleId}-${k}`}
                />
                <Text field={label} tag="span" />
              </label>
              <p id={`${titleId}-${k}`}>
                <Text field={desc} tag="span" />
              </p>
            </div>
          ))}
        </fieldset>
      )}

      {/* Reject and Accept share one style: necessary-only is one click, never a buried link. */}
      <div className="consent-banner__actions">
        <button type="button" data-consent-action="reject-all" onClick={() => onDecide(NECESSARY_ONLY)}>
          <Text field={fields.RejectAllLabel} tag="span" />
        </button>
        <button type="button" data-consent-action="accept-all" onClick={() => onDecide(ALL)}>
          <Text field={fields.AcceptAllLabel} tag="span" />
        </button>
        {customizing ? (
          <button type="button" data-consent-action="save" onClick={() => onDecide(draft)}>
            <Text field={fields.SaveLabel} tag="span" />
          </button>
        ) : (
          <button type="button" data-consent-action="customize" onClick={() => setCustomizing(true)}>
            <Text field={fields.CustomizeLabel} tag="span" />
          </button>
        )}
      </div>
    </section>
  );
}

function AuthoringPanel({ fields }: { fields: ConsentBannerFields }) {
  return (
    <section className="consent-banner consent-banner--authoring">
      <Text field={fields.Title} tag="h2" />
      <RichText field={fields.Body} />
      {fields.PolicyLink && <Link field={fields.PolicyLink} />}
      {(
        [
          [fields.NecessaryLabel, fields.NecessaryDescription],
          [fields.FunctionalLabel, fields.FunctionalDescription],
          [fields.AnalyticsLabel, fields.AnalyticsDescription],
          [fields.MarketingLabel, fields.MarketingDescription],
        ] as const
      ).map(([label, desc], i) => (
        <div key={i}>
          <Text field={label} tag="strong" />
          <Text field={desc} tag="p" />
        </div>
      ))}
      <p>
        <Text field={fields.RejectAllLabel} tag="span" /> · <Text field={fields.AcceptAllLabel} tag="span" /> ·{' '}
        <Text field={fields.CustomizeLabel} tag="span" /> · <Text field={fields.SaveLabel} tag="span" /> ·{' '}
        <Text field={fields.ReopenLabel} tag="span" />
      </p>
      {/* Bump to re-prompt every visitor after a policy change. */}
      <Text field={fields.PolicyVersion} tag="code" />
    </section>
  );
}

export default Default;

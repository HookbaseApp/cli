import * as fs from 'fs';
import * as api from './api.js';
import type { SecretSource } from './api.js';

// The provider pickers (CLI create, TUI create/edit) are built from the API's public provider
// catalog rather than a list in this repo. The API accepts 78 provider ids and grows; three
// hand-kept copies here fell behind it twice. `provider` is an open string on the wire — the API
// validates it and answers a clear 400 — so the CLI never has to know the full set.

export type { SecretSource };

/** Picker value meaning "no provider": the only way to get a source that never checks a signature. */
export const NO_PROVIDER = '';
/** Picker value that asks the user to type a provider id the catalog doesn't list. */
export const OTHER_PROVIDER = '__other__';

export interface ProviderChoice {
  /** What is sent as the source's `provider` (NO_PROVIDER / OTHER_PROVIDER are sentinels). */
  value: string;
  name: string;
  /** Catalog id for the detail lookup; differs from `value` for e.g. mollie-nextgen -> mollie. */
  catalogId?: string;
  secretSource?: SecretSource;
  secretLabel?: string;
  secretPlaceholder?: string;
  secretAfterRegistration?: boolean;
}

/** Everything a create/edit flow needs to know about a provider's credential. */
export interface SecretInfo {
  providerName?: string;
  secretSource?: SecretSource;
  kind?: string;
  secretLabel?: string;
  secretInstruction?: string;
  secretPlaceholder?: string;
  secretAfterRegistration?: boolean;
  verifyToken?: { label: string; instruction: string };
}

const CUSTOM_CHOICE: ProviderChoice = {
  value: 'custom',
  name: 'Custom HMAC — HMAC-SHA256 over the raw body, any sender',
  // Hookbase generates one when none is given, and the user configures the sender with it.
  secretSource: 'operator',
  secretLabel: 'Signing secret',
};

const OTHER_CHOICE: ProviderChoice = {
  value: OTHER_PROVIDER,
  name: 'Other — type a provider id',
};

/**
 * Used only when the catalog can't be fetched. Deliberately short: it exists so an offline or
 * older API still gets a usable picker, and "Other" covers everything it leaves out.
 */
export const FALLBACK_PROVIDERS: readonly ProviderChoice[] = [
  { value: NO_PROVIDER, name: 'None — no signature verification' },
  { value: 'github', name: 'GitHub', secretSource: 'operator', secretLabel: 'Secret' },
  { value: 'stripe', name: 'Stripe', secretSource: 'provider', secretLabel: 'Signing secret', secretPlaceholder: 'whsec_...' },
  { value: 'shopify', name: 'Shopify', secretSource: 'provider', secretLabel: 'Signing secret' },
  { value: 'slack', name: 'Slack', secretSource: 'provider', secretLabel: 'Signing secret' },
  { value: 'standard-webhooks', name: 'Standard Webhooks / Svix (Resend, Clerk, ...)', secretSource: 'provider', secretLabel: 'Signing secret', secretPlaceholder: 'whsec_...' },
  CUSTOM_CHOICE,
  OTHER_CHOICE,
];

/** Display names for catalog groups no single catalog entry is named after. */
const GROUP_NAMES: Record<string, string> = {
  'standard-webhooks': 'Standard Webhooks / Svix',
};

const MAX_ALSO = 4;

function listNames(names: string[]): string {
  return names.length > MAX_ALSO ? `${names.slice(0, MAX_ALSO).join(', ')}, …` : names.join(', ');
}

/**
 * Turn the catalog into picker choices, one per distinct `hookbaseProvider`.
 *
 * Several catalog entries share a source provider (Resend, Clerk, Render and Fathom are all
 * `standard-webhooks`), so they become one choice whose label names them all — picking "Clerk"
 * and "Resend" separately would create identical sources. Entries that map to `custom` because
 * the vendor doesn't sign (Microsoft Teams, Salesforce, ...) are folded into the "None" choice,
 * which is what they actually need; a real `custom` choice for HMAC senders is added separately.
 */
export function buildProviderChoices(providers: api.ProviderCatalogSummary[]): ProviderChoice[] {
  const groups = new Map<string, api.ProviderCatalogSummary[]>();
  const unsigned: string[] = [];

  for (const p of providers) {
    if (!p.hookbaseProvider) continue;
    if (p.hookbaseProvider === 'custom' || p.hookbaseProvider === 'generic') {
      unsigned.push(p.name);
      continue;
    }
    const group = groups.get(p.hookbaseProvider);
    if (group) group.push(p);
    else groups.set(p.hookbaseProvider, [p]);
  }

  const choices: ProviderChoice[] = [];
  for (const [value, entries] of groups) {
    const primary = entries.find((e) => e.id === value);
    const lead = primary ?? entries[0];
    const others = entries.filter((e) => e !== primary).map((e) => e.name);
    let name: string;
    if (primary) {
      name = others.length > 0 ? `${primary.name} (also ${listNames(others)})` : primary.name;
    } else {
      // No entry is named after the group (standard-webhooks): label it by what it is and list
      // every vendor that uses it, since those names are what the user is searching for.
      name = `${GROUP_NAMES[value] ?? lead.name} (${listNames(entries.map((e) => e.name))})`;
    }
    const sv = lead.signatureVerification ?? undefined;
    choices.push({
      value,
      name,
      catalogId: lead.id,
      secretSource: sv?.secretSource,
      secretLabel: sv?.secretLabel,
      secretPlaceholder: sv?.secretPlaceholder,
      secretAfterRegistration: sv?.secretAfterRegistration,
    });
  }

  choices.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const none: ProviderChoice = {
    value: NO_PROVIDER,
    name: unsigned.length > 0
      ? `None — no signature verification (for senders that don't sign: ${listNames(unsigned)})`
      : 'None — no signature verification',
  };
  return [none, ...choices, CUSTOM_CHOICE, OTHER_CHOICE];
}

/** Picker choices from the live catalog, or the fallback list (with `offline: true`). */
export async function loadProviderChoices(): Promise<{ choices: ProviderChoice[]; offline: boolean }> {
  try {
    const result = await api.getProviderCatalog();
    const providers = result.data?.providers;
    if (!result.error && Array.isArray(providers) && providers.length > 0) {
      return { choices: buildProviderChoices(providers), offline: false };
    }
  } catch {
    // fall through
  }
  return { choices: [...FALLBACK_PROVIDERS], offline: true };
}

function fromDetail(detail: api.ProviderCatalogDetail): SecretInfo {
  const sv = detail.signatureVerification;
  return {
    providerName: detail.name,
    secretSource: sv?.secretSource,
    kind: sv?.kind,
    secretLabel: sv?.secretLabel,
    secretInstruction: sv?.secretInstruction,
    secretPlaceholder: sv?.secretPlaceholder,
    secretAfterRegistration: sv?.secretAfterRegistration,
    verifyToken: sv?.verifyToken,
  };
}

/** Prefer the detail's fields, keep the summary's where the detail is silent. */
function merge(base: SecretInfo, over: SecretInfo): SecretInfo {
  const out: SecretInfo = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * Secret details for a picked choice. Fetches the catalog detail for the instruction text and
 * verify-token block (the list never carries those); on failure, what the choice already knew.
 */
export async function getChoiceSecretInfo(choice: ProviderChoice): Promise<SecretInfo> {
  const base: SecretInfo = {
    providerName: choice.name,
    secretSource: choice.secretSource,
    secretLabel: choice.secretLabel,
    secretPlaceholder: choice.secretPlaceholder,
    secretAfterRegistration: choice.secretAfterRegistration,
  };
  if (!choice.catalogId) return base;
  try {
    const result = await api.getProviderCatalogEntry(choice.catalogId);
    if (!result.error && result.data?.provider) return merge(base, fromDetail(result.data.provider));
  } catch {
    // fall through
  }
  return base;
}

/**
 * Secret details for a source `provider` value, looked up by `hookbaseProvider`. Undefined when
 * the provider is unset or the catalog can't say (offline, or an id the catalog doesn't list) —
 * callers then let the API decide.
 */
export async function lookupProviderSecretInfo(provider: string | null | undefined): Promise<SecretInfo | undefined> {
  if (!provider) return undefined;
  // `custom` (alias `generic`) is a scheme, not a vendor: the catalog only lists it as the
  // target of vendors that don't sign. As a source it is an HMAC secret Hookbase generates.
  if (provider === 'custom' || provider === 'generic') {
    return { providerName: 'Custom HMAC', secretSource: 'operator', kind: 'hmac', secretLabel: 'Signing secret' };
  }
  try {
    const list = await api.getProviderCatalog();
    const entries = (list.data?.providers ?? []).filter((p) => p.hookbaseProvider === provider);
    if (list.error || entries.length === 0) return undefined;
    const lead = entries.find((e) => e.id === provider) ?? entries[0];
    const sv = lead.signatureVerification ?? undefined;
    const summary: SecretInfo = {
      providerName: lead.name,
      secretSource: sv?.secretSource,
      kind: sv?.kind,
      secretLabel: sv?.secretLabel,
      secretPlaceholder: sv?.secretPlaceholder,
      secretAfterRegistration: sv?.secretAfterRegistration,
    };
    if (summary.secretSource) return summary;
    // An API older than the list-item summary: the detail always has it.
    const detail = await api.getProviderCatalogEntry(lead.id);
    if (!detail.error && detail.data?.provider) return merge(summary, fromDetail(detail.data.provider));
    return summary;
  } catch {
    return undefined;
  }
}

export type SecretPlan =
  /** Ask for the vendor-issued secret; required. */
  | { action: 'prompt'; required: true }
  /** Ask for the vendor's public key (PEM/base64, or a file); required. */
  | { action: 'prompt_public_key'; required: true }
  /** Don't ask: Hookbase generates it and the create reply shows it once. */
  | { action: 'generated' }
  /** Don't ask, and say why. */
  | { action: 'skip'; reason: string }
  /** The catalog couldn't say: offer an optional prompt and let the API decide. */
  | { action: 'optional' };

/** How a create flow should handle the secret for a provider. */
export function planSecret(provider: string, info: SecretInfo | undefined): SecretPlan {
  if (!provider) return { action: 'skip', reason: 'No provider, so nothing is verified and no secret is needed.' };
  const name = info?.providerName ?? provider;
  if (info?.secretAfterRegistration) {
    return { action: 'skip', reason: afterRegistrationNote(provider, name, true) };
  }
  switch (info?.secretSource) {
    case 'provider':
      return { action: 'prompt', required: true };
    case 'public_key':
      return { action: 'prompt_public_key', required: true };
    case 'operator':
      return { action: 'generated' };
    case 'built_in':
      return { action: 'skip', reason: `${name} is verified with a key Hookbase already has — there is no secret to enter.` };
    case 'none':
      return { action: 'skip', reason: `${name} doesn't sign its webhooks, so there is no secret to enter.` };
    default:
      return { action: 'optional' };
  }
}

/**
 * What to tell the user about a source with no secret yet where only the vendor can issue one
 * (`awaitingSigningSecret`): Stripe-style secrets copied from the vendor's dashboard, or ones that
 * exist only after the ingest URL is registered (`afterRegistration`, e.g. Asana and Notion).
 */
export function afterRegistrationNote(provider: string, name = provider, afterRegistration = false): string {
  if (provider === 'notion') {
    return `${name} sends a verification token to the ingest URL when you create the subscription. ` +
      `Run "hookbase inbound sources pending-verification <source>" to see it, paste it into ${name}'s Verify form, ` +
      `then "hookbase inbound sources adopt-verification <source>" to make it this source's secret.`;
  }
  const set = `set it with "hookbase inbound sources update <source> --signing-secret <secret>"`;
  if (afterRegistration) {
    return `${name} issues its secret only after the ingest URL is registered with it. Once you have it, ${set}.`;
  }
  return `${name} issues this source's signing secret and none is set yet, so events are accepted but not verified. ` +
    `Copy it from ${name} and ${set}.`;
}

/**
 * Why rotate-secret shouldn't run for a provider, or null when it can. Only secrets Hookbase
 * generated (`operator`) can be rotated by Hookbase. `apiRejects` says whether the API itself
 * would answer 400 — it does for every case here except a vendor that doesn't sign at all, where
 * a rotated secret is merely never checked.
 */
export function rotateRefusal(
  provider: string | null | undefined,
  info: SecretInfo | undefined,
): { reason: string; apiRejects: boolean } | null {
  if (!provider) return null;
  const name = info?.providerName ?? provider;
  const update = 'hookbase inbound sources update <source> --signing-secret';
  if (info?.secretAfterRegistration) {
    return {
      reason: `${name} issues its own secret after registration — Hookbase can't generate one. ` +
        `Get the new value from ${name}, then run "${update} <secret>".`,
      apiRejects: true,
    };
  }
  switch (info?.secretSource) {
    case 'provider':
      return {
        reason: `${name} issues its own signing secret — Hookbase can't generate a valid one. ` +
          `Regenerate it in ${name}, then run "${update} <secret>".`,
        apiRejects: true,
      };
    case 'public_key':
      return {
        reason: `${name} verifies with a public key — there is no secret to generate. ` +
          `Paste the replacement key with "${update} @key.pem".`,
        apiRejects: true,
      };
    case 'built_in':
      return {
        reason: `${name} is verified with a key Hookbase already has — this source has no secret to rotate.`,
        apiRejects: true,
      };
    case 'none':
      return {
        reason: `${name} doesn't sign its webhooks, so a rotated secret would never be checked.`,
        apiRejects: false,
      };
    default:
      return null;
  }
}

/**
 * `--signing-secret` values may be `@path` to read a file — public keys are multi-line PEM, which
 * a shell argument or a single-line prompt mangles. Trailing whitespace is trimmed.
 */
export function readSecretValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('@') && trimmed.length > 1) {
    return fs.readFileSync(trimmed.slice(1), 'utf8').trim();
  }
  return trimmed;
}

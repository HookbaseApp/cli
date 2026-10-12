import { select, input, confirm } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as logger from '../lib/logger.js';

function isPromptCancelled(error: unknown): boolean {
  return error instanceof ExitPromptError ||
    (error instanceof Error && error.name === 'ExitPromptError');
}

const FRAMEWORKS = ['express', 'fastify', 'hono', 'nextjs', 'cloudflare-worker'] as const;
type Framework = typeof FRAMEWORKS[number];

// ---------------------------------------------------------------------------------------------
// Providers
//
// This table mirrors the API's webhook signature scheme table (api/src/utils/signature-schemes.ts).
// That table is what `SUPPORTED_SIGNATURE_PROVIDERS` — and therefore `VALID_PROVIDERS` in
// api/src/routes/sources.ts — is built from, and `POST /api/sources` validates `provider` against
// it and rejects anything else with a 400. So a provider offered here that is missing there
// scaffolds a handler for a source the platform will refuse to create, and a provider missing here
// is simply unreachable from `hookbase init`. The scheme fields are mirrored too, not just the
// ids, because the scaffold has to emit a verifier that agrees with the one Hookbase runs.
//
// Only `hmac` and `shared_secret` rows (plus Twilio, whose bespoke verifier predates this) are
// scaffolded. Providers the API verifies with a public key, a certificate or a bespoke scheme are
// listed in INGEST_VERIFIED instead: Hookbase ingest verifies them, and the scaffolded handler
// receives the events Hookbase forwards, so it gets no local verifier. Together the two tables
// cover every id in the API's table — src/commands/provider-lists.test.ts checks that.
// `PROVIDERS` — what --provider accepts, and what the error message lists — is sorted.
// ---------------------------------------------------------------------------------------------

type HeaderFormat =
  /** With `listSeparator`, the header may hold several signatures (key rotation); any may match. */
  | { readonly type: 'plain'; readonly listSeparator?: string }
  | {
      readonly type: 'key_value';
      readonly pairSeparator: string;
      readonly signatureKey: string;
      /** Absent when the timestamp isn't in the header (or isn't signed at all). */
      readonly timestampKey?: string;
    }
  | {
      readonly type: 'versioned_list';
      readonly entrySeparator: string;
      readonly versionSeparator: string;
      readonly version: string;
    };

interface ProviderScheme {
  readonly id: string;
  readonly label: string;
  /**
   * `hmac` — keyed hash over a string built from the request.
   * `shared_secret` — the provider echoes a token you configured; there is no hash.
   * `bespoke` — not a function of the body alone, so it gets its own generated verifier.
   */
  readonly kind: 'hmac' | 'shared_secret' | 'bespoke';
  readonly algorithm: 'sha1' | 'sha256' | 'sha512';
  readonly encoding: 'hex' | 'base64';
  /** Headers carrying the signature; several means the first one present is used. */
  readonly header: readonly string[];
  /** Numbered headers `<prefix>1`..`<prefix><count>`, every present one a candidate (DocuSign). */
  readonly allHeadersPattern?: { readonly prefix: string; readonly count: number };
  readonly headerFormat: HeaderFormat;
  /** Fixed prefix on the encoded signature, e.g. `sha256=`. Required unless `prefixOptional`. */
  readonly signaturePrefix?: string;
  readonly prefixOptional?: boolean;
  /** What gets hashed, as a template over `{body}`, `{timestamp}` and `{id}`. */
  readonly signingTemplate: string;
  readonly timestampHeader?: readonly string[];
  readonly idHeader?: readonly string[];
  /** Max accepted clock skew, seconds. Set whenever `{timestamp}` is in the signing string. */
  readonly timestampTolerance?: number;
  /** How the timestamp is written. Default `unix_s`; WorkOS sends ms, Klaviyo an HTTP date. */
  readonly timestampFormat?: 'unix_s' | 'unix_ms' | 'http_date';
  /** Stripped from the configured secret before use, e.g. Standard Webhooks' `whsec_`. */
  readonly secretPrefix?: string;
  /** `base64` means the secret encodes the key bytes and must be decoded before signing. */
  readonly secretEncoding?: 'raw' | 'base64';
  /** Overrides the derived `<ID>_SIGNING_SECRET` env var name. */
  readonly envVar?: string;
}

const PROVIDER_SCHEMES = [
  // Supported before the scheme table existed.
  {
    id: 'github',
    label: 'GitHub',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['x-hub-signature-256'],
    headerFormat: { type: 'plain' },
    signaturePrefix: 'sha256=',
    signingTemplate: '{body}',
  },
  {
    id: 'stripe',
    label: 'Stripe',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['stripe-signature'],
    headerFormat: { type: 'key_value', pairSeparator: ',', signatureKey: 'v1', timestampKey: 't' },
    signingTemplate: '{timestamp}.{body}',
    timestampTolerance: 300,
  },
  {
    id: 'shopify',
    label: 'Shopify',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'base64',
    header: ['x-shopify-hmac-sha256'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'slack',
    label: 'Slack',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['x-slack-signature'],
    headerFormat: { type: 'plain' },
    signaturePrefix: 'v0=',
    signingTemplate: 'v0:{timestamp}:{body}',
    timestampHeader: ['x-slack-request-timestamp'],
    timestampTolerance: 300,
  },
  {
    id: 'twilio',
    label: 'Twilio',
    kind: 'bespoke',
    algorithm: 'sha1',
    encoding: 'base64',
    header: ['x-twilio-signature'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },

  // The spec several senders share (Resend, Clerk, Fathom, GitLab signing tokens).
  {
    id: 'standard-webhooks',
    label: 'Standard Webhooks (Svix)',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'base64',
    // The spec says `webhook-*`; Svix's own senders use `svix-*`. Both genuinely arrive.
    header: ['webhook-signature', 'svix-signature'],
    headerFormat: {
      type: 'versioned_list',
      entrySeparator: ' ',
      versionSeparator: ',',
      version: 'v1',
    },
    signingTemplate: '{id}.{timestamp}.{body}',
    timestampHeader: ['webhook-timestamp', 'svix-timestamp'],
    idHeader: ['webhook-id', 'svix-id'],
    timestampTolerance: 300,
    // The one scheme whose key is not the secret's own bytes. Using the string as-is produces a
    // digest that never matches — the most common way an implementation of this spec goes wrong.
    secretPrefix: 'whsec_',
    secretEncoding: 'base64',
  },

  // Wired up when the catalog was, alphabetically.
  {
    id: 'bitbucket',
    label: 'Bitbucket',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['x-hub-signature'],
    headerFormat: { type: 'plain' },
    signaturePrefix: 'sha256=',
    signingTemplate: '{body}',
  },
  {
    id: 'gitlab',
    label: 'GitLab',
    kind: 'shared_secret',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['x-gitlab-token'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
    // GitLab's newer *signing token* mode is Standard Webhooks verbatim — pick
    // standard-webhooks for that, not this.
  },
  {
    id: 'heroku',
    label: 'Heroku',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'base64',
    header: ['heroku-webhook-hmac-sha256'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'lemonsqueezy',
    label: 'Lemon Squeezy',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['x-signature'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'paddle',
    label: 'Paddle',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['paddle-signature'],
    headerFormat: { type: 'key_value', pairSeparator: ';', signatureKey: 'h1', timestampKey: 'ts' },
    signingTemplate: '{timestamp}:{body}',
    timestampTolerance: 300,
    // Paddle's docs are explicit that the key is the raw secret string, pdl_ prefix included.
  },
  {
    id: 'sentry',
    label: 'Sentry',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['sentry-hook-signature'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'typeform',
    label: 'Typeform',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'base64',
    header: ['typeform-signature'],
    headerFormat: { type: 'plain' },
    // Base64 behind a "sha256=" prefix — the one combination that reads like a mistake and is
    // not. GitHub's identical-looking prefix carries hex.
    signaturePrefix: 'sha256=',
    signingTemplate: '{body}',
  },
  {
    id: 'zoom',
    label: 'Zoom',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['x-zm-signature'],
    headerFormat: { type: 'plain' },
    signaturePrefix: 'v0=',
    signingTemplate: 'v0:{timestamp}:{body}',
    timestampHeader: ['x-zm-request-timestamp'],
    timestampTolerance: 300,
  },

  // Added 2026-09-25, alphabetically.
  {
    id: 'airtable',
    label: 'Airtable',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['x-airtable-content-mac'],
    headerFormat: { type: 'plain' },
    signaturePrefix: 'hmac-sha256=',
    signingTemplate: '{body}',
    // Airtable hands you `macSecretBase64`; the key is its decoded bytes, not the string.
    secretEncoding: 'base64',
  },
  {
    id: 'asana',
    label: 'Asana',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['x-hook-signature'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'calendly',
    label: 'Calendly',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['calendly-webhook-signature'],
    headerFormat: { type: 'key_value', pairSeparator: ',', signatureKey: 'v1', timestampKey: 't' },
    signingTemplate: '{timestamp}.{body}',
    // Calendly's docs name three minutes explicitly.
    timestampTolerance: 180,
  },
  {
    id: 'intercom',
    label: 'Intercom',
    kind: 'hmac',
    // SHA-1, not SHA-256: same header and prefix shape GitHub used before it moved on.
    algorithm: 'sha1',
    encoding: 'hex',
    header: ['x-hub-signature'],
    headerFormat: { type: 'plain' },
    signaturePrefix: 'sha1=',
    signingTemplate: '{body}',
  },
  {
    id: 'notion',
    label: 'Notion',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['x-notion-signature'],
    headerFormat: { type: 'plain' },
    signaturePrefix: 'sha256=',
    signingTemplate: '{body}',
  },
  {
    id: 'razorpay',
    label: 'Razorpay',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['x-razorpay-signature'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'workos',
    label: 'WorkOS',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['workos-signature'],
    headerFormat: { type: 'key_value', pairSeparator: ',', signatureKey: 'v1', timestampKey: 't' },
    signingTemplate: '{timestamp}.{body}',
    // Milliseconds, not seconds — checked as seconds, every WorkOS request reads as far future.
    timestampFormat: 'unix_ms',
    timestampTolerance: 300,
  },

  // Added 2026-10 from the API scheme table, in its order.
  {
    id: 'gitlab-signing-token',
    label: 'GitLab (Signing Token)',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'base64',
    header: ['webhook-signature', 'svix-signature'],
    headerFormat: {
      type: 'versioned_list',
      entrySeparator: ' ',
      versionSeparator: ',',
      version: 'v1',
    },
    signingTemplate: '{id}.{timestamp}.{body}',
    timestampHeader: ['webhook-timestamp', 'svix-timestamp'],
    idHeader: ['webhook-id', 'svix-id'],
    timestampTolerance: 300,
    secretPrefix: 'whsec_',
    secretEncoding: 'base64',
  },
  {
    id: 'linear',
    label: 'Linear',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['linear-signature'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'vercel',
    label: 'Vercel',
    kind: 'hmac',
    algorithm: 'sha1',
    encoding: 'hex',
    header: ['x-vercel-signature'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'supabase-auth-hooks',
    label: 'Supabase Auth Hooks',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'base64',
    header: ['webhook-signature', 'svix-signature'],
    headerFormat: {
      type: 'versioned_list',
      entrySeparator: ' ',
      versionSeparator: ',',
      version: 'v1',
    },
    signingTemplate: '{id}.{timestamp}.{body}',
    timestampHeader: ['webhook-timestamp', 'svix-timestamp'],
    idHeader: ['webhook-id', 'svix-id'],
    timestampTolerance: 300,
    secretPrefix: 'v1,whsec_',
    secretEncoding: 'base64',
  },
  {
    id: 'circleci',
    label: 'CircleCI',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['circleci-signature'],
    headerFormat: { type: 'key_value', pairSeparator: ',', signatureKey: 'v1' },
    signingTemplate: '{body}',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp Business',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['x-hub-signature-256'],
    headerFormat: { type: 'plain' },
    signaturePrefix: 'sha256=',
    signingTemplate: '{body}',
  },
  {
    id: 'zendesk',
    label: 'Zendesk',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'base64',
    header: ['x-zendesk-webhook-signature'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{timestamp}{body}',
    timestampHeader: ['x-zendesk-webhook-signature-timestamp'],
    timestampTolerance: 300,
  },
  {
    id: 'clickup',
    label: 'ClickUp',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['x-signature'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'mailchimp',
    label: 'Mailchimp',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['x-mailchimp-signature'],
    headerFormat: { type: 'key_value', pairSeparator: ',', signatureKey: 'v1', timestampKey: 't' },
    signingTemplate: '{timestamp}.{body}',
    timestampTolerance: 300,
  },
  {
    id: 'pagerduty',
    label: 'PagerDuty',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['x-pagerduty-signature'],
    headerFormat: { type: 'key_value', pairSeparator: ',', signatureKey: 'v1' },
    signingTemplate: '{body}',
  },
  {
    id: 'woocommerce',
    label: 'WooCommerce',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'base64',
    header: ['x-wc-webhook-signature'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'docusign',
    label: 'DocuSign',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'base64',
    header: ['x-docusign-signature-1'],
    // One numbered header per active key, up to 100; any of them may carry the match.
    allHeadersPattern: { prefix: 'x-docusign-signature-', count: 100 },
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'coinbase-commerce',
    label: 'Coinbase Commerce',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['x-cc-webhook-signature'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'gocardless',
    label: 'GoCardless',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['webhook-signature'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'terraform-cloud',
    label: 'HCP Terraform (Terraform Cloud)',
    kind: 'hmac',
    algorithm: 'sha512',
    encoding: 'hex',
    header: ['x-tfe-notification-signature'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'launchdarkly',
    label: 'LaunchDarkly',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['x-ld-signature'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'segment',
    label: 'Segment',
    kind: 'hmac',
    algorithm: 'sha1',
    encoding: 'hex',
    header: ['x-signature'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'klaviyo',
    label: 'Klaviyo',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['klaviyo-signature'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}{timestamp}',
    timestampHeader: ['klaviyo-timestamp'],
    timestampFormat: 'http_date',
    timestampTolerance: 300,
  },
  {
    id: 'telegram',
    label: 'Telegram',
    kind: 'shared_secret',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['x-telegram-bot-api-secret-token'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'jira',
    label: 'Jira',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['x-hub-signature'],
    headerFormat: { type: 'plain' },
    signaturePrefix: 'sha256=',
    signingTemplate: '{body}',
  },
  {
    id: 'okta',
    label: 'Okta (header echo)',
    kind: 'shared_secret',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['authorization'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'grafana',
    label: 'Grafana Cloud (Bearer token)',
    kind: 'shared_secret',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['authorization'],
    headerFormat: { type: 'plain' },
    signaturePrefix: 'Bearer ',
    signingTemplate: '{body}',
  },
  {
    id: 'grafana-hmac',
    label: 'Grafana Cloud (HMAC, no timestamp)',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['x-grafana-alerting-signature'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'grafana-hmac-timestamped',
    label: 'Grafana Cloud (HMAC, with timestamp)',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['x-grafana-alerting-signature'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{timestamp}:{body}',
    timestampHeader: ['x-grafana-alerting-signature-timestamp'],
    timestampTolerance: 300,
  },
  {
    id: 'auth0',
    label: 'Auth0',
    kind: 'shared_secret',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['authorization'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'newrelic',
    label: 'New Relic',
    kind: 'shared_secret',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['authorization'],
    headerFormat: { type: 'plain' },
    signaturePrefix: 'Bearer ',
    signingTemplate: '{body}',
  },
  {
    id: 'railway',
    label: 'Railway',
    kind: 'shared_secret',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['authorization'],
    headerFormat: { type: 'plain' },
    signaturePrefix: 'Bearer ',
    prefixOptional: true,
    signingTemplate: '{body}',
  },
  {
    id: 'pipedrive',
    label: 'Pipedrive',
    kind: 'shared_secret',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['authorization'],
    headerFormat: { type: 'plain' },
    signaturePrefix: 'Basic ',
    signingTemplate: '{body}',
  },
  {
    id: 'chargebee',
    label: 'Chargebee',
    kind: 'shared_secret',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['authorization'],
    headerFormat: { type: 'plain' },
    signaturePrefix: 'Basic ',
    signingTemplate: '{body}',
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare (Notification Webhooks)',
    kind: 'shared_secret',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['cf-webhook-auth'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'freshdesk',
    label: 'Freshdesk',
    kind: 'shared_secret',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['authorization'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'postmark',
    label: 'Postmark',
    kind: 'shared_secret',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['authorization'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'datadog',
    label: 'Datadog',
    kind: 'shared_secret',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['authorization'],
    headerFormat: { type: 'plain' },
    signingTemplate: '{body}',
  },
  {
    id: 'supabase',
    label: 'Supabase (Database Webhooks)',
    kind: 'shared_secret',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['authorization'],
    headerFormat: { type: 'plain' },
    signaturePrefix: 'Bearer ',
    prefixOptional: true,
    signingTemplate: '{body}',
  },
  {
    id: 'bigcommerce',
    label: 'BigCommerce',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'base64',
    header: ['webhook-signature'],
    headerFormat: {
      type: 'versioned_list',
      entrySeparator: ' ',
      versionSeparator: ',',
      version: 'v1',
    },
    signingTemplate: '{id}.{timestamp}.{body}',
    timestampHeader: ['webhook-timestamp'],
    idHeader: ['webhook-id'],
    timestampTolerance: 300,
  },
  {
    id: 'mollie',
    label: 'Mollie (Next-gen Webhooks)',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['x-mollie-signature'],
    headerFormat: { type: 'plain', listSeparator: ',' },
    signaturePrefix: 'sha256=',
    prefixOptional: true,
    signingTemplate: '{body}',
  },

  // The fallback, last.
  {
    id: 'custom',
    label: 'Custom HMAC',
    kind: 'hmac',
    algorithm: 'sha256',
    encoding: 'hex',
    header: ['x-signature', 'x-webhook-signature', 'x-hub-signature-256'],
    headerFormat: { type: 'plain' },
    signaturePrefix: 'sha256=',
    // No published format to be strict about; senders vary on the prefix.
    prefixOptional: true,
    signingTemplate: '{body}',
    envVar: 'WEBHOOK_SIGNING_SECRET',
  },
] as const satisfies readonly ProviderScheme[];

/**
 * Providers the API verifies with a public key (Discord, SendGrid, Wise), a certificate the request
 * points at (AWS SNS) or a bespoke scheme (the rest). Reproducing those locally is a verifier per
 * vendor, and pointless behind Hookbase: ingest has already verified the request before it is
 * forwarded. These get a handler that accepts what Hookbase forwards, and a note saying so.
 */
interface IngestVerified {
  readonly id: string;
  readonly label: string;
  readonly kind: 'asymmetric' | 'bespoke';
}

const INGEST_VERIFIED = [
  {
    id: 'discord',
    label: 'Discord',
    kind: 'asymmetric',
  },
  {
    id: 'sendgrid',
    label: 'SendGrid',
    kind: 'asymmetric',
  },
  {
    id: 'wise',
    label: 'Wise',
    kind: 'asymmetric',
  },
  {
    id: 'wise-sandbox',
    label: 'Wise (sandbox)',
    kind: 'asymmetric',
  },
  {
    id: 'netlify',
    label: 'Netlify',
    kind: 'bespoke',
  },
  {
    id: 'mailgun',
    label: 'Mailgun',
    kind: 'bespoke',
  },
  {
    id: 'adyen',
    label: 'Adyen',
    kind: 'bespoke',
  },
  {
    id: 'braintree',
    label: 'Braintree',
    kind: 'bespoke',
  },
  {
    id: 'square',
    label: 'Square',
    kind: 'bespoke',
  },
  {
    id: 'trello',
    label: 'Trello',
    kind: 'bespoke',
  },
  {
    id: 'paypal',
    label: 'PayPal',
    kind: 'bespoke',
  },
  {
    id: 'aws-sns',
    label: 'AWS SNS',
    kind: 'bespoke',
  },
  {
    id: 'hubspot',
    label: 'HubSpot',
    kind: 'bespoke',
  },
] as const satisfies readonly IngestVerified[];

type CanonicalProvider = typeof PROVIDER_SCHEMES[number]['id'] | typeof INGEST_VERIFIED[number]['id'];

/**
 * Accepted on `--provider` but deliberately absent from the menu: each is a second spelling of a
 * scheme already listed, and showing both would read as two different choices. The API accepts
 * them, so rejecting them here would be the CLI being stricter than the platform.
 */
const PROVIDER_ALIASES = {
  svix: 'standard-webhooks',
  clerk: 'standard-webhooks',
  resend: 'standard-webhooks',
  render: 'standard-webhooks',
  etsy: 'standard-webhooks',
  stytch: 'standard-webhooks',
  generic: 'custom',
} as const satisfies Record<string, CanonicalProvider>;

type ProviderAlias = keyof typeof PROVIDER_ALIASES;
type Provider = CanonicalProvider | ProviderAlias;

/** Every provider id the API accepts, aliases included — the mirror of VALID_PROVIDERS. */
const PROVIDERS: readonly Provider[] = [
  ...PROVIDER_SCHEMES.map((s) => s.id),
  ...INGEST_VERIFIED.map((s) => s.id),
  ...(Object.keys(PROVIDER_ALIASES) as ProviderAlias[]),
].sort();

function canonicalId(p: Provider): string {
  return p in PROVIDER_ALIASES ? PROVIDER_ALIASES[p as ProviderAlias] : p;
}

/** The ingest-verified entry for a provider, or undefined when it gets a local verifier. */
function ingestVerifiedFor(p: Provider): IngestVerified | undefined {
  const canonical = canonicalId(p);
  return INGEST_VERIFIED.find((s) => s.id === canonical);
}

function schemeFor(p: Provider): ProviderScheme {
  const canonical = canonicalId(p);
  const scheme = PROVIDER_SCHEMES.find((s) => s.id === canonical);
  if (!scheme) {
    // Unreachable: `p` was checked against PROVIDERS, which is built from this same table.
    throw new Error(`No signature scheme for provider '${p}'`);
  }
  return scheme;
}

interface InitOptions {
  framework?: string;
  provider?: string;
  dir?: string;
  source?: string;
  force?: boolean;
}

function templatesRoot(): string {
  // Resolve relative to the compiled file. tsc emits to dist/commands/init.js,
  // and the build copy step lands templates at dist/templates/.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, '..', 'templates');
}

function isDirNonEmpty(dir: string): boolean {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

function copyTemplate(srcDir: string, destDir: string, replacements: Record<string, string>): void {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    // Strip the .tmpl extension so the rendered filename is the real one.
    const outName = entry.name.endsWith('.tmpl') ? entry.name.slice(0, -5) : entry.name;
    const destPath = path.join(destDir, outName);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyTemplate(srcPath, destPath, replacements);
      continue;
    }

    const content = fs.readFileSync(srcPath, 'utf-8');
    const rendered = Object.entries(replacements).reduce(
      (acc, [key, value]) => acc.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), () => value),
      content
    );
    fs.writeFileSync(destPath, rendered);
  }
}

export async function initCommand(options: InitOptions): Promise<void> {
  try {
    let framework = options.framework as Framework | undefined;
    if (!framework) {
      framework = (await select({
        message: 'Choose a framework:',
        choices: [
          { name: 'Express (Node.js, most common)', value: 'express' },
          { name: 'Fastify (Node.js, faster)', value: 'fastify' },
          { name: 'Hono (Node/Bun/edge runtimes)', value: 'hono' },
          { name: 'Next.js (App Router route handler)', value: 'nextjs' },
          { name: 'Cloudflare Worker', value: 'cloudflare-worker' },
        ],
      })) as Framework;
    }
    if (!FRAMEWORKS.includes(framework)) {
      logger.error(`Unknown framework: ${framework}. Choose one of: ${FRAMEWORKS.join(', ')}`);
      return;
    }

    let provider = options.provider as Provider | undefined;
    if (!provider) {
      provider = (await select({
        message: 'Provider for signature verification:',
        pageSize: 12,
        choices: [
          ...PROVIDER_SCHEMES.map((s) => ({
            // The header is part of the label because that is what the user is looking at in the
            // provider's own dashboard when they answer this prompt.
            name: `${s.label} — ${displayHeader(s.header[0])}`,
            value: s.id as Provider,
          })),
          ...INGEST_VERIFIED.map((s) => ({
            name: `${s.label} — verified by Hookbase ingest (no local verifier)`,
            value: s.id as Provider,
          })),
        ],
      })) as Provider;
    }
    if (!PROVIDERS.includes(provider)) {
      logger.error(`Unknown provider: ${provider}. Choose one of: ${PROVIDERS.join(', ')}`);
      return;
    }

    let dir = options.dir;
    if (!dir) {
      dir = await input({ message: 'Output directory:', default: './hookbase-handler' });
    }
    const targetDir = path.resolve(dir);

    if (fs.existsSync(targetDir) && isDirNonEmpty(targetDir) && !options.force) {
      const overwrite = await confirm({
        message: `Directory ${targetDir} is not empty. Continue and overwrite?`,
        default: false,
      });
      if (!overwrite) {
        logger.info('Aborted.');
        return;
      }
    }

    fs.mkdirSync(targetDir, { recursive: true });

    const srcDir = path.join(templatesRoot(), framework);
    if (!fs.existsSync(srcDir)) {
      logger.error(`Template not found at ${srcDir}. The CLI may have been installed without templates.`);
      return;
    }

    const ingestVerified = ingestVerifiedFor(provider);
    copyTemplate(srcDir, targetDir, {
      PROVIDER: provider,
      PROVIDER_LABEL: providerLabel(provider),
      VERIFY_SNIPPET: ingestVerified
        ? passThroughSnippet(ingestVerified, framework)
        : getVerifySnippet(provider, framework),
      ENV_VAR_NAME: envVarName(provider),
      MISSING_SECRET_NOTE: ingestVerified
        ? `not needed: Hookbase ingest verifies ${ingestVerified.label} signatures`
        : 'signature verification will fail',
      SOURCE_URL: options.source ? `Configure your Hookbase source destination URL to hit this endpoint.` : 'See https://www.hookbase.app/docs',
      HEADER_NAME: signatureHeader(provider),
    });

    logger.success(`Scaffold created at ${targetDir}`);
    logger.log('');
    logger.log('Next steps:');
    logger.log(`  cd ${path.relative(process.cwd(), targetDir) || '.'}`);
    logger.log('  npm install');
    if (framework === 'cloudflare-worker') {
      logger.log('  npx wrangler dev');
    } else {
      logger.log('  npm run dev');
    }
    logger.log('');
    logger.dim(`Then point a Hookbase destination at your dev URL (use 'hookbase listen <port>' for a tunnel).`);
    if (ingestVerified) {
      logger.log('');
      logger.info(
        `${ingestVerified.label} uses ${ingestVerified.kind === 'asymmetric' ? 'public-key' : 'a provider-specific'} signature verification, ` +
        'which Hookbase ingest performs before forwarding. The scaffolded handler receives those forwarded ' +
        'events and does not re-verify them — keep its URL private (a Hookbase tunnel or destination), ' +
        `and point ${ingestVerified.label} at your source's ingest URL, not at this handler.`
      );
    }
  } catch (error) {
    if (isPromptCancelled(error)) {
      return;
    }
    logger.error(error instanceof Error ? error.message : 'init failed');
  }
}

function providerLabel(p: Provider): string {
  return ingestVerifiedFor(p)?.label ?? schemeFor(p).label;
}

function envVarName(p: Provider): string {
  const passthrough = ingestVerifiedFor(p);
  const scheme = passthrough ? undefined : schemeFor(p);
  // `standard-webhooks` would otherwise produce a name with a hyphen in it, which is not a
  // legal shell identifier.
  return scheme?.envVar ?? `${canonicalId(p).toUpperCase().replace(/[^A-Z0-9]/g, '_')}_SIGNING_SECRET`;
}

function signatureHeader(p: Provider): string {
  return ingestVerifiedFor(p) ? '(verified by Hookbase ingest)' : schemeFor(p).header[0];
}

/** `x-hub-signature-256` -> `X-Hub-Signature-256`, for display only. Header names are matched
 *  case-insensitively, so this never affects verification. */
function displayHeader(name: string): string {
  return name.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('-');
}

// ---------------------------------------------------------------------------------------------
// Verifier generation
//
// Templates get a `verifySignature(rawBody, secret, getHeader, requestUrl)` function as a string,
// so a framework template never has to know anything provider-specific. `getHeader` is the
// template's own header accessor, which is what lets a scheme read a timestamp or message-id
// header without every template hard-coding one provider's header names.
// ---------------------------------------------------------------------------------------------

type Runtime = 'node' | 'web';
type Lang = 'js' | 'ts';

const FRAMEWORK_TARGET: Record<Framework, { runtime: Runtime; lang: Lang }> = {
  express: { runtime: 'node', lang: 'js' },
  fastify: { runtime: 'node', lang: 'js' },
  hono: { runtime: 'node', lang: 'ts' },
  nextjs: { runtime: 'node', lang: 'ts' },
  'cloudflare-worker': { runtime: 'web', lang: 'ts' },
};

/** `getHeader('a') || getHeader('b') || ''` — first header present wins. */
function readHeader(names: readonly string[]): string {
  return `${names.map((n) => `getHeader('${n}')`).join(' || ')} || ''`;
}

/** Turns a signing template such as `v0:{timestamp}:{body}` into a JS expression. */
function signingExpr(template: string): string {
  if (template === '{body}') return 'rawBody';
  const filled = template
    .replace(/\{body\}/g, '${rawBody}')
    .replace(/\{timestamp\}/g, '${timestamp}')
    .replace(/\{id\}/g, '${id}');
  return '`' + filled + '`';
}

/**
 * The `const key = …` line, for the schemes where the HMAC key is not simply the configured
 * secret — Standard Webhooks and Airtable both hand you base64 and mean its decoded bytes.
 * Schemes that sign with the secret as-is get no line at all; `keyExpr` names `secret` directly.
 */
function keyLines(scheme: ProviderScheme, runtime: Runtime): string[] {
  if (scheme.secretEncoding !== 'base64') return [];
  const stripped = scheme.secretPrefix
    ? `secret.replace(/^${scheme.secretPrefix.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/, '')`
    : 'secret';
  if (runtime === 'node') {
    return [
      '// The secret encodes the key bytes; signing with the string itself never matches.',
      `const key = Buffer.from(${stripped}, 'base64');`,
    ];
  }
  return [
    '// The secret encodes the key bytes; signing with the string itself never matches.',
    '// atob throws on a malformed secret — fail closed rather than answer 500.',
    'let key;',
    'try {',
    // `new Uint8Array(...)` rather than `Uint8Array.from(...)`: only the constructor is typed
    // as backed by an ArrayBuffer, which is what crypto.subtle.importKey will accept.
    `  key = new Uint8Array([...atob(${stripped})].map((c) => c.charCodeAt(0)));`,
    '} catch {',
    '  return false;',
    '}',
  ];
}

function keyExpr(scheme: ProviderScheme): string {
  return scheme.secretEncoding === 'base64' ? 'key' : 'secret';
}

function digestExpr(scheme: ProviderScheme, runtime: Runtime, dataExpr: string): string {
  if (runtime === 'node') {
    return `crypto.createHmac('${scheme.algorithm}', ${keyExpr(scheme)}).update(${dataExpr}, 'utf8').digest('${scheme.encoding}')`;
  }
  const webAlg = scheme.algorithm === 'sha1' ? 'SHA-1' : scheme.algorithm === 'sha512' ? 'SHA-512' : 'SHA-256';
  return `await hmac(${keyExpr(scheme)}, ${dataExpr}, '${webAlg}', '${scheme.encoding}')`;
}

function timestampGuard(tolerance: number, format: ProviderScheme['timestampFormat'] = 'unix_s'): string[] {
  if (format === 'http_date') {
    return [
      '// An HTTP date such as "Thu, 04 Jan 2024 18:05:25 GMT", not a number.',
      'const sentAt = Date.parse(timestamp) / 1000;',
      `if (!Number.isFinite(sentAt) || Math.abs(Date.now() / 1000 - sentAt) > ${tolerance}) {`,
      '  return false;',
      '}',
    ];
  }
  const seconds = format === 'unix_ms' ? 'Number(timestamp) / 1000' : 'Number(timestamp)';
  return [
    ...(format === 'unix_ms' ? ['// Milliseconds since the epoch, not seconds.'] : []),
    `if (!/^\\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - ${seconds}) > ${tolerance}) {`,
    '  return false;',
    '}',
  ];
}

/** Strips the scheme's fixed prefix off the header value, leaving the encoded signature. */
function providedLines(scheme: ProviderScheme): string[] {
  if (!scheme.signaturePrefix) return ['const provided = header;'];
  if (scheme.prefixOptional) {
    return [
      `const prefix = '${scheme.signaturePrefix}';`,
      'const provided = header.startsWith(prefix) ? header.slice(prefix.length) : header;',
    ];
  }
  return [
    `const prefix = '${scheme.signaturePrefix}';`,
    'if (!header.startsWith(prefix)) return false;',
    'const provided = header.slice(prefix.length);',
  ];
}

function verifyBody(scheme: ProviderScheme, runtime: Runtime, lang: Lang): string[] {
  const lines: string[] = [];

  if (scheme.kind === 'shared_secret') {
    lines.push(
      `const token = ${readHeader(scheme.header)};`,
      'if (!token || !secret) return false;',
      '// The provider echoes the token you configured on the webhook; there is no hash to',
      '// recompute, but the token IS the credential, so it is still compared in constant time.'
    );
    if (!scheme.signaturePrefix) {
      lines.push('return timingSafeEqual(secret, token);');
    } else if (scheme.prefixOptional) {
      lines.push(
        `// Sent as "${scheme.signaturePrefix}<token>", though the secret may have been saved with the prefix.`,
        `const prefix = '${scheme.signaturePrefix}';`,
        'if (token.startsWith(prefix) && timingSafeEqual(secret, token.slice(prefix.length))) return true;',
        'return timingSafeEqual(secret, token);'
      );
    } else {
      lines.push(
        `// Sent as "${scheme.signaturePrefix}<token>"; the configured secret is the part after it.`,
        `const prefix = '${scheme.signaturePrefix}';`,
        'if (!token.startsWith(prefix)) return false;',
        'return timingSafeEqual(secret, token.slice(prefix.length));'
      );
    }
    return lines;
  }

  if (scheme.kind === 'bespoke') {
    // Twilio, and only Twilio.
    lines.push(
      `const header = ${readHeader(scheme.header)};`,
      'if (!header || !secret) return false;',
      '// Twilio signs the full public URL it called plus the POST parameters, sorted by name and',
      '// concatenated as name+value — not the raw body. Behind a tunnel or a proxy that URL is not',
      '// the one this process sees, so override it with the URL configured in the Twilio console.'
    );
    lines.push(
      runtime === 'node'
        ? 'const signedUrl = process.env.WEBHOOK_PUBLIC_URL || requestUrl;'
        : 'const signedUrl = requestUrl;'
    );
    lines.push(
      'const params = new URLSearchParams(rawBody);',
      'let data = signedUrl;',
      'for (const name of [...new Set(params.keys())].sort()) {',
      "  data += name + params.getAll(name).join('');",
      '}',
      ...keyLines(scheme, runtime),
      `const expected = ${digestExpr(scheme, runtime, 'data')};`,
      'return timingSafeEqual(expected, header);'
    );
    return lines;
  }

  const format = scheme.headerFormat;

  if (format.type === 'key_value') {
    const example = format.timestampKey
      ? `${format.timestampKey}=<timestamp>${format.pairSeparator}${format.signatureKey}=<signature>`
      : `${format.signatureKey}=<signature>`;
    lines.push(
      `const header = ${readHeader(scheme.header)};`,
      'if (!header || !secret) return false;',
      `// Header is a "${format.pairSeparator}"-separated list of key=value pairs, e.g. "${example}".`,
      `// Every ${format.signatureKey}= entry is a candidate: senders repeat it while rotating secrets.`,
      lang === 'ts' ? 'const candidates: string[] = [];' : 'const candidates = [];',
      ...(format.timestampKey ? ["let timestamp = '';"] : []),
      `for (const pair of header.split('${format.pairSeparator}')) {`,
      "  const i = pair.indexOf('=');",
      '  if (i <= 0) continue;',
      '  const key = pair.slice(0, i).trim();',
      '  const value = pair.slice(i + 1).trim();',
      ...(format.timestampKey
        ? [
            `  if (key === '${format.timestampKey}') {`,
            '    if (!timestamp) timestamp = value;',
            `  } else if (key === '${format.signatureKey}') {`,
            '    candidates.push(value);',
            '  }',
          ]
        : [`  if (key === '${format.signatureKey}') candidates.push(value);`]),
      '}',
      'if (candidates.length === 0) return false;',
      ...(format.timestampKey
        ? ['if (!timestamp) return false;', ...timestampGuard(scheme.timestampTolerance ?? 300, scheme.timestampFormat)]
        : []),
      ...keyLines(scheme, runtime),
      `const expected = ${digestExpr(scheme, runtime, signingExpr(scheme.signingTemplate))};`,
      'return candidates.some((candidate) => timingSafeEqual(expected, candidate));'
    );
    return lines;
  }

  if (format.type === 'versioned_list') {
    lines.push(
      `const header = ${readHeader(scheme.header)};`,
      `const timestamp = ${readHeader(scheme.timestampHeader ?? [])};`,
      `const id = ${readHeader(scheme.idHeader ?? [])};`,
      'if (!header || !timestamp || !id || !secret) return false;',
      ...timestampGuard(scheme.timestampTolerance ?? 300, scheme.timestampFormat),
      ...keyLines(scheme, runtime),
      `const expected = ${digestExpr(scheme, runtime, signingExpr(scheme.signingTemplate))};`,
      `// The header is a ${format.entrySeparator === ' ' ? 'space' : `"${format.entrySeparator}"`}-delimited list of`,
      `// "<version>${format.versionSeparator}<signature>" entries. Anything that is not ${format.version} was signed`,
      '// by rules this handler does not implement, so it is skipped rather than compared.',
      `for (const entry of header.split('${format.entrySeparator}')) {`,
      `  const [version, provided] = entry.split('${format.versionSeparator}');`,
      `  if (version === '${format.version}' && provided && timingSafeEqual(expected, provided)) {`,
      '    return true;',
      '  }',
      '}',
      'return false;'
    );
    return lines;
  }

  // plain, but several candidates: one header listing them, or several numbered headers
  if (format.listSeparator || scheme.allHeadersPattern) {
    const pattern = scheme.allHeadersPattern;
    if (pattern) {
      lines.push(
        `// One numbered header per active key (${pattern.prefix}1..${pattern.count}); the configured`,
        '// key may be in any of them, so every one present is a candidate.',
        lang === 'ts' ? 'const values: string[] = [];' : 'const values = [];',
        `for (let i = 1; i <= ${pattern.count}; i++) {`,
        `  const value = getHeader('${pattern.prefix}' + i);`,
        '  if (value) values.push(value);',
        '}',
        'if (values.length === 0 || !secret) return false;'
      );
    } else {
      lines.push(
        `const header = ${readHeader(scheme.header)};`,
        'if (!header || !secret) return false;',
        `// May carry several signatures while a secret rotates, separated by "${format.listSeparator}".`,
        `const values = header.split('${format.listSeparator}').map((v) => v.trim()).filter(Boolean);`
      );
    }
    const strip = !scheme.signaturePrefix
      ? 'values'
      : scheme.prefixOptional
        ? `values.map((v) => (v.startsWith('${scheme.signaturePrefix}') ? v.slice(${scheme.signaturePrefix.length}) : v))`
        : `values.filter((v) => v.startsWith('${scheme.signaturePrefix}')).map((v) => v.slice(${scheme.signaturePrefix.length}))`;
    lines.push(
      `const candidates = ${strip};`,
      ...keyLines(scheme, runtime),
      `const expected = ${digestExpr(scheme, runtime, signingExpr(scheme.signingTemplate))};`,
      'return candidates.some((candidate) => timingSafeEqual(expected, candidate));'
    );
    return lines;
  }

  // plain
  lines.push(
    `const header = ${readHeader(scheme.header)};`,
    'if (!header || !secret) return false;'
  );
  if (scheme.timestampHeader) {
    lines.push(
      `const timestamp = ${readHeader(scheme.timestampHeader)};`,
      'if (!timestamp) return false;',
      ...timestampGuard(scheme.timestampTolerance ?? 300, scheme.timestampFormat)
    );
  }
  lines.push(
    ...providedLines(scheme),
    ...keyLines(scheme, runtime),
    `const expected = ${digestExpr(scheme, runtime, signingExpr(scheme.signingTemplate))};`,
    'return timingSafeEqual(expected, provided);'
  );
  return lines;
}

function helpers(runtime: Runtime, lang: Lang): string[] {
  const t = (js: string, ts: string) => (lang === 'ts' ? ts : js);
  if (runtime === 'node') {
    return [
      '// Constant-time compare that tolerates a length mismatch: crypto.timingSafeEqual throws',
      '// when the buffers differ in length, which would turn a malformed signature into a 500.',
      t(
        'function timingSafeEqual(a, b) {',
        'function timingSafeEqual(a: string, b: string): boolean {'
      ),
      "  const ab = Buffer.from(String(a), 'utf8');",
      "  const bb = Buffer.from(String(b), 'utf8');",
      '  if (ab.length !== bb.length) return false;',
      '  return crypto.timingSafeEqual(ab, bb);',
      '}',
    ];
  }
  return [
    t(
      'async function hmac(key, data, algorithm, encoding) {',
      "async function hmac(key: BufferSource | string, data: string, algorithm: string, encoding: 'hex' | 'base64'): Promise<string> {"
    ),
    "  const material = typeof key === 'string' ? new TextEncoder().encode(key) : key;",
    '  const cryptoKey = await crypto.subtle.importKey(',
    "    'raw',",
    '    material,',
    "    { name: 'HMAC', hash: algorithm },",
    '    false,',
    "    ['sign']",
    '  );',
    "  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data)));",
    "  if (encoding === 'base64') {",
    "    let binary = '';",
    '    for (const b of sig) binary += String.fromCharCode(b);',
    '    return btoa(binary);',
    '  }',
    "  return Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('');",
    '}',
    '',
    '// Constant-time string compare — Workers has no crypto.timingSafeEqual.',
    t(
      'function timingSafeEqual(a, b) {',
      'function timingSafeEqual(a: string, b: string): boolean {'
    ),
    '  if (a.length !== b.length) return false;',
    '  let r = 0;',
    '  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);',
    '  return r === 0;',
    '}',
  ];
}

/**
 * Inline verifier for a provider, emitted as a string so the framework templates stay free of
 * provider-specific code — one generator over the scheme table instead of a
 * (frameworks x providers) matrix of template files.
 */
function getVerifySnippet(p: Provider, framework: Framework): string {
  const scheme = schemeFor(p);
  const { runtime, lang } = FRAMEWORK_TARGET[framework];

  const signature = lang === 'ts'
    ? 'rawBody: string, secret: string, getHeader: (name: string) => string, requestUrl: string'
    : 'rawBody, secret, getHeader, requestUrl';
  const header = runtime === 'web'
    ? `async function verifySignature(${signature})${lang === 'ts' ? ': Promise<boolean>' : ''} {`
    : `function verifySignature(${signature})${lang === 'ts' ? ': boolean' : ''} {`;

  return [
    ...helpers(runtime, lang),
    '',
    `// ${scheme.label}. Mirrors the verification Hookbase itself runs on this provider.`,
    header,
    ...verifyBody(scheme, runtime, lang).map((line) => (line ? `  ${line}` : line)),
    '}',
  ].join('\n');
}

/**
 * The `verifySignature` for a provider Hookbase ingest verifies itself (public-key, certificate and
 * bespoke schemes). Same signature as the generated verifiers so the templates need no branch.
 */
function passThroughSnippet(p: IngestVerified, framework: Framework): string {
  const { runtime, lang } = FRAMEWORK_TARGET[framework];
  const params = lang === 'ts'
    ? '_rawBody: string, _secret: string, _getHeader: (name: string) => string, _requestUrl: string'
    : '_rawBody, _secret, _getHeader, _requestUrl';
  const ret = lang === 'ts' ? (runtime === 'web' ? ': Promise<boolean>' : ': boolean') : '';
  return [
    `// ${p.label} signs with ${p.kind === 'asymmetric' ? 'a public-key scheme' : 'a provider-specific scheme'}, and Hookbase ingest`,
    '// verifies it before forwarding the event here. This handler only ever sees what Hookbase',
    '// forwards, so it accepts it as-is — keep its URL private (a Hookbase tunnel or destination).',
    `${runtime === 'web' ? 'async ' : ''}function verifySignature(${params})${ret} {`,
    '  return true;',
    '}',
  ].join('\n');
}

/** Exported for init.verify.test.ts only. */
export const __testing = { getVerifySnippet, PROVIDER_SCHEMES, INGEST_VERIFIED, PROVIDERS, passThroughSnippet };

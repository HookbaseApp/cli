import { input, confirm, select, number } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';
import { askAdvanced, gatedPrompt, ensureFeature, loadFeatures } from '../lib/advanced.js';

/** Helper to check if an error is a prompt cancellation (Ctrl+C) */
function isPromptCancelled(error: unknown): boolean {
  return error instanceof ExitPromptError ||
    (error instanceof Error && error.name === 'ExitPromptError');
}

/** HTTP verbs the ingest endpoint can be restricted to. Mirrors VALID_INGEST_METHODS in the API.
 * OPTIONS is excluded: CORS preflight is answered before ingest runs, so it is never gateable. */
const INGEST_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;

/** Parse a --methods flag value into a verb array for the API.
 * "" / "any" / "all" -> [] (accept any method). Unknown verbs are dropped with a warning. */
function parseMethods(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === '' || /^(any|all)$/i.test(trimmed)) return [];
  const valid: string[] = [];
  for (const token of trimmed.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean)) {
    if ((INGEST_METHODS as readonly string[]).includes(token)) {
      if (!valid.includes(token)) valid.push(token);
    } else {
      logger.warn(`Ignoring unknown HTTP method "${token}" (valid: ${INGEST_METHODS.join(', ')})`);
    }
  }
  return valid;
}

/** Split a comma-separated flag value into a trimmed, non-empty string array
 * (undefined when the input is undefined; undefined when nothing is left). */
function parseCsv(raw?: string): string[] | undefined {
  if (raw === undefined) return undefined;
  const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

const IP_FILTER_MODES = ['none', 'allowlist', 'denylist', 'both'] as const;

const PROVIDERS = [
  { name: 'Generic (no signature verification)', value: '' },
  { name: 'GitHub', value: 'github' },
  { name: 'Stripe', value: 'stripe' },
  { name: 'Shopify', value: 'shopify' },
  { name: 'Slack', value: 'slack' },
  { name: 'Twilio', value: 'twilio' },
  { name: 'SendGrid', value: 'sendgrid' },
  { name: 'Mailgun', value: 'mailgun' },
  { name: 'Paddle', value: 'paddle' },
  { name: 'Linear', value: 'linear' },
];

function requireAuth(): boolean {
  if (!config.isAuthenticated()) {
    if (config.hasStaleJwtToken()) {
      logger.error('Your session uses a JWT token which is no longer supported. Please re-login with an API key: hookbase login');
    } else {
      logger.error('Not logged in. Run "hookbase login" with an API key.');
    }
    process.exit(1);
  }
  return true;
}

export async function sourcesListCommand(options: { json?: boolean }): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching sources...');
  const result = await api.getSources();

  if (result.error) {
    spinner.fail('Failed to fetch sources');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const sources = result.data?.sources || [];

  if (options.json) {
    console.log(JSON.stringify(sources, null, 2));
    return;
  }

  if (sources.length === 0) {
    logger.info('No sources found');
    logger.dim('Create sources with "hookbase sources create"');
    return;
  }

  const org = config.getCurrentOrg();
  const apiUrl = config.getApiUrl();

  logger.table(
    ['ID', 'Name', 'Slug', 'Provider', 'Status', 'Events', 'Routes'],
    sources.map(s => [
      s.id,
      s.name,
      s.slug,
      s.provider || 'generic',
      (s.isActive || s.is_active) ? logger.green('active') : logger.dimText('inactive'),
      String(s.eventCount ?? s.event_count ?? 0),
      String(s.routeCount ?? s.route_count ?? 0),
    ])
  );

  logger.log('');
  logger.dim('Ingest URL format:');
  logger.dim(`  ${apiUrl}/ingest/${org?.slug}/<source-slug>`);
}

/** Interactive advanced sub-prompts for a source, each gated by plan feature. */
async function runSourceAdvancedWizard(
  adv: NonNullable<Parameters<typeof api.createSource>[3]>,
  provider?: string,
): Promise<void> {
  // Signature verification (only meaningful when a provider is configured)
  if (provider && provider.length > 0 && adv.rejectInvalidSignatures === undefined) {
    adv.rejectInvalidSignatures = await confirm({
      message: 'Reject requests whose signature fails verification?',
      default: false,
    });
  }

  // Rate limiting (paid plans)
  await gatedPrompt('rate_limits', 'Rate limiting', async () => {
    const rl = await number({
      message: 'Rate limit (requests/min, blank = unlimited):',
      min: 1, max: 100000, required: false,
    });
    if (rl) adv.rateLimitPerMinute = rl;
  }, undefined);

  // IP filtering (paid plans)
  await gatedPrompt('ip_filtering', 'IP filtering', async () => {
    const mode = await select({
      message: 'IP filter mode:',
      choices: [
        { name: 'None', value: 'none' },
        { name: 'Allowlist (only these IPs)', value: 'allowlist' },
        { name: 'Denylist (block these IPs)', value: 'denylist' },
        { name: 'Both', value: 'both' },
      ],
      default: 'none',
    });
    if (mode !== 'none') {
      adv.ipFilterMode = mode as 'allowlist' | 'denylist' | 'both';
      if (mode === 'allowlist' || mode === 'both') {
        adv.ipAllowlist = parseCsv(await input({ message: 'Allowlist IPs/CIDRs (comma-separated):' }));
      }
      if (mode === 'denylist' || mode === 'both') {
        adv.ipDenylist = parseCsv(await input({ message: 'Denylist IPs/CIDRs (comma-separated):' }));
      }
    }
  }, undefined);

  // Field encryption/masking (Pro+)
  await gatedPrompt('field_encryption', 'Field encryption/masking', async () => {
    adv.encryptFields = parseCsv(await input({ message: 'Fields to encrypt (dot-paths, comma-separated, blank = none):' }));
    adv.maskFields = parseCsv(await input({ message: 'Fields to mask (dot-paths, comma-separated, blank = none):' }));
  }, undefined);

  // Deduplication (ungated)
  if (adv.dedupEnabled === undefined) {
    const dedup = await confirm({ message: 'Enable event deduplication?', default: false });
    if (dedup) {
      adv.dedupEnabled = true;
      const hrs = await number({ message: 'Dedup window (hours, 1-168):', min: 1, max: 168, default: 24, required: false });
      if (hrs) adv.dedupWindowHours = hrs;
    }
  }
}

export async function sourcesCreateCommand(options: {
  name?: string;
  slug?: string;
  provider?: string;
  description?: string;
  transient?: boolean;
  methods?: string;
  rateLimit?: string;
  ipFilterMode?: string;
  ipAllowlist?: string;
  ipDenylist?: string;
  encryptFields?: string;
  maskFields?: string;
  rejectInvalidSignatures?: boolean;
  dedup?: boolean;
  dedupWindow?: string;
  yes?: boolean;
  json?: boolean;
}): Promise<void> {
  requireAuth();

  let name = options.name;
  let slug = options.slug;
  let provider = options.provider;

  // Advanced config assembled from flags and/or the interactive wizard.
  const adv: NonNullable<Parameters<typeof api.createSource>[3]> = {};
  if (options.description) adv.description = options.description;
  if (options.transient !== undefined) adv.transientMode = options.transient;
  if (options.methods !== undefined) adv.allowedMethods = parseMethods(options.methods);
  if (options.rejectInvalidSignatures) adv.rejectInvalidSignatures = true;
  if (options.dedup) adv.dedupEnabled = true;
  if (options.dedupWindow) adv.dedupWindowHours = parseInt(options.dedupWindow, 10);

  // Feature-gated flags — validate against the plan before doing anything.
  const gatedFlagUsed =
    options.rateLimit !== undefined || options.ipFilterMode !== undefined ||
    options.ipAllowlist !== undefined || options.ipDenylist !== undefined ||
    options.encryptFields !== undefined || options.maskFields !== undefined;

  const anyAdvancedFlag = gatedFlagUsed || options.description !== undefined ||
    !!options.rejectInvalidSignatures || !!options.dedup || options.dedupWindow !== undefined;

  if (gatedFlagUsed) {
    await loadFeatures();
    if (options.rateLimit !== undefined) {
      if (!ensureFeature('rate_limits', 'Rate limits')) return;
      adv.rateLimitPerMinute = parseInt(options.rateLimit, 10);
    }
    const ipAllow = parseCsv(options.ipAllowlist);
    const ipDeny = parseCsv(options.ipDenylist);
    if (options.ipFilterMode !== undefined || ipAllow || ipDeny) {
      if (!ensureFeature('ip_filtering', 'IP filtering')) return;
      if (options.ipFilterMode !== undefined) {
        if (!(IP_FILTER_MODES as readonly string[]).includes(options.ipFilterMode)) {
          logger.error(`Invalid --ip-filter-mode "${options.ipFilterMode}" (valid: ${IP_FILTER_MODES.join(', ')})`);
          return;
        }
        adv.ipFilterMode = options.ipFilterMode as typeof IP_FILTER_MODES[number];
      } else {
        adv.ipFilterMode = ipAllow && ipDeny ? 'both' : ipAllow ? 'allowlist' : 'denylist';
      }
      if (ipAllow) adv.ipAllowlist = ipAllow;
      if (ipDeny) adv.ipDenylist = ipDeny;
    }
    const enc = parseCsv(options.encryptFields);
    const mask = parseCsv(options.maskFields);
    if (enc || mask) {
      if (!ensureFeature('field_encryption', 'Field encryption/masking')) return;
      if (enc) adv.encryptFields = enc;
      if (mask) adv.maskFields = mask;
    }
  }

  // Interactive mode - wrapped in try-catch to handle Ctrl+C gracefully
  try {
    if (!name) {
      name = await input({
        message: 'Source name:',
        validate: (value) => value.length > 0 || 'Name is required',
      });

      const autoSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const customSlug = await confirm({
        message: `Use auto-generated slug "${autoSlug}"?`,
        default: true,
      });

      if (!customSlug) {
        slug = await input({
          message: 'Custom slug:',
          validate: (value) => /^[a-z0-9-]+$/.test(value) || 'Slug must be lowercase letters, numbers, and hyphens',
        });
      } else {
        slug = autoSlug;
      }

      provider = await select({
        message: 'Select provider (for signature verification):',
        choices: PROVIDERS,
      });

      if (adv.transientMode === undefined) {
        adv.transientMode = await confirm({
          message: 'Enable transient mode? (payloads are not stored)',
          default: false,
        });
      }
    } else {
      slug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    // Advanced wizard — only in the fully-interactive path (skipped when -n,
    // --yes, or any advanced flag was already supplied).
    if (await askAdvanced('source', options.yes || anyAdvancedFlag || !!options.name)) {
      await loadFeatures();
      await runSourceAdvancedWizard(adv, provider);
    }

    if (!options.yes && !options.name) {
      const confirmed = await confirm({
        message: `Create source "${name}" with slug "${slug}"?`,
        default: true,
      });
      if (!confirmed) {
        logger.info('Cancelled');
        return;
      }
    }
  } catch (error) {
    if (isPromptCancelled(error)) {
      logger.log('');
      logger.info('Cancelled');
      return;
    }
    throw error;
  }

  const spinner = logger.spinner('Creating source...');
  const result = await api.createSource(name!, slug!, provider, adv);

  if (result.error) {
    spinner.fail('Failed to create source');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Source created');

  if (options.json) {
    console.log(JSON.stringify(result.data?.source, null, 2));
    return;
  }

  const source = result.data?.source;
  const org = config.getCurrentOrg();
  const apiUrl = config.getApiUrl();

  if (source) {
    logger.log('');
    logger.box('Source Created', [
      `ID:       ${source.id}`,
      `Name:     ${source.name}`,
      `Slug:     ${source.slug}`,
      `Provider: ${source.provider || 'generic'}`,
      `Methods:  ${(source.allowedMethods ?? source.allowed_methods ?? []).length > 0 ? (source.allowedMethods ?? source.allowed_methods ?? []).join(', ') : 'Any'}`,
      ``,
      `Ingest URL:`,
      `${apiUrl}/ingest/${org?.slug}/${source.slug}`,
    ].join('\n'));
  }
}

export async function sourcesGetCommand(
  sourceId: string,
  options: { json?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching source...');
  const result = await api.getSource(sourceId);

  if (result.error) {
    spinner.fail('Failed to fetch source');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const source = result.data?.source;

  if (options.json) {
    console.log(JSON.stringify(source, null, 2));
    return;
  }

  if (!source) {
    logger.error('Source not found');
    return;
  }

  const org = config.getCurrentOrg();
  const apiUrl = config.getApiUrl();

  logger.log('');
  logger.log(logger.bold('Source Details'));
  logger.log('');
  logger.log(`ID:          ${source.id}`);
  logger.log(`Name:        ${source.name}`);
  logger.log(`Slug:        ${source.slug}`);
  logger.log(`Provider:    ${source.provider || 'generic'}`);
  logger.log(`Status:      ${(source.isActive || source.is_active) ? logger.green('active') : logger.red('inactive')}`);
  const detailMethods = source.allowedMethods ?? source.allowed_methods ?? [];
  logger.log(`Methods:     ${detailMethods.length > 0 ? detailMethods.join(', ') : 'Any'}`);
  logger.log(`Events:      ${source.eventCount ?? source.event_count ?? 0}`);
  logger.log(`Routes:      ${source.routeCount ?? source.route_count ?? 0}`);
  if (source.description) {
    logger.log(`Description: ${source.description}`);
  }
  logger.log('');
  logger.log(`Ingest URL:  ${apiUrl}/ingest/${org?.slug}/${source.slug}`);
  logger.log('');
}

export async function sourcesUpdateCommand(
  sourceId: string,
  options: {
    name?: string;
    provider?: string;
    description?: string;
    active?: boolean;
    inactive?: boolean;
    transient?: boolean;
    methods?: string;
    json?: boolean;
  }
): Promise<void> {
  requireAuth();

  const updateData: Parameters<typeof api.updateSource>[1] = {};

  if (options.name) updateData.name = options.name;
  if (options.provider) updateData.provider = options.provider;
  if (options.description) updateData.description = options.description;
  if (options.active) updateData.isActive = true;
  if (options.inactive) updateData.isActive = false;
  if (options.transient !== undefined) updateData.transientMode = options.transient;
  if (options.methods !== undefined) updateData.allowedMethods = parseMethods(options.methods);

  if (Object.keys(updateData).length === 0) {
    logger.error('No updates specified. Use --name, --provider, --description, --active, --inactive, --transient, or --methods');
    return;
  }

  const spinner = logger.spinner('Updating source...');
  const result = await api.updateSource(sourceId, updateData);

  if (result.error) {
    spinner.fail('Failed to update source');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Source updated');

  if (options.json) {
    console.log(JSON.stringify(result.data?.source, null, 2));
  }
}

export async function sourcesDeleteCommand(
  sourceId: string,
  options: { yes?: boolean; json?: boolean }
): Promise<void> {
  requireAuth();

  try {
    if (!options.yes) {
      const confirmed = await confirm({
        message: `Are you sure you want to delete source ${sourceId}? This will also delete all associated events. This cannot be undone.`,
        default: false,
      });
      if (!confirmed) {
        logger.info('Cancelled');
        return;
      }
    }
  } catch (error) {
    if (isPromptCancelled(error)) {
      logger.log('');
      logger.info('Cancelled');
      return;
    }
    throw error;
  }

  const spinner = logger.spinner('Deleting source...');
  const result = await api.deleteSource(sourceId);

  if (result.error) {
    spinner.fail('Failed to delete source');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Source deleted');

  if (options.json) {
    console.log(JSON.stringify({ success: true, sourceId }, null, 2));
  }
}

export async function sourcesRotateSecretCommand(
  sourceId: string,
  options: { yes?: boolean; json?: boolean }
): Promise<void> {
  requireAuth();

  try {
    if (!options.yes) {
      const confirmed = await confirm({
        message: `Are you sure you want to rotate the signing secret for source ${sourceId}? The old secret will stop working immediately.`,
        default: false,
      });
      if (!confirmed) {
        logger.info('Cancelled');
        return;
      }
    }
  } catch (error) {
    if (isPromptCancelled(error)) {
      logger.log('');
      logger.info('Cancelled');
      return;
    }
    throw error;
  }

  const spinner = logger.spinner('Rotating secret...');
  const result = await api.rotateSourceSecret(sourceId);

  if (result.error) {
    spinner.fail('Failed to rotate secret');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Secret rotated');

  if (options.json) {
    console.log(JSON.stringify(result.data, null, 2));
    return;
  }

  if (result.data?.signingSecret) {
    logger.log('');
    logger.box('New Signing Secret', [
      logger.yellow('Save this secret - it will not be shown again:'),
      ``,
      logger.bold(result.data.signingSecret),
    ].join('\n'));
    logger.log('');
    logger.warn('Update your webhook provider with this new secret.');
  }
}

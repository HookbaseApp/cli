import { input, confirm, select, number, password, search } from '@inquirer/prompts';
import * as fs from 'fs';
import { ExitPromptError } from '@inquirer/core';
import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';
import { askAdvanced, gatedPrompt, ensureFeature, loadFeatures } from '../lib/advanced.js';

import { requireAuth } from '../lib/requireAuth.js';
import { formatOutput } from '../lib/output.js';
import {
  NO_PROVIDER,
  OTHER_PROVIDER,
  loadProviderChoices,
  getChoiceSecretInfo,
  lookupProviderSecretInfo,
  planSecret,
  rotateRefusal,
  afterRegistrationNote,
  readSecretValue,
  type SecretInfo,
} from '../lib/providerCatalog.js';

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

/** One-word secret state for tables. */
function secretState(s: api.Source): string {
  if (s.verifiesWithoutSecret) return 'built-in';
  if (s.hasSigningSecret) return 'set';
  if (s.awaitingSigningSecret) return 'awaiting';
  return s.provider ? 'not set' : '-';
}

/** The secret line for `sources get`. */
function secretDetail(s: api.Source): string {
  if (s.verifiesWithoutSecret) return 'not needed (verified with a key Hookbase already has)';
  if (s.hasSigningSecret) return s.signingSecretLast4 ? `set (${s.signingSecretLast4})` : 'set';
  if (s.awaitingSigningSecret) return logger.yellow(`awaiting — only ${s.provider} can issue it; events are not verified until it is set`);
  return s.provider ? logger.yellow('not set') : 'none (no provider, nothing is verified)';
}

/**
 * Interactive provider picker over the live catalog (type to filter). Falls back to a short
 * offline list, and "Other" takes any id — the API validates it.
 */
async function pickProvider(): Promise<{ provider: string; info?: SecretInfo }> {
  const { choices, offline } = await loadProviderChoices();
  if (offline) {
    logger.dim('Could not load the provider catalog — showing a short list. Choose "Other" to type any provider id.');
  }
  const picked = await search<string>({
    message: 'Provider (type to filter; used for signature verification):',
    pageSize: 15,
    source: (term) => {
      const t = (term ?? '').trim().toLowerCase();
      return choices
        .filter((c) => !t || c.name.toLowerCase().includes(t) || c.value.includes(t))
        .map((c) => ({ name: c.name, value: c.value }));
    },
  });

  if (picked === NO_PROVIDER) return { provider: NO_PROVIDER };
  if (picked === OTHER_PROVIDER) {
    const typed = (await input({
      message: 'Provider id (e.g. grafana-hmac, wise-sandbox):',
      validate: (v) => /^[a-z0-9-]+$/.test(v.trim()) || 'Lowercase letters, digits and hyphens',
    })).trim();
    return { provider: typed, info: await lookupProviderSecretInfo(typed) };
  }
  const choice = choices.find((c) => c.value === picked)!;
  return { provider: picked, info: await getChoiceSecretInfo(choice) };
}

/** Validator for prompts that accept `@path`: the file has to exist. */
function validateSecretInput(label: string, required: boolean) {
  return (value: string): true | string => {
    const v = value.trim();
    if (!v) return required ? `${label} is required` : true;
    if (v.startsWith('@') && !fs.existsSync(v.slice(1))) return `File not found: ${v.slice(1)}`;
    return true;
  };
}

/**
 * Ask for (or explain the absence of) the signing secret, by the provider's catalog
 * `secretSource`. Returns the secret to send, or undefined to send none.
 */
async function promptForSecret(provider: string, info: SecretInfo | undefined): Promise<string | undefined> {
  const plan = planSecret(provider, info);
  const label = info?.secretLabel ?? 'Signing secret';
  const name = info?.providerName ?? provider;
  const hint = info?.secretPlaceholder ? ` (${info.secretPlaceholder})` : '';

  switch (plan.action) {
    case 'skip':
      if (provider) logger.dim(plan.reason);
      return undefined;
    case 'generated':
      logger.dim(`Hookbase will generate the ${label.toLowerCase()} and show it once after the source is created.`);
      if (info?.secretInstruction) logger.dim(info.secretInstruction);
      return undefined;
    case 'prompt': {
      if (info?.secretInstruction) logger.dim(info.secretInstruction);
      const value = await password({
        message: `${label} from ${name}${hint}:`,
        mask: '*',
        validate: validateSecretInput(label, true),
      });
      return readSecretValue(value);
    }
    case 'prompt_public_key': {
      if (info?.secretInstruction) logger.dim(info.secretInstruction);
      const value = await input({
        message: `${label} from ${name} — paste it, or @path to a PEM file${hint}:`,
        validate: validateSecretInput(label, true),
      });
      return readSecretValue(value);
    }
    case 'optional': {
      const value = await password({
        message: 'Signing secret (blank to let Hookbase generate one where the provider allows it):',
        mask: '*',
        validate: validateSecretInput('Signing secret', false),
      });
      return value.trim() ? readSecretValue(value) : undefined;
    }
  }
}

/** Show the secrets the create reply carries — once — and what to do with them. */
function showCreatedSecrets(source: api.Source, opts: { secretProvided: boolean; info?: SecretInfo }): void {
  const name = opts.info?.providerName ?? source.provider ?? 'the sender';
  const label = opts.info?.secretLabel ?? 'Signing secret';

  if (source.signingSecret && !opts.secretProvided) {
    logger.log('');
    logger.box(label, [
      logger.yellow('Shown once — save it now:'),
      '',
      logger.bold(source.signingSecret),
      '',
      opts.info?.secretInstruction ?? `Configure ${name} to sign its webhooks with this secret.`,
    ].join('\n'));
  }

  if (source.verifyToken) {
    const vt = opts.info?.verifyToken;
    logger.log('');
    logger.box(vt?.label ?? 'Verify token', [
      logger.bold(source.verifyToken),
      '',
      vt?.instruction ?? `Enter this as the verify token when you register the ingest URL with ${name}.`,
      'Show it again with "hookbase inbound sources verify-token <source>".',
    ].join('\n'));
  }

  if (source.awaitingSigningSecret) {
    logger.log('');
    logger.warn(afterRegistrationNote(source.provider ?? '', name, !!opts.info?.secretAfterRegistration).replace(/<source>/g, source.slug));
  } else if (source.verifiesWithoutSecret) {
    logger.dim(`${name} is verified with a key Hookbase already has — no secret needed.`);
  }
}

export async function sourcesListCommand(options: { json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
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

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(sources, options.xml, options.yaml));
    return;
  }

  if (sources.length === 0) {
    logger.info('No sources found');
    logger.dim('Create sources with "hookbase inbound sources create"');
    return;
  }

  const org = config.getCurrentOrg();
  const apiUrl = config.getApiUrl();

  logger.table(
    ['ID', 'Name', 'Slug', 'Provider', 'Secret', 'Status', 'Events', 'Routes'],
    sources.map(s => [
      s.id,
      s.name,
      s.slug,
      s.provider || 'none',
      secretState(s),
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
  signingSecret?: string;
  verifyToken?: string;
  yes?: boolean;
  json?: boolean;
  xml?: boolean;
  yaml?: boolean;
}): Promise<void> {
  requireAuth();

  let name = options.name;
  let slug = options.slug;
  let provider = options.provider;
  let secretInfo: SecretInfo | undefined;

  let signingSecret: string | undefined;
  try {
    if (options.signingSecret !== undefined) signingSecret = readSecretValue(options.signingSecret) || undefined;
  } catch (error) {
    logger.error(`Could not read --signing-secret: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const secretProvided = signingSecret !== undefined;

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

      if (provider === undefined) {
        const picked = await pickProvider();
        provider = picked.provider;
        secretInfo = picked.info;
      } else {
        secretInfo = await lookupProviderSecretInfo(provider);
      }

      if (signingSecret === undefined) {
        signingSecret = await promptForSecret(provider, secretInfo);
      }
      if (secretInfo?.verifyToken && options.verifyToken === undefined) {
        logger.dim(`Hookbase will generate the ${secretInfo.verifyToken.label.toLowerCase()} and show it after the source is created.`);
      }

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
  if (signingSecret !== undefined) adv.signingSecret = signingSecret;
  if (options.verifyToken !== undefined) adv.verifyToken = options.verifyToken;
  const result = await api.createSource(name!, slug!, provider, adv);

  if (result.error) {
    spinner.fail('Failed to create source');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Source created');

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data?.source, options.xml, options.yaml));
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
      `Provider: ${source.provider || 'none'}`,
      `Methods:  ${(source.allowedMethods ?? source.allowed_methods ?? []).length > 0 ? (source.allowedMethods ?? source.allowed_methods ?? []).join(', ') : 'Any'}`,
      ``,
      `Ingest URL:`,
      source.ingestUrl ?? `${apiUrl}/ingest/${org?.slug}/${source.slug}`,
      ...(secretProvided && source.hasSigningSecret !== false
        ? ['', `Signing secret: set${source.signingSecretLast4 ? ` (${source.signingSecretLast4})` : ''}`]
        : []),
    ].join('\n'));
    showCreatedSecrets(source, { secretProvided, info: secretInfo });
  }
}

export async function sourcesGetCommand(
  sourceId: string,
  options: { json?: boolean; xml?: boolean; yaml?: boolean }
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

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(source, options.xml, options.yaml));
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
  logger.log(`Provider:    ${source.provider || 'none'}`);
  logger.log(`Secret:      ${secretDetail(source)}`);
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
    signingSecret?: string;
    verifyToken?: string;
    json?: boolean;
    xml?: boolean;
    yaml?: boolean;
  }
): Promise<void> {
  requireAuth();

  const updateData: Parameters<typeof api.updateSource>[1] = {};

  if (options.signingSecret !== undefined) {
    try {
      // Empty clears the secret — the API takes null for that.
      updateData.signingSecret = readSecretValue(options.signingSecret) || null;
    } catch (error) {
      logger.error(`Could not read --signing-secret: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
  }
  // '' asks the API to generate a fresh one (same as rotate-verify-token).
  if (options.verifyToken !== undefined) updateData.verifyToken = options.verifyToken.trim();

  if (options.name) updateData.name = options.name;
  if (options.provider) updateData.provider = options.provider;
  if (options.description) updateData.description = options.description;
  if (options.active) updateData.isActive = true;
  if (options.inactive) updateData.isActive = false;
  if (options.transient !== undefined) updateData.transientMode = options.transient;
  if (options.methods !== undefined) updateData.allowedMethods = parseMethods(options.methods);

  if (Object.keys(updateData).length === 0) {
    logger.error('No updates specified. Use --name, --provider, --description, --active, --inactive, --transient, --methods, --signing-secret or --verify-token');
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

  if (options.json || options.xml || options.yaml) {
    // PATCH answers {success:true} only; read the source back for its new state.
    const updated = await api.getSource(sourceId);
    console.log(formatOutput(updated.data?.source ?? result.data, options.xml, options.yaml));
  }
}

export async function sourcesDeleteCommand(
  sourceId: string,
  options: { yes?: boolean; json?: boolean; xml?: boolean; yaml?: boolean }
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

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput({ success: true, sourceId }, options.xml, options.yaml));
  }
}

export async function sourcesRotateSecretCommand(
  sourceId: string,
  options: { yes?: boolean; json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  // Only a secret Hookbase generated can be rotated by Hookbase. Check before asking, so the user
  // isn't asked to confirm something the API is going to refuse.
  const lookup = await api.getSource(sourceId);
  if (lookup.error || !lookup.data?.source) {
    logger.error(lookup.error ?? 'Source not found');
    return;
  }
  const source = lookup.data.source;
  const info = await lookupProviderSecretInfo(source.provider);
  const refusal = rotateRefusal(source.provider, info);
  if (refusal) {
    logger.error(`Can't rotate this source's secret: ${refusal.reason.replace(/<source>/g, source.slug)}`);
    if (refusal.apiRejects) logger.dim('(The API rejects rotate-secret for this provider with a 400.)');
    return;
  }

  try {
    if (!options.yes) {
      const confirmed = await confirm({
        message: `Rotate the signing secret for source ${source.slug}? The old secret stops working immediately.`,
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

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data, options.xml, options.yaml));
    return;
  }

  if (result.data?.signingSecret) {
    const name = info?.providerName ?? source.provider ?? 'the sender';
    const label = info?.secretLabel ?? 'Signing secret';
    logger.log('');
    logger.box(`New ${label}`, [
      logger.yellow('Shown once — save it now:'),
      ``,
      logger.bold(result.data.signingSecret),
    ].join('\n'));
    logger.log('');
    logger.warn(
      `Hookbase now verifies with this secret. Replace the old one in ${name}'s webhook settings` +
      ` — until you do, its deliveries fail signature verification.`
    );
  }
}

export async function sourcesRevealSecretCommand(
  sourceId: string,
  options: { json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  const result = await api.revealSourceSecret(sourceId);
  if (result.error) {
    logger.error(result.error);
    if (result.status === 404) {
      logger.dim(`Check "hookbase inbound sources get ${sourceId}" — the source may have no secret yet, or need none.`);
    }
    return;
  }

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data, options.xml, options.yaml));
    return;
  }
  logger.log(result.data?.signingSecret ?? '');
}

export async function sourcesVerifyTokenCommand(
  sourceId: string,
  options: { json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  const result = await api.getSourceVerifyToken(sourceId);
  if (result.error) {
    logger.error(result.error);
    return;
  }

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data, options.xml, options.yaml));
    return;
  }
  logger.log(result.data?.verifyToken ?? '');
}

export async function sourcesRotateVerifyTokenCommand(
  sourceId: string,
  options: { yes?: boolean; json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  try {
    if (!options.yes) {
      const confirmed = await confirm({
        message: `Generate a new verify token for source ${sourceId}? Meta checks it whenever the callback URL is (re)registered, so enter the new one there.`,
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

  const spinner = logger.spinner('Rotating verify token...');
  const result = await api.rotateSourceVerifyToken(sourceId);
  if (result.error) {
    spinner.fail('Failed to rotate verify token');
    logger.error(result.error);
    return;
  }
  spinner.succeed('Verify token rotated');

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data, options.xml, options.yaml));
    return;
  }
  logger.log('');
  logger.box('New Verify Token', [
    logger.bold(result.data?.verifyToken ?? ''),
    '',
    'Enter it as the Verify token in Meta\'s webhook settings.',
  ].join('\n'));
}

export async function sourcesPendingVerificationCommand(
  sourceId: string,
  options: { json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  const result = await api.getSourcePendingVerification(sourceId);
  if (result.error) {
    logger.error(result.error);
    return;
  }
  const pending = result.data!;

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(pending, options.xml, options.yaml));
    return;
  }

  logger.log('');
  logger.log(logger.bold('Pending verification token'));
  logger.log('');
  logger.log(`Provider:    ${pending.provider}`);
  logger.log(`Token:       ${pending.token}`);
  logger.log(`Received at: ${pending.receivedAt}`);
  logger.log(`From IP:     ${pending.clientIp ?? 'unknown'}`);
  logger.log('');
  logger.dim(`Paste the token into ${pending.provider}'s Verify form. Once ${pending.provider} shows the subscription as verified,`);
  logger.dim(`run "hookbase inbound sources adopt-verification ${sourceId}" to make it this source's signing secret.`);
}

export async function sourcesAdoptVerificationCommand(
  sourceId: string,
  options: { yes?: boolean; json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  try {
    if (!options.yes) {
      const confirmed = await confirm({
        message: `Make the pending verification token source ${sourceId}'s signing secret? ` +
          'It arrived unauthenticated — only do this after the vendor shows the subscription as verified.',
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

  const spinner = logger.spinner('Adopting verification token...');
  const result = await api.adoptSourcePendingVerification(sourceId);
  if (result.error) {
    spinner.fail('Failed to adopt verification token');
    logger.error(result.error);
    return;
  }
  spinner.succeed('Verification token adopted as the signing secret');

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput({ success: true, sourceId }, options.xml, options.yaml));
  }
}

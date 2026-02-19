import { input, confirm, select } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';

/** Helper to check if an error is a prompt cancellation (Ctrl+C) */
function isPromptCancelled(error: unknown): boolean {
  return error instanceof ExitPromptError ||
    (error instanceof Error && error.name === 'ExitPromptError');
}

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

export async function sourcesCreateCommand(options: {
  name?: string;
  slug?: string;
  provider?: string;
  transient?: boolean;
  yes?: boolean;
  json?: boolean;
}): Promise<void> {
  requireAuth();

  let name = options.name;
  let slug = options.slug;
  let provider = options.provider;

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

      if (options.transient === undefined) {
        options.transient = await confirm({
          message: 'Enable transient mode? (payloads are not stored)',
          default: false,
        });
      }
    } else {
      slug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
  const result = await api.createSource(name!, slug!, provider, {
    transientMode: options.transient,
  });

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

  if (Object.keys(updateData).length === 0) {
    logger.error('No updates specified. Use --name, --provider, --description, --active, --inactive, or --transient');
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

import { input, confirm } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';

/** Helper to check if an error is a prompt cancellation (Ctrl+C) */
function isPromptCancelled(error: unknown): boolean {
  return error instanceof ExitPromptError ||
    (error instanceof Error && error.name === 'ExitPromptError');
}

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

export async function applicationsListCommand(options: { json?: boolean }): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching applications...');
  const result = await api.getWebhookApplications();

  if (result.error) {
    spinner.fail('Failed to fetch applications');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const applications = (result.data as any)?.data || result.data?.applications || [];

  if (options.json) {
    console.log(JSON.stringify(applications, null, 2));
    return;
  }

  if (applications.length === 0) {
    logger.info('No webhook applications found');
    logger.dim('Create applications with "hookbase apps create"');
    return;
  }

  logger.table(
    ['ID', 'Name', 'UID', 'Status', 'Endpoints', 'Messages'],
    applications.map((a: any) => {
      const isActive = a.is_active ?? (a.isDisabled !== undefined ? !a.isDisabled : true);
      return [
        a.id,
        a.name,
        a.uid || a.externalId || '-',
        isActive ? logger.green('active') : logger.dimText('inactive'),
        String(a.endpoint_count ?? a.endpointCount ?? 0),
        String(a.message_count ?? a.messageCount ?? 0),
      ];
    })
  );
}

export async function applicationsCreateCommand(options: {
  name?: string;
  uid?: string;
  description?: string;
  rateLimit?: string;
  yes?: boolean;
  json?: boolean;
}): Promise<void> {
  requireAuth();

  let name = options.name;
  let uid = options.uid;
  let description = options.description;

  try {
    if (!name) {
      name = await input({
        message: 'Application name:',
        validate: (value) => value.length > 0 || 'Name is required',
      });

      uid = await input({
        message: 'Application UID (optional, for your reference):',
      });

      description = await input({
        message: 'Description (optional):',
      });
    }

    if (!options.yes && !options.name) {
      const confirmed = await confirm({
        message: `Create application "${name}"?`,
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

  const spinner = logger.spinner('Creating application...');
  const result = await api.createWebhookApplication({
    name: name!,
    uid: uid || undefined,
    description: description || undefined,
    rateLimitPerMinute: options.rateLimit ? parseInt(options.rateLimit, 10) : undefined,
  });

  if (result.error) {
    spinner.fail('Failed to create application');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Application created');

  const app = (result.data as any)?.data || result.data?.application;

  if (options.json) {
    console.log(JSON.stringify(app, null, 2));
    return;
  }

  if (app) {
    logger.log('');
    logger.box('Application Created', [
      `ID:          ${app.id}`,
      `Name:        ${app.name}`,
      app.uid ? `UID:         ${app.uid}` : '',
      app.description ? `Description: ${app.description}` : '',
    ].filter(Boolean).join('\n'));
  }
}

export async function applicationsGetCommand(
  appId: string,
  options: { json?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching application...');
  const result = await api.getWebhookApplication(appId);

  if (result.error) {
    spinner.fail('Failed to fetch application');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const app = (result.data as any)?.data || result.data?.application;

  if (options.json) {
    console.log(JSON.stringify(app, null, 2));
    return;
  }

  if (!app) {
    logger.error('Application not found');
    return;
  }

  const isActive = app.is_active ?? (app.isDisabled !== undefined ? !app.isDisabled : true);

  logger.log('');
  logger.log(logger.bold('Application Details'));
  logger.log('');
  logger.log(`ID:          ${app.id}`);
  logger.log(`Name:        ${app.name}`);
  if (app.uid || app.externalId) logger.log(`UID:         ${app.uid || app.externalId}`);
  if (app.description) logger.log(`Description: ${app.description}`);
  logger.log(`Status:      ${isActive ? logger.green('active') : logger.red('inactive')}`);
  logger.log(`Endpoints:   ${app.endpoint_count ?? app.endpointCount ?? 0}`);
  logger.log(`Messages:    ${app.message_count ?? app.messageCount ?? 0}`);
  if (app.rate_limit_per_minute || app.rateLimitPerMinute) logger.log(`Rate Limit:  ${app.rate_limit_per_minute || app.rateLimitPerMinute}/min`);
  logger.log(`Created:     ${app.created_at || app.createdAt}`);
  logger.log('');
}

export async function applicationsUpdateCommand(
  appId: string,
  options: {
    name?: string;
    description?: string;
    rateLimit?: string;
    active?: boolean;
    inactive?: boolean;
    json?: boolean;
  }
): Promise<void> {
  requireAuth();

  const updateData: Parameters<typeof api.updateWebhookApplication>[1] = {};

  if (options.name) updateData.name = options.name;
  if (options.description) updateData.description = options.description;
  if (options.rateLimit) updateData.rateLimitPerMinute = parseInt(options.rateLimit, 10);
  if (options.active) updateData.isDisabled = false;
  if (options.inactive) updateData.isDisabled = true;

  if (Object.keys(updateData).length === 0) {
    logger.error('No updates specified. Use --name, --description, --rate-limit, --active, or --inactive');
    return;
  }

  const spinner = logger.spinner('Updating application...');
  const result = await api.updateWebhookApplication(appId, updateData);

  if (result.error) {
    spinner.fail('Failed to update application');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Application updated');

  if (options.json) {
    const updated = (result.data as any)?.data || result.data?.application;
    console.log(JSON.stringify(updated, null, 2));
  }
}

export async function applicationsDeleteCommand(
  appId: string,
  options: { yes?: boolean; json?: boolean }
): Promise<void> {
  requireAuth();

  try {
    if (!options.yes) {
      const confirmed = await confirm({
        message: `Are you sure you want to delete application ${appId}? This will also delete all endpoints and messages. This cannot be undone.`,
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

  const spinner = logger.spinner('Deleting application...');
  const result = await api.deleteWebhookApplication(appId);

  if (result.error) {
    spinner.fail('Failed to delete application');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Application deleted');

  if (options.json) {
    console.log(JSON.stringify({ success: true, applicationId: appId }, null, 2));
  }
}

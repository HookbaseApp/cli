import { input, confirm } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import * as api from '../lib/api.js';
import * as logger from '../lib/logger.js';

import { requireAuth } from '../lib/requireAuth.js';
import { formatOutput } from '../lib/output.js';

/** Helper to check if an error is a prompt cancellation (Ctrl+C) */
function isPromptCancelled(error: unknown): boolean {
  return error instanceof ExitPromptError ||
    (error instanceof Error && error.name === 'ExitPromptError');
}

export async function applicationsListCommand(options: { json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching applications...');
  const result = await api.getWebhookApplications();

  if (result.error) {
    spinner.fail('Failed to fetch applications');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const applications = result.data?.data ?? [];

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(applications, options.xml, options.yaml));
    return;
  }

  if (applications.length === 0) {
    logger.info('No webhook applications found');
    logger.dim('Create applications with "hookbase apps create"');
    return;
  }

  logger.table(
    ['ID', 'Name', 'External ID', 'Status', 'Endpoints', 'Messages'],
    applications.map((a) => [
      a.id,
      a.name,
      a.externalId || '-',
      a.isDisabled ? logger.dimText('inactive') : logger.green('active'),
      String(a.endpointCount ?? 0),
      String(a.totalMessagesSent ?? 0),
    ])
  );
}

export async function applicationsCreateCommand(options: {
  name?: string;
  externalId?: string;
  /** Deprecated alias for --external-id, kept so existing scripts keep working. */
  uid?: string;
  /** Accepted and ignored; see the warning below. */
  description?: string;
  rateLimit?: string;
  yes?: boolean;
  json?: boolean;
  xml?: boolean;
  yaml?: boolean;
}): Promise<void> {
  requireAuth();

  // An application has no description -- webhook_applications has no such column and neither
  // create nor update accepts one. It was being sent and silently dropped, so the flag has always
  // been a no-op. Warn rather than error so scripts that pass it keep running.
  if (options.description) {
    logger.warn('--description is ignored: webhook applications have no description field.');
  }

  let name = options.name;
  let externalId = options.externalId ?? options.uid;

  try {
    if (!name) {
      name = await input({
        message: 'Application name:',
        validate: (value) => value.length > 0 || 'Name is required',
      });

      externalId = await input({
        message: 'External ID (optional, your own identifier for this application):',
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
    externalId: externalId || undefined,
    rateLimitPerMinute: options.rateLimit ? parseInt(options.rateLimit, 10) : undefined,
  });

  if (result.error) {
    spinner.fail('Failed to create application');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Application created');

  const app = result.data?.data;

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(app, options.xml, options.yaml));
    return;
  }

  if (app) {
    logger.log('');
    logger.box('Application Created', [
      `ID:          ${app.id}`,
      `Name:        ${app.name}`,
      app.externalId ? `External ID: ${app.externalId}` : '',
    ].filter(Boolean).join('\n'));
  }
}

export async function applicationsGetCommand(
  appId: string,
  options: { json?: boolean; xml?: boolean; yaml?: boolean }
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

  const app = result.data?.data;

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(app, options.xml, options.yaml));
    return;
  }

  if (!app) {
    logger.error('Application not found');
    return;
  }

  logger.log('');
  logger.log(logger.bold('Application Details'));
  logger.log('');
  logger.log(`ID:          ${app.id}`);
  logger.log(`Name:        ${app.name}`);
  if (app.externalId) logger.log(`External ID: ${app.externalId}`);
  logger.log(`Status:      ${app.isDisabled ? logger.red('inactive') : logger.green('active')}`);
  if (app.isDisabled && app.disabledReason) logger.log(`Reason:      ${app.disabledReason}`);
  logger.log(`Endpoints:   ${app.endpointCount ?? app.totalEndpoints ?? 0}`);
  logger.log(`Messages:    ${app.totalMessagesSent ?? 0}`);
  if (app.rateLimitPerMinute) logger.log(`Rate Limit:  ${app.rateLimitPerMinute}/min`);
  logger.log(`Created:     ${app.createdAt}`);
  logger.log('');
}

export async function applicationsUpdateCommand(
  appId: string,
  options: {
    name?: string;
    /** Accepted and ignored; see the warning below. */
    description?: string;
    rateLimit?: string;
    active?: boolean;
    inactive?: boolean;
    json?: boolean;
    xml?: boolean;
    yaml?: boolean;
  }
): Promise<void> {
  requireAuth();

  // See applicationsCreateCommand: there is no description field on an application.
  if (options.description) {
    logger.warn('--description is ignored: webhook applications have no description field.');
  }

  const updateData: Parameters<typeof api.updateWebhookApplication>[1] = {};

  if (options.name) updateData.name = options.name;
  if (options.rateLimit) updateData.rateLimitPerMinute = parseInt(options.rateLimit, 10);
  if (options.active) updateData.isDisabled = false;
  if (options.inactive) updateData.isDisabled = true;

  if (Object.keys(updateData).length === 0) {
    logger.error('No updates specified. Use --name, --rate-limit, --active, or --inactive');
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

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data?.data, options.xml, options.yaml));
  }
}

export async function applicationsDeleteCommand(
  appId: string,
  options: { yes?: boolean; json?: boolean; xml?: boolean; yaml?: boolean }
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

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput({ success: true, applicationId: appId }, options.xml, options.yaml));
  }
}

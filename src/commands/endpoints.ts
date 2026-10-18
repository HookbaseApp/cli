import { input, confirm, select } from '@inquirer/prompts';
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

function formatCircuitState(state?: string): string {
  switch (state) {
    case 'closed': return logger.green('closed');
    case 'open': return logger.red('open');
    case 'half_open': return logger.yellow('half_open');
    default: return logger.dimText('unknown');
  }
}

export async function endpointsListCommand(options: {
  app?: string;
  json?: boolean;
  xml?: boolean;
  yaml?: boolean;
}): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching endpoints...');
  const result = await api.listAllWebhookEndpoints(options.app);

  if (result.error) {
    spinner.fail('Failed to fetch endpoints');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const endpoints = result.data?.data ?? [];

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(endpoints, options.xml, options.yaml));
    return;
  }

  if (endpoints.length === 0) {
    logger.info('No webhook endpoints found');
    logger.dim('Create endpoints with "hookbase endpoints create"');
    return;
  }

  logger.table(
    ['ID', 'URL', 'App', 'Circuit', 'Status', 'Success Rate'],
    endpoints.map((e) => {
      const successRate = api.endpointSuccessRate(e);
      return [
        e.id.substring(0, 12) + '...',
        e.url.length > 40 ? e.url.substring(0, 37) + '...' : e.url,
        (e.applicationId || '').substring(0, 8) + '...',
        formatCircuitState(e.circuitState),
        !e.isDisabled ? logger.green('active') : logger.dimText('inactive'),
        successRate !== undefined ? `${(successRate * 100).toFixed(1)}%` : '-',
      ];
    })
  );
}

export async function endpointsCreateCommand(options: {
  app?: string;
  url?: string;
  description?: string;
  eventTypes?: string;
  timeout?: string;
  rateLimit?: string;
  staticIp?: boolean;
  noStaticIp?: boolean;
  yes?: boolean;
  json?: boolean;
  xml?: boolean;
  yaml?: boolean;
}): Promise<void> {
  requireAuth();

  let applicationId = options.app;
  let url = options.url;
  let description = options.description;

  // Endpoints don't carry event types in the API — event routing is managed via
  // subscriptions. Warn instead of silently dropping the flag.
  if (options.eventTypes) {
    logger.warn('--event-types is not applied at the endpoint level (manage event routing via subscriptions); ignoring.');
  }

  try {
    if (!applicationId) {
      // Fetch applications for selection
      const appsResult = await api.listAllWebhookApplications();
      const apps = appsResult.data?.data ?? [];
      if (appsResult.error || !apps.length) {
        logger.error('No applications found. Create one first with "hookbase outbound applications create"');
        return;
      }

      applicationId = await select({
        message: 'Select application:',
        choices: apps.map((a) => ({
          name: `${a.name} (${a.id})`,
          value: a.id,
        })),
      });
    }

    if (!url) {
      url = await input({
        message: 'Endpoint URL:',
        validate: (value) => {
          try {
            new URL(value);
            return true;
          } catch {
            return 'Please enter a valid URL';
          }
        },
      });

      description = await input({
        message: 'Description (optional):',
      });
    }

    if (!options.yes && !options.url) {
      const confirmed = await confirm({
        message: `Create endpoint "${url}"?`,
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

  const spinner = logger.spinner('Creating endpoint...');
  const result = await api.createWebhookEndpoint({
    applicationId: applicationId!,
    url: url!,
    description: description || undefined,
    timeoutSeconds: options.timeout ? parseInt(options.timeout, 10) : undefined,
    rateLimitPerSecond: options.rateLimit ? parseInt(options.rateLimit, 10) : undefined,
    useStaticIp: options.staticIp,
  });

  if (result.error) {
    spinner.fail('Failed to create endpoint');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Endpoint created');

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data, options.xml, options.yaml));
    return;
  }

  // POST /webhook-endpoints answers { data: { ...endpoint, secret }, warning }.
  const endpoint = result.data?.data;
  const secret = endpoint?.secret;

  if (endpoint?.id) {
    logger.log('');
    logger.box('Endpoint Created', [
      `ID:          ${endpoint.id}`,
      `URL:         ${endpoint.url}`,
      ``,
      logger.yellow('Signing Secret (save this - shown only once):'),
      `${secret}`,
    ].join('\n'));
    logger.log('');
    logger.dim('Use this secret to verify webhook signatures in your application.');
  }
}

export async function endpointsGetCommand(
  endpointId: string,
  options: { json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching endpoint...');
  const result = await api.getWebhookEndpoint(endpointId);

  if (result.error) {
    spinner.fail('Failed to fetch endpoint');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const endpoint = result.data?.data;

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(endpoint, options.xml, options.yaml));
    return;
  }

  if (!endpoint) {
    logger.error('Endpoint not found');
    return;
  }

  const isActive = !endpoint.isDisabled;
  const timeoutSeconds = endpoint.timeoutSeconds ?? 30;
  const rateLimitPerSecond = endpoint.rateLimitPerSecond;

  logger.log('');
  logger.log(logger.bold('Endpoint Details'));
  logger.log('');
  logger.log(`ID:            ${endpoint.id}`);
  logger.log(`URL:           ${endpoint.url}`);
  logger.log(`Application:   ${endpoint.applicationId}`);
  if (endpoint.description) logger.log(`Description:   ${endpoint.description}`);
  logger.log(`Status:        ${isActive ? logger.green('active') : logger.red('inactive')}`);
  logger.log(`Circuit:       ${formatCircuitState(endpoint.circuitState)}`);
  logger.log(`Timeout:       ${timeoutSeconds}s`);
  logger.log(`Static IP:     ${endpoint.useStaticIp === true ? logger.green('enabled') : logger.dimText('disabled')}`);
  if (rateLimitPerSecond) logger.log(`Rate Limit:    ${rateLimitPerSecond}/sec`);
  logger.log(`Messages:      ${endpoint.totalMessages ?? 0}`);
  const sr = api.endpointSuccessRate(endpoint);
  logger.log(`Success Rate:  ${sr !== undefined ? `${(sr * 100).toFixed(1)}%` : 'N/A'}`);
  logger.log(`Created:       ${endpoint.createdAt}`);
  logger.log('');
}

export async function endpointsUpdateCommand(
  endpointId: string,
  options: {
    url?: string;
    description?: string;
    eventTypes?: string;
    timeout?: string;
    rateLimit?: string;
    active?: boolean;
    inactive?: boolean;
    staticIp?: boolean;
    noStaticIp?: boolean;
    json?: boolean;
    xml?: boolean;
    yaml?: boolean;
  }
): Promise<void> {
  requireAuth();

  const updateData: Parameters<typeof api.updateWebhookEndpoint>[1] = {};

  if (options.eventTypes) {
    logger.warn('--event-types is not applied at the endpoint level (manage event routing via subscriptions); ignoring.');
  }

  if (options.url) updateData.url = options.url;
  if (options.description) updateData.description = options.description;
  if (options.timeout) updateData.timeoutSeconds = parseInt(options.timeout, 10);
  if (options.rateLimit) updateData.rateLimitPerSecond = parseInt(options.rateLimit, 10);
  if (options.active) updateData.isActive = true;
  if (options.inactive) updateData.isActive = false;
  if (options.staticIp !== undefined) updateData.useStaticIp = options.staticIp;

  if (Object.keys(updateData).length === 0) {
    logger.error('No updates specified. Use --url, --description, --timeout, --rate-limit, --active, --inactive, --static-ip, or --no-static-ip');
    return;
  }

  const spinner = logger.spinner('Updating endpoint...');
  const result = await api.updateWebhookEndpoint(endpointId, updateData);

  if (result.error) {
    spinner.fail('Failed to update endpoint');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Endpoint updated');

  if (options.json || options.xml || options.yaml) {
    const updated = result.data?.data;
    console.log(formatOutput(updated, options.xml, options.yaml));
  }
}

export async function endpointsDeleteCommand(
  endpointId: string,
  options: { yes?: boolean; json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  try {
    if (!options.yes) {
      const confirmed = await confirm({
        message: `Are you sure you want to delete endpoint ${endpointId}? This cannot be undone.`,
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

  const spinner = logger.spinner('Deleting endpoint...');
  const result = await api.deleteWebhookEndpoint(endpointId);

  if (result.error) {
    spinner.fail('Failed to delete endpoint');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Endpoint deleted');

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput({ success: true, endpointId }, options.xml, options.yaml));
  }
}

export async function endpointsTestCommand(
  endpointId: string,
  options: { json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Testing endpoint...');
  const result = await api.testWebhookEndpoint(endpointId);

  if (result.error) {
    spinner.fail('Failed to test endpoint');
    logger.error(result.error);
    return;
  }

  const data = result.data;

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(data, options.xml, options.yaml));
    return;
  }

  // The outcome is nested: { success, testEvent, delivery: { responseStatus, responseTimeMs, errorMessage } }.
  const delivery = data?.delivery;
  const statusCode = delivery?.responseStatus ? String(delivery.responseStatus) : 'N/A';
  const responseTime = delivery?.responseTimeMs != null ? `${delivery.responseTimeMs}ms` : 'N/A';
  if (data?.success) {
    spinner.succeed('Endpoint test successful');
  } else {
    spinner.fail('Endpoint test failed');
  }
  logger.log('');
  logger.log(`Status Code:   ${statusCode}`);
  logger.log(`Response Time: ${responseTime}`);
  if (!data?.success && delivery?.errorMessage) {
    logger.log(`Error:         ${delivery.errorMessage}`);
  }
  logger.log('');
}

export async function endpointsRotateSecretCommand(
  endpointId: string,
  options: { gracePeriod?: string; yes?: boolean; json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  // rotateSecretSchema: gracePeriodSeconds 0-86400, default 3600 when omitted.
  let gracePeriodSeconds: number | undefined;
  if (options.gracePeriod !== undefined) {
    gracePeriodSeconds = Number(options.gracePeriod);
    if (!Number.isInteger(gracePeriodSeconds) || gracePeriodSeconds < 0 || gracePeriodSeconds > 86400) {
      logger.error('--grace-period must be a whole number of seconds between 0 and 86400');
      return;
    }
  }
  const graceText = gracePeriodSeconds === 0
    ? 'The old secret will stop being used immediately.'
    : `The old secret stays valid for ${gracePeriodSeconds ?? 3600}s; deliveries are signed with both secrets until then.`;

  try {
    if (!options.yes) {
      const confirmed = await confirm({
        message: `Are you sure you want to rotate the signing secret for endpoint ${endpointId}? ${graceText}`,
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
  const result = await api.rotateWebhookEndpointSecret(endpointId, { gracePeriodSeconds });

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

  // The rotate response is bare: { secret, previousSecretExpiresAt, secretVersion }.
  const rotated = result.data;
  const newSecret = rotated?.secret;
  if (newSecret) {
    logger.log('');
    logger.box('New Signing Secret', [
      logger.yellow('Save this secret - it will not be shown again:'),
      ``,
      logger.bold(newSecret),
      ``,
      `Version:                ${rotated.secretVersion}`,
      `Old secret valid until: ${new Date(rotated.previousSecretExpiresAt).toLocaleString()}`,
    ].join('\n'));
    logger.log('');
    logger.warn('Update your webhook verification code with this new secret.');
  }
}

export async function endpointsResetCircuitCommand(
  endpointId: string,
  options: { json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Resetting circuit breaker...');
  const result = await api.resetWebhookEndpointCircuit(endpointId);

  if (result.error) {
    spinner.fail('Failed to reset circuit breaker');
    logger.error(result.error);
    return;
  }

  spinner.succeed(`Circuit breaker reset (state: ${result.data?.circuitState})`);

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data, options.xml, options.yaml));
  }
}

export async function endpointsReplayFailedCommand(
  endpointId: string,
  options: { since?: string; includeUnattempted?: boolean; json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Replaying failed messages...');
  const result = await api.replayFailedWebhookEndpointMessages(endpointId, {
    since: options.since,
    includeUnattempted: options.includeUnattempted,
  });

  if (result.error) {
    spinner.fail('Failed to replay messages');
    logger.error(result.error);
    return;
  }

  const replayed = result.data?.data?.replayed ?? 0;
  spinner.succeed(`Replayed ${replayed} message${replayed === 1 ? '' : 's'}`);

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data, options.xml, options.yaml));
  }
}

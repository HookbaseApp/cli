import { input, confirm, select, checkbox } from '@inquirer/prompts';
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
  json?: boolean
}): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching endpoints...');
  const result = await api.getWebhookEndpoints(options.app);

  if (result.error) {
    spinner.fail('Failed to fetch endpoints');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const endpoints = (result.data as any)?.data || result.data?.endpoints || [];

  if (options.json) {
    console.log(JSON.stringify(endpoints, null, 2));
    return;
  }

  if (endpoints.length === 0) {
    logger.info('No webhook endpoints found');
    logger.dim('Create endpoints with "hookbase endpoints create"');
    return;
  }

  logger.table(
    ['ID', 'URL', 'App', 'Circuit', 'Status', 'Success Rate'],
    endpoints.map((e: any) => [
      e.id.substring(0, 12) + '...',
      e.url.length > 40 ? e.url.substring(0, 37) + '...' : e.url,
      e.application_name || e.applicationName || (e.application_id || e.applicationId || '').substring(0, 8) + '...',
      formatCircuitState(e.circuit_state || e.circuitState),
      (e.is_active ?? !e.isDisabled) ? logger.green('active') : logger.dimText('inactive'),
      (e.success_rate ?? e.successRate) !== undefined ? `${((e.success_rate ?? e.successRate) * 100).toFixed(1)}%` : '-',
    ])
  );
}

export async function endpointsCreateCommand(options: {
  app?: string;
  url?: string;
  description?: string;
  eventTypes?: string;
  timeout?: string;
  rateLimit?: string;
  yes?: boolean;
  json?: boolean;
}): Promise<void> {
  requireAuth();

  let applicationId = options.app;
  let url = options.url;
  let description = options.description;
  let eventTypes: string[] = options.eventTypes ? options.eventTypes.split(',') : ['*'];

  try {
    if (!applicationId) {
      // Fetch applications for selection
      const appsResult = await api.getWebhookApplications();
      const apps = (appsResult.data as any)?.data || appsResult.data?.applications || [];
      if (appsResult.error || !apps.length) {
        logger.error('No applications found. Create one first with "hookbase outbound applications create"');
        return;
      }

      applicationId = await select({
        message: 'Select application:',
        choices: apps.map((a: any) => ({
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

      const allEvents = await confirm({
        message: 'Subscribe to all event types?',
        default: true,
      });

      if (!allEvents) {
        const eventTypesInput = await input({
          message: 'Event types (comma-separated):',
          validate: (value) => value.length > 0 || 'At least one event type is required',
        });
        eventTypes = eventTypesInput.split(',').map(e => e.trim());
      }
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
    eventTypes,
    timeoutMs: options.timeout ? parseInt(options.timeout, 10) : undefined,
    rateLimitPerMinute: options.rateLimit ? parseInt(options.rateLimit, 10) : undefined,
  });

  if (result.error) {
    spinner.fail('Failed to create endpoint');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Endpoint created');

  if (options.json) {
    console.log(JSON.stringify(result.data, null, 2));
    return;
  }

  const resData = (result.data as any)?.data || result.data;
  const endpoint = resData?.endpoint || resData;
  const secret = resData?.secret || result.data?.secret;

  if (endpoint?.id) {
    const eventTypes = endpoint.event_types || endpoint.eventTypes || ['*'];
    logger.log('');
    logger.box('Endpoint Created', [
      `ID:          ${endpoint.id}`,
      `URL:         ${endpoint.url}`,
      `Event Types: ${Array.isArray(eventTypes) ? eventTypes.join(', ') : eventTypes}`,
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
  options: { json?: boolean }
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

  const endpoint: any = (result.data as any)?.data || result.data?.endpoint;

  if (options.json) {
    console.log(JSON.stringify(endpoint, null, 2));
    return;
  }

  if (!endpoint) {
    logger.error('Endpoint not found');
    return;
  }

  const isActive = endpoint.is_active ?? !endpoint.isDisabled;
  const eventTypes = endpoint.event_types || endpoint.eventTypes || ['*'];

  logger.log('');
  logger.log(logger.bold('Endpoint Details'));
  logger.log('');
  logger.log(`ID:            ${endpoint.id}`);
  logger.log(`URL:           ${endpoint.url}`);
  logger.log(`Application:   ${endpoint.application_name || endpoint.applicationName || endpoint.application_id || endpoint.applicationId}`);
  if (endpoint.description) logger.log(`Description:   ${endpoint.description}`);
  logger.log(`Status:        ${isActive ? logger.green('active') : logger.red('inactive')}`);
  logger.log(`Circuit:       ${formatCircuitState(endpoint.circuit_state || endpoint.circuitState)}`);
  logger.log(`Event Types:   ${Array.isArray(eventTypes) ? eventTypes.join(', ') : eventTypes}`);
  logger.log(`Timeout:       ${endpoint.timeout_ms || endpoint.timeoutMs || 30000}ms`);
  if (endpoint.rate_limit_per_minute || endpoint.rateLimitPerMinute) logger.log(`Rate Limit:    ${endpoint.rate_limit_per_minute || endpoint.rateLimitPerMinute}/min`);
  logger.log(`Messages:      ${endpoint.message_count ?? endpoint.messageCount ?? 0}`);
  const sr = endpoint.success_rate ?? endpoint.successRate;
  logger.log(`Success Rate:  ${sr !== undefined ? `${(sr * 100).toFixed(1)}%` : 'N/A'}`);
  logger.log(`Created:       ${endpoint.created_at || endpoint.createdAt}`);
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
    json?: boolean;
  }
): Promise<void> {
  requireAuth();

  const updateData: Parameters<typeof api.updateWebhookEndpoint>[1] = {};

  if (options.url) updateData.url = options.url;
  if (options.description) updateData.description = options.description;
  if (options.eventTypes) updateData.eventTypes = options.eventTypes.split(',').map(e => e.trim());
  if (options.timeout) updateData.timeoutMs = parseInt(options.timeout, 10);
  if (options.rateLimit) updateData.rateLimitPerMinute = parseInt(options.rateLimit, 10);
  if (options.active) updateData.isActive = true;
  if (options.inactive) updateData.isActive = false;

  if (Object.keys(updateData).length === 0) {
    logger.error('No updates specified. Use --url, --description, --event-types, --timeout, --rate-limit, --active, or --inactive');
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

  if (options.json) {
    const updated = (result.data as any)?.data || result.data?.endpoint;
    console.log(JSON.stringify(updated, null, 2));
  }
}

export async function endpointsDeleteCommand(
  endpointId: string,
  options: { yes?: boolean; json?: boolean }
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

  if (options.json) {
    console.log(JSON.stringify({ success: true, endpointId }, null, 2));
  }
}

export async function endpointsTestCommand(
  endpointId: string,
  options: { json?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Testing endpoint...');
  const result = await api.testWebhookEndpoint(endpointId);

  if (result.error) {
    spinner.fail('Failed to test endpoint');
    logger.error(result.error);
    return;
  }

  const data: any = (result.data as any)?.data || result.data;

  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (data?.success) {
    spinner.succeed('Endpoint test successful');
    logger.log('');
    logger.log(`Status Code:   ${data.statusCode || data.status_code}`);
    logger.log(`Response Time: ${data.duration ?? data.responseTime ?? 0}ms`);
  } else {
    spinner.fail('Endpoint test failed');
    logger.log('');
    logger.log(`Status Code:   ${data?.statusCode || data?.status_code || 'N/A'}`);
    logger.log(`Response Time: ${data?.duration ?? data?.responseTime ?? 'N/A'}ms`);
    if (data?.error) {
      logger.log(`Error:         ${data.error}`);
    }
  }
  logger.log('');
}

export async function endpointsRotateSecretCommand(
  endpointId: string,
  options: { yes?: boolean; json?: boolean }
): Promise<void> {
  requireAuth();

  try {
    if (!options.yes) {
      const confirmed = await confirm({
        message: `Are you sure you want to rotate the signing secret for endpoint ${endpointId}? The old secret will stop working immediately.`,
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
  const result = await api.rotateWebhookEndpointSecret(endpointId);

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

  const secretData = (result.data as any)?.data || result.data;
  const newSecret = secretData?.secret;
  if (newSecret) {
    logger.log('');
    logger.box('New Signing Secret', [
      logger.yellow('Save this secret - it will not be shown again:'),
      ``,
      logger.bold(newSecret),
    ].join('\n'));
    logger.log('');
    logger.warn('Update your webhook verification code with this new secret.');
  }
}

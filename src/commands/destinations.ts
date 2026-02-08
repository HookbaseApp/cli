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

function requireAuth(): boolean {
  if (!config.isAuthenticated()) {
    logger.error('Not logged in. Run "hookbase login" first.');
    process.exit(1);
  }
  return true;
}

export async function destinationsListCommand(options: { json?: boolean }): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching destinations...');
  const result = await api.getDestinations();

  if (result.error) {
    spinner.fail('Failed to fetch destinations');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const destinations = result.data?.destinations || [];

  if (options.json) {
    console.log(JSON.stringify(destinations, null, 2));
    return;
  }

  if (destinations.length === 0) {
    logger.info('No destinations found');
    logger.dim('Create one with "hookbase destinations create"');
    return;
  }

  logger.table(
    ['ID', 'Name', 'URL', 'Method', 'Status', 'Deliveries'],
    destinations.map((d: any) => [
      d.id,
      d.name,
      d.url.length > 40 ? d.url.slice(0, 37) + '...' : d.url,
      d.method || 'POST',
      (d.is_active ?? d.isActive ?? !d.isDisabled) ? logger.green('active') : logger.dimText('inactive'),
      String(d.delivery_count ?? d.deliveryCount ?? 0),
    ])
  );
}

export async function destinationsCreateCommand(options: {
  name?: string;
  url?: string;
  method?: string;
  yes?: boolean;
  json?: boolean;
}): Promise<void> {
  requireAuth();

  let name = options.name;
  let url = options.url;
  let method = options.method;

  // Interactive mode - wrapped in try-catch to handle Ctrl+C gracefully
  try {
    if (!name || !url) {
      name = name || await input({
        message: 'Destination name:',
        validate: (value) => value.length > 0 || 'Name is required',
      });

      url = url || await input({
        message: 'Destination URL:',
        validate: (value) => {
          try {
            new URL(value);
            return true;
          } catch {
            return 'Please enter a valid URL';
          }
        },
      });

      method = method || await select({
        message: 'HTTP method:',
        choices: [
          { name: 'POST (Recommended)', value: 'POST' },
          { name: 'PUT', value: 'PUT' },
          { name: 'PATCH', value: 'PATCH' },
        ],
        default: 'POST',
      });
    }

    if (!options.yes && !options.name) {
      const confirmed = await confirm({
        message: `Create destination "${name}" pointing to ${url}?`,
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

  const spinner = logger.spinner('Creating destination...');
  const result = await api.createDestination({
    name: name!,
    url: url!,
    method: method || 'POST',
  });

  if (result.error) {
    spinner.fail('Failed to create destination');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Destination created');

  if (options.json) {
    console.log(JSON.stringify(result.data?.destination, null, 2));
    return;
  }

  const dest = result.data?.destination;
  if (dest) {
    logger.log('');
    logger.box('Destination Created', [
      `ID:     ${dest.id}`,
      `Name:   ${dest.name}`,
      `URL:    ${dest.url}`,
      `Method: ${dest.method}`,
    ].join('\n'));
  }
}

export async function destinationsGetCommand(
  destId: string,
  options: { json?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching destination...');
  const result = await api.getDestination(destId);

  if (result.error) {
    spinner.fail('Failed to fetch destination');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const dest = result.data?.destination;

  if (options.json) {
    console.log(JSON.stringify(dest, null, 2));
    return;
  }

  if (!dest) {
    logger.error('Destination not found');
    return;
  }

  logger.log('');
  logger.log(logger.bold('Destination Details'));
  logger.log('');
  logger.log(`ID:          ${dest.id}`);
  logger.log(`Name:        ${dest.name}`);
  logger.log(`Slug:        ${dest.slug}`);
  logger.log(`URL:         ${dest.url}`);
  logger.log(`Method:      ${dest.method}`);
  logger.log(`Auth Type:   ${dest.auth_type ?? (dest as any).authType ?? '-'}`);
  logger.log(`Status:      ${(dest.is_active ?? (dest as any).isActive ?? !(dest as any).isDisabled) ? logger.green('active') : logger.red('inactive')}`);
  logger.log(`Timeout:     ${dest.timeout_ms ?? (dest as any).timeoutMs ?? 30000}ms`);
  if (dest.headers && Object.keys(dest.headers).length > 0) {
    logger.log(`Headers:`);
    for (const [key, value] of Object.entries(dest.headers)) {
      logger.log(`  ${key}: ${value}`);
    }
  }
  logger.log('');
}

export async function destinationsUpdateCommand(
  destId: string,
  options: {
    name?: string;
    url?: string;
    method?: string;
    active?: boolean;
    inactive?: boolean;
    json?: boolean;
  }
): Promise<void> {
  requireAuth();

  const updateData: Parameters<typeof api.updateDestination>[1] = {};

  if (options.name) updateData.name = options.name;
  if (options.url) updateData.url = options.url;
  if (options.method) updateData.method = options.method;
  if (options.active) updateData.isActive = true;
  if (options.inactive) updateData.isActive = false;

  if (Object.keys(updateData).length === 0) {
    logger.error('No updates specified. Use --name, --url, --method, --active, or --inactive');
    return;
  }

  const spinner = logger.spinner('Updating destination...');
  const result = await api.updateDestination(destId, updateData);

  if (result.error) {
    spinner.fail('Failed to update destination');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Destination updated');

  if (options.json) {
    console.log(JSON.stringify(result.data?.destination, null, 2));
  }
}

export async function destinationsDeleteCommand(
  destId: string,
  options: { yes?: boolean; json?: boolean }
): Promise<void> {
  requireAuth();

  try {
    if (!options.yes) {
      const confirmed = await confirm({
        message: `Are you sure you want to delete destination ${destId}? This cannot be undone.`,
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

  const spinner = logger.spinner('Deleting destination...');
  const result = await api.deleteDestination(destId);

  if (result.error) {
    spinner.fail('Failed to delete destination');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Destination deleted');

  if (options.json) {
    console.log(JSON.stringify({ success: true, destId }, null, 2));
  }
}

export async function destinationsTestCommand(
  destId: string,
  options: { json?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Testing destination...');
  const result = await api.testDestination(destId);

  if (result.error) {
    spinner.fail('Test failed');
    logger.error(result.error);
    return;
  }

  const raw = result.data as any;
  const testResult = (raw?.data && typeof raw.data === 'object' ? raw.data : raw) as any;

  if (options.json) {
    console.log(JSON.stringify(testResult, null, 2));
    return;
  }

  const statusCode = testResult?.statusCode ?? testResult?.status_code ?? 0;
  const responseTime = testResult?.duration ?? testResult?.responseTime ?? testResult?.response_time ?? 0;

  if (testResult?.success) {
    spinner.succeed('Test successful');
    logger.log('');
    logger.log(`Status Code:   ${logger.green(String(statusCode))}`);
    logger.log(`Response Time: ${responseTime}ms`);
  } else {
    spinner.fail('Test failed');
    logger.log('');
    logger.log(`Status Code:   ${logger.red(statusCode > 0 ? String(statusCode) : 'N/A')}`);
    logger.log(`Response Time: ${responseTime || 'N/A'}ms`);
    if (testResult?.error) {
      logger.log(`Error:         ${testResult.error}`);
    }
  }
}

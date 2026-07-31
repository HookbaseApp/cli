import { input, confirm, select, number } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';
import { askAdvanced, gatedPrompt, ensureFeature, loadFeatures, featureEnabled } from '../lib/advanced.js';

/** Helper to check if an error is a prompt cancellation (Ctrl+C) */
function isPromptCancelled(error: unknown): boolean {
  return error instanceof ExitPromptError ||
    (error instanceof Error && error.name === 'ExitPromptError');
}

const WAREHOUSE_TYPES = ['s3', 'r2', 'gcs', 'azure_blob'] as const;
const QUEUE_TYPES = ['sqs', 'eventbridge', 'servicebus', 'pubsub', 'oci_queue'] as const;
type DestType = 'http' | typeof WAREHOUSE_TYPES[number] | typeof QUEUE_TYPES[number];

/** Which plan feature a non-HTTP destination type requires (null for HTTP). */
function destTypeFeature(type: string): { key: string; label: string } | null {
  if ((WAREHOUSE_TYPES as readonly string[]).includes(type)) {
    return { key: 'warehouse_destinations', label: 'Warehouse destinations' };
  }
  if ((QUEUE_TYPES as readonly string[]).includes(type)) {
    return { key: 'sqs_destinations', label: 'Queue/event-bus destinations' };
  }
  return null;
}

/** Parse repeated "Key: Value" header flags into a headers object. */
function parseHeaderFlags(items?: string[]): Record<string, string> | undefined {
  if (!items || items.length === 0) return undefined;
  const headers: Record<string, string> = {};
  for (const raw of items) {
    const idx = raw.indexOf(':');
    if (idx === -1) {
      logger.warn(`Ignoring malformed header "${raw}" (expected "Key: Value")`);
      continue;
    }
    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    if (key) headers[key] = value;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/** Parse a JSON flag value; on error, log and return undefined. */
function parseJsonFlag(raw: string | undefined, label: string): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    logger.warn(`--${label} must be a JSON object; ignoring`);
  } catch {
    logger.warn(`--${label} is not valid JSON; ignoring`);
  }
  return undefined;
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
    ['ID', 'Name', 'Slug', 'URL', 'Method', 'Status', 'Deliveries'],
    destinations.map((d: any) => [
      d.id,
      d.name,
      d.slug || '-',
      (() => { const u = d.url || ''; return u.length > 40 ? u.slice(0, 37) + '...' : (u || '-'); })(),
      d.method || 'POST',
      (d.is_active ?? d.isActive ?? !d.isDisabled) ? logger.green('active') : logger.dimText('inactive'),
      String(d.delivery_count ?? d.deliveryCount ?? 0),
    ])
  );
}

/** Interactive advanced sub-prompts for a destination, each gated by plan feature. */
async function runDestinationAdvancedWizard(
  dest: Parameters<typeof api.createDestination>[0],
): Promise<void> {
  // Custom headers (ungated)
  if (await confirm({ message: 'Add custom request headers?', default: false })) {
    const headers: Record<string, string> = { ...(dest.headers || {}) };
    for (;;) {
      const line = await input({ message: 'Header (Key: Value), blank to finish:' });
      if (!line.trim()) break;
      const idx = line.indexOf(':');
      if (idx === -1) { logger.warn('Expected "Key: Value"'); continue; }
      const key = line.slice(0, idx).trim();
      if (key) headers[key] = line.slice(idx + 1).trim();
    }
    if (Object.keys(headers).length > 0) dest.headers = headers;
  }

  // Auth (ungated). bearer/basic are applied by the delivery worker; any other
  // static auth header can be added via the custom-headers step above.
  const authType = await select({
    message: 'Authentication:',
    choices: [
      { name: 'None', value: 'none' },
      { name: 'Bearer token', value: 'bearer' },
      { name: 'Basic (username/password)', value: 'basic' },
    ],
    default: 'none',
  });
  if (authType === 'bearer') {
    dest.authType = 'bearer';
    dest.authConfig = { token: await input({ message: 'Bearer token:' }) };
  } else if (authType === 'basic') {
    const username = await input({ message: 'Username:' });
    const password = await input({ message: 'Password:' });
    dest.authType = 'basic';
    dest.authConfig = { username, password };
  }

  // Timeout (ungated)
  const timeout = await number({ message: 'Request timeout (ms, 1000-60000):', min: 1000, max: 60000, default: 30000, required: false });
  if (timeout) dest.timeoutMs = timeout;

  // Rate limiting (paid)
  await gatedPrompt('rate_limits', 'Rate limiting', async () => {
    const rl = await number({ message: 'Rate limit (requests/min, blank = unlimited):', min: 1, max: 100000, required: false });
    if (rl) dest.rateLimitPerMinute = rl;
  }, undefined);

  // Static IP delivery (Pro+)
  await gatedPrompt('static_ip', 'Static IP delivery', async () => {
    dest.useStaticIp = await confirm({ message: 'Deliver from a dedicated static IP?', default: false });
  }, undefined);

  // Destination type — only offer warehouse/queue when the plan allows them.
  const typeChoices: Array<{ name: string; value: string }> = [{ name: 'HTTP webhook', value: 'http' }];
  if (featureEnabled('warehouse_destinations')) typeChoices.push({ name: 'Warehouse — S3 / R2 / GCS / Azure Blob', value: '__warehouse' });
  if (featureEnabled('sqs_destinations')) typeChoices.push({ name: 'Queue / event bus — SQS / EventBridge / …', value: '__queue' });
  if (typeChoices.length > 1) {
    const choice = await select({ message: 'Destination type:', choices: typeChoices, default: 'http' });
    if (choice === '__warehouse' || choice === '__queue') {
      const group = choice === '__warehouse' ? WAREHOUSE_TYPES : QUEUE_TYPES;
      const chosen = await select({ message: 'Provider:', choices: group.map((t) => ({ name: t, value: t })) });
      dest.type = chosen as DestType;
      const cfgRaw = await input({ message: `Config for ${chosen} (JSON object):` });
      const cfg = parseJsonFlag(cfgRaw, 'config');
      if (cfg) dest.config = cfg;
      const batch = await number({ message: 'Batch size (1-1000, blank = 1):', min: 1, max: 1000, required: false });
      if (batch) dest.batchSize = batch;
    }
  }
}

export async function destinationsCreateCommand(options: {
  name?: string;
  url?: string;
  method?: string;
  header?: string[];
  authType?: string;
  authToken?: string;
  authUser?: string;
  authPass?: string;
  timeout?: string;
  rateLimit?: string;
  type?: string;
  config?: string;
  batchSize?: string;
  batchWindow?: string;
  fieldMapping?: string;
  staticIp?: boolean;
  yes?: boolean;
  json?: boolean;
}): Promise<void> {
  requireAuth();

  let name = options.name;
  let url = options.url;
  let method = options.method;

  // Advanced config assembled from flags and/or the interactive wizard.
  const dest: Parameters<typeof api.createDestination>[0] = { name: '' };
  const flagHeaders = parseHeaderFlags(options.header);
  if (flagHeaders) dest.headers = flagHeaders;
  if (options.timeout) dest.timeoutMs = parseInt(options.timeout, 10);
  if (options.batchSize) dest.batchSize = parseInt(options.batchSize, 10);
  if (options.batchWindow) dest.batchWindowSeconds = parseInt(options.batchWindow, 10);
  if (options.fieldMapping) {
    try {
      const fm = JSON.parse(options.fieldMapping);
      if (Array.isArray(fm)) dest.fieldMapping = fm;
      else logger.warn('--field-mapping must be a JSON array; ignoring');
    } catch { logger.warn('--field-mapping is not valid JSON; ignoring'); }
  }
  if (options.authType && options.authType !== 'none') {
    if (options.authType === 'bearer') {
      dest.authType = 'bearer';
      dest.authConfig = { token: options.authToken || '' };
    } else if (options.authType === 'basic') {
      dest.authType = 'basic';
      dest.authConfig = { username: options.authUser || '', password: options.authPass || '' };
    } else {
      logger.error(`Unsupported --auth-type "${options.authType}" (use bearer|basic; for custom headers use --header)`);
      return;
    }
  }

  // Feature-gated flags — validate against the plan up front.
  const gatedFlagUsed =
    options.rateLimit !== undefined || options.staticIp === true ||
    (options.type !== undefined && options.type !== 'http');
  const anyAdvancedFlag = gatedFlagUsed || options.staticIp === false ||
    !!flagHeaders || options.authType !== undefined || options.timeout !== undefined ||
    options.batchSize !== undefined || options.batchWindow !== undefined ||
    options.fieldMapping !== undefined || options.config !== undefined;

  if (options.staticIp === false) dest.useStaticIp = false; // --no-static-ip (ungated: turning it OFF)

  if (gatedFlagUsed) {
    await loadFeatures();
    if (options.rateLimit !== undefined) {
      if (!ensureFeature('rate_limits', 'Rate limits')) return;
      dest.rateLimitPerMinute = parseInt(options.rateLimit, 10);
    }
    if (options.staticIp === true) {
      if (!ensureFeature('static_ip', 'Static IP delivery')) return;
      dest.useStaticIp = true;
    }
    if (options.type !== undefined && options.type !== 'http') {
      const feat = destTypeFeature(options.type);
      if (!feat) { logger.error(`Invalid --type "${options.type}"`); return; }
      if (!ensureFeature(feat.key, feat.label)) return;
      dest.type = options.type as DestType;
      const cfg = parseJsonFlag(options.config, 'config');
      if (cfg) dest.config = cfg;
    }
  }

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

    // Advanced wizard — only in the fully-interactive path.
    if (await askAdvanced('destination', options.yes || anyAdvancedFlag || !!options.name)) {
      await loadFeatures();
      await runDestinationAdvancedWizard(dest);
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

  dest.name = name!;
  dest.url = url!;
  dest.method = method || 'POST';

  const spinner = logger.spinner('Creating destination...');
  const result = await api.createDestination(dest);

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

  const created = result.data?.destination;
  if (created) {
    logger.log('');
    logger.box('Destination Created', [
      `ID:     ${created.id}`,
      `Name:   ${created.name}`,
      `URL:    ${created.url}`,
      `Method: ${created.method}`,
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
  const staticIp = dest.use_static_ip ?? (dest as any).useStaticIp;
  logger.log(`Static IP:   ${staticIp === 1 || staticIp === true ? logger.green('enabled') : logger.dimText('disabled')}`);
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
    staticIp?: boolean;
    noStaticIp?: boolean;
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
  if (options.staticIp !== undefined) updateData.useStaticIp = options.staticIp;

  if (Object.keys(updateData).length === 0) {
    logger.error('No updates specified. Use --name, --url, --method, --active, --inactive, --static-ip, or --no-static-ip');
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

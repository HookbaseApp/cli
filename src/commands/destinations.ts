import { input, confirm, select, number } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import * as api from '../lib/api.js';
import * as logger from '../lib/logger.js';
import { askAdvanced, gatedPrompt, ensureFeature, loadFeatures, featureEnabled } from '../lib/advanced.js';
import { readJsonArg, isJsonObject, parseJsonField } from '../lib/parseJson.js';
import {
  WAREHOUSE_TYPES, QUEUE_TYPES, anyBridgeFlag, buildBridgeConfig, describeDestinationConfig, type BridgeFlags,
} from '../lib/destinationConfig.js';

import { requireAuth } from '../lib/requireAuth.js';
import { formatOutput } from '../lib/output.js';

/** Helper to check if an error is a prompt cancellation (Ctrl+C) */
function isPromptCancelled(error: unknown): boolean {
  return error instanceof ExitPromptError ||
    (error instanceof Error && error.name === 'ExitPromptError');
}

type DestType = api.DestinationType;

/** Which plan feature a destination type requires (null for HTTP and bridge, which every plan has). */
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

/** Read a --config value (inline JSON or @file); logs and returns null when it is not a JSON object. */
function readConfigFlag(raw: string): Record<string, unknown> | null {
  const parsed = readJsonArg(raw, '--config');
  if (!parsed.ok) { logger.error(parsed.error); return null; }
  if (!isJsonObject(parsed.value)) { logger.error('--config must be a JSON object'); return null; }
  return parsed.value;
}

/** Parse 0..86400 for --grace-period; null (after logging) when invalid. */
export function parseGracePeriod(raw: string | undefined): number | undefined | null {
  if (raw === undefined) return undefined;
  const n = Number(raw.trim());
  if (!/^\d+$/.test(raw.trim()) || !Number.isInteger(n) || n < 0 || n > 86400) {
    logger.error('--grace-period must be a whole number of seconds from 0 to 86400');
    return null;
  }
  return n;
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

export async function destinationsListCommand(options: { json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
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

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(destinations, options.xml, options.yaml));
    return;
  }

  if (destinations.length === 0) {
    logger.info('No destinations found');
    logger.dim('Create one with "hookbase destinations create"');
    return;
  }

  logger.table(
    ['ID', 'Name', 'Slug', 'Type', 'URL / Target', 'Method', 'Status', 'Deliveries'],
    destinations.map((d: any) => [
      d.id,
      d.name,
      d.slug || '-',
      d.type || 'http',
      (() => {
        const type = d.type || 'http';
        // Non-HTTP destinations have no URL: show the first config row (bucket, queue, event type).
        const u = type === 'http' ? (d.url || '') : (describeDestinationConfig(type, d.config)[0]?.[1] ?? '');
        return u.length > 40 ? u.slice(0, 37) + '...' : (u || '-');
      })(),
      (d.type || 'http') === 'http' ? (d.method || 'POST') : '-',
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

  // Throttling (paid)
  await gatedPrompt('throttling', 'Throttling', async () => {
    const mode = await select({
      message: 'Throttle mode:',
      choices: [
        { name: 'Off (no throttling)', value: 'off' },
        { name: 'Rate limit (requests per time unit)', value: 'rate' },
        { name: 'Concurrency limit (max in-flight requests)', value: 'concurrency' },
      ],
      default: 'off',
    });
    if (mode === 'off') return;

    if (mode === 'rate') {
      const rateLimit = await number({ message: 'Rate limit (requests):', min: 1, max: 100000, required: true });
      const rateUnit = await select({
        message: 'Per:',
        choices: [
          { name: 'Second', value: 'second' },
          { name: 'Minute', value: 'minute' },
          { name: 'Hour', value: 'hour' },
        ],
        default: 'minute',
      });
      dest.throttle = { mode: 'rate', rateLimit, rateUnit: rateUnit as 'second' | 'minute' | 'hour' };
    } else {
      const maxConcurrency = await number({ message: 'Max concurrency (in-flight requests):', min: 1, max: 1000, required: true });
      dest.throttle = { mode: 'concurrency', maxConcurrency };
    }

    const queueLimit = await number({ message: 'Queue depth limit (blank = no backpressure threshold):', min: 1, max: 100000, required: false });
    if (queueLimit && dest.throttle) dest.throttle.queueLimit = queueLimit;
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
  throttleMode?: string;
  throttleRate?: string;
  throttleUnit?: string;
  throttleConcurrency?: string;
  throttleQueueLimit?: string;
  type?: string;
  config?: string;
  batchSize?: string;
  batchWindow?: string;
  fieldMapping?: string;
  staticIp?: boolean;
  eventTypeSource?: string;
  eventType?: string;
  eventTypeField?: string;
  eventTypePrefix?: string;
  application?: string;
  allowUnverifiedSources?: boolean;
  yes?: boolean;
  json?: boolean;
  xml?: boolean;
  yaml?: boolean;
}): Promise<void> {
  requireAuth();

  if (options.type !== undefined && !(api.DESTINATION_TYPES as readonly string[]).includes(options.type)) {
    logger.error(`Invalid --type "${options.type}" (use ${api.DESTINATION_TYPES.join('|')})`);
    return;
  }
  const bridgeFlags: BridgeFlags = {
    eventTypeSource: options.eventTypeSource,
    eventType: options.eventType,
    eventTypeField: options.eventTypeField,
    eventTypePrefix: options.eventTypePrefix,
    application: options.application,
    allowUnverifiedSources: options.allowUnverifiedSources,
  };
  if (anyBridgeFlag(bridgeFlags) && options.type !== 'bridge') {
    logger.error('The --event-type*, --application and --allow-unverified-sources flags need --type bridge');
    return;
  }
  let flagConfig: Record<string, unknown> | undefined;
  if (options.config !== undefined) {
    const cfg = readConfigFlag(options.config);
    if (!cfg) return;
    flagConfig = cfg;
  }

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
    options.throttleMode !== undefined || options.staticIp === true ||
    (options.type !== undefined && destTypeFeature(options.type) !== null);
  const anyAdvancedFlag = gatedFlagUsed || options.staticIp === false ||
    !!flagHeaders || options.authType !== undefined || options.timeout !== undefined ||
    options.batchSize !== undefined || options.batchWindow !== undefined ||
    options.fieldMapping !== undefined || options.config !== undefined ||
    options.throttleRate !== undefined || options.throttleUnit !== undefined ||
    options.throttleConcurrency !== undefined || options.throttleQueueLimit !== undefined ||
    options.type !== undefined || anyBridgeFlag(bridgeFlags);

  if (options.staticIp === false) dest.useStaticIp = false; // --no-static-ip (ungated: turning it OFF)

  if (gatedFlagUsed) {
    await loadFeatures();
    if (options.throttleMode !== undefined) {
      if (!ensureFeature('throttling', 'Throttling')) return;
      const mode = options.throttleMode;
      if (mode !== 'off' && mode !== 'rate' && mode !== 'concurrency') {
        logger.error(`Invalid --throttle-mode "${mode}" (use off|rate|concurrency)`);
        return;
      }
      if (mode === 'off') {
        dest.throttle = { mode: 'off' };
      } else if (mode === 'rate') {
        const rateLimit = options.throttleRate ? parseInt(options.throttleRate, 10) : undefined;
        if (!rateLimit) {
          logger.error('--throttle-rate is required when --throttle-mode is "rate"');
          return;
        }
        const rateUnit = options.throttleUnit || 'minute';
        if (rateUnit !== 'second' && rateUnit !== 'minute' && rateUnit !== 'hour') {
          logger.error(`Invalid --throttle-unit "${rateUnit}" (use second|minute|hour)`);
          return;
        }
        dest.throttle = { mode: 'rate', rateLimit, rateUnit };
      } else {
        const maxConcurrency = options.throttleConcurrency ? parseInt(options.throttleConcurrency, 10) : undefined;
        if (!maxConcurrency) {
          logger.error('--throttle-concurrency is required when --throttle-mode is "concurrency"');
          return;
        }
        dest.throttle = { mode: 'concurrency', maxConcurrency };
      }
      if (dest.throttle.mode !== 'off' && options.throttleQueueLimit) {
        dest.throttle.queueLimit = parseInt(options.throttleQueueLimit, 10);
      }
    }
    if (options.staticIp === true) {
      if (!ensureFeature('static_ip', 'Static IP delivery')) return;
      dest.useStaticIp = true;
    }
    const feat = options.type !== undefined ? destTypeFeature(options.type) : null;
    if (feat && !ensureFeature(feat.key, feat.label)) return;
  }

  if (options.type === 'bridge') {
    // A bridge publishes outbound events (any plan); it has no URL, headers, auth or static IP.
    const built = buildBridgeConfig(flagConfig, bridgeFlags);
    if (!built.ok) { logger.error(built.error); return; }
    dest.type = 'bridge';
    dest.config = built.config as unknown as Record<string, unknown>;
  } else if (options.type !== undefined && options.type !== 'http') {
    dest.type = options.type as DestType;
    if (flagConfig) dest.config = flagConfig;
  }
  const isHttp = !dest.type || dest.type === 'http';

  // Interactive mode - wrapped in try-catch to handle Ctrl+C gracefully
  try {
    if (!name || (isHttp && !url)) {
      name = name || await input({
        message: 'Destination name:',
        validate: (value) => value.length > 0 || 'Name is required',
      });
    }

    if (isHttp && (!url || !options.name)) {
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
        message: isHttp ? `Create destination "${name}" pointing to ${url}?` : `Create ${dest.type} destination "${name}"?`,
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
  if (isHttp) {
    dest.url = url!;
    dest.method = method || 'POST';
  }

  const spinner = logger.spinner('Creating destination...');
  const result = await api.createDestination(dest);

  if (result.error) {
    spinner.fail('Failed to create destination');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Destination created');

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data?.destination, options.xml, options.yaml));
    return;
  }

  const created = result.data?.destination;
  if (created) {
    const type = created.type || 'http';
    const lines = [
      `ID:     ${created.id}`,
      `Name:   ${created.name}`,
      `Type:   ${type}`,
    ];
    if (type === 'http') {
      lines.push(`URL:    ${created.url}`, `Method: ${created.method}`);
    } else {
      for (const [label, value] of describeDestinationConfig(type, created.config)) {
        lines.push(`${(label + ':').padEnd(7)} ${value}`);
      }
    }
    logger.log('');
    logger.box('Destination Created', lines.join('\n'));
    if (created.signingSecret) {
      logger.log('');
      logger.log(`Signing secret (shown once): ${logger.bold(created.signingSecret)}`);
      logger.dim('Every delivery is signed with it. Store it now; later use "hookbase destinations reveal-secret ' + created.id + '".');
    }
  }
}

export async function destinationsGetCommand(
  destId: string,
  options: { json?: boolean; xml?: boolean; yaml?: boolean }
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

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(dest, options.xml, options.yaml));
    return;
  }

  if (!dest) {
    logger.error('Destination not found');
    return;
  }

  const d = dest as any;
  const destType: string = dest.type || d.destinationType || 'http';
  const isHttp = destType === 'http';

  logger.log('');
  logger.log(logger.bold('Destination Details'));
  logger.log('');
  logger.log(`ID:          ${dest.id}`);
  logger.log(`Name:        ${dest.name}`);
  logger.log(`Slug:        ${dest.slug}`);
  logger.log(`Type:        ${destType}`);
  if (isHttp) {
    logger.log(`URL:         ${dest.url}`);
    logger.log(`Method:      ${dest.method}`);
    logger.log(`Auth Type:   ${dest.auth_type ?? d.authType ?? '-'}`);
    logger.log(`Signing:     ${dest.hasSigningSecret
      ? logger.green('signed') + logger.dimText(' (hookbase destinations reveal-secret ' + (dest.slug || dest.id) + ')')
      : logger.dimText('no signing secret (rotate-secret issues one)')}`);
  } else {
    for (const [label, value] of describeDestinationConfig(destType, dest.config)) {
      logger.log(`${(label + ':').padEnd(12)} ${value}`);
    }
  }
  logger.log(`Status:      ${(dest.is_active ?? d.isActive ?? !d.isDisabled) ? logger.green('active') : logger.red('inactive')}`);
  if (isHttp) {
    const staticIp = dest.use_static_ip ?? d.useStaticIp;
    logger.log(`Static IP:   ${staticIp === 1 || staticIp === true ? logger.green('enabled') : logger.dimText('disabled')}`);
    logger.log(`Timeout:     ${dest.timeout_ms ?? d.timeoutMs ?? 30000}ms`);
  }
  logger.log(`Deliveries:  ${dest.delivery_count ?? d.deliveryCount ?? 0}`);
  logger.log(`  Delivered: ${dest.success_count ?? d.successCount ?? 0}`);
  logger.log(`  Failed:    ${dest.failure_count ?? d.failureCount ?? 0}`);
  logger.log(`Routes:      ${dest.route_count ?? d.routeCount ?? 0}`);
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
    config?: string;
    eventTypeSource?: string;
    eventType?: string;
    eventTypeField?: string;
    eventTypePrefix?: string;
    application?: string | false;
    allowUnverifiedSources?: boolean;
    json?: boolean;
    xml?: boolean;
    yaml?: boolean;
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

  let flagConfig: Record<string, unknown> | undefined;
  if (options.config !== undefined) {
    const cfg = readConfigFlag(options.config);
    if (!cfg) return;
    flagConfig = cfg;
  }
  const bridgeFlags: BridgeFlags = {
    eventTypeSource: options.eventTypeSource,
    eventType: options.eventType,
    eventTypeField: options.eventTypeField,
    eventTypePrefix: options.eventTypePrefix,
    application: options.application,
    allowUnverifiedSources: options.allowUnverifiedSources,
  };
  if (anyBridgeFlag(bridgeFlags)) {
    // The API replaces a bridge's config as a whole, so the flags are applied on top of the stored
    // config (or --config, when given).
    const current = await api.getDestination(destId);
    if (current.error || !current.data?.destination) {
      logger.error(current.error || 'Destination not found');
      return;
    }
    if (current.data.destination.type !== 'bridge') {
      logger.error(`The --event-type*, --application and --allow-unverified-sources flags apply only to bridge destinations (this one is ${current.data.destination.type || 'http'})`);
      return;
    }
    const base = flagConfig ?? parseJsonField(current.data.destination.config, {} as Record<string, unknown>);
    const built = buildBridgeConfig(base, bridgeFlags);
    if (!built.ok) { logger.error(built.error); return; }
    updateData.config = built.config as unknown as Record<string, unknown>;
  } else if (flagConfig) {
    updateData.config = flagConfig;
  }

  if (Object.keys(updateData).length === 0) {
    logger.error('No updates specified. Use --name, --url, --method, --active, --inactive, --static-ip, --no-static-ip, --config, or the bridge flags');
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

  if (options.json || options.xml || options.yaml) {
    // PATCH answers { success: true }; print the updated destination, as `sources update` does.
    const updated = await api.getDestination(destId);
    console.log(formatOutput(updated.data?.destination ?? result.data, options.xml, options.yaml));
  }
}

export async function destinationsDeleteCommand(
  destId: string,
  options: { yes?: boolean; json?: boolean; xml?: boolean; yaml?: boolean }
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

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput({ success: true, destId }, options.xml, options.yaml));
  }
}

export async function destinationsTestCommand(
  destId: string,
  options: { payload?: string; json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  let payload: unknown;
  if (options.payload !== undefined) {
    const parsed = readJsonArg(options.payload, '--payload');
    if (!parsed.ok) { logger.error(parsed.error); return; }
    if (!isJsonObject(parsed.value)) { logger.error('--payload must be a JSON object'); return; }
    payload = parsed.value;
  }

  const spinner = logger.spinner('Testing destination...');
  const result = await api.testDestination(destId, payload);

  if (result.error) {
    spinner.fail('Test failed');
    logger.error(result.error);
    return;
  }

  const testResult = result.data;

  if (options.json || options.xml || options.yaml) {
    spinner.stop();
    console.log(formatOutput(testResult, options.xml, options.yaml));
    return;
  }

  if (!testResult) {
    spinner.fail('Test failed');
    return;
  }

  if (testResult.dryRun) {
    // Bridge: nothing was published. Report what would have been.
    if (testResult.success) spinner.succeed('Dry run: the bridge would publish this event');
    else spinner.fail('Dry run: the bridge would not publish this event');
    logger.log('');
    logger.log(`Event Type:    ${testResult.eventType ?? logger.red('none')}`);
    if (testResult.eventType) {
      logger.log(`Type Enabled:  ${testResult.eventTypeExists ? logger.green('yes') : logger.red('no (create or enable it under outbound event types)')}`);
    }
    logger.log(`Endpoints:     ${testResult.matchingEndpoints ?? 0} subscribed`);
    if (testResult.error) logger.log(`Reason:        ${logger.red(testResult.error)}`);
    logger.log('');
    logger.dim(payload === undefined
      ? 'Used Hookbase\'s test payload. Pass --payload to resolve the event type from your own sample.'
      : 'Nothing was published or charged.');
    return;
  }

  const statusCode = testResult.status ?? 0;
  const latency = testResult.latencyMs;

  if (testResult.success) {
    spinner.succeed('Test successful');
    logger.log('');
    logger.log(`Status Code:   ${logger.green(String(statusCode))}`);
    logger.log(`Response Time: ${latency ?? 0}ms`);
  } else {
    spinner.fail('Test failed');
    logger.log('');
    logger.log(`Status Code:   ${logger.red(statusCode > 0 ? String(statusCode) : 'N/A')}`);
    logger.log(`Response Time: ${latency !== undefined ? `${latency}ms` : 'N/A'}`);
    if (testResult.error) {
      logger.log(`Error:         ${testResult.error}`);
    }
  }
  if (testResult.responseBody) {
    logger.log('');
    logger.log(logger.bold('Response Body:'));
    logger.log(testResult.responseBody);
  }
  if (payload !== undefined) {
    logger.log('');
    logger.dim('--payload is only used by bridge dry runs; this test sent Hookbase\'s own test payload.');
  }
}

function printSigningSecret(data: api.DestinationSigningSecret, heading: string): void {
  logger.log('');
  logger.log(`${heading}: ${logger.bold(data.signingSecret)}`);
  if (data.previousSecretExpiresAt) {
    logger.log(`Previous secret also signs until ${new Date(data.previousSecretExpiresAt).toLocaleString()} ${logger.dimText(`(${data.previousSecretExpiresAt})`)}`);
  } else {
    logger.dim('No previous secret is in use.');
  }
}

export async function destinationsRevealSecretCommand(
  destId: string,
  options: { json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching signing secret...');
  const result = await api.revealDestinationSecret(destId);

  if (result.error || !result.data) {
    spinner.fail('Failed to reveal signing secret');
    logger.error(result.error || 'No secret returned');
    return;
  }

  spinner.stop();

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data, options.xml, options.yaml));
    return;
  }

  printSigningSecret(result.data, 'Signing secret');
}

export async function destinationsRotateSecretCommand(
  destId: string,
  options: { gracePeriod?: string; yes?: boolean; json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  const gracePeriodSeconds = parseGracePeriod(options.gracePeriod);
  if (gracePeriodSeconds === null) return;

  try {
    if (!options.yes) {
      const window = gracePeriodSeconds === undefined
        ? 'for 1 hour (the default; set --grace-period to change it)'
        : gracePeriodSeconds === 0 ? null : `for ${gracePeriodSeconds} seconds`;
      const confirmed = await confirm({
        message: window
          ? `Rotate the signing secret for ${destId}? Deliveries carry both signatures ${window}.`
          : `Rotate the signing secret for ${destId}? The old secret stops signing immediately.`,
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

  const spinner = logger.spinner('Rotating signing secret...');
  const result = await api.rotateDestinationSecret(destId, gracePeriodSeconds);

  if (result.error || !result.data) {
    spinner.fail('Failed to rotate signing secret');
    logger.error(result.error || 'No secret returned');
    return;
  }

  spinner.succeed('Signing secret rotated');

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data, options.xml, options.yaml));
    return;
  }

  printSigningSecret(result.data, 'New signing secret');
}

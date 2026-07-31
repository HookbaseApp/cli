import { input, confirm, select, checkbox, number } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';
import { askAdvanced, gatedPrompt, ensureFeature, featureEnabled, loadFeatures } from '../lib/advanced.js';

/** Helper to check if an error is a prompt cancellation (Ctrl+C) */
function isPromptCancelled(error: unknown): boolean {
  return error instanceof ExitPromptError ||
    (error instanceof Error && error.name === 'ExitPromptError');
}

const FILTER_OPERATORS = [
  'equals', 'not_equals', 'contains', 'starts_with', 'ends_with',
  'exists', 'not_exists', 'greater_than', 'less_than', 'regex',
] as const;

/** Resolve an id-or-slug-or-name against a fetched list; undefined if no match. */
function resolveOne(value: string, items: Array<{ id: string; name?: string; slug?: string }>): string | undefined {
  const v = value.trim();
  const m = items.find((i) => i.id === v || i.slug === v || i.name === v);
  return m?.id;
}

/** Prompt for a list of filter conditions (blank field ends the loop). */
export async function promptFilterConditions(): Promise<api.FilterCondition[]> {
  const conditions: api.FilterCondition[] = [];
  for (;;) {
    const field = await input({ message: 'Condition field path (blank to finish):' });
    if (!field.trim()) break;
    const operator = await select({
      message: 'Operator:',
      choices: FILTER_OPERATORS.map((o) => ({ name: o, value: o })),
    });
    let value: string | undefined;
    if (operator !== 'exists' && operator !== 'not_exists') {
      value = await input({ message: 'Value:' });
    }
    conditions.push({ field: field.trim(), operator, value });
  }
  return conditions;
}

/** Create a transform inline; returns its id or null on failure. */
async function createTransformInline(): Promise<string | null> {
  const name = await input({ message: 'Transform name:', validate: (v) => v.length > 0 || 'Required' });
  const transformType = await select({
    message: 'Transform type:',
    choices: [
      { name: 'JSONata', value: 'jsonata' },
      { name: 'JavaScript', value: 'javascript' },
      { name: 'Liquid', value: 'liquid' },
      { name: 'XSLT', value: 'xslt' },
    ],
    default: 'jsonata',
  }) as 'jsonata' | 'javascript' | 'liquid' | 'xslt';
  const code = await input({ message: 'Transform code:', validate: (v) => v.length > 0 || 'Required' });
  const res = await api.createTransform({ name, code, transformType });
  if (res.error || !res.data?.transform) {
    logger.error(`Transform not created: ${res.error || 'unknown error'}`);
    return null;
  }
  logger.dim(`  Created transform ${res.data.transform.id}`);
  return res.data.transform.id;
}

/** Create a validation schema inline; returns its id or null on failure. */
async function createSchemaInline(): Promise<string | null> {
  const name = await input({ message: 'Schema name:', validate: (v) => v.length > 0 || 'Required' });
  const raw = await input({ message: 'JSON Schema (paste a JSON object):' });
  let jsonSchema: unknown;
  try {
    jsonSchema = JSON.parse(raw);
  } catch {
    logger.error('Invalid JSON; schema not created');
    return null;
  }
  const res = await api.createSchema({ name, jsonSchema });
  if (res.error || !res.data?.schema) {
    logger.error(`Schema not created: ${res.error || 'unknown error'}`);
    return null;
  }
  logger.dim(`  Created schema ${res.data.schema.id}`);
  return res.data.schema.id;
}

/** Prompt for a notification channel's type-specific config (matches the API's
 * validateChannelConfig contract). */
export async function promptChannelConfig(type: api.NotificationChannel['type']): Promise<Record<string, unknown>> {
  switch (type) {
    case 'email': {
      const raw = await input({ message: 'Recipient emails (comma-separated):' });
      return { emails: raw.split(',').map((e) => e.trim()).filter(Boolean) };
    }
    case 'slack':
      return { webhookUrl: await input({ message: 'Slack webhook URL (https://hooks.slack.com/…):' }) };
    case 'teams':
      return { webhookUrl: await input({ message: 'Teams webhook URL (…webhook.office.com/…):' }) };
    case 'discord':
      return { webhookUrl: await input({ message: 'Discord webhook URL (https://discord.com/api/webhooks/…):' }) };
    case 'pagerduty':
      return { routingKey: await input({ message: 'PagerDuty routing key (32 chars):' }) };
    case 'webhook':
      return { url: await input({ message: 'Webhook URL (http/https):' }) };
    default:
      return {};
  }
}

/** Create a notification channel inline; returns its id or null on failure. */
async function createChannelInline(): Promise<string | null> {
  const name = await input({ message: 'Channel name:', validate: (v) => v.length > 0 || 'Required' });
  const type = await select({
    message: 'Channel type:',
    choices: [
      { name: 'Slack', value: 'slack' },
      { name: 'Webhook', value: 'webhook' },
      { name: 'Email', value: 'email' },
      { name: 'Microsoft Teams', value: 'teams' },
      { name: 'PagerDuty', value: 'pagerduty' },
      { name: 'Discord', value: 'discord' },
    ],
  }) as api.NotificationChannel['type'];
  const cfg = await promptChannelConfig(type);
  const res = await api.createNotificationChannel({ name, type, config: cfg });
  if (res.error || !res.data?.channel) {
    logger.error(`Channel not created: ${res.error || 'unknown error'}`);
    return null;
  }
  logger.dim(`  Created channel ${res.data.channel.id}`);
  return res.data.channel.id;
}

/** Interactive advanced sub-prompts for a route, each gated by plan feature.
 * Mutates routeData; appends channel ids to link post-creation into channelLinks. */
async function runRouteAdvancedWizard(
  routeData: NonNullable<Parameters<typeof api.createRoute>[0]>,
  channelLinks: string[],
  primaryDestinationId: string,
): Promise<void> {
  // ---- Filter (ungated) ----
  const filterChoice = await select({
    message: 'Apply a filter?',
    choices: [
      { name: 'None', value: 'none' },
      { name: 'Pick an existing filter', value: 'pick' },
      { name: 'Create conditions inline', value: 'create' },
    ],
    default: 'none',
  });
  if (filterChoice === 'pick') {
    const items = (await api.getFilters()).data?.filters || [];
    if (items.length === 0) logger.dim('  No existing filters');
    else routeData.filterId = await select({ message: 'Filter:', choices: items.map((f) => ({ name: f.name, value: f.id })) });
  } else if (filterChoice === 'create') {
    const conditions = await promptFilterConditions();
    if (conditions.length > 0) {
      routeData.filterConditions = conditions;
      routeData.filterLogic = conditions.length > 1
        ? await select({ message: 'Combine conditions with:', choices: [{ name: 'AND', value: 'AND' }, { name: 'OR', value: 'OR' }], default: 'AND' }) as 'AND' | 'OR'
        : 'AND';
    }
  }

  // ---- Transform (transforms) ----
  await gatedPrompt('transforms', 'Transforms', async () => {
    const choice = await select({
      message: 'Apply a transform?',
      choices: [{ name: 'None', value: 'none' }, { name: 'Pick existing', value: 'pick' }, { name: 'Create new', value: 'create' }],
      default: 'none',
    });
    if (choice === 'pick') {
      const items = (await api.getTransforms()).data?.transforms || [];
      if (items.length === 0) logger.dim('  No existing transforms');
      else routeData.transformId = await select({ message: 'Transform:', choices: items.map((t) => ({ name: t.name, value: t.id })) });
    } else if (choice === 'create') {
      const id = await createTransformInline();
      if (id) routeData.transformId = id;
    }
  }, undefined);

  // ---- Validation schema (schemas) ----
  await gatedPrompt('schemas', 'Validation schemas', async () => {
    const choice = await select({
      message: 'Validate payloads against a JSON schema?',
      choices: [{ name: 'None', value: 'none' }, { name: 'Pick existing', value: 'pick' }, { name: 'Create new', value: 'create' }],
      default: 'none',
    });
    if (choice === 'pick') {
      const items = (await api.getSchemas()).data?.schemas || [];
      if (items.length === 0) logger.dim('  No existing schemas');
      else routeData.schemaId = await select({ message: 'Schema:', choices: items.map((s) => ({ name: s.name, value: s.id })) });
    } else if (choice === 'create') {
      const id = await createSchemaInline();
      if (id) routeData.schemaId = id;
    }
  }, undefined);

  // ---- Failover destinations (failover) ----
  await gatedPrompt('failover', 'Failover destinations', async () => {
    const dests = ((await api.getDestinations()).data?.destinations || []).filter((d) => d.id !== primaryDestinationId);
    if (dests.length === 0) { logger.dim('  No other destinations to fail over to'); return; }
    const picked = await checkbox({
      message: 'Failover destinations (max 3):',
      choices: dests.map((d) => ({ name: `${d.name}${d.url ? ` (${d.url})` : ''}`, value: d.id })),
    });
    if (picked.length > 0) {
      routeData.failoverDestinationIds = picked.slice(0, 3);
      routeData.failoverAfterAttempts = (await number({ message: 'Fail over after N attempts (1-5):', min: 1, max: 5, default: 3, required: false })) ?? 3;
    }
  }, undefined);

  // ---- Circuit breaker (circuit_breaker) ----
  await gatedPrompt('circuit_breaker', 'Circuit breaker', async () => {
    if (await confirm({ message: 'Configure a circuit breaker?', default: false })) {
      const failures = await number({ message: 'Open circuit after N consecutive failures:', min: 1, max: 100, default: 5, required: false });
      if (failures) routeData.circuitFailureThreshold = failures;
      const cooldown = await number({ message: 'Cooldown before probing again (seconds):', min: 1, max: 86400, default: 60, required: false });
      if (cooldown) routeData.circuitCooldownSeconds = cooldown;
      const probes = await number({ message: 'Successful probes required to close circuit:', min: 1, max: 100, default: 1, required: false });
      if (probes) routeData.circuitProbeSuccessThreshold = probes;
    }
  }, undefined);

  // ---- Notifications: email (ungated) ----
  if (await confirm({ message: 'Send failure notifications by email?', default: false })) {
    const emails = await input({ message: 'Notify emails (comma-separated):' });
    const list = emails.split(',').map((e) => e.trim()).filter(Boolean);
    if (list.length > 0) {
      routeData.notifyEmails = list.join(',');
      routeData.notifyOnFailure = true;
      routeData.notifyOnRecovery = true;
    }
  }

  // ---- Notifications: channels (notification_channels) ----
  await gatedPrompt('notification_channels', 'Notification channels', async () => {
    const choice = await select({
      message: 'Notify a channel (Slack, webhook, …) on failure?',
      choices: [{ name: 'None', value: 'none' }, { name: 'Pick existing', value: 'pick' }, { name: 'Create new', value: 'create' }],
      default: 'none',
    });
    if (choice === 'pick') {
      const items = (await api.getNotificationChannels()).data?.channels || [];
      if (items.length === 0) logger.dim('  No existing channels');
      else channelLinks.push(await select({ message: 'Channel:', choices: items.map((ch) => ({ name: `${ch.name} (${ch.type})`, value: ch.id })) }));
    } else if (choice === 'create') {
      const id = await createChannelInline();
      if (id) channelLinks.push(id);
    }
  }, undefined);
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

export async function routesListCommand(options: { json?: boolean }): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching routes...');
  const result = await api.getRoutes();

  if (result.error) {
    spinner.fail('Failed to fetch routes');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const routes = result.data?.routes || [];

  if (options.json) {
    console.log(JSON.stringify(routes, null, 2));
    return;
  }

  if (routes.length === 0) {
    logger.info('No routes found');
    logger.dim('Create one with "hookbase routes create"');
    return;
  }

  logger.table(
    ['ID', 'Name', 'Source', 'Destination', 'Priority', 'Status', 'Deliveries'],
    routes.map((r: any) => [
      r.id || '-',
      r.name || '-',
      r.source_name || r.sourceName || r.source_id || r.sourceId || '-',
      r.destination_name || r.destinationName || r.destination_id || r.destinationId || '-',
      String(r.priority ?? 0),
      (r.is_active ?? r.isActive) ? logger.green('active') : logger.dimText('inactive'),
      String(r.delivery_count ?? r.deliveryCount ?? 0),
    ])
  );
}

/** Resolve advanced route flags into routeData (+ channel links), gated by plan
 * feature. Returns false to abort (feature denied or an id/slug didn't resolve). */
async function applyRouteAdvancedFlags(
  options: {
    transform?: string; schema?: string; filter?: string;
    failover?: string; failoverAfter?: string;
    circuitCooldown?: string; circuitFailures?: string;
    notifyEmails?: string; notifyChannel?: string[];
  },
  routeData: NonNullable<Parameters<typeof api.createRoute>[0]>,
  channelLinks: string[],
  primaryDestinationId: string,
): Promise<boolean> {
  if (options.transform !== undefined) {
    if (!ensureFeature('transforms', 'Transforms')) return false;
    const id = resolveOne(options.transform, (await api.getTransforms()).data?.transforms || []);
    if (!id) { logger.error(`Transform "${options.transform}" not found`); return false; }
    routeData.transformId = id;
  }
  if (options.schema !== undefined) {
    if (!ensureFeature('schemas', 'Validation schemas')) return false;
    const id = resolveOne(options.schema, (await api.getSchemas()).data?.schemas || []);
    if (!id) { logger.error(`Schema "${options.schema}" not found`); return false; }
    routeData.schemaId = id;
  }
  if (options.filter !== undefined) {
    const id = resolveOne(options.filter, (await api.getFilters()).data?.filters || []);
    if (!id) { logger.error(`Filter "${options.filter}" not found`); return false; }
    routeData.filterId = id;
  }
  if (options.failover !== undefined) {
    if (!ensureFeature('failover', 'Failover destinations')) return false;
    const dests = (await api.getDestinations()).data?.destinations || [];
    const ids: string[] = [];
    for (const token of options.failover.split(',').map((s) => s.trim()).filter(Boolean)) {
      const id = resolveOne(token, dests);
      if (!id) { logger.error(`Failover destination "${token}" not found`); return false; }
      if (id === primaryDestinationId) { logger.error('Failover destinations cannot include the primary destination'); return false; }
      ids.push(id);
    }
    if (ids.length > 0) {
      routeData.failoverDestinationIds = ids.slice(0, 3);
      routeData.failoverAfterAttempts = options.failoverAfter ? parseInt(options.failoverAfter, 10) : 3;
    }
  } else if (options.failoverAfter !== undefined) {
    routeData.failoverAfterAttempts = parseInt(options.failoverAfter, 10);
  }
  if (options.circuitCooldown !== undefined || options.circuitFailures !== undefined) {
    if (!ensureFeature('circuit_breaker', 'Circuit breaker')) return false;
    if (options.circuitCooldown !== undefined) routeData.circuitCooldownSeconds = parseInt(options.circuitCooldown, 10);
    if (options.circuitFailures !== undefined) routeData.circuitFailureThreshold = parseInt(options.circuitFailures, 10);
  }
  if (options.notifyEmails !== undefined) {
    const list = options.notifyEmails.split(',').map((e) => e.trim()).filter(Boolean);
    if (list.length > 0) {
      routeData.notifyEmails = list.join(',');
      routeData.notifyOnFailure = true;
      routeData.notifyOnRecovery = true;
    }
  }
  if (options.notifyChannel && options.notifyChannel.length > 0) {
    if (!ensureFeature('notification_channels', 'Notification channels')) return false;
    const items = (await api.getNotificationChannels()).data?.channels || [];
    for (const token of options.notifyChannel) {
      const id = resolveOne(token, items);
      if (!id) { logger.error(`Notification channel "${token}" not found`); return false; }
      channelLinks.push(id);
    }
  }
  return true;
}

export async function routesCreateCommand(options: {
  name?: string;
  source?: string;
  destination?: string;
  priority?: string;
  transform?: string;
  schema?: string;
  filter?: string;
  failover?: string;
  failoverAfter?: string;
  circuitCooldown?: string;
  circuitFailures?: string;
  notifyEmails?: string;
  notifyChannel?: string[];
  yes?: boolean;
  json?: boolean;
}): Promise<void> {
  requireAuth();

  let name = options.name;
  let sourceId = options.source;
  let destinationId = options.destination;
  let priority = options.priority ? parseInt(options.priority, 10) : 0;

  const routeData: NonNullable<Parameters<typeof api.createRoute>[0]> = { name: '', sourceId: '', destinationId: '' };
  const channelLinks: string[] = [];

  const anyAdvancedFlag =
    options.transform !== undefined || options.schema !== undefined ||
    options.filter !== undefined || options.failover !== undefined ||
    options.failoverAfter !== undefined || options.circuitCooldown !== undefined ||
    options.circuitFailures !== undefined || options.notifyEmails !== undefined ||
    (options.notifyChannel !== undefined && options.notifyChannel.length > 0);

  // Interactive mode - wrapped in try-catch to handle Ctrl+C gracefully
  try {
    // Fetch sources/destinations up front — used both to prompt and to resolve
    // id/slug/name flags to real ids (so failover exclusion + create work).
    const [sourcesResult, destinationsResult] = await Promise.all([api.getSources(), api.getDestinations()]);
    const sources = sourcesResult.data?.sources || [];
    const destinations = destinationsResult.data?.destinations || [];

    if (sources.length === 0) { logger.error('No sources found. Create a source first with "hookbase sources create"'); return; }
    if (destinations.length === 0) { logger.error('No destinations found. Create a destination first with "hookbase destinations create"'); return; }

    name = name || await input({ message: 'Route name:', validate: (value) => value.length > 0 || 'Name is required' });

    if (sourceId) {
      const rid = resolveOne(sourceId, sources);
      if (!rid) { logger.error(`Source "${sourceId}" not found`); return; }
      sourceId = rid;
    } else {
      sourceId = await select({ message: 'Select source:', choices: sources.map((s) => ({ name: `${s.name} (${s.slug})`, value: s.id })) });
    }

    if (destinationId) {
      const rid = resolveOne(destinationId, destinations);
      if (!rid) { logger.error(`Destination "${destinationId}" not found`); return; }
      destinationId = rid;
    } else {
      destinationId = await select({ message: 'Select destination:', choices: destinations.map((d) => ({ name: `${d.name} (${d.url})`, value: d.id })) });
    }

    // Basic-path priority prompt (interactive only, no --priority given).
    if (!options.name && options.priority === undefined) {
      const setPriority = await confirm({ message: 'Set a custom priority? (default is 0)', default: false });
      if (setPriority) {
        const priorityInput = await input({ message: 'Priority (higher = runs first):', default: '0', validate: (value) => !isNaN(parseInt(value, 10)) || 'Must be a number' });
        priority = parseInt(priorityInput, 10);
      }
    }

    // Advanced flags (scripting).
    if (anyAdvancedFlag) {
      await loadFeatures();
      if (!await applyRouteAdvancedFlags(options, routeData, channelLinks, destinationId!)) return;
    }

    // Advanced wizard (interactive) — skipped when -n, --yes, or advanced flags given.
    if (await askAdvanced('route', options.yes || anyAdvancedFlag || !!options.name)) {
      await loadFeatures();
      await runRouteAdvancedWizard(routeData, channelLinks, destinationId!);
    }

    if (!options.yes && !options.name) {
      const confirmed = await confirm({ message: `Create route "${name}"?`, default: true });
      if (!confirmed) { logger.info('Cancelled'); return; }
    }
  } catch (error) {
    if (isPromptCancelled(error)) {
      logger.log('');
      logger.info('Cancelled');
      return;
    }
    throw error;
  }

  routeData.name = name!;
  routeData.sourceId = sourceId!;
  routeData.destinationId = destinationId!;
  routeData.priority = priority;

  const spinner = logger.spinner('Creating route...');
  const result = await api.createRoute(routeData);

  if (result.error) {
    spinner.fail('Failed to create route');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Route created');

  const route = result.data?.route;

  // Link any notification channels chosen during advanced setup.
  if (route && channelLinks.length > 0) {
    for (const channelId of channelLinks) {
      const linkRes = await api.linkNotificationChannel(channelId, { routeId: route.id, notifyOnFailure: true, notifyOnRecovery: true });
      if (linkRes.error) logger.warn(`Could not link channel ${channelId}: ${linkRes.error}`);
    }
  }

  if (options.json) {
    console.log(JSON.stringify(route, null, 2));
    return;
  }

  if (route) {
    logger.log('');
    logger.box('Route Created', [
      `ID:          ${route.id}`,
      `Name:        ${route.name}`,
      `Source:      ${route.source_name || (route as any).sourceName || route.source_id || (route as any).sourceId}`,
      `Destination: ${route.destination_name || (route as any).destinationName || route.destination_id || (route as any).destinationId}`,
      `Priority:    ${route.priority}`,
    ].join('\n'));
  }
}

export async function routesGetCommand(
  routeId: string,
  options: { json?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching route...');
  const result = await api.getRoute(routeId);

  if (result.error) {
    spinner.fail('Failed to fetch route');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const route: any = result.data?.route;

  if (options.json) {
    console.log(JSON.stringify(route, null, 2));
    return;
  }

  if (!route) {
    logger.error('Route not found');
    return;
  }

  logger.log('');
  logger.log(logger.bold('Route Details'));
  logger.log('');
  logger.log(`ID:          ${route.id}`);
  logger.log(`Name:        ${route.name}`);
  logger.log(`Source:      ${route.source_name || route.sourceName || route.source_id || route.sourceId}`);
  logger.log(`Destination: ${route.destination_name || route.destinationName || route.destination_id || route.destinationId}`);
  logger.log(`Priority:    ${route.priority}`);
  logger.log(`Status:      ${(route.is_active ?? route.isActive) ? logger.green('active') : logger.red('inactive')}`);
  if (route.filter_id || route.filterId) logger.log(`Filter:      ${route.filter_id || route.filterId}`);
  if (route.transform_id || route.transformId) logger.log(`Transform:   ${route.transform_id || route.transformId}`);
  logger.log(`Deliveries:  ${route.delivery_count ?? route.deliveryCount ?? 0}`);
  logger.log('');
}

export async function routesUpdateCommand(
  routeId: string,
  options: {
    name?: string;
    source?: string;
    destination?: string;
    priority?: string;
    active?: boolean;
    inactive?: boolean;
    json?: boolean;
  }
): Promise<void> {
  requireAuth();

  const updateData: Parameters<typeof api.updateRoute>[1] = {};

  if (options.name) updateData.name = options.name;
  if (options.source) updateData.sourceId = options.source;
  if (options.destination) updateData.destinationId = options.destination;
  if (options.priority) updateData.priority = parseInt(options.priority, 10);
  if (options.active) updateData.isActive = true;
  if (options.inactive) updateData.isActive = false;

  if (Object.keys(updateData).length === 0) {
    logger.error('No updates specified. Use --name, --source, --destination, --priority, --active, or --inactive');
    return;
  }

  const spinner = logger.spinner('Updating route...');
  const result = await api.updateRoute(routeId, updateData);

  if (result.error) {
    spinner.fail('Failed to update route');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Route updated');

  if (options.json) {
    console.log(JSON.stringify(result.data?.route, null, 2));
  }
}

export async function routesDeleteCommand(
  routeId: string,
  options: { yes?: boolean; json?: boolean }
): Promise<void> {
  requireAuth();

  try {
    if (!options.yes) {
      const confirmed = await confirm({
        message: `Are you sure you want to delete route ${routeId}? This cannot be undone.`,
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

  const spinner = logger.spinner('Deleting route...');
  const result = await api.deleteRoute(routeId);

  if (result.error) {
    spinner.fail('Failed to delete route');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Route deleted');

  if (options.json) {
    console.log(JSON.stringify({ success: true, routeId }, null, 2));
  }
}

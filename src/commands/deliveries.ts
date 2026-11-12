import { confirm, checkbox } from '@inquirer/prompts';
import * as api from '../lib/api.js';
import * as logger from '../lib/logger.js';

import { requireAuth } from '../lib/requireAuth.js';
import { formatOutput } from '../lib/output.js';
import { readJsonArg, isJsonObject } from '../lib/parseJson.js';

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString();
}

/** Colour an inbound delivery status (api.DELIVERY_STATUSES). */
export function formatStatus(status: string): string {
  switch (status) {
    case 'delivered':
      return logger.green('delivered');
    case 'success':
      return logger.green('success');
    case 'failed':
      return logger.red('failed');
    case 'schema_failed':
      return logger.red('schema_failed');
    case 'failed_over':
      return logger.yellow('failed_over');
    case 'pending':
      return logger.yellow('pending');
    case 'awaiting_retry':
      return logger.yellow('awaiting_retry');
    case 'throttled':
      return logger.yellow('throttled');
    case 'held':
      // Waiting while the route's circuit is open; fails at holdExpiresAt if it never closes.
      return logger.cyan('held');
    case 'retrying':
      // Pre-0134 value, kept for older rows.
      return logger.yellow('retrying');
    default:
      return logger.dimText(status);
  }
}

export async function deliveriesListCommand(options: {
  limit?: string;
  event?: string;
  route?: string;
  destination?: string;
  status?: string;
  json?: boolean;
  xml?: boolean;
  yaml?: boolean;
}): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching deliveries...');
  const result = await api.getDeliveries({
    limit: options.limit ? parseInt(options.limit, 10) : 50,
    eventId: options.event,
    routeId: options.route,
    destinationId: options.destination,
    status: options.status,
  });

  if (result.error) {
    spinner.fail('Failed to fetch deliveries');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const deliveries = result.data?.deliveries || [];

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(deliveries, options.xml, options.yaml));
    return;
  }

  if (deliveries.length === 0) {
    logger.info('No deliveries found');
    return;
  }

  logger.table(
    ['ID', 'Destination', 'Status', 'Response', 'Attempts', 'Time', 'Created'],
    deliveries.map((d: any) => [
      d.id,
      d.destination_name || d.destinationName || d.destination_id || d.destinationId || '-',
      formatStatus(d.status),
      (d.response_status ?? d.responseStatus) ? String(d.response_status ?? d.responseStatus) : '-',
      `${d.attempt_count ?? d.attemptCount ?? 0}/${d.max_attempts ?? d.maxAttempts ?? 5}`,
      (d.latencyMs ?? d.response_time_ms ?? d.responseTimeMs) ? `${d.latencyMs ?? d.response_time_ms ?? d.responseTimeMs}ms` : '-',
      formatDate(d.created_at || d.createdAt || ''),
    ])
  );

  logger.log('');
  // The list returns no total; a full page means there may be more.
  const limit = result.data?.limit;
  logger.dim(
    limit && deliveries.length >= limit
      ? `Showing the latest ${deliveries.length} deliveries (--limit, max 100)`
      : `Showing ${deliveries.length} deliveries`
  );
}

export async function deliveriesGetCommand(
  deliveryId: string,
  options: { json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching delivery...');
  const result = await api.getDelivery(deliveryId);

  if (result.error) {
    spinner.fail('Failed to fetch delivery');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const delivery: any = result.data?.delivery;

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(delivery, options.xml, options.yaml));
    return;
  }

  if (!delivery) {
    logger.error('Delivery not found');
    return;
  }

  const respStatus = delivery.response_status ?? delivery.responseStatus;
  const respTimeMs = delivery.latencyMs ?? delivery.response_time_ms ?? delivery.responseTimeMs;
  const errorMsg = delivery.error_message ?? delivery.errorMessage;
  const nextRetry = delivery.next_retry_at || delivery.nextRetryAt;
  const holdExpiresAt = delivery.holdExpiresAt;
  const createdAt = delivery.created_at || delivery.createdAt;
  const completedAt = delivery.deliveredAt || delivery.completed_at || delivery.completedAt;
  const responseBody = delivery.response_body ?? delivery.responseBody;

  logger.log('');
  logger.log(logger.bold('Delivery Details'));
  logger.log('');
  logger.log(`ID:            ${delivery.id}`);
  logger.log(`Event:         ${delivery.event_id || delivery.eventId}`);
  logger.log(`Route:         ${delivery.route_name || delivery.routeName || delivery.route_id || delivery.routeId || '-'}`);
  logger.log(`Destination:   ${delivery.destination_name || delivery.destinationName || delivery.destination_id || delivery.destinationId || '-'}`);
  if (delivery.destinationUrl) logger.log(`URL:           ${delivery.destinationUrl}`);
  logger.log(`Status:        ${formatStatus(delivery.status)}`);
  logger.log(`Attempts:      ${delivery.attempt_count ?? delivery.attemptCount ?? 0} of ${delivery.max_attempts ?? delivery.maxAttempts ?? 5}`);

  if (respStatus) {
    const statusColor = respStatus >= 200 && respStatus < 300
      ? logger.green
      : respStatus >= 400
        ? logger.red
        : logger.yellow;
    logger.log(`Response:      ${statusColor(String(respStatus))}`);
  }

  if (respTimeMs) {
    logger.log(`Response Time: ${respTimeMs}ms`);
  }

  if (errorMsg) {
    logger.log(`Error:         ${logger.red(errorMsg)}`);
  }

  if (nextRetry) {
    logger.log(`Next Retry:    ${formatDate(nextRetry)}`);
  }

  if (holdExpiresAt) {
    logger.log(`Held Until:    ${formatDate(holdExpiresAt)} ${logger.dimText('(fails then if the circuit is still open)')}`);
  }

  logger.log(`Created:       ${formatDate(createdAt || '')}`);

  if (completedAt) {
    logger.log(`Delivered:     ${formatDate(completedAt)}`);
  }

  if (responseBody) {
    logger.log('');
    logger.log(logger.bold('Response Body:'));
    try {
      const parsed = JSON.parse(responseBody);
      logger.log(JSON.stringify(parsed, null, 2));
    } catch {
      logger.log(responseBody);
    }
  }
}

/** Parse repeatable `--header name=value` flags. */
export function parseHeaderFlags(values: string[] | undefined): { ok: true; headers: Record<string, string> } | { ok: false; error: string } {
  const headers: Record<string, string> = {};
  for (const raw of values ?? []) {
    const eq = raw.indexOf('=');
    const name = eq > 0 ? raw.slice(0, eq).trim() : '';
    if (!name) {
      return { ok: false, error: `--header "${raw}" must be name=value` };
    }
    headers[name] = raw.slice(eq + 1);
  }
  return { ok: true, headers };
}

/** Readable text for the replay error codes (api/src/routes/deliveries.ts, utils/payloadPatch.ts). */
export function replayErrorMessage(result: { error?: string; code?: string; status: number }, destination?: string): string {
  switch (result.code) {
    case 'TRANSIENT_REPLAY_DISABLED':
      return 'This event was received in transient mode, so its payload was never stored and it cannot be replayed.';
    case 'PAYLOAD_NOT_FOUND':
      return 'The original payload is no longer stored (it may be past retention), so there is nothing to patch. Use --payload to send a full payload instead.';
    case 'PAYLOAD_EDIT_AMBIGUOUS':
      return 'Use either --patch or --payload, not both.';
    case 'PATCH_INVALID':
      return '--patch must be a JSON object (an RFC 7386 merge patch, e.g. \'{"amount": 100}\').';
    case 'PAYLOAD_NOT_JSON_OBJECT':
      return 'The stored payload is not a JSON object, so it cannot be patched. Use --payload to replace it instead.';
    case 'PATCH_TOUCHES_ENCRYPTED_FIELD':
      return `${result.error ?? 'The patch changes an encrypted field.'} Leave encrypted fields out of --patch.`;
    case 'DESTINATION_OVERRIDE_NOT_FOUND':
      return `Destination "${destination ?? ''}" was not found in this organization. Use a destination id or slug.`;
    case 'HEADERS_OVERRIDE_INVALID':
      return 'Each --header must be name=value.';
    case 'HEADERS_OVERRIDE_FORBIDDEN':
      // The API message names the header.
      return `${(result.error ?? '').replace(/^headersOverride/, '--header')}. Hookbase sets that header itself.`;
    case 'HEADERS_OVERRIDE_TOO_LARGE':
      return 'At most 50 --header values are allowed.';
  }
  // A 404 can be the delivery or its event ("Event not found"): say what the API said.
  if (result.status === 404) return result.error ?? 'Not found';
  if (result.status === 403 && /events:send/.test(result.error ?? '')) {
    return `${result.error}. Replaying into a bridge destination, or editing what one receives, also needs the events:send permission.`;
  }
  return result.error ?? 'Replay failed';
}

export async function deliveriesReplayCommand(
  deliveryId: string,
  options: {
    patch?: string;
    payload?: string;
    destination?: string;
    header?: string[];
    yes?: boolean;
    json?: boolean;
    xml?: boolean;
    yaml?: boolean;
  }
): Promise<void> {
  requireAuth();

  if (options.patch !== undefined && options.payload !== undefined) {
    logger.error('Use either --patch or --payload, not both.');
    return;
  }

  const replay: api.ReplayDeliveryOptions = {};
  if (options.patch !== undefined) {
    const parsed = readJsonArg(options.patch, '--patch');
    if (!parsed.ok) { logger.error(parsed.error); return; }
    if (!isJsonObject(parsed.value)) {
      logger.error('--patch must be a JSON object (an RFC 7386 merge patch). Use --payload to replace the whole payload.');
      return;
    }
    replay.payloadPatch = parsed.value;
  }
  if (options.payload !== undefined) {
    const parsed = readJsonArg(options.payload, '--payload');
    if (!parsed.ok) { logger.error(parsed.error); return; }
    replay.modifiedPayload = parsed.value;
  }
  if (options.destination !== undefined) {
    if (!options.destination.trim()) { logger.error('--destination needs a destination id or slug'); return; }
    replay.destinationOverride = options.destination.trim();
  }
  const headers = parseHeaderFlags(options.header);
  if (!headers.ok) { logger.error(headers.error); return; }
  if (Object.keys(headers.headers).length > 0) replay.headersOverride = headers.headers;

  if (!options.yes) {
    const edits: string[] = [];
    if (replay.payloadPatch) edits.push('a patched payload');
    if (replay.modifiedPayload !== undefined) edits.push('a replaced payload');
    if (replay.headersOverride) edits.push(`${Object.keys(replay.headersOverride).length} header override(s)`);
    if (replay.destinationOverride) edits.push(`destination "${replay.destinationOverride}"`);
    const confirmed = await confirm({
      message: `Replay delivery ${deliveryId}${edits.length ? ` with ${edits.join(', ')}` : ''}?`,
      default: true,
    });
    if (!confirmed) {
      logger.info('Cancelled');
      return;
    }
  }

  const spinner = logger.spinner('Replaying delivery...');
  const result = await api.replayDelivery(deliveryId, replay);

  if (result.error || !result.data) {
    spinner.fail('Failed to replay delivery');
    logger.error(replayErrorMessage(result, replay.destinationOverride));
    return;
  }

  const data = result.data;
  spinner.succeed(data.message || 'Replay queued');

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(data, options.xml, options.yaml));
    return;
  }

  logger.log('');
  logger.log(`New delivery:  ${data.deliveryId}`);
  logger.log(`Destination:   ${data.targetDestinationId}${data.destinationOverridden ? logger.yellow(' (overridden)') : ''}`);
  if (data.modified) {
    logger.log(`Payload:       ${replay.payloadPatch ? 'patched' : 'replaced'}`);
  }
  if (data.headersOverridden) {
    logger.log(`Headers:       ${Object.keys(replay.headersOverride ?? {}).join(', ') || 'overridden'}`);
  }
  logger.log('');
  logger.dim(`Track it with: hookbase deliveries get ${data.deliveryId}`);
}

export async function deliveriesBulkReplayCommand(options: {
  status?: string;
  limit?: string;
  yes?: boolean;
  json?: boolean;
  xml?: boolean;
  yaml?: boolean;
}): Promise<void> {
  requireAuth();

  // First fetch failed deliveries
  const spinner = logger.spinner('Fetching failed deliveries...');
  const listResult = await api.getDeliveries({
    status: options.status || 'failed',
    limit: options.limit ? parseInt(options.limit, 10) : 50,
  });

  if (listResult.error) {
    spinner.fail('Failed to fetch deliveries');
    logger.error(listResult.error);
    return;
  }

  spinner.stop();

  const deliveries = listResult.data?.deliveries || [];

  if (deliveries.length === 0) {
    logger.info('No failed deliveries found');
    return;
  }

  // Interactive selection
  let selectedIds: string[];

  if (options.yes) {
    selectedIds = deliveries.map(d => d.id);
  } else {
    selectedIds = await checkbox({
      message: 'Select deliveries to replay:',
      choices: deliveries.map((d: any) => ({
        name: `${d.id} - ${d.destination_name || d.destinationName || d.destination_id || d.destinationId || '-'} - ${d.error_message || d.errorMessage || 'Failed'}`,
        value: d.id,
        checked: true,
      })),
    });

    if (selectedIds.length === 0) {
      logger.info('No deliveries selected');
      return;
    }

    const confirmed = await confirm({
      message: `Replay ${selectedIds.length} deliveries?`,
      default: true,
    });
    if (!confirmed) {
      logger.info('Cancelled');
      return;
    }
  }

  const replaySpinner = logger.spinner(`Replaying ${selectedIds.length} deliveries...`);
  const result = await api.bulkReplayDeliveries(selectedIds);

  if (result.error) {
    replaySpinner.fail('Failed to replay deliveries');
    logger.error(result.error);
    return;
  }

  replaySpinner.succeed(result.data?.message || 'Bulk replay completed');

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data, options.xml, options.yaml));
    return;
  }

  logger.log('');
  logger.log(`Queued:  ${logger.green(String(result.data?.queued ?? 0))}`);
  if (result.data?.skipped) {
    logger.log(`Skipped: ${logger.yellow(String(result.data.skipped))}`);
    for (const r of result.data.results ?? []) {
      if (r.status === 'skipped') logger.dim(`  ${r.originalId}: ${r.reason || 'skipped'}`);
    }
  }
  // Ids the API did not find are in neither count (e.g. deleted since the list was read).
  const answered = new Set((result.data?.results ?? []).map((r) => r.originalId));
  const missing = selectedIds.filter((id) => !answered.has(id));
  if (result.data?.results && missing.length > 0) {
    logger.log(`Not found: ${logger.yellow(String(missing.length))}`);
    for (const id of missing) logger.dim(`  ${id}`);
  }
}

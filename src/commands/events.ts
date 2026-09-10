import * as api from '../lib/api.js';
import * as logger from '../lib/logger.js';
import { parseJsonField } from '../lib/parseJson.js';

import { requireAuth } from '../lib/requireAuth.js';
import { formatOutput } from '../lib/output.js';
import { buildStreamRequest, streamForever, printInboundFrame } from '../lib/sseStream.js';

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString();
}

function parseHeaders(headers: unknown): Record<string, string> {
  return parseJsonField(headers, {} as Record<string, string>);
}

function formatStatus(status?: string): string {
  switch (status) {
    case 'delivered':
      return logger.green('delivered');
    case 'failed':
      return logger.red('failed');
    case 'pending':
      return logger.yellow('pending');
    case 'partial':
      return logger.yellow('partial');
    case 'no_routes':
      return logger.dimText('no routes');
    default:
      return logger.dimText(status || 'unknown');
  }
}

export async function eventsListCommand(options: {
  limit?: string;
  offset?: string;
  source?: string;
  status?: string;
  json?: boolean;
  xml?: boolean;
  yaml?: boolean;
}): Promise<void> {
  requireAuth();

  const limit = options.limit ? parseInt(options.limit, 10) : 50;
  const offset = options.offset ? parseInt(options.offset, 10) : 0;

  const spinner = logger.spinner('Fetching events...');
  const result = await api.getEvents({
    limit,
    offset,
    sourceId: options.source,
    status: options.status,
  });

  if (result.error) {
    spinner.fail('Failed to fetch events');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const events = result.data?.events || [];

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(events, options.xml, options.yaml));
    return;
  }

  if (events.length === 0) {
    logger.info('No events found');
    return;
  }

  logger.table(
    ['ID', 'Source', 'Type', 'Status', 'Received'],
    events.map(e => [
      e.id,
      e.source_name || e.sourceName || e.source_slug || e.sourceSlug || e.source_id || e.sourceId || '-',
      e.event_type || e.eventType || e.method || '-',
      formatStatus(e.status),
      formatDate(e.received_at || e.receivedAt || ''),
    ])
  );

  const total = result.data?.total ?? events.length;
  logger.log('');
  logger.dim(`Showing ${offset + 1}-${offset + events.length} of ${total} events`);
  if (result.data?.hasMore) {
    logger.dim(`Next page: hookbase events list --offset ${offset + limit}${options.limit ? ` --limit ${limit}` : ''}`);
  }
}

export async function eventsGetCommand(
  eventId: string,
  options: { json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching event...');
  const result = await api.getEvent(eventId);

  if (result.error) {
    spinner.fail('Failed to fetch event');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const event = result.data?.event;

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data, options.xml, options.yaml));
    return;
  }

  if (!event) {
    logger.error('Event not found');
    return;
  }

  logger.log('');
  logger.log(logger.bold('Event Details'));
  logger.log('');
  logger.log(`ID:        ${event.id}`);
  logger.log(`Source:    ${event.source_name || event.sourceName || event.source_id || event.sourceId || '-'}`);
  logger.log(`Type:      ${event.event_type || event.eventType || '-'}`);
  logger.log(`Method:    ${event.method || '-'}`);
  logger.log(`Path:      ${event.path || '/'}`);
  logger.log(`Status:    ${formatStatus(event.status)}`);
  logger.log(`Size:      ${event.payload_size ?? event.payloadSize ?? 0} bytes`);
  const sigValid = event.signature_valid ?? event.signatureValid;
  logger.log(`Signature: ${sigValid === true ? logger.green('valid') : sigValid === false ? logger.red('invalid') : logger.dimText('not verified')}`);
  logger.log(`Received:  ${formatDate(event.received_at || event.receivedAt || '')}`);

  const headers = parseHeaders(event.headers);
  if (Object.keys(headers).length > 0) {
    logger.log('');
    logger.log(logger.bold('Headers:'));
    for (const [key, value] of Object.entries(headers)) {
      logger.log(`  ${key}: ${value}`);
    }
  }

  if (result.data?.transient) {
    logger.log('');
    logger.log(logger.dimText('Transient event - payload was not stored (compliance mode)'));
  } else if (result.data?.payload) {
    logger.log('');
    logger.log(logger.bold('Payload:'));
    logger.log(JSON.stringify(result.data.payload, null, 2));
  }

  const deliveries = result.data?.deliveries;
  if (deliveries && deliveries.length > 0) {
    logger.log('');
    logger.log(logger.bold('Deliveries:'));
    logger.table(
      ['ID', 'Destination', 'Status', 'Response', 'Time'],
      deliveries.map((d: any) => [
        d.id,
        d.destination_name || d.destinationName || d.destination_id || d.destinationId || '-',
        d.status === 'delivered' ? logger.green(d.status) : (d.status === 'failed' || d.status === 'failed_over' || d.status === 'schema_failed') ? logger.red(d.status) : logger.yellow(d.status),
        (d.response_status ?? d.responseStatus) ? String(d.response_status ?? d.responseStatus) : '-',
        (d.response_time_ms ?? d.responseTimeMs) ? `${d.response_time_ms ?? d.responseTimeMs}ms` : '-',
      ])
    );
  }
}

export async function eventsFollowCommand(options: {
  source?: string;
}): Promise<void> {
  requireAuth();

  logger.info('Connecting to event stream...');
  logger.dim('Press Ctrl+C to stop');
  logger.log('');

  const { url, getHeaders } = buildStreamRequest('stream');
  if (options.source) {
    url.searchParams.set('sourceId', options.source);
  }

  await streamForever(url, getHeaders, printInboundFrame, () => {
    logger.success('Connected! Waiting for events...');
    logger.log('');
  });
}

import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';

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

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString();
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
  source?: string;
  status?: string;
  json?: boolean;
}): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching events...');
  const result = await api.getEvents({
    limit: options.limit ? parseInt(options.limit, 10) : 50,
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

  if (options.json) {
    console.log(JSON.stringify(events, null, 2));
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

  logger.log('');
  logger.dim(`Showing ${events.length} of ${result.data?.total || events.length} events`);
}

export async function eventsGetCommand(
  eventId: string,
  options: { json?: boolean }
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

  if (options.json) {
    console.log(JSON.stringify(event, null, 2));
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

  if (event.headers && Object.keys(event.headers).length > 0) {
    logger.log('');
    logger.log(logger.bold('Headers:'));
    for (const [key, value] of Object.entries(event.headers)) {
      logger.log(`  ${key}: ${value}`);
    }
  }

  if (event.payload) {
    logger.log('');
    logger.log(logger.bold('Payload:'));
    logger.log(JSON.stringify(event.payload, null, 2));
  }

  if (event.deliveries && event.deliveries.length > 0) {
    logger.log('');
    logger.log(logger.bold('Deliveries:'));
    logger.table(
      ['ID', 'Destination', 'Status', 'Response', 'Time'],
      event.deliveries.map((d: any) => [
        d.id,
        d.destination_name || d.destinationName || d.destination_id || d.destinationId || '-',
        d.status === 'delivered' ? logger.green(d.status) : (d.status === 'failed' || d.status === 'failed_over' || d.status === 'schema_failed') ? logger.red(d.status) : logger.yellow(d.status),
        (d.response_status ?? d.responseStatus) ? String(d.response_status ?? d.responseStatus) : '-',
        (d.response_time_ms ?? d.responseTimeMs) ? `${d.response_time_ms ?? d.responseTimeMs}ms` : '-',
      ])
    );
  }
}

/** One decoded SSE frame. */
interface SseFrame {
  id?: string;
  event: string;
  data: string;
}

/**
 * Splits an SSE byte stream into frames. The previous implementation looked
 * only at `data:` lines, which discarded the `event:` name the server uses to
 * say *what* happened — so even against the right URL it could never have
 * matched anything.
 */
async function* readSseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Frames are separated by a blank line. Tolerate CRLF: some proxies rewrite
    // the line endings on the way through.
    let boundary: RegExpMatchArray | null;
    while ((boundary = buffer.match(/\r?\n\r?\n/)) !== null) {
      const raw = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index! + boundary[0].length);

      let id: string | undefined;
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith('id:')) id = line.slice(3).trim();
        else if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      }
      if (dataLines.length > 0) {
        yield { id, event, data: dataLines.join('\n') };
      }
    }
  }
}

/** Renders one stream frame. Transport chatter is silently skipped. */
function printStreamFrame(frame: SseFrame): void {
  let payload: Record<string, any>;
  try {
    payload = JSON.parse(frame.data);
  } catch {
    return;
  }

  const stamp = payload.timestamp ? new Date(payload.timestamp) : new Date();
  const time = logger.dimText(stamp.toLocaleTimeString());

  switch (frame.event) {
    case 'event_received':
      logger.log(
        `${time} ${logger.cyan(payload.sourceName || payload.sourceId || 'unknown')} ` +
        `${payload.eventType || '-'} ${logger.dimText('received')}`
      );
      return;

    case 'delivery_started':
    case 'delivery_completed':
    case 'delivery_failed':
    case 'delivery_throttled': {
      const target = payload.destinationName || payload.destinationId || 'unknown';
      const code = payload.statusCode ? ` ${payload.statusCode}` : '';
      const took = payload.duration ? ` ${logger.dimText(`${payload.duration}ms`)}` : '';
      const attempt = payload.attempt && payload.attempt > 1 ? logger.dimText(` (attempt ${payload.attempt})`) : '';
      logger.log(`${time} ${logger.cyan(target)} ${formatStatus(payload.status)}${code}${took}${attempt}`);
      return;
    }

    case 'source_rate_limited':
      logger.log(`${time} ${logger.yellow('rate limited')} ${logger.dimText(payload.sourceId || '')}`);
      return;

    case 'error':
      logger.error(`Stream error: ${payload.message || 'unknown'}`);
      return;

    default:
      // connected / heartbeat / reconnect are transport chatter, not events.
      return;
  }
}

export async function eventsFollowCommand(options: {
  source?: string;
}): Promise<void> {
  requireAuth();

  logger.info('Connecting to event stream...');
  logger.dim('Press Ctrl+C to stop');
  logger.log('');

  const apiUrl = config.getApiUrl();
  const token = config.getAuthToken();

  const url = new URL(`${apiUrl}/api/realtime/stream`);
  if (options.source) {
    url.searchParams.set('sourceId', options.source);
  }

  // The server closes the stream after ~25s to stay under Cloudflare's 30s
  // limit and sends a `reconnect` frame on the way out, so "follow" is a
  // reconnect loop, not a single request. Resume from the highest SSE `id:`
  // seen — epoch millis, which is what the server's Last-Event-ID handler
  // parseInt()s. Deliberately *not* the `reconnect` payload's `lastEventId`:
  // that field carries an ISO string, and parseInt("2026-08-31T…") is 2026,
  // which would rewind the cursor to 1970 and replay history on every cycle.
  let lastEventId: string | undefined;
  let announced = false;
  let backoff = 1000;

  // A connection that lasted at least this long did its job, so the next one
  // starts immediately and backoff resets. Anything shorter is treated as a
  // failed cycle even when the server closed politely: without this, a server
  // that returns 200 and immediately EOFs (mid-deploy, or a proxy in front of
  // the API) turns "follow" into hundreds of requests a second.
  const HEALTHY_CONNECTION_MS = 5000;

  for (;;) {
    const startedAt = Date.now();
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
      };
      if (lastEventId) {
        headers['Last-Event-ID'] = lastEventId;
      }

      const response = await fetch(url.toString(), { headers });

      if (!response.ok) {
        // 401/403 will never fix themselves by retrying.
        if (response.status === 401 || response.status === 403) {
          logger.error(`Not authorized to stream events (${response.status}). Run "hookbase login".`);
          return;
        }
        logger.error(`Failed to connect: ${response.status} ${response.statusText}`);
        return;
      }

      if (!response.body) {
        logger.error('No response body');
        return;
      }

      if (!announced) {
        logger.success('Connected! Waiting for events...');
        logger.log('');
        announced = true;
      }

      for await (const frame of readSseFrames(response.body as ReadableStream<Uint8Array>)) {
        if (frame.id) {
          lastEventId = frame.id;
        }
        printStreamFrame(frame);
      }

      if (Date.now() - startedAt >= HEALTHY_CONNECTION_MS) {
        // Normal end of a ~25s window: reconnect at once so the gap stays small.
        backoff = 1000;
        continue;
      }

      logger.dim(`Stream closed early. Reconnecting in ${Math.round(backoff / 1000)}s...`);
      await new Promise((resolve) => setTimeout(resolve, backoff));
      backoff = Math.min(backoff * 2, 30000);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.log('');
        logger.info('Stream closed');
        return;
      }
      logger.error(
        `Connection lost: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
        `Retrying in ${Math.round(backoff / 1000)}s...`
      );
      await new Promise((resolve) => setTimeout(resolve, backoff));
      backoff = Math.min(backoff * 2, 30000);
    }
  }
}

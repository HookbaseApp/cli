import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';

function requireAuth(): boolean {
  if (!config.isAuthenticated()) {
    logger.error('Not logged in. Run "hookbase login" first.');
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
      e.source_name || e.source_slug || e.source_id,
      e.event_type || e.method || '-',
      formatStatus(e.status),
      formatDate(e.received_at),
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
  logger.log(`Source:    ${event.source_name || event.source_id}`);
  logger.log(`Type:      ${event.event_type || '-'}`);
  logger.log(`Method:    ${event.method || '-'}`);
  logger.log(`Path:      ${event.path || '/'}`);
  logger.log(`Status:    ${formatStatus(event.status)}`);
  logger.log(`Size:      ${event.payload_size || 0} bytes`);
  logger.log(`Signature: ${event.signature_valid === true ? logger.green('valid') : event.signature_valid === false ? logger.red('invalid') : logger.dimText('not verified')}`);
  logger.log(`Received:  ${formatDate(event.received_at)}`);

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
      event.deliveries.map(d => [
        d.id,
        d.destination_name || d.destination_id,
        d.status === 'success' ? logger.green(d.status) : d.status === 'failed' ? logger.red(d.status) : logger.yellow(d.status),
        d.response_status ? String(d.response_status) : '-',
        d.response_time_ms ? `${d.response_time_ms}ms` : '-',
      ])
    );
  }
}

export async function eventsFollowCommand(options: {
  source?: string;
}): Promise<void> {
  requireAuth();

  const org = config.getCurrentOrg();
  if (!org) {
    logger.error('No organization selected');
    return;
  }

  logger.info('Connecting to event stream...');
  logger.dim('Press Ctrl+C to stop');
  logger.log('');

  const apiUrl = config.getApiUrl();
  const token = config.getAuthToken();

  // Build SSE URL
  let sseUrl = `${apiUrl}/api/organizations/${org.id}/realtime/events`;
  if (options.source) {
    sseUrl += `?sourceId=${options.source}`;
  }

  try {
    const response = await fetch(sseUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'text/event-stream',
      },
    });

    if (!response.ok) {
      logger.error(`Failed to connect: ${response.statusText}`);
      return;
    }

    if (!response.body) {
      logger.error('No response body');
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    logger.success('Connected! Waiting for events...');
    logger.log('');

    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'event' && data.event) {
              const e = data.event;
              const time = new Date().toLocaleTimeString();
              const status = formatStatus(e.status);
              logger.log(
                `${logger.dimText(time)} ${logger.cyan(e.source_name || e.source_slug || 'unknown')} ` +
                `${e.event_type || e.method || '-'} ${status}`
              );
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.log('');
      logger.info('Stream closed');
    } else {
      logger.error(`Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

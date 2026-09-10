import * as config from './config.js';
import * as logger from './logger.js';
import { refreshSession } from './api.js';

/** One decoded SSE frame. */
export interface SseFrame {
  id?: string;
  event: string;
  data: string;
}

/**
 * Splits an SSE byte stream into frames. Frames are separated by a blank
 * line; CRLF is tolerated since some proxies rewrite line endings in transit.
 */
export async function* readSseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

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

/**
 * Base URL + a header builder for a realtime SSE endpoint. An API key implies
 * its org, so `/api/realtime/<path>` is enough; a session isn't tied to one
 * org, so it needs the org-scoped `/api/organizations/:id/realtime/<path>`
 * route. Call after requireAuth()/isAuthReady() has already confirmed one of
 * these credential sets is present.
 *
 * Headers are rebuilt fresh on every call (not captured once) because a
 * session's access token is short-lived (15min) and streamForever() calls
 * this again after refreshing it.
 */
export function buildStreamRequest(path: 'stream' | 'outbound-stream'): { url: URL; getHeaders: () => Record<string, string> } {
  const apiUrl = config.getApiUrl();

  if (config.isAuthenticated()) {
    return {
      url: new URL(`${apiUrl}/api/realtime/${path}`),
      getHeaders: () => ({ Authorization: `Bearer ${config.getAuthToken()}` }),
    };
  }

  const org = config.getCurrentOrg();
  if (!org || !config.getSessionAccessToken()) {
    throw new Error('Not authenticated. Run "hookbase login".');
  }
  return {
    url: new URL(`${apiUrl}/api/organizations/${org.id}/realtime/${path}`),
    getHeaders: () => ({ Authorization: `Bearer ${config.getSessionAccessToken()}` }),
  };
}

const HEALTHY_CONNECTION_MS = 5000;

/**
 * Connects to a realtime SSE endpoint and reconnects (with Last-Event-ID) for
 * as long as the process runs — the server intentionally closes the stream
 * every ~25s (Cloudflare Workers subrequest limit) and expects the client to
 * reconnect using the highest SSE `id:` seen so far (a microsecond-precision
 * ISO timestamp string).
 */
export async function streamForever(
  url: URL,
  getHeaders: () => Record<string, string>,
  onFrame: (frame: SseFrame) => void,
  onConnected: () => void
): Promise<void> {
  let lastEventId: string | undefined;
  let announced = false;
  let backoff = 1000;
  let refreshedAfter401 = false;

  for (;;) {
    const startedAt = Date.now();
    try {
      const reqHeaders: Record<string, string> = { ...getHeaders(), Accept: 'text/event-stream' };
      if (lastEventId) {
        reqHeaders['Last-Event-ID'] = lastEventId;
      }

      const response = await fetch(url.toString(), { headers: reqHeaders });

      if (!response.ok) {
        // A session's access token is short-lived (15min) and can expire mid-stream.
        // Try one silent refresh before giving up — getHeaders() picks up the
        // refreshed token on the next loop iteration. API-key auth can't be
        // refreshed this way, so only attempt it for session auth.
        if (response.status === 401 && !config.isAuthenticated() && !refreshedAfter401) {
          refreshedAfter401 = true;
          if (await refreshSession()) {
            continue;
          }
        }
        if (response.status === 401 || response.status === 403) {
          logger.error(`Not authorized to stream (${response.status}). Run "hookbase login".`);
          return;
        }
        logger.error(`Failed to connect: ${response.status} ${response.statusText}`);
        return;
      }
      refreshedAfter401 = false;

      if (!response.body) {
        logger.error('No response body');
        return;
      }

      if (!announced) {
        onConnected();
        announced = true;
      }

      for await (const frame of readSseFrames(response.body as ReadableStream<Uint8Array>)) {
        // Track the MAX id seen, not simply the last one: the server interleaves
        // events and deliveries in each poll batch, and a delivery's id (its
        // created_at) can be earlier than an event already sent in the same
        // batch. Overwriting unconditionally would regress the resume point
        // backward on reconnect, causing the server to re-send everything since
        // that earlier point — the whole recent window repeating forever.
        //
        // ids are fixed-width ISO timestamps with microsecond precision
        // ("2026-09-09T01:31:46.123456Z"), not epoch millis — the server
        // needs sub-millisecond precision to avoid re-matching the same row
        // on its next poll, and a plain string compare is exact and correct
        // for that format (unlike `Number()`, which can't parse it at all).
        if (frame.id && (!lastEventId || frame.id > lastEventId)) {
          lastEventId = frame.id;
        }
        onFrame(frame);
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

function formatInboundStatus(status?: string): string {
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

/** Renders one inbound (`/realtime/stream`) frame. Transport chatter is silently skipped. */
export function printInboundFrame(frame: SseFrame): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      logger.log(`${time} ${logger.cyan(target)} ${formatInboundStatus(payload.status)}${code}${took}${attempt}`);
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

function formatOutboundStatus(status?: string): string {
  switch (status) {
    case 'success':
      return logger.green('success');
    case 'failed':
      return logger.red('failed');
    case 'exhausted':
    case 'dlq':
      return logger.red(status);
    case 'awaiting_retry':
      return logger.yellow('retrying');
    case 'pending':
    case 'processing':
      return logger.yellow(status);
    default:
      return logger.dimText(status || 'unknown');
  }
}

/** Renders one outbound (`/realtime/outbound-stream`) frame. Transport chatter is silently skipped. */
export function printOutboundFrame(frame: SseFrame): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payload: Record<string, any>;
  try {
    payload = JSON.parse(frame.data);
  } catch {
    return;
  }

  const stamp = payload.timestamp ? new Date(payload.timestamp) : new Date();
  const time = logger.dimText(stamp.toLocaleTimeString());

  switch (frame.event) {
    case 'message_queued':
    case 'message_processing':
    case 'message_succeeded':
    case 'message_failed':
    case 'message_exhausted': {
      const target = payload.endpointUrl || payload.endpointId || 'unknown';
      const app = payload.applicationName ? `${logger.cyan(payload.applicationName)} → ` : '';
      const code = payload.responseStatus ? ` ${payload.responseStatus}` : '';
      const attempt = payload.attempt && payload.maxAttempts ? logger.dimText(` (${payload.attempt}/${payload.maxAttempts})`) : '';
      logger.log(`${time} ${app}${target} ${formatOutboundStatus(payload.status)}${code}${attempt}`);
      return;
    }

    case 'attempt_started':
    case 'attempt_completed': {
      const code = payload.responseStatus ? ` ${payload.responseStatus}` : '';
      const took = payload.responseTimeMs ? ` ${logger.dimText(`${payload.responseTimeMs}ms`)}` : '';
      logger.log(`${time} attempt #${payload.attempt ?? '?'} ${formatOutboundStatus(payload.status)}${code}${took}`);
      return;
    }

    case 'error':
      logger.error(`Stream error: ${payload.message || 'unknown'}`);
      return;

    default:
      // connected / heartbeat / reconnect are transport chatter, not events.
      return;
  }
}

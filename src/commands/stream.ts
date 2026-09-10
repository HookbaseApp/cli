import * as logger from '../lib/logger.js';
import { requireAuth } from '../lib/requireAuth.js';
import { buildStreamRequest, streamForever, printInboundFrame, printOutboundFrame, type SseFrame } from '../lib/sseStream.js';

export async function streamCommand(options: {
  outbound?: boolean;
  source?: string;
  application?: string;
  endpoint?: string;
  json?: boolean;
}): Promise<void> {
  requireAuth();

  const { url, getHeaders } = buildStreamRequest(options.outbound ? 'outbound-stream' : 'stream');

  if (options.outbound) {
    if (options.application) url.searchParams.set('applicationId', options.application);
    if (options.endpoint) url.searchParams.set('endpointId', options.endpoint);
  } else if (options.source) {
    url.searchParams.set('sourceId', options.source);
  }

  if (!options.json) {
    logger.info(`Connecting to ${options.outbound ? 'outbound delivery' : 'inbound event'} stream...`);
    logger.dim('Press Ctrl+C to stop');
    logger.log('');
  }

  const printFrame = options.outbound ? printOutboundFrame : printInboundFrame;

  const onFrame = (frame: SseFrame) => {
    if (!options.json) {
      printFrame(frame);
      return;
    }
    // Transport chatter (connected/heartbeat/reconnect) has no downstream
    // consumer for --json output, same as it's silently skipped in the human view.
    if (['connected', 'heartbeat', 'reconnect'].includes(frame.event)) return;
    try {
      process.stdout.write(JSON.stringify({ event: frame.event, data: JSON.parse(frame.data) }) + '\n');
    } catch {
      // malformed frame data — nothing usable to emit
    }
  };

  await streamForever(url, getHeaders, onFrame, () => {
    if (!options.json) {
      logger.success(`Connected! Waiting for ${options.outbound ? 'deliveries' : 'events'}...`);
      logger.log('');
    }
  });
}

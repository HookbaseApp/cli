import { input, select, editor } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import * as fs from 'fs';
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
    if (config.hasStaleJwtToken()) {
      logger.error('Your session uses a JWT token which is no longer supported. Please re-login with an API key: hookbase login');
    } else {
      logger.error('Not logged in. Run "hookbase login" with an API key.');
    }
    process.exit(1);
  }
  return true;
}

export async function sendCommand(options: {
  app?: string;
  eventType?: string;
  payload?: string;
  file?: string;
  endpoints?: string;
  json?: boolean;
}): Promise<void> {
  requireAuth();

  let applicationId = options.app;
  let eventType = options.eventType;
  let payload: unknown;
  let endpointIds: string[] | undefined;

  try {
    // Get application
    if (!applicationId) {
      const appsResult = await api.getWebhookApplications();
      const appsRaw = appsResult.data as any;
      const apps = appsRaw?.data || appsRaw?.applications || [];
      if (appsResult.error || !apps.length) {
        logger.error('No applications found. Create one first with "hookbase outbound applications create"');
        return;
      }

      applicationId = await select({
        message: 'Select application:',
        choices: apps.map((a: any) => ({
          name: `${a.name} (${a.id})`,
          value: a.id,
        })),
      });
    }

    // Get event type
    if (!eventType) {
      eventType = await input({
        message: 'Event type (e.g., user.created, order.completed):',
        validate: (value) => value.length > 0 || 'Event type is required',
      });
    }

    // Get payload
    if (options.file) {
      // Read from file
      try {
        const fileContent = fs.readFileSync(options.file, 'utf-8');
        payload = JSON.parse(fileContent);
      } catch (error) {
        logger.error(`Failed to read or parse file: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return;
      }
    } else if (options.payload) {
      // Parse inline payload
      try {
        payload = JSON.parse(options.payload);
      } catch {
        logger.error('Invalid JSON payload. Use --file for complex payloads or ensure valid JSON.');
        return;
      }
    } else {
      // Interactive payload input
      const payloadStr = await editor({
        message: 'Event payload (JSON):',
        default: JSON.stringify({ id: '123', timestamp: new Date().toISOString() }, null, 2),
        validate: (value) => {
          try {
            JSON.parse(value);
            return true;
          } catch {
            return 'Invalid JSON';
          }
        },
      });
      payload = JSON.parse(payloadStr);
    }

    // Get specific endpoints (optional)
    if (options.endpoints) {
      endpointIds = options.endpoints.split(',').map(e => e.trim());
    }

  } catch (error) {
    if (isPromptCancelled(error)) {
      logger.log('');
      logger.info('Cancelled');
      return;
    }
    throw error;
  }

  const spinner = logger.spinner('Sending webhook event...');
  const result = await api.sendWebhookEvent({
    applicationId: applicationId!,
    eventType: eventType!,
    payload,
    endpointIds,
  });

  if (result.error) {
    spinner.fail('Failed to send webhook event');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Webhook event sent');

  if (options.json) {
    console.log(JSON.stringify(result.data, null, 2));
    return;
  }

  const message: any = (result.data as any)?.data || result.data?.message;
  if (message) {
    logger.log('');
    logger.box('Webhook Event Sent', [
      `Message ID:  ${message.id}`,
      `Event Type:  ${message.event_type || message.eventType}`,
      `Status:      ${message.status}`,
      `Created:     ${message.created_at || message.createdAt}`,
    ].join('\n'));
    logger.log('');
    logger.dim('Track delivery with "hookbase outbound messages get ' + message.id + '"');
  }
}

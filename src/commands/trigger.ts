import { select } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import * as fs from 'fs';
import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';

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

const SAMPLE_PAYLOADS: Record<string, { name: string; headers: Record<string, string>; body: unknown }> = {
  github_push: {
    name: 'GitHub Push',
    headers: { 'content-type': 'application/json', 'x-github-event': 'push' },
    body: {
      ref: 'refs/heads/main',
      repository: { full_name: 'user/my-repo', private: false },
      pusher: { name: 'testuser', email: 'test@example.com' },
      commits: [{ id: 'abc123', message: 'Test commit', timestamp: new Date().toISOString() }],
    },
  },
  stripe_payment: {
    name: 'Stripe Payment',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1234567890,v1=test' },
    body: {
      id: `evt_test_${Date.now()}`,
      type: 'payment_intent.succeeded',
      data: { object: { id: `pi_test_${Date.now()}`, amount: 2000, currency: 'usd', status: 'succeeded' } },
      created: Math.floor(Date.now() / 1000),
    },
  },
  shopify_order: {
    name: 'Shopify Order',
    headers: { 'content-type': 'application/json', 'x-shopify-topic': 'orders/create' },
    body: {
      id: 1234567890,
      order_number: 1001,
      total_price: '49.99',
      currency: 'USD',
      email: 'customer@example.com',
      line_items: [{ title: 'Test Product', quantity: 1, price: '49.99' }],
      created_at: new Date().toISOString(),
    },
  },
  slack_message: {
    name: 'Slack Message',
    headers: { 'content-type': 'application/json' },
    body: {
      type: 'event_callback',
      event: { type: 'message', text: 'Hello from Hookbase trigger!', user: 'U01234567', channel: 'C01234567', ts: String(Date.now() / 1000) },
      team_id: 'T01234567',
    },
  },
  generic: {
    name: 'Generic Test',
    headers: { 'content-type': 'application/json' },
    body: {
      event: 'test.trigger',
      timestamp: new Date().toISOString(),
      data: { message: 'Test webhook from Hookbase CLI', id: crypto.randomUUID() },
    },
  },
};

export async function triggerCommand(options: {
  source?: string;
  event?: string;
  payload?: string;
  file?: string;
  json?: boolean;
}): Promise<void> {
  requireAuth();

  try {
    // 1. Resolve source
    let sourceId = options.source;
    let sourceName = options.source;

    if (!sourceId) {
      // Interactive: pick a source
      const sourcesResult = await api.getSources();
      const sources = (sourcesResult.data as any)?.sources || [];
      if (sourcesResult.error || sources.length === 0) {
        logger.error('No sources found. Create one first.');
        return;
      }

      const selected = await select({
        message: 'Select a source to trigger:',
        choices: sources.map((s: any) => ({
          name: `${s.name} (${s.slug})${s.provider && s.provider !== 'none' ? ` [${s.provider}]` : ''}`,
          value: s.id,
          description: s.description || undefined,
        })),
      });
      sourceId = selected as string;
      sourceName = sources.find((s: any) => s.id === selected)?.name || selected;
    }

    // 2. Resolve payload
    let customPayload: unknown = undefined;
    let customHeaders: Record<string, string> | undefined = undefined;
    let template: string | undefined = undefined;

    if (options.file) {
      // Load from file
      if (!fs.existsSync(options.file)) {
        logger.error(`File not found: ${options.file}`);
        return;
      }
      const content = fs.readFileSync(options.file, 'utf-8');
      try {
        customPayload = JSON.parse(content);
      } catch {
        logger.error('Invalid JSON in file');
        return;
      }
      logger.dim(`Loaded payload from ${options.file}`);
    } else if (options.payload) {
      // Parse inline payload
      try {
        customPayload = JSON.parse(options.payload);
      } catch {
        logger.error('Invalid JSON payload. Use --payload \'{"key": "value"}\'');
        return;
      }
    } else if (options.event) {
      // Use a named template
      const key = options.event.toLowerCase().replace(/[^a-z_]/g, '_');
      if (SAMPLE_PAYLOADS[key]) {
        template = key;
        customHeaders = SAMPLE_PAYLOADS[key].headers;
        logger.dim(`Using ${SAMPLE_PAYLOADS[key].name} template`);
      } else {
        // Try to match by partial name
        const match = Object.entries(SAMPLE_PAYLOADS).find(([k, v]) =>
          k.includes(key) || v.name.toLowerCase().includes(options.event!.toLowerCase())
        );
        if (match) {
          template = match[0];
          customHeaders = match[1].headers;
          logger.dim(`Using ${match[1].name} template`);
        } else {
          logger.warn(`Unknown event template "${options.event}". Using generic template.`);
          template = 'generic';
        }
      }
    } else {
      // Interactive: pick a template or send generic
      const selected = await select({
        message: 'Select a webhook template:',
        choices: [
          ...Object.entries(SAMPLE_PAYLOADS).map(([key, val]) => ({
            name: val.name,
            value: key,
          })),
        ],
      });
      template = selected;
      customHeaders = SAMPLE_PAYLOADS[selected]?.headers;
    }

    // 3. Send
    logger.info(`Triggering webhook to ${sourceName}...`);

    const result = await api.triggerSource(sourceId!, {
      template,
      customPayload,
      customHeaders,
    });

    if (result.error) {
      logger.error(`Failed: ${result.error}`);
      return;
    }

    const data = result.data as any;

    if (options.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    if (data.success) {
      logger.success(`Webhook delivered successfully (${data.statusCode})`);
    } else {
      logger.error(`Webhook delivery failed (${data.statusCode})`);
    }

    if (data.result?.eventId) {
      logger.info(`Event ID: ${data.result.eventId}`);
    }

    if (data.request?.url) {
      logger.dim(`URL: ${data.request.url}`);
    }

    const deliveryCount = data.result?.deliveries?.length ?? data.result?.routesMatched ?? data.result?.deliveriesQueued;
    if (deliveryCount !== undefined && deliveryCount !== null) {
      logger.info(`${deliveryCount} delivery(ies) queued`);
    }
  } catch (error) {
    if (isPromptCancelled(error)) {
      return;
    }
    logger.error(error instanceof Error ? error.message : 'Trigger failed');
  }
}

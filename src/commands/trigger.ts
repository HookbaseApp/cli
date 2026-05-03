import { select, input, confirm } from '@inquirer/prompts';
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

interface TriggerOptions {
  source?: string;
  provider?: string;
  event?: string;
  payload?: string;
  file?: string;
  sign?: boolean;
  print?: boolean;
  json?: boolean;
}

export async function triggerCommand(options: TriggerOptions): Promise<void> {
  requireAuth();

  try {
    // 1. Resolve source
    let sourceId = options.source;
    let sourceName: string | undefined = options.source;
    let sourceProvider: string | null = null;

    const sourcesResult = await api.getSources();
    const sources = (sourcesResult.data as any)?.sources || [];
    if (sourcesResult.error || sources.length === 0) {
      logger.error('No sources found. Create one first.');
      return;
    }

    if (!sourceId) {
      const selected = await select({
        message: 'Select a source to trigger:',
        choices: sources.map((s: any) => ({
          name: `${s.name} (${s.slug})${s.provider && s.provider !== 'none' ? ` [${s.provider}]` : ''}`,
          value: s.id,
          description: s.description || undefined,
        })),
      });
      sourceId = selected as string;
    }

    const sourceRecord = sources.find((s: any) => s.id === sourceId);
    if (sourceRecord) {
      sourceName = sourceRecord.name;
      sourceProvider = sourceRecord.provider && sourceRecord.provider !== 'none' ? sourceRecord.provider : null;
    }

    // 2. Resolve payload — three paths
    let customPayload: unknown = undefined;
    let customHeaders: Record<string, string> | undefined = undefined;
    let providerId: string | undefined = options.provider;
    let eventType: string | undefined = options.event;

    if (options.file) {
      if (!fs.existsSync(options.file)) {
        logger.error(`File not found: ${options.file}`);
        return;
      }
      try {
        customPayload = JSON.parse(fs.readFileSync(options.file, 'utf-8'));
      } catch {
        logger.error('Invalid JSON in file');
        return;
      }
      logger.dim(`Loaded payload from ${options.file}`);
    } else if (options.payload) {
      try {
        customPayload = JSON.parse(options.payload);
      } catch {
        logger.error('Invalid JSON payload. Use --payload \'{"key": "value"}\'');
        return;
      }
    } else if (!providerId && !eventType) {
      // Interactive: pick provider (default to source's provider) → event
      const catalogResult = await api.getProviderCatalog();
      if (catalogResult.error || !catalogResult.data) {
        logger.warn('Could not load provider catalog — falling back to generic payload');
      } else {
        const providers = catalogResult.data.providers;
        const defaultProviderId = sourceProvider && providers.some((p) => p.hookbaseProvider === sourceProvider)
          ? providers.find((p) => p.hookbaseProvider === sourceProvider)!.id
          : undefined;

        providerId = await select({
          message: 'Select a provider:',
          default: defaultProviderId,
          choices: providers
            .filter((p) => p.eventTypeCount > 0)
            .slice(0, 60)
            .map((p) => ({
              name: `${p.icon ? p.icon + ' ' : ''}${p.name} (${p.id})`,
              value: p.id,
              description: p.description.slice(0, 80),
            })),
        });

        const eventsResult = await api.getProviderEvents(providerId!);
        if (eventsResult.data?.eventTypes?.length) {
          const haveSamples = eventsResult.data.eventTypes.filter(
            (e) => eventsResult.data!.samplePayloads[e.type]
          );
          if (haveSamples.length === 0) {
            logger.warn(`Provider "${providerId}" has no sample payloads — using generic`);
            providerId = undefined;
          } else {
            eventType = await select({
              message: 'Select an event type:',
              choices: haveSamples.map((e) => ({
                name: e.type,
                value: e.type,
                description: e.description,
              })),
            });
          }
        }
      }
    } else if (providerId && !eventType) {
      const eventsResult = await api.getProviderEvents(providerId);
      if (eventsResult.error || !eventsResult.data) {
        logger.error(`Unknown provider: ${providerId}`);
        return;
      }
      const haveSamples = eventsResult.data.eventTypes.filter(
        (e) => eventsResult.data!.samplePayloads[e.type]
      );
      if (haveSamples.length === 0) {
        logger.error(`Provider "${providerId}" has no sample payloads`);
        return;
      }
      eventType = await select({
        message: 'Select an event type:',
        choices: haveSamples.map((e) => ({ name: e.type, value: e.type, description: e.description })),
      });
    }

    // 3. --print mode: don't send
    if (options.print) {
      if (!providerId || !eventType) {
        logger.error('--print requires --provider and --event');
        return;
      }
      const eventsResult = await api.getProviderEvents(providerId);
      const payload = eventsResult.data?.samplePayloads?.[eventType];
      if (!payload) {
        logger.error(`No sample for ${providerId} → ${eventType}`);
        return;
      }
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    // 4. Send
    logger.info(`Triggering webhook to ${sourceName}...`);

    const sign = options.sign !== false; // default true; users opt out via --no-sign
    const result = await api.triggerSource(sourceId!, {
      providerId,
      eventType,
      customPayload,
      customHeaders,
      sign,
    });

    if (result.error) {
      logger.error(`Failed: ${result.error}`);
      return;
    }

    const data = result.data!;

    if (options.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    if (data.success) {
      logger.success(`Webhook delivered (${data.statusCode})`);
    } else {
      logger.error(`Webhook delivery failed (${data.statusCode})`);
    }

    if (data.signed && data.signatureHeader) {
      logger.dim(`Signed with ${data.signatureHeader} header`);
    } else if (sign && sourceProvider) {
      logger.warn('Source has provider but signing was skipped — check signing_secret');
    }

    const result2 = data.result as any;
    if (result2?.eventId) {
      logger.info(`Event ID: ${result2.eventId}`);
    }
    if (data.request?.url) {
      logger.dim(`URL: ${data.request.url}`);
    }
    const deliveryCount = result2?.deliveries?.length ?? result2?.routesMatched ?? result2?.deliveriesQueued;
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

import type { BridgeConfig } from './api.js';
import { parseJsonField, isJsonObject } from './parseJson.js';

export const WAREHOUSE_TYPES = ['s3', 'r2', 'gcs', 'azure_blob'] as const;
export const QUEUE_TYPES = ['sqs', 'eventbridge', 'servicebus', 'pubsub', 'oci_queue'] as const;

export function isWarehouseType(type: string): boolean {
  return (WAREHOUSE_TYPES as readonly string[]).includes(type);
}

export function isQueueType(type: string): boolean {
  return (QUEUE_TYPES as readonly string[]).includes(type);
}

/** The bridge flags shared by `destinations create` and `destinations update`. */
export interface BridgeFlags {
  eventTypeSource?: string;
  eventType?: string;
  eventTypeField?: string;
  eventTypePrefix?: string;
  /** An application id; `false` (update's --no-application) clears it. */
  application?: string | false;
  allowUnverifiedSources?: boolean;
}

export function anyBridgeFlag(flags: BridgeFlags): boolean {
  return flags.eventTypeSource !== undefined || flags.eventType !== undefined ||
    flags.eventTypeField !== undefined || flags.eventTypePrefix !== undefined ||
    flags.application !== undefined || flags.allowUnverifiedSources !== undefined;
}

/**
 * Build a bridge config from `base` (a --config object, or the stored config on update) with the
 * flags applied on top. The source is --event-type-source when given, else implied by --event-type
 * (fixed) or --event-type-field (field), else the base's. Fields that belong to the other source are
 * dropped, since the API's schema is strict and refuses them. The server does the full validation
 * (event type exists and is enabled, the application belongs to the org).
 */
export function buildBridgeConfig(
  base: Record<string, unknown> | undefined,
  flags: BridgeFlags
): { ok: true; config: BridgeConfig } | { ok: false; error: string } {
  const config: Record<string, unknown> = { ...(base ?? {}) };

  if (flags.eventTypeSource !== undefined && flags.eventTypeSource !== 'fixed' && flags.eventTypeSource !== 'field') {
    return { ok: false, error: `Invalid --event-type-source "${flags.eventTypeSource}" (use fixed|field)` };
  }
  if (flags.eventTypeSource === undefined && flags.eventType !== undefined && flags.eventTypeField !== undefined) {
    return { ok: false, error: 'Use --event-type (a fixed event type) or --event-type-field (read from the payload), not both' };
  }

  const source = flags.eventTypeSource
    ?? (flags.eventType !== undefined ? 'fixed' : flags.eventTypeField !== undefined ? 'field' : undefined)
    ?? config.eventTypeSource;
  if (source !== 'fixed' && source !== 'field') {
    return { ok: false, error: 'A bridge needs an event type: --event-type <name> (fixed) or --event-type-field <path> (read from the payload)' };
  }
  config.eventTypeSource = source;

  if (flags.eventType !== undefined) config.eventType = flags.eventType;
  if (flags.eventTypeField !== undefined) config.eventTypeField = flags.eventTypeField;
  if (flags.eventTypePrefix !== undefined) config.eventTypePrefix = flags.eventTypePrefix;

  if (source === 'fixed') {
    if (flags.eventTypeField !== undefined || flags.eventTypePrefix !== undefined) {
      return { ok: false, error: '--event-type-field and --event-type-prefix only apply with --event-type-source field' };
    }
    delete config.eventTypeField;
    delete config.eventTypePrefix;
    if (!config.eventType) return { ok: false, error: '--event-type is required when the event type source is fixed' };
  } else {
    if (flags.eventType !== undefined) {
      return { ok: false, error: '--event-type only applies with --event-type-source fixed' };
    }
    delete config.eventType;
    if (!config.eventTypeField) return { ok: false, error: '--event-type-field is required when the event type source is field' };
  }

  if (flags.application === false) config.applicationId = null;
  else if (flags.application !== undefined) config.applicationId = flags.application;
  if (flags.allowUnverifiedSources !== undefined) config.allowUnverifiedSources = flags.allowUnverifiedSources;

  return { ok: true, config: config as unknown as BridgeConfig };
}

/** Label/value rows describing a non-HTTP destination's config, for `destinations get` and the TUI. */
export function describeDestinationConfig(type: string, rawConfig: unknown): Array<[string, string]> {
  const cfg = parseJsonField(rawConfig, {} as Record<string, unknown>);
  const c = isJsonObject(cfg) ? cfg : {};
  const str = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : String(v));
  const rows: Array<[string, string | undefined]> = [];

  if (type === 'bridge') {
    if (c.eventTypeSource === 'field') {
      rows.push(['Event Type', `from payload field ${str(c.eventTypeField) ?? '?'}`]);
      rows.push(['Prefix', str(c.eventTypePrefix)]);
    } else {
      rows.push(['Event Type', str(c.eventType) ?? '-']);
    }
    rows.push(['Application', str(c.applicationId) ?? 'all subscribed endpoints']);
    rows.push(['Unverified', c.allowUnverifiedSources === true ? 'published' : 'not published (only verified senders)']);
  } else if (isWarehouseType(type)) {
    if (type === 'azure_blob') {
      rows.push(['Account', str(c.accountName)]);
      rows.push(['Container', str(c.containerName) ?? '-']);
    } else {
      rows.push(['Bucket', str(c.bucket) ?? '-']);
    }
    if (type === 's3') rows.push(['Region', str(c.region)]);
    if (type === 'r2') rows.push(['Endpoint', str(c.endpoint)]);
    if (type === 'gcs') rows.push(['Project', str(c.projectId)]);
    rows.push(['Prefix', str(c.prefix)]);
    rows.push(['File Format', str(c.fileFormat) ?? 'jsonl']);
    rows.push(['Partition', str(c.partitionBy) ?? 'date']);
  } else if (type === 'sqs') {
    rows.push(['Queue URL', str(c.queueUrl) ?? '-']);
    rows.push(['Region', str(c.region)]);
    rows.push(['Group ID', str(c.messageGroupId)]);
  } else if (type === 'eventbridge') {
    rows.push(['Event Bus', str(c.eventBusName) ?? '-']);
    rows.push(['Region', str(c.region)]);
    rows.push(['Source', str(c.source)]);
    rows.push(['Detail Type', str(c.detailType)]);
  } else if (type === 'servicebus') {
    rows.push(['Namespace', str(c.namespace) ?? '-']);
    rows.push(['Queue/Topic', str(c.queueOrTopicName)]);
  } else if (type === 'pubsub') {
    rows.push(['Project', str(c.projectId) ?? '-']);
    rows.push(['Topic', str(c.topicId)]);
  } else if (type === 'oci_queue') {
    rows.push(['Queue', str(c.queueId) ?? '-']);
    rows.push(['Region', str(c.region)]);
    rows.push(['Endpoint', str(c.endpoint)]);
  }

  return rows.filter((r): r is [string, string] => r[1] !== undefined);
}

import { describe, it, expect } from 'vitest';
import { buildBridgeConfig, describeDestinationConfig } from './destinationConfig.js';

// bridgeConfigSchema (api/src/types/warehouse.ts) is strict: fixed takes eventType only, field takes
// eventTypeField (+ optional eventTypePrefix) only.

describe('buildBridgeConfig', () => {
  it('implies the source from --event-type / --event-type-field', () => {
    expect(buildBridgeConfig(undefined, { eventType: 'order.created' })).toEqual({
      ok: true, config: { eventTypeSource: 'fixed', eventType: 'order.created' },
    });
    expect(buildBridgeConfig(undefined, { eventTypeField: 'data.type', eventTypePrefix: 'acme.' })).toEqual({
      ok: true, config: { eventTypeSource: 'field', eventTypeField: 'data.type', eventTypePrefix: 'acme.' },
    });
  });

  it('drops the other source\'s fields when switching', () => {
    const base = { eventTypeSource: 'field', eventTypeField: 'type', eventTypePrefix: 'x.' };
    expect(buildBridgeConfig(base, { eventType: 'a.b' })).toEqual({ ok: true, config: { eventTypeSource: 'fixed', eventType: 'a.b' } });
    expect(buildBridgeConfig({ eventTypeSource: 'fixed', eventType: 'a.b' }, { eventTypeField: 'kind' }))
      .toEqual({ ok: true, config: { eventTypeSource: 'field', eventTypeField: 'kind' } });
  });

  it('keeps the base source when only other flags change', () => {
    expect(buildBridgeConfig({ eventTypeSource: 'fixed', eventType: 'a.b' }, { allowUnverifiedSources: false, application: 'app' }))
      .toEqual({ ok: true, config: { eventTypeSource: 'fixed', eventType: 'a.b', allowUnverifiedSources: false, applicationId: 'app' } });
  });

  it.each([
    [{}, 'A bridge needs an event type'],
    [{ eventTypeSource: 'other' }, 'Invalid --event-type-source "other"'],
    [{ eventType: 'a.b', eventTypeField: 'type' }, 'not both'],
    [{ eventTypeSource: 'fixed' }, '--event-type is required'],
    [{ eventTypeSource: 'field' }, '--event-type-field is required'],
    [{ eventTypeSource: 'fixed', eventType: 'a.b', eventTypePrefix: 'x.' }, 'only apply with --event-type-source field'],
    [{ eventTypeSource: 'field', eventTypeField: 't', eventType: 'a.b' }, 'only applies with --event-type-source fixed'],
  ])('rejects %j', (flags, message) => {
    const result = buildBridgeConfig(undefined, flags);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(message);
  });
});

describe('describeDestinationConfig', () => {
  it('describes azure by container, not bucket', () => {
    const rows = describeDestinationConfig('azure_blob', { accountName: 'acct', containerName: 'hooks' });
    expect(rows).toContainEqual(['Container', 'hooks']);
    expect(rows.map(([l]) => l)).not.toContain('Bucket');
  });

  it('accepts a JSON-string config and never prints secrets', () => {
    const rows = describeDestinationConfig('eventbridge', JSON.stringify({ eventBusName: 'default', region: 'us-east-1', secretAccessKey: '••••' }));
    expect(rows).toEqual([['Event Bus', 'default'], ['Region', 'us-east-1']]);
  });

  it('is empty for http and unknown types', () => {
    expect(describeDestinationConfig('http', { bucket: 'x' })).toEqual([]);
    expect(describeDestinationConfig('kafka', { bucket: 'x' })).toEqual([]);
  });
});

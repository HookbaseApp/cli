import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Command -> wire -> display for `deliveries`, with the real api module and fetch mocked.
// Wire shapes: api/src/routes/deliveries.ts (origin/main, 2026-11-12).

vi.mock('../lib/config.js', () => ({
  getApiUrl: () => 'https://api.example.test',
  getAuthToken: () => 'whr_test_key',
  getCurrentOrg: () => null,
  getSessionAccessToken: () => null,
  getSessionRefreshToken: () => null,
  getSessionUser: () => null,
  setSession: () => {},
  clearSession: () => {},
  isAuthenticated: () => true,
  hasSession: () => false,
}));

const prompts = { input: vi.fn(), confirm: vi.fn(), select: vi.fn(), checkbox: vi.fn() };
vi.mock('@inquirer/prompts', () => prompts);
vi.mock('../lib/requireAuth.js', () => ({ requireAuth: () => {} }));

const out: string[] = [];
const tables: string[][][] = [];
const spinner = { succeed: vi.fn((m: string) => { out.push(m); }), fail: vi.fn((m: string) => { out.push(m); }), stop: vi.fn() };
vi.mock('../lib/logger.js', () => {
  const rec = (m: string) => { out.push(m); };
  const id = (m: string) => m;
  return {
    success: rec, error: rec, warn: rec, info: rec, log: rec, dim: rec,
    // dimText marks its output so a status that falls through to formatStatus' default is visible.
    bold: id, green: id, red: id, yellow: id, blue: id, cyan: id, dimText: (m: string) => `~${m}`,
    spinner: () => spinner,
    table: (_h: string[], rows: string[][]) => { tables.push(rows); },
    box: (title: string, content: string) => { out.push(`[${title}]\n${content}`); },
  };
});

const fetchMock = vi.fn();
const respond = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

function call(n = 0) {
  const [url, init] = fetchMock.mock.calls[n];
  return {
    url: new URL(url as string),
    method: init.method as string,
    body: init.body ? JSON.parse(init.body as string) : undefined,
  };
}

const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
const deliveries = await import('./deliveries.js');
const text = () => out.join('\n');

const replayed = (over: Record<string, unknown> = {}) => ({
  deliveryId: 'dlv_new',
  message: 'Replay queued',
  modified: false,
  destinationOverridden: false,
  transformOverridden: false,
  transformPersisted: false,
  headersOverridden: false,
  targetDestinationId: 'dst_1',
  ...over,
});

beforeEach(() => {
  out.length = 0;
  tables.length = 0;
  logSpy.mockClear();
  fetchMock.mockReset();
  for (const fn of Object.values(prompts)) fn.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('deliveries replay', () => {
  it('a plain replay sends no body and shows the new delivery id', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, replayed()));
    await deliveries.deliveriesReplayCommand('dlv_1', { yes: true });
    expect(call().method).toBe('POST');
    expect(call().url.pathname).toBe('/api/deliveries/dlv_1/replay');
    expect(call().body).toBeUndefined();
    expect(text()).toContain('New delivery:  dlv_new');
    expect(text()).toContain('hookbase deliveries get dlv_new');
  });

  it('--patch @file, --destination and --header go out as payloadPatch, destinationOverride and headersOverride', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hb-replay-'));
    const file = join(dir, 'patch.json');
    writeFileSync(file, '{"order":{"total":100}}');
    fetchMock.mockResolvedValueOnce(respond(200, replayed({
      message: 'Replay queued with modified payload, header overrides, destination "Backup"',
      modified: true, headersOverridden: true, destinationOverridden: true, targetDestinationId: 'dst_backup',
    })));

    await deliveries.deliveriesReplayCommand('dlv_1', {
      yes: true, patch: `@${file}`, destination: 'backup', header: ['X-Debug=1', 'X-Trace=a=b'],
    });

    expect(call().body).toEqual({
      payloadPatch: { order: { total: 100 } },
      destinationOverride: 'backup',
      headersOverride: { 'X-Debug': '1', 'X-Trace': 'a=b' },
    });
    expect(text()).toContain('Replay queued with modified payload');
    expect(text()).toContain('Destination:   dst_backup (overridden)');
    expect(text()).toContain('Payload:       patched');
    expect(text()).toContain('Headers:       X-Debug, X-Trace');
  });

  it('--payload replaces the payload (any JSON value)', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, replayed({ modified: true })));
    await deliveries.deliveriesReplayCommand('dlv_1', { yes: true, payload: '[1,2]' });
    expect(call().body).toEqual({ modifiedPayload: [1, 2] });
    expect(text()).toContain('Payload:       replaced');
  });

  it('--patch and --payload together fail before any request', async () => {
    await deliveries.deliveriesReplayCommand('dlv_1', { yes: true, patch: '{}', payload: '{}' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(text()).toContain('Use either --patch or --payload, not both.');
  });

  it('rejects a --patch that is not a JSON object, bad JSON and a bad --header without calling the API', async () => {
    await deliveries.deliveriesReplayCommand('dlv_1', { yes: true, patch: '[1]' });
    await deliveries.deliveriesReplayCommand('dlv_1', { yes: true, payload: '{oops' });
    await deliveries.deliveriesReplayCommand('dlv_1', { yes: true, header: ['NoEquals'] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(text()).toContain('--patch must be a JSON object');
    expect(text()).toContain('--payload: invalid JSON');
    expect(text()).toContain('--header "NoEquals" must be name=value');
  });

  it('--json prints the API result', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, replayed()));
    await deliveries.deliveriesReplayCommand('dlv_1', { yes: true, json: true });
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual(replayed());
  });

  it.each([
    ['TRANSIENT_REPLAY_DISABLED', 400, 'Replay is not available for transient events', 'transient mode'],
    ['PATCH_TOUCHES_ENCRYPTED_FIELD', 422, 'The patch changes an encrypted field (/card). Encrypted fields cannot be edited in a replay.', 'Leave encrypted fields out of --patch'],
    ['PAYLOAD_NOT_JSON_OBJECT', 422, 'The stored payload is not JSON, so it cannot be patched.', 'Use --payload to replace it instead'],
    ['DESTINATION_OVERRIDE_NOT_FOUND', 400, 'Destination override not found in this organization', 'Destination "nope" was not found'],
    ['HEADERS_OVERRIDE_FORBIDDEN', 400, 'headersOverride cannot set "Host" — it\'s controlled by the worker', '--header cannot set "Host"'],
  ])('%s gets a readable message', async (code, status, error, expected) => {
    fetchMock.mockResolvedValueOnce(respond(status, { error, code }));
    await deliveries.deliveriesReplayCommand('dlv_1', { yes: true, destination: 'nope' });
    expect(text()).toContain('Failed to replay delivery');
    expect(text()).toContain(expected);
  });

  it.each([
    ['Event not found'],
    ['Delivery not found'],
  ])('a 404 without a code shows the API message (%s)', async (error) => {
    fetchMock.mockResolvedValueOnce(respond(404, { error }));
    await deliveries.deliveriesReplayCommand('dlv_1', { yes: true });
    expect(text()).toContain(error);
    if (error === 'Event not found') expect(text()).not.toContain('Delivery not found');
  });

  it('explains the events:send gate on a bridge replay', async () => {
    fetchMock.mockResolvedValueOnce(respond(403, { error: 'Permission denied: events:send', reason: 'no matching allow' }));
    await deliveries.deliveriesReplayCommand('dlv_1', { yes: true, destination: 'bridge' });
    expect(text()).toContain('also needs the events:send permission');
  });

  it('the confirmation names the edits', async () => {
    prompts.confirm.mockResolvedValue(false);
    await deliveries.deliveriesReplayCommand('dlv_1', { patch: '{"a":1}', header: ['X-A=1'] });
    expect(prompts.confirm.mock.calls[0][0].message).toBe('Replay delivery dlv_1 with a patched payload, 1 header override(s)?');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('deliveries bulk-replay', () => {
  it('reads queued/skipped (not replayed/failed)', async () => {
    fetchMock
      .mockResolvedValueOnce(respond(200, { deliveries: [{ id: 'd1', status: 'failed' }, { id: 'd2', status: 'failed' }], limit: 50, offset: 0 }))
      .mockResolvedValueOnce(respond(200, {
        message: '1 deliveries queued for replay, 1 skipped', queued: 1, skipped: 1,
        results: [{ originalId: 'd1', newId: 'n1', status: 'queued' }, { originalId: 'd2', newId: '', status: 'skipped', reason: 'Transient event - payload not stored' }],
      }));
    await deliveries.deliveriesBulkReplayCommand({ yes: true });
    expect(call(1).body).toEqual({ deliveryIds: ['d1', 'd2'] });
    expect(text()).toContain('Queued:  1');
    expect(text()).toContain('Skipped: 1');
    expect(text()).toContain('d2: Transient event - payload not stored');
    expect(text()).not.toContain('Not found:');
  });

  it('lists ids the API did not find, which are in neither queued nor skipped', async () => {
    fetchMock
      .mockResolvedValueOnce(respond(200, { deliveries: [{ id: 'd1', status: 'failed' }, { id: 'gone', status: 'failed' }], limit: 50, offset: 0 }))
      .mockResolvedValueOnce(respond(200, {
        message: '1 deliveries queued for replay, 0 skipped', queued: 1, skipped: 0,
        results: [{ originalId: 'd1', newId: 'n1', status: 'queued' }],
      }));
    await deliveries.deliveriesBulkReplayCommand({ yes: true });
    expect(text()).toContain('Queued:  1');
    expect(text()).toContain('Not found: 1');
    expect(text()).toContain('  gone');
  });
});

describe('deliveries get / list', () => {
  const row = {
    id: 'dlv_1', eventId: 'evt_1', routeId: 'rt_1', destinationId: 'dst_1', destinationName: 'Orders',
    status: 'held', attemptCount: 2, maxAttempts: 8, nextRetryAt: null, holdExpiresAt: '2026-11-12T10:00:00.000Z',
    responseStatus: 503, latencyMs: 812, errorMessage: 'Service Unavailable', deliveredAt: null,
    createdAt: '2026-11-12T09:00:00.000Z',
  };

  it('get shows held status, the hold deadline and latencyMs', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { delivery: { ...row, destinationUrl: 'https://example.test/hook' } }));
    await deliveries.deliveriesGetCommand('dlv_1', {});
    expect(text()).toContain('Status:        held');
    expect(text()).toContain('Held Until:');
    expect(text()).toContain('Response Time: 812ms');
    expect(text()).toContain('URL:           https://example.test/hook');
    expect(text()).not.toContain('Next Retry');
  });

  it('get shows deliveredAt as Delivered', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { delivery: { ...row, status: 'delivered', holdExpiresAt: null, deliveredAt: '2026-11-12T09:00:01.000Z' } }));
    await deliveries.deliveriesGetCommand('dlv_1', {});
    expect(text()).toContain('Delivered:');
  });

  it('list reads latencyMs and does not invent a total', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { deliveries: [row], limit: 50, offset: 0 }));
    await deliveries.deliveriesListCommand({});
    expect(tables[0][0][2]).toBe('held');
    expect(tables[0][0][5]).toBe('812ms');
    expect(text()).toContain('Showing 1 deliveries');
  });

  it('formatStatus has an explicit colour for every API status', async () => {
    const { DELIVERY_STATUSES } = await import('../lib/api.js');
    for (const status of DELIVERY_STATUSES) {
      expect(deliveries.formatStatus(status)).toBe(status);
    }
    expect(deliveries.formatStatus('something_new')).toBe('~something_new');
  });
});

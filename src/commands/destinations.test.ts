import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Command -> wire -> display for `destinations`, with the real api module and fetch mocked.
// Wire shapes: api/src/routes/destinations.ts (origin/main, 2026-11-12).

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

const prompts = { input: vi.fn(), confirm: vi.fn(), select: vi.fn(), number: vi.fn() };
vi.mock('@inquirer/prompts', () => prompts);
vi.mock('../lib/requireAuth.js', () => ({ requireAuth: () => {} }));
const advanced = {
  askAdvanced: vi.fn(async () => false),
  gatedPrompt: vi.fn(async () => {}),
  ensureFeature: vi.fn(() => true),
  loadFeatures: vi.fn(async () => {}),
  featureEnabled: vi.fn(() => true),
};
vi.mock('../lib/advanced.js', () => advanced);

const out: string[] = [];
const spinner = { succeed: vi.fn((m: string) => { out.push(m); }), fail: vi.fn((m: string) => { out.push(m); }), stop: vi.fn() };
vi.mock('../lib/logger.js', () => {
  const rec = (m: string) => { out.push(m); };
  const id = (m: string) => m;
  return {
    success: rec, error: rec, warn: rec, info: rec, log: rec, dim: rec,
    bold: id, green: id, red: id, yellow: id, blue: id, cyan: id, dimText: id,
    spinner: () => spinner,
    table: () => {},
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
const destinations = await import('./destinations.js');
const text = () => out.join('\n');

beforeEach(() => {
  out.length = 0;
  logSpy.mockClear();
  fetchMock.mockReset();
  for (const fn of Object.values(prompts)) fn.mockReset();
  advanced.ensureFeature.mockClear();
  advanced.loadFeatures.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('destinations create', () => {
  it('prints the one-time signing secret, labelled shown once', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { destination: {
      id: 'dst_1', name: 'Orders', slug: 'orders', url: 'https://example.test/hook', method: 'POST', type: 'http',
      hasSigningSecret: true, signingSecret: 'whsec_once',
    } }));
    await destinations.destinationsCreateCommand({ name: 'Orders', url: 'https://example.test/hook', yes: true });
    expect(call().body).toMatchObject({ name: 'Orders', slug: 'orders', url: 'https://example.test/hook', type: 'http' });
    expect(text()).toContain('Signing secret (shown once): whsec_once');
    expect(text()).toContain('destinations reveal-secret dst_1');
  });

  it('--json keeps the signing secret', async () => {
    const destination = { id: 'dst_1', name: 'Orders', type: 'http', hasSigningSecret: true, signingSecret: 'whsec_once' };
    fetchMock.mockResolvedValueOnce(respond(200, { destination }));
    await destinations.destinationsCreateCommand({ name: 'Orders', url: 'https://example.test/hook', yes: true, json: true });
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual(destination);
  });

  it('creates a bridge from flags without a URL, prompt or plan gate', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { destination: {
      id: 'dst_b', name: 'Bridge', type: 'bridge', url: '', hasSigningSecret: false, signingSecret: null,
      config: { eventTypeSource: 'field', eventTypeField: 'type', eventTypePrefix: 'stripe.' },
    } }));
    await destinations.destinationsCreateCommand({
      name: 'Bridge', type: 'bridge', eventTypeField: 'type', eventTypePrefix: 'stripe.',
      application: '0b9c8a52-63a4-4a43-9b3c-1d2e3f4a5b6c', allowUnverifiedSources: true,
    });
    expect(prompts.input).not.toHaveBeenCalled();
    expect(advanced.ensureFeature).not.toHaveBeenCalled();
    expect(call().body).toMatchObject({
      name: 'Bridge', type: 'bridge', url: '',
      config: {
        eventTypeSource: 'field', eventTypeField: 'type', eventTypePrefix: 'stripe.',
        applicationId: '0b9c8a52-63a4-4a43-9b3c-1d2e3f4a5b6c', allowUnverifiedSources: true,
      },
    });
    expect(text()).toContain('Type:   bridge');
    expect(text()).toContain('from payload field type');
    expect(text()).not.toContain('Signing secret');
  });

  it('reads a bridge --config from @file and lets flags override it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hb-dest-'));
    const file = join(dir, 'bridge.json');
    writeFileSync(file, JSON.stringify({ eventTypeSource: 'fixed', eventType: 'order.created' }));
    fetchMock.mockResolvedValueOnce(respond(200, { destination: { id: 'dst_b', name: 'B', type: 'bridge' } }));
    await destinations.destinationsCreateCommand({ name: 'B', type: 'bridge', config: `@${file}`, eventType: 'order.updated' });
    expect(call().body.config).toEqual({ eventTypeSource: 'fixed', eventType: 'order.updated' });
  });

  it('refuses bridge flags without --type bridge, an unknown --type, and a bridge with no event type', async () => {
    await destinations.destinationsCreateCommand({ name: 'X', url: 'https://example.test', eventType: 'a.b' });
    await destinations.destinationsCreateCommand({ name: 'X', type: 'kafka' });
    await destinations.destinationsCreateCommand({ name: 'X', type: 'bridge' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(text()).toContain('need --type bridge');
    expect(text()).toContain('Invalid --type "kafka"');
    expect(text()).toContain('A bridge needs an event type');
  });

  it('a queue type is still plan-gated', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { destination: { id: 'dst_q', name: 'Q', type: 'sqs', config: { queueUrl: 'https://sqs.x/q' } } }));
    await destinations.destinationsCreateCommand({ name: 'Q', type: 'sqs', config: '{"queueUrl":"https://sqs.x/q"}' });
    expect(advanced.ensureFeature).toHaveBeenCalledWith('sqs_destinations', 'Queue/event-bus destinations');
    expect(call().body).toMatchObject({ type: 'sqs', config: { queueUrl: 'https://sqs.x/q' } });
  });
});

describe('destinations get', () => {
  it('shows hasSigningSecret for HTTP', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { destination: {
      id: 'dst_1', name: 'Orders', slug: 'orders', url: 'https://example.test', method: 'POST', type: 'http', hasSigningSecret: true,
    } }));
    await destinations.destinationsGetCommand('orders', {});
    expect(text()).toContain('Signing:     signed');
  });

  it('renders a bridge config, without HTTP-only rows', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { destination: {
      id: 'dst_b', name: 'Bridge', slug: 'bridge', url: '', method: 'POST', type: 'bridge', hasSigningSecret: false,
      config: { eventTypeSource: 'fixed', eventType: 'order.created', applicationId: 'app-1' },
    } }));
    await destinations.destinationsGetCommand('bridge', {});
    expect(text()).toContain('Type:        bridge');
    expect(text()).toContain('Event Type:  order.created');
    expect(text()).toContain('Application: app-1');
    expect(text()).toContain('Unverified:  not published');
    expect(text()).not.toContain('URL:');
    expect(text()).not.toContain('Bucket');
  });

  it('renders a queue config instead of Bucket/File Format', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { destination: {
      id: 'dst_q', name: 'Q', slug: 'q', type: 'sqs', config: { queueUrl: 'https://sqs.us-east-1.amazonaws.com/1/q', region: 'us-east-1', accessKeyId: '••••' },
    } }));
    await destinations.destinationsGetCommand('q', {});
    expect(text()).toContain('Queue URL:   https://sqs.us-east-1.amazonaws.com/1/q');
    expect(text()).not.toContain('Bucket');
    expect(text()).not.toContain('File Format');
  });
});

describe('destinations reveal-secret / rotate-secret', () => {
  it('reveal prints the secret and the grace deadline', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { signingSecret: 'whsec_cur', previousSecretExpiresAt: '2026-11-12T11:00:00.000Z' }));
    await destinations.destinationsRevealSecretCommand('orders', {});
    expect(call().method).toBe('GET');
    expect(call().url.pathname).toBe('/api/destinations/orders/reveal-secret');
    expect(text()).toContain('Signing secret: whsec_cur');
    expect(text()).toContain('2026-11-12T11:00:00.000Z');
  });

  it('rotate sends gracePeriodSeconds and prints both fields; --json passes them through', async () => {
    const data = { signingSecret: 'whsec_new', previousSecretExpiresAt: '2026-11-12T10:05:00.000Z' };
    fetchMock.mockResolvedValueOnce(respond(200, data));
    await destinations.destinationsRotateSecretCommand('orders', { gracePeriod: '300', yes: true, json: true });
    expect(call().method).toBe('POST');
    expect(call().url.pathname).toBe('/api/destinations/orders/rotate-secret');
    expect(call().body).toEqual({ gracePeriodSeconds: 300 });
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual(data);
  });

  it('rotate without --grace-period sends an empty body (server default 3600)', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { signingSecret: 'whsec_new', previousSecretExpiresAt: null }));
    await destinations.destinationsRotateSecretCommand('orders', { yes: true });
    expect(call().body).toEqual({});
    expect(text()).toContain('New signing secret: whsec_new');
  });

  it.each(['-1', '86401', '1.5', 'abc', ''])('rejects --grace-period %j before any request', async (gracePeriod) => {
    await destinations.destinationsRotateSecretCommand('orders', { gracePeriod, yes: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(text()).toContain('--grace-period must be a whole number of seconds from 0 to 86400');
  });

  it('accepts the bounds 0 and 86400', async () => {
    fetchMock.mockResolvedValue(respond(200, { signingSecret: 's', previousSecretExpiresAt: null }));
    await destinations.destinationsRotateSecretCommand('orders', { gracePeriod: '0', yes: true });
    await destinations.destinationsRotateSecretCommand('orders', { gracePeriod: '86400', yes: true });
    expect(call(0).body).toEqual({ gracePeriodSeconds: 0 });
    expect(call(1).body).toEqual({ gracePeriodSeconds: 86400 });
  });
});

describe('destinations test', () => {
  it('reads status/latencyMs for an HTTP test', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { success: true, status: 204, latencyMs: 41, responseBody: '' }));
    await destinations.destinationsTestCommand('orders', {});
    expect(call().body).toBeUndefined();
    expect(text()).toContain('Status Code:   204');
    expect(text()).toContain('Response Time: 41ms');
  });

  it('renders a bridge dry run and sends --payload', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { success: true, dryRun: true, eventType: 'stripe.invoice.paid', eventTypeExists: true, matchingEndpoints: 3 }));
    await destinations.destinationsTestCommand('bridge', { payload: '{"type":"invoice.paid"}' });
    expect(call().body).toEqual({ payload: { type: 'invoice.paid' } });
    expect(text()).toContain('Dry run: the bridge would publish this event');
    expect(text()).toContain('Event Type:    stripe.invoice.paid');
    expect(text()).toContain('Endpoints:     3 subscribed');
  });

  it('explains a dry run that resolves nothing', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { success: false, dryRun: true, eventType: null, eventTypeExists: false, matchingEndpoints: 0, error: "Payload field 'type' is missing" }));
    await destinations.destinationsTestCommand('bridge', {});
    expect(text()).toContain('would not publish');
    expect(text()).toContain("Reason:        Payload field 'type' is missing");
  });

  it('rejects a --payload that is not a JSON object', async () => {
    await destinations.destinationsTestCommand('bridge', { payload: '[1]' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(text()).toContain('--payload must be a JSON object');
  });
});

describe('destinations update (bridge)', () => {
  it('applies bridge flags over the stored config and switches source cleanly', async () => {
    fetchMock
      .mockResolvedValueOnce(respond(200, { destination: { id: 'dst_b', type: 'bridge', config: { eventTypeSource: 'field', eventTypeField: 'type', eventTypePrefix: 'stripe.', applicationId: 'app-1' } } }))
      .mockResolvedValueOnce(respond(200, { destination: { id: 'dst_b' } }));
    await destinations.destinationsUpdateCommand('dst_b', { eventType: 'order.created', application: false });
    expect(call(1).method).toBe('PATCH');
    expect(call(1).body).toEqual({ config: { eventTypeSource: 'fixed', eventType: 'order.created', applicationId: null } });
  });

  it('refuses bridge flags on a non-bridge destination', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { destination: { id: 'dst_1', type: 'http' } }));
    await destinations.destinationsUpdateCommand('dst_1', { allowUnverifiedSources: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(text()).toContain('apply only to bridge destinations (this one is http)');
  });
});

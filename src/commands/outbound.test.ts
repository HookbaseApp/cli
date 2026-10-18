import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Command -> wire -> display for the outbound commands, with the real api module and fetch mocked.

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

const prompts = { input: vi.fn(), confirm: vi.fn(), select: vi.fn(), checkbox: vi.fn(), editor: vi.fn() };
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
    bold: id, green: id, red: id, yellow: id, blue: id, cyan: id, dimText: id,
    spinner: () => spinner,
    table: (_h: string[], rows: string[][]) => { tables.push(rows); },
    box: (title: string, content: string) => { out.push(`[${title}]\n${content}`); },
  };
});

const fetchMock = vi.fn();
const respond = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
const page = <T>(data: T[], nextCursor: string | null) => respond(200, { data, pagination: { hasMore: nextCursor !== null, nextCursor } });

function call(n = 0) {
  const [url, init] = fetchMock.mock.calls[n];
  return {
    url: new URL(url as string),
    method: init.method as string,
    headers: init.headers as Record<string, string>,
    body: init.body ? JSON.parse(init.body as string) : undefined,
  };
}

const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
const outbound = await import('./outbound.js');
const endpoints = await import('./endpoints.js');
const { sendCommand } = await import('./send.js');
const text = () => out.join('\n');

const msg = (id: string) => ({
  id, eventId: 'evt', eventType: 'order.created', applicationId: 'app', endpointId: 'ep',
  status: 'awaiting_retry', attempts: 2, maxAttempts: 5, lastResponseStatus: 503, lastErrorMessage: 'boom',
  createdAt: '2026-10-17T00:00:00.000Z', completedAt: null,
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

describe('messages list', () => {
  it('pages past 100 for a larger --limit and prints the resume cursor', async () => {
    fetchMock
      .mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, i) => msg(`msg_${i}_xxxxxxxx`)), 'cur1'))
      .mockResolvedValueOnce(page(Array.from({ length: 20 }, (_, i) => msg(`msg_b${i}_xxxxxxx`)), 'cur2'));
    await outbound.outboundListCommand({ limit: '120' });
    expect(call(0).url.searchParams.get('limit')).toBe('100');
    expect(call(1).url.searchParams.get('cursor')).toBe('cur1');
    expect(call(1).url.searchParams.get('limit')).toBe('20');
    expect(tables[0]).toHaveLength(120);
    expect(tables[0][0][2]).toBe('awaiting_retry');
    expect(tables[0][0][3]).toBe('2/5');
    expect(text()).toContain('--cursor cur2');
  });

  it('--cursor resumes and --json reports hasMore/nextCursor (no fake total)', async () => {
    fetchMock.mockResolvedValueOnce(page([msg('msg_1_xxxxxxxxxx')], null));
    await outbound.outboundListCommand({ cursor: 'opaque|cursor', json: true });
    expect(call().url.searchParams.get('cursor')).toBe('opaque|cursor');
    const printed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(printed).toEqual({ messages: [msg('msg_1_xxxxxxxxxx')], hasMore: false, nextCursor: null });
  });

  it('rejects a non-numeric --limit without calling the API', async () => {
    await outbound.outboundListCommand({ limit: 'abc' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(text()).toContain('--limit must be a positive whole number');
  });
});

describe('dlq', () => {
  it('retry goes to /dlq/:id/retry', async () => {
    fetchMock.mockResolvedValueOnce(respond(201, { data: { originalMessageId: 'm1', newMessageId: 'm2', status: 'queued' } }));
    await outbound.dlqRetryCommand('m1', { yes: true });
    expect(call().url.pathname).toBe('/api/outbound-messages/dlq/m1/retry');
    expect(text()).toContain('queued for retry as m2');
  });

  it('bulk-retry lists the DLQ, labels by dlqReason and posts one retry-bulk call', async () => {
    fetchMock
      .mockResolvedValueOnce(page([{ ...msg('dlq_1_xxxxxxxxxx'), dlqReason: 'max_retries_exceeded' }], null))
      .mockResolvedValueOnce(respond(201, { data: { queued: 1, skipped: 0, messages: [{ originalMessageId: 'dlq_1_xxxxxxxxxx', newMessageId: 'n1' }] } }));
    prompts.checkbox.mockImplementation(async (cfg: { choices: Array<{ name: string; value: string }> }) => {
      expect(cfg.choices[0].name).toContain('(max_retries_exceeded)');
      return cfg.choices.map((c) => c.value);
    });
    prompts.confirm.mockResolvedValue(true);
    await outbound.dlqBulkRetryCommand({});
    expect(call(0).url.pathname).toBe('/api/outbound-messages/dlq/messages');
    expect(call(1).url.pathname).toBe('/api/outbound-messages/dlq/retry-bulk');
    expect(call(1).body).toEqual({ messageIds: ['dlq_1_xxxxxxxxxx'] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(text()).toContain('Queued 1 message(s) for retry');
  });

  it('dlq list shows dlqReason', async () => {
    fetchMock.mockResolvedValueOnce(page([{ ...msg('dlq_1_xxxxxxxxxx'), dlqReason: 'circuit_open', dlqMovedAt: '2026-10-17T01:00:00.000Z' }], null));
    await outbound.dlqListCommand({});
    expect(tables[0][0][2]).toBe('circuit_open');
  });
});

describe('send', () => {
  it('a single --endpoints id goes out as endpointIds + endpointId, with the idempotency key in body and header', async () => {
    fetchMock.mockResolvedValueOnce(respond(201, { data: { eventId: 'evt_1', messagesQueued: 1, endpoints: [{ id: 'ep_1', url: 'https://x' }] } }));
    await sendCommand({ app: 'app_1', eventType: 'order.created', payload: '{"a":1}', endpoints: 'ep_1', idempotencyKey: 'k1' });
    const { body, headers } = call();
    expect(body).toMatchObject({ endpointIds: ['ep_1'], endpointId: 'ep_1', idempotencyKey: 'k1' });
    expect(headers['Idempotency-Key']).toBe('k1');
    expect(text()).toContain('Event ID:        evt_1');
  });
});

describe('endpoints', () => {
  it('test reads delivery.responseStatus / responseTimeMs / errorMessage', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, {
      success: false,
      testEvent: { id: 'e', type: 't', timestamp: 'x' },
      delivery: { status: 'failed', responseStatus: 502, responseTimeMs: 87, responseBody: '', errorMessage: 'Bad gateway' },
      signature: { header: 'webhook-signature', value: 'v1,x', timestamp: 1 },
    }));
    await endpoints.endpointsTestCommand('ep_1', {});
    expect(text()).toContain('Status Code:   502');
    expect(text()).toContain('Response Time: 87ms');
    expect(text()).toContain('Error:         Bad gateway');
  });

  it('rotate-secret sends --grace-period and shows the expiry and version', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { secret: 'whsec_new', previousSecretExpiresAt: '2026-10-18T00:00:00.000Z', secretVersion: 4 }));
    await endpoints.endpointsRotateSecretCommand('ep_1', { gracePeriod: '600', yes: true });
    expect(call().body).toEqual({ gracePeriodSeconds: 600 });
    expect(text()).toContain('whsec_new');
    expect(text()).toContain('Version:                4');
    expect(text()).toContain('Old secret valid until:');
  });

  it('rotate-secret rejects an out-of-range --grace-period', async () => {
    await endpoints.endpointsRotateSecretCommand('ep_1', { gracePeriod: '90000', yes: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(text()).toContain('--grace-period must be');
  });

  it('list follows the cursor and computes success rate from the counters', async () => {
    const ep = (id: string, totalMessages: number, totalSuccesses: number) => ({
      id, applicationId: 'app_123456789', url: 'https://example.test/hook', isDisabled: false,
      circuitState: 'closed', totalMessages, totalSuccesses, createdAt: 'x', updatedAt: 'x',
    });
    fetchMock
      .mockResolvedValueOnce(page([ep('ep_aaaaaaaaaaaa', 4, 3)], 'c1'))
      .mockResolvedValueOnce(page([ep('ep_bbbbbbbbbbbb', 0, 0)], null));
    await endpoints.endpointsListCommand({});
    expect(call(1).url.searchParams.get('cursor')).toBe('c1');
    expect(tables[0]).toHaveLength(2);
    expect(tables[0][0][5]).toBe('75.0%');
    expect(tables[0][1][5]).toBe('-');
  });
});

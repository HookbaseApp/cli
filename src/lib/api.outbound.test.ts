import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Wire contract of the outbound client, pinned against the API routes:
//   send-event.ts          sendEventSchema (endpointId, endpointIds, idempotencyKey) + Idempotency-Key header
//   outbound-messages.ts   list / dlq/messages pagination { data, pagination: { hasMore, nextCursor } },
//                          POST /dlq/:id/retry, POST /dlq/retry-bulk { messageIds } (max 100)
//   webhook-endpoints.ts   rotateSecretSchema { gracePeriodSeconds }, bare rotate response, /test shape
//   webhook-applications.ts / webhook-endpoints.ts list pagination

const auth = { session: false };

vi.mock('./config.js', () => ({
  getApiUrl: () => 'https://api.example.test',
  getAuthToken: () => (auth.session ? null : 'whr_test_key'),
  getCurrentOrg: () => (auth.session ? { id: 'org_1', slug: 'acme', name: 'Acme' } : null),
  getSessionAccessToken: () => (auth.session ? 'session-token' : null),
  getSessionRefreshToken: () => null,
  getSessionUser: () => null,
  setSession: () => {},
  clearSession: () => {},
  isAuthenticated: () => true,
  hasSession: () => auth.session,
}));

const fetchMock = vi.fn();

function respond(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

beforeEach(() => {
  auth.session = false;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(respond(200, { data: {} }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function call(n = 0): { url: URL; method: string; headers: Record<string, string>; body?: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls[n];
  return {
    url: new URL(url as string),
    method: init.method as string,
    headers: init.headers as Record<string, string>,
    body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined,
  };
}

function page<T>(data: T[], nextCursor: string | null) {
  return respond(200, { data, pagination: { hasMore: nextCursor !== null, nextCursor } });
}

const api = await import('./api.js');

describe('sendWebhookEvent', () => {
  it('sends a single target as both endpointIds and endpointId', async () => {
    await api.sendWebhookEvent({ applicationId: 'app_1', eventType: 'order.created', payload: { a: 1 }, endpointIds: ['ep_1'] });
    const { url, method, body } = call();
    expect(method).toBe('POST');
    expect(url.pathname).toBe('/api/send-event');
    expect(body).toEqual({
      applicationId: 'app_1',
      eventType: 'order.created',
      payload: { a: 1 },
      endpointIds: ['ep_1'],
      endpointId: 'ep_1',
    });
  });

  it('sends several targets as endpointIds only', async () => {
    await api.sendWebhookEvent({ eventType: 'x', payload: {}, endpointIds: ['ep_1', 'ep_2'] });
    const { body } = call();
    expect(body?.endpointIds).toEqual(['ep_1', 'ep_2']);
    expect(body).not.toHaveProperty('endpointId');
  });

  it('sends no targeting fields when no endpoints are given', async () => {
    await api.sendWebhookEvent({ eventType: 'x', payload: {}, endpointIds: [] });
    const { body } = call();
    expect(body).not.toHaveProperty('endpointIds');
    expect(body).not.toHaveProperty('endpointId');
  });

  it('puts the idempotency key in the body and the Idempotency-Key header', async () => {
    await api.sendWebhookEvent({ eventType: 'x', payload: {}, idempotencyKey: 'key-123' });
    const { body, headers } = call();
    expect(body?.idempotencyKey).toBe('key-123');
    expect(headers['Idempotency-Key']).toBe('key-123');
    expect(headers.Authorization).toBe('Bearer whr_test_key');
  });

  it('sends neither when there is no key', async () => {
    await api.sendWebhookEvent({ eventType: 'x', payload: {} });
    const { body, headers } = call();
    expect(body).not.toHaveProperty('idempotencyKey');
    expect(headers).not.toHaveProperty('Idempotency-Key');
  });

  it('carries the Idempotency-Key header on the session path too', async () => {
    auth.session = true;
    await api.sendWebhookEvent({ eventType: 'x', payload: {}, idempotencyKey: 'key-9' });
    const { url, headers } = call();
    expect(url.pathname).toBe('/api/organizations/org_1/send-event');
    expect(headers['Idempotency-Key']).toBe('key-9');
    expect(headers.Authorization).toBe('Bearer session-token');
  });

  it('returns the { data: { eventId, messagesQueued, endpoints } } envelope', async () => {
    fetchMock.mockResolvedValue(respond(201, { data: { eventId: 'evt_1', messagesQueued: 1, endpoints: [{ id: 'ep_1', url: 'https://x' }] } }));
    const res = await api.sendWebhookEvent({ eventType: 'x', payload: {} });
    expect(res.data?.data).toEqual({ eventId: 'evt_1', messagesQueued: 1, endpoints: [{ id: 'ep_1', url: 'https://x' }] });
  });
});

describe('list pagination', () => {
  it('passes limit and an opaque cursor verbatim, never offset', async () => {
    const cursor = '2026-10-17T12:00:00.000Z|msg_01J+/=';
    await api.getWebhookMessages({ limit: 20, cursor, status: 'awaiting_retry', eventType: 'a.b' });
    const { url } = call();
    expect(url.pathname).toBe('/api/outbound-messages');
    expect(url.searchParams.get('cursor')).toBe(cursor);
    expect(url.searchParams.get('limit')).toBe('20');
    expect(url.searchParams.get('status')).toBe('awaiting_retry');
    expect(url.searchParams.get('eventType')).toBe('a.b');
    expect(url.searchParams.has('offset')).toBe(false);
  });

  it('getDlqMessages uses /dlq/messages with the same cursor params', async () => {
    await api.getDlqMessages({ limit: 5, cursor: 'opaque', endpointId: 'ep_1' });
    const { url } = call();
    expect(url.pathname).toBe('/api/outbound-messages/dlq/messages');
    expect(url.searchParams.get('cursor')).toBe('opaque');
    expect(url.searchParams.get('endpointId')).toBe('ep_1');
    expect(url.searchParams.has('offset')).toBe(false);
  });

  it('collectPages follows nextCursor until hasMore is false', async () => {
    fetchMock
      .mockResolvedValueOnce(page([{ id: 'a' }, { id: 'b' }], 'c1'))
      .mockResolvedValueOnce(page([{ id: 'c' }], 'c2'))
      .mockResolvedValueOnce(page([{ id: 'd' }], null));
    const res = await api.listAllWebhookApplications();
    expect(res.data?.data.map((a) => a.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(res.data?.pagination).toEqual({ hasMore: false, nextCursor: null });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(call(0).url.searchParams.has('cursor')).toBe(false);
    expect(call(1).url.searchParams.get('cursor')).toBe('c1');
    expect(call(2).url.searchParams.get('cursor')).toBe('c2');
    expect(call(0).url.pathname).toBe('/api/webhook-applications');
  });

  it('collectPages stops at max, asks for only the rows still wanted, and returns the resume cursor', async () => {
    const rows = (n: number, p: string) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}` }));
    fetchMock
      .mockResolvedValueOnce(page(rows(100, 'a'), 'c1'))
      .mockResolvedValueOnce(page(rows(50, 'b'), 'c2'));
    const res = await api.collectPages((p) => api.getWebhookMessages({ ...p }), { max: 150, cursor: 'start' });
    expect(res.data?.data).toHaveLength(150);
    expect(call(0).url.searchParams.get('limit')).toBe('100');
    expect(call(0).url.searchParams.get('cursor')).toBe('start');
    expect(call(1).url.searchParams.get('limit')).toBe('50');
    expect(call(1).url.searchParams.get('cursor')).toBe('c1');
    expect(res.data?.pagination).toEqual({ hasMore: true, nextCursor: 'c2' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('collectPages stops when the server repeats a cursor', async () => {
    fetchMock.mockResolvedValue(page([{ id: 'x' }], 'same'));
    const res = await api.collectPages((p) => api.getWebhookMessages({ ...p }), { cursor: 'same' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.data?.data).toHaveLength(1);
  });

  it('collectPages surfaces a page error', async () => {
    fetchMock
      .mockResolvedValueOnce(page([{ id: 'a' }], 'c1'))
      .mockResolvedValueOnce(respond(500, { error: 'boom' }));
    const res = await api.collectPages((p) => api.getWebhookMessages({ ...p }));
    expect(res.error).toBe('boom');
    expect(res.status).toBe(500);
  });

  it('listAllWebhookEndpoints keeps the applicationId filter on every page', async () => {
    fetchMock
      .mockResolvedValueOnce(page([{ id: 'e1' }], 'c1'))
      .mockResolvedValueOnce(page([{ id: 'e2' }], null));
    const res = await api.listAllWebhookEndpoints('app_1');
    expect(res.data?.data.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(call(0).url.pathname).toBe('/api/webhook-endpoints');
    expect(call(0).url.searchParams.get('applicationId')).toBe('app_1');
    expect(call(1).url.searchParams.get('applicationId')).toBe('app_1');
    expect(call(1).url.searchParams.get('cursor')).toBe('c1');
  });
});

describe('DLQ retry', () => {
  it('retries a single message through POST /dlq/:id/retry', async () => {
    fetchMock.mockResolvedValue(respond(201, { data: { originalMessageId: 'm1', newMessageId: 'm2', status: 'queued' } }));
    const res = await api.retryDlqMessage('m1');
    const { url, method } = call();
    expect(method).toBe('POST');
    expect(url.pathname).toBe('/api/outbound-messages/dlq/m1/retry');
    expect(res.data?.data.newMessageId).toBe('m2');
  });

  it('bulk-retries through POST /dlq/retry-bulk in chunks of 100 and sums the results', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `m${i}`);
    fetchMock
      .mockResolvedValueOnce(respond(201, { data: { queued: 99, skipped: 1, messages: [{ originalMessageId: 'm0', newMessageId: 'n0' }] } }))
      .mockResolvedValueOnce(respond(201, { data: { queued: 50, skipped: 0, messages: [{ originalMessageId: 'm100', newMessageId: 'n100' }] } }));
    const res = await api.bulkRetryDlqMessages(ids);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(call(0).url.pathname).toBe('/api/outbound-messages/dlq/retry-bulk');
    expect(call(0).body).toEqual({ messageIds: ids.slice(0, 100) });
    expect(call(1).body).toEqual({ messageIds: ids.slice(100) });
    expect(res.data).toEqual({
      queued: 149,
      skipped: 1,
      messages: [
        { originalMessageId: 'm0', newMessageId: 'n0' },
        { originalMessageId: 'm100', newMessageId: 'n100' },
      ],
    });
  });

  it('counts a chunk the API 404s (nothing left in the DLQ) as skipped', async () => {
    fetchMock.mockResolvedValue(respond(404, { error: 'No valid DLQ messages found' }));
    const res = await api.bulkRetryDlqMessages(['m1', 'm2']);
    expect(res.error).toBeUndefined();
    expect(res.data).toEqual({ queued: 0, skipped: 2, messages: [] });
  });

  it('stops on any other error and says how many were already queued', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `m${i}`);
    fetchMock
      .mockResolvedValueOnce(respond(201, { data: { queued: 100, skipped: 0, messages: [] } }))
      .mockResolvedValueOnce(respond(403, { error: 'Forbidden' }));
    const res = await api.bulkRetryDlqMessages(ids);
    expect(res.status).toBe(403);
    expect(res.error).toContain('Forbidden');
    expect(res.error).toContain('100 message(s) were already queued');
  });
});

describe('endpoint rotate-secret and test', () => {
  it('sends gracePeriodSeconds and maps the bare response', async () => {
    fetchMock.mockResolvedValue(respond(200, { secret: 'whsec_new', previousSecretExpiresAt: '2026-10-18T00:00:00.000Z', secretVersion: 3 }));
    const res = await api.rotateWebhookEndpointSecret('ep_1', { gracePeriodSeconds: 0 });
    const { url, method, body } = call();
    expect(method).toBe('POST');
    expect(url.pathname).toBe('/api/webhook-endpoints/ep_1/rotate-secret');
    expect(body).toEqual({ gracePeriodSeconds: 0 });
    expect(res.data).toEqual({ secret: 'whsec_new', previousSecretExpiresAt: '2026-10-18T00:00:00.000Z', secretVersion: 3 });
  });

  it('sends an empty body when no grace period is given (server default 3600)', async () => {
    await api.rotateWebhookEndpointSecret('ep_1');
    expect(call().body).toEqual({});
  });

  it('test returns the nested delivery outcome', async () => {
    const body = {
      success: false,
      testEvent: { id: 'evt', type: 'test', timestamp: 't' },
      delivery: { status: 'failed', responseStatus: 500, responseTimeMs: 42, responseBody: 'x', errorMessage: 'HTTP 500' },
      signature: { header: 'webhook-signature', value: 'v1,abc', timestamp: 1 },
    };
    fetchMock.mockResolvedValue(respond(200, body));
    const res = await api.testWebhookEndpoint('ep_1');
    expect(call().url.pathname).toBe('/api/webhook-endpoints/ep_1/test');
    expect(res.data?.delivery.responseStatus).toBe(500);
    expect(res.data?.delivery.errorMessage).toBe('HTTP 500');
  });

  it('endpointSuccessRate derives from totalSuccesses / totalMessages', () => {
    expect(api.endpointSuccessRate({ totalMessages: 4, totalSuccesses: 3 })).toBe(0.75);
    expect(api.endpointSuccessRate({ totalMessages: 0, totalSuccesses: 0 })).toBeUndefined();
    expect(api.endpointSuccessRate({})).toBeUndefined();
  });
});

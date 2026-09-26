import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The wire payloads these tests pin come from api/src/routes/webhook-applications.ts:
//   createApplicationSchema: externalId?, name, metadata?, rateLimitPerSecond?,
//                            rateLimitPerMinute?, rateLimitPerHour?
//   updateApplicationSchema: name?, metadata?, the three rate limits, isDisabled?, disabledReason?
// Neither accepts `uid` or `description`, and `webhook_applications` has no description column.
// The CLI used to send both; z.object() dropped them silently, so --uid set nothing and
// --description did nothing. Once those schemas become .strict() the same payloads 400 instead.
// These tests fail on either regression.

vi.mock('./config.js', () => ({
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

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: { id: 'app_1', name: 'n' } }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The JSON body of the single fetch call made by the method under test. */
function sentBody(): Record<string, unknown> {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [, init] = fetchMock.mock.calls[0];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

function sentTo(): { url: string; method: string } {
  const [url, init] = fetchMock.mock.calls[0];
  return { url: url as string, method: init.method as string };
}

describe('createWebhookApplication', () => {
  it('sends externalId, never uid', async () => {
    const api = await import('./api.js');
    await api.createWebhookApplication({ name: 'My App', externalId: 'ext-123' });

    const body = sentBody();
    expect(body.externalId).toBe('ext-123');
    expect(body).not.toHaveProperty('uid');
  });

  it('never sends description', async () => {
    const api = await import('./api.js');
    await api.createWebhookApplication({ name: 'My App' });
    expect(sentBody()).not.toHaveProperty('description');
  });

  it('sends only keys createApplicationSchema accepts', async () => {
    const api = await import('./api.js');
    await api.createWebhookApplication({
      name: 'My App',
      externalId: 'ext-123',
      rateLimitPerMinute: 60,
    });

    const allowed = new Set([
      'externalId', 'name', 'metadata',
      'rateLimitPerSecond', 'rateLimitPerMinute', 'rateLimitPerHour',
    ]);
    for (const key of Object.keys(sentBody())) {
      expect(allowed, `create sent unknown key "${key}"`).toContain(key);
    }
  });

  it('POSTs to /api/webhook-applications', async () => {
    const api = await import('./api.js');
    await api.createWebhookApplication({ name: 'My App' });
    expect(sentTo()).toEqual({
      url: 'https://api.example.test/api/webhook-applications',
      method: 'POST',
    });
  });
});

describe('updateWebhookApplication', () => {
  it('sends only keys updateApplicationSchema accepts', async () => {
    const api = await import('./api.js');
    await api.updateWebhookApplication('app_1', {
      name: 'Renamed',
      rateLimitPerMinute: 120,
      isDisabled: true,
      disabledReason: 'over quota',
    });

    const allowed = new Set([
      'name', 'metadata', 'rateLimitPerSecond', 'rateLimitPerMinute',
      'rateLimitPerHour', 'isDisabled', 'disabledReason',
    ]);
    for (const key of Object.keys(sentBody())) {
      expect(allowed, `update sent unknown key "${key}"`).toContain(key);
    }
  });

  it('PATCHes to /api/webhook-applications/:id', async () => {
    const api = await import('./api.js');
    await api.updateWebhookApplication('app_1', { name: 'Renamed' });
    expect(sentTo()).toEqual({
      url: 'https://api.example.test/api/webhook-applications/app_1',
      method: 'PATCH',
    });
  });

  it('passes a description through to the wire only if a caller forces it past the type', async () => {
    // updateWebhookApplication forwards `data` as-is, so the type is the only thing keeping
    // `description` off the wire. This documents that and fails if the guarantee is ever
    // needed at runtime instead -- see applicationsUpdateCommand, which never sets it.
    const api = await import('./api.js');
    const forced = { name: 'Renamed', description: 'nope' } as Parameters<
      typeof api.updateWebhookApplication
    >[1];
    await api.updateWebhookApplication('app_1', forced);
    expect(sentBody()).toHaveProperty('description');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Wire shapes from api/src/routes/sources.ts (createSourceSchema / updateSourceSchema are .strict())
// and api/src/routes/catalog.ts (public, no auth).

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

function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce({ ok: status < 400, status, text: async () => JSON.stringify(body) });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function call(i = 0): { url: string; method: string; body?: Record<string, unknown>; headers?: Record<string, string> } {
  const [url, init] = fetchMock.mock.calls[i];
  return {
    url: url as string,
    method: init.method as string,
    body: init.body ? JSON.parse(init.body as string) : undefined,
    headers: init.headers as Record<string, string> | undefined,
  };
}

describe('source secret wiring', () => {
  it('createSource sends signingSecret and verifyToken', async () => {
    const api = await import('./api.js');
    respond({ source: { id: 's1' } });
    await api.createSource('n', 'n', 'whatsapp', { signingSecret: 'app-secret', verifyToken: 'tok' });
    const { body } = call();
    expect(body).toMatchObject({ provider: 'whatsapp', signingSecret: 'app-secret', verifyToken: 'tok' });
    expect(body).not.toHaveProperty('signing_secret');
  });

  it('updateSource sends signingSecret (null clears) and verifyToken', async () => {
    const api = await import('./api.js');
    respond({ success: true });
    await api.updateSource('s1', { signingSecret: null, verifyToken: '' });
    const { method, url, body } = call();
    expect(method).toBe('PATCH');
    expect(url).toBe('https://api.example.test/api/sources/s1');
    expect(body!.signingSecret).toBeNull();
    expect(body!.verifyToken).toBe('');
  });

  it.each([
    ['revealSourceSecret', 'GET', '/api/sources/my-src/reveal-secret'],
    ['getSourceVerifyToken', 'GET', '/api/sources/my-src/verify-token'],
    ['rotateSourceVerifyToken', 'POST', '/api/sources/my-src/rotate-verify-token'],
    ['getSourcePendingVerification', 'GET', '/api/sources/my-src/pending-verification'],
    ['adoptSourcePendingVerification', 'POST', '/api/sources/my-src/pending-verification/adopt'],
    ['rotateSourceSecret', 'POST', '/api/sources/my-src/rotate-secret'],
  ] as const)('%s -> %s %s', async (fn, method, path) => {
    const api = await import('./api.js');
    respond({});
    await (api[fn] as (id: string) => Promise<unknown>)('my-src');
    expect(call()).toMatchObject({ method, url: `https://api.example.test${path}` });
  });
});

describe('provider catalog', () => {
  it('is fetched without credentials', async () => {
    const api = await import('./api.js');
    respond({ providers: [], categories: [], total: 0 });
    await api.getProviderCatalog();
    const c = call();
    expect(c.url).toBe('https://api.example.test/api/catalog/providers');
    expect(c.headers?.Authorization).toBeUndefined();
  });

  it('detail encodes the id', async () => {
    const api = await import('./api.js');
    respond({ provider: {} });
    await api.getProviderCatalogEntry('mollie-nextgen');
    expect(call().url).toBe('https://api.example.test/api/catalog/providers/mollie-nextgen');
  });
});

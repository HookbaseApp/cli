import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Offset pagination on the inbound list routes (api/src/routes/{sources,destinations,routes,
// transforms,filters}.ts): `?page=N&pageSize=M`, pageSize defaults to 20 and is capped at 100, and
// the body is `{ <key>: rows, pagination: { total, page, pageSize } }`. getSources & co. feed the
// id/slug/name lookups, so they must return every page, not just the first.

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
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

/** Serve `rows` under `key` the way the API does: honour page/pageSize, default 20, cap 100. */
function serve(key: string, rows: unknown[]) {
  fetchMock.mockImplementation(async (url: string) => {
    const u = new URL(url);
    const page = Math.max(1, parseInt(u.searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(u.searchParams.get('pageSize') || '20', 10)));
    const slice = rows.slice((page - 1) * pageSize, page * pageSize);
    return json({ [key]: slice, pagination: { total: rows.length, page, pageSize } });
  });
}

const rows = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}_${i}`, name: `${prefix} ${i}`, slug: `${prefix}-${i}` }));

function urls(): URL[] {
  return fetchMock.mock.calls.map(([u]) => new URL(u as string));
}

const api = await import('./api.js');

const cases = [
  ['getSources', 'sources', '/api/sources'],
  ['getDestinations', 'destinations', '/api/destinations'],
  ['getRoutes', 'routes', '/api/routes'],
  ['getTransforms', 'transforms', '/api/transforms'],
  ['getFilters', 'filters', '/api/filters'],
] as const;

describe('offset-paginated lists return every page', () => {
  it.each(cases)('%s reads past the first page', async (fn, key, path) => {
    serve(key, rows(250, key));

    const result = await (api[fn] as () => Promise<{ data?: Record<string, Array<{ slug: string }>> }>)();
    const items = result.data![key];

    expect(items).toHaveLength(250);
    // A slug that lives on page 3 is visible to name/slug resolution.
    expect(items.some((i) => i.slug === `${key}-240`)).toBe(true);
    expect(urls().map((u) => [u.pathname, u.searchParams.get('page'), u.searchParams.get('pageSize')])).toEqual([
      [path, '1', '100'],
      [path, '2', '100'],
      [path, '3', '100'],
    ]);
  });

  it('stops at pagination.total on an exact multiple of the page size', async () => {
    serve('sources', rows(200, 'src'));
    const result = await api.getSources();
    expect(result.data!.sources).toHaveLength(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('makes one request when everything fits on the first page', async () => {
    serve('routes', rows(7, 'rt'));
    const result = await api.getRoutes();
    expect(result.data!.routes).toHaveLength(7);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops on an empty page when the server reports no total', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ destinations: rows(100, 'd') }))
      .mockResolvedValueOnce(json({ destinations: [] }));
    const result = await api.getDestinations();
    expect(result.data!.destinations).toHaveLength(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('is bounded when a server keeps returning full pages, and says so on stderr', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    fetchMock.mockImplementation(async () => json({ sources: rows(100, 's'), pagination: { total: 1_000_000 } }));
    const result = await api.getSources();
    expect(fetchMock).toHaveBeenCalledTimes(api.MAX_OFFSET_PAGES);
    expect(result.data!.sources).toHaveLength(api.MAX_OFFSET_PAGES * 100);
    expect(result.data!.pagination.truncated).toBe(true);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('/api/sources has more than 5000 rows (1000000 reported); only the first 5000 were read.'));
    stderr.mockRestore();
  });

  it('keeps paging when the server uses a smaller page size than asked for', async () => {
    const all = rows(120, 'f');
    fetchMock.mockImplementation(async (url: string) => {
      const page = Number(new URL(url).searchParams.get('page'));
      return json({ filters: all.slice((page - 1) * 50, page * 50), pagination: { total: all.length, page, pageSize: 50 } });
    });
    const result = await api.getFilters();
    expect(result.data!.filters).toHaveLength(120);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('a smaller server page size still ends on a short page when there is no total', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ routes: rows(50, 'r'), pagination: { pageSize: 50 } }))
      .mockResolvedValueOnce(json({ routes: rows(10, 'r2'), pagination: { pageSize: 50 } }));
    const result = await api.getRoutes();
    expect(result.data!.routes).toHaveLength(60);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a complete read is not marked truncated and writes nothing to stderr', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    serve('transforms', rows(250, 't'));
    const result = await api.getTransforms();
    expect(result.data!.pagination).not.toHaveProperty('truncated');
    expect(stderr).not.toHaveBeenCalled();
    stderr.mockRestore();
  });

  it('returns the error when a later page fails', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ sources: rows(100, 's'), pagination: { total: 150 } }))
      .mockResolvedValueOnce(json({ error: 'Too many requests', code: 'RATE_LIMITED' }, 429));
    const result = await api.getSources();
    expect(result.data).toBeUndefined();
    expect(result.error).toBe('Too many requests');
    expect(result.code).toBe('RATE_LIMITED');
    expect(result.status).toBe(429);
  });
});

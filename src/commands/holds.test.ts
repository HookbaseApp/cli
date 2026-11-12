import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Circuit holds (migration 0134) and bridge hops (0138) across routes, endpoints, outbound messages
// and send, with the real api module and fetch mocked. Wire shapes: api/src/routes/{routes,
// webhook-endpoints,outbound-messages,send-event}.ts and utils/holds.ts (origin/main, 2026-11-12).

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

const prompts = { input: vi.fn(), confirm: vi.fn(), select: vi.fn(), checkbox: vi.fn(), number: vi.fn(), editor: vi.fn() };
vi.mock('@inquirer/prompts', () => prompts);
vi.mock('../lib/requireAuth.js', () => ({ requireAuth: () => {} }));
vi.mock('../lib/advanced.js', () => ({
  askAdvanced: vi.fn(async () => false),
  gatedPrompt: vi.fn(async () => {}),
  ensureFeature: vi.fn(() => true),
  loadFeatures: vi.fn(async () => {}),
  featureEnabled: vi.fn(() => true),
}));

const out: string[] = [];
const tables: string[][][] = [];
const spinner = { succeed: vi.fn((m: string) => { out.push(m); }), fail: vi.fn((m: string) => { out.push(m); }), stop: vi.fn() };
vi.mock('../lib/logger.js', () => {
  const rec = (m: string) => { out.push(m); };
  const id = (m: string) => m;
  return {
    success: rec, error: rec, warn: rec, info: rec, log: rec, dim: rec,
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
const api = await import('../lib/api.js');
const outbound = await import('./outbound.js');
const endpoints = await import('./endpoints.js');
const routes = await import('./routes.js');
const { sendCommand } = await import('./send.js');
const text = () => out.join('\n');

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

describe('outbound message statuses', () => {
  it('every API status has an explicit colour', () => {
    for (const status of api.OUTBOUND_MESSAGE_STATUSES) {
      expect(outbound.formatStatus(status)).toBe(status);
    }
    expect(outbound.formatStatus('something_new')).toBe('~something_new');
  });

  it('the --status list carries the polling, FIFO and hold statuses', () => {
    expect(api.OUTBOUND_MESSAGE_STATUSES).toEqual(expect.arrayContaining(['awaiting_pull', 'fifo_waiting', 'held']));
    expect(api.OUTBOUND_MESSAGE_STATUSES).toHaveLength(10);
  });
});

describe('outbound message get', () => {
  const message = {
    id: 'msg_1', eventId: 'evt_1', eventType: 'order.created', applicationId: 'app_1', endpointId: 'ep_1',
    status: 'held', attempts: 1, maxAttempts: 5, lastResponseStatus: 503, lastErrorMessage: 'Service Unavailable',
    createdAt: '2026-11-12T09:00:00.000Z', completedAt: null,
  };

  it('shows when a hold ends', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { data: { ...message, holdExpiresAt: '2026-11-12T10:00:00.000Z', bridge: null } }));
    await outbound.outboundGetCommand('msg_1', {});
    expect(text()).toContain('Status:        held');
    expect(text()).toContain('Held Until:');
    expect(text()).not.toContain('Bridged From');
  });

  it('shows the bridge hop it came from', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { data: {
      ...message, status: 'success', holdExpiresAt: null,
      bridge: { inboundEventId: 'evt_in_1', deliveryId: 'dlv_9', hop: 2 },
    } }));
    await outbound.outboundGetCommand('msg_1', {});
    expect(text()).toContain('Bridged From:  inbound event evt_in_1 (hop 2)');
    expect(text()).toContain('delivery dlv_9');
    expect(text()).toContain('hookbase deliveries get dlv_9');
    expect(text()).not.toContain('Held Until');
  });
});

describe('outbound stats', () => {
  it('shows held, and an Other line for buckets the summary does not name', async () => {
    fetchMock
      .mockResolvedValueOnce(respond(200, { data: { pending: 1, processing: 0, success: 10, failed: 0, awaitingRetry: 2, held: 3, exhausted: 0, dlq: 0, total: 20 } }))
      .mockResolvedValueOnce(respond(200, { data: { total: 0, byReason: {}, topFailingEndpoints: [] } }));
    await outbound.outboundStatsCommand({});
    expect(text()).toContain('Held:            3');
    expect(text()).toContain('Other:           4');
  });
});

describe('send', () => {
  it('shows messagesHeld when the API reports some', async () => {
    fetchMock.mockResolvedValueOnce(respond(201, { data: { eventId: 'evt_1', messagesQueued: 3, messagesHeld: 2, endpoints: [] } }));
    await sendCommand({ app: 'app_1', eventType: 'order.created', payload: '{"a":1}' });
    expect(text()).toContain('Messages Queued: 3');
    expect(text()).toContain('Messages Held:   2');
  });

  it('prints no held line when the field is absent', async () => {
    fetchMock.mockResolvedValueOnce(respond(201, { data: { eventId: 'evt_1', messagesQueued: 1, endpoints: [] } }));
    await sendCommand({ app: 'app_1', eventType: 'order.created', payload: '{"a":1}' });
    expect(text()).not.toContain('Messages Held');
  });
});

describe('heldCount', () => {
  it('formats a capped count as 10000+', () => {
    expect(api.formatHeldCount({ heldCount: 10_000, heldCountCapped: true })).toBe('10000+');
    expect(api.formatHeldCount({ heldCount: 12, heldCountCapped: false })).toBe('12');
    expect(api.formatHeldCount({})).toBe('0');
  });

  it('endpoint get shows heldCount and holdOnCircuitOpen', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { data: {
      id: 'ep_1', applicationId: 'app_1', url: 'https://example.test', isDisabled: false, circuitState: 'open',
      holdOnCircuitOpen: true, heldCount: 10_000, heldCountCapped: true, createdAt: 'x', updatedAt: 'x',
    } }));
    await endpoints.endpointsGetCommand('ep_1', {});
    expect(text()).toContain('Held:          10000+');
    expect(text()).toContain('On Open:       hold messages until the circuit recovers');
  });

  it.each([
    ['a FIFO endpoint', { fifoEnabled: true, endpointType: 'http' }, 'n/a (FIFO endpoints never hold)'],
    ['a polling endpoint', { fifoEnabled: false, endpointType: 'polling', pollUrl: 'https://api.example.test/poll/x' }, 'n/a (polling endpoints never hold)'],
    ['an opted-out endpoint', { holdOnCircuitOpen: false }, 'dead-letter messages'],
  ])('endpoint get says what really happens for %s', async (_label, fields, expected) => {
    fetchMock.mockResolvedValueOnce(respond(200, { data: {
      id: 'ep_1', applicationId: 'app_1', url: 'https://example.test', isDisabled: false, circuitState: 'closed',
      holdOnCircuitOpen: true, heldCount: 0, heldCountCapped: false, createdAt: 'x', updatedAt: 'x', ...fields,
    } }));
    await endpoints.endpointsGetCommand('ep_1', {});
    expect(text()).toContain(`On Open:       ${expected}`);
  });

  it('route get shows heldCount, holdOnCircuitOpen=false, and no invented delivery count', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { route: {
      id: 'rt_1', name: 'R', sourceName: 'S', destinationName: 'D', priority: 0, isActive: true,
      circuitState: 'closed', holdOnCircuitOpen: false, heldCount: 4, heldCountCapped: false,
    } }));
    await routes.routesGetCommand('rt_1', {});
    expect(text()).toContain('Held:        4');
    expect(text()).toContain('On Open:     dead-letter deliveries');
    expect(text()).not.toContain('Deliveries:');
  });
});

describe('--[no-]hold-on-circuit-open', () => {
  // PATCH /routes/:id answers { success: true } (api routes.ts), not the route.
  it('route update sends the field only when a flag is given', async () => {
    fetchMock.mockResolvedValue(respond(200, { success: true }));
    await routes.routesUpdateCommand('rt_1', { holdOnCircuitOpen: false });
    await routes.routesUpdateCommand('rt_1', { name: 'x' });
    expect(call(0).body).toEqual({ holdOnCircuitOpen: false });
    expect(call(1).body).toEqual({ name: 'x' });
    expect(out.filter((l) => l === 'Route updated')).toHaveLength(2);
  });

  it('route update with only the hold flag is a valid update', async () => {
    fetchMock.mockResolvedValue(respond(200, { success: true }));
    await routes.routesUpdateCommand('rt_1', { holdOnCircuitOpen: true });
    expect(call().body).toEqual({ holdOnCircuitOpen: true });
    expect(text()).toContain('Route updated');
  });

  it('route update --json prints the route as it is after the update', async () => {
    const after = { id: 'rt_1', name: 'R', holdOnCircuitOpen: false, heldCount: 0, heldCountCapped: false };
    fetchMock
      .mockResolvedValueOnce(respond(200, { success: true }))
      .mockResolvedValueOnce(respond(200, { route: after }));
    await routes.routesUpdateCommand('rt_1', { holdOnCircuitOpen: false, json: true });
    expect(call(1).method).toBe('GET');
    expect(call(1).url.pathname).toBe('/api/routes/rt_1');
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual(after);
  });

  it('route create omits the field by default and sends false with --no-hold-on-circuit-open', async () => {
    const lists = () => {
      fetchMock
        .mockResolvedValueOnce(respond(200, { sources: [{ id: 'src_1', name: 'S', slug: 's' }], pagination: { total: 1 } }))
        .mockResolvedValueOnce(respond(200, { destinations: [{ id: 'dst_1', name: 'D', slug: 'd', url: 'https://x' }], pagination: { total: 1 } }))
        .mockResolvedValueOnce(respond(200, { route: { id: 'rt_1', name: 'R', priority: 0 } }));
    };
    lists();
    await routes.routesCreateCommand({ name: 'R', source: 's', destination: 'd', yes: true });
    lists();
    await routes.routesCreateCommand({ name: 'R', source: 's', destination: 'd', yes: true, holdOnCircuitOpen: false });
    expect(call(2).method).toBe('POST');
    expect(call(2).body).not.toHaveProperty('holdOnCircuitOpen');
    expect(call(5).body).toMatchObject({ holdOnCircuitOpen: false });
  });

  it('endpoint create and update send the field only when a flag is given', async () => {
    fetchMock.mockResolvedValue(respond(200, { data: { id: 'ep_1', url: 'https://x', secret: 'whsec_x' } }));
    await endpoints.endpointsCreateCommand({ app: 'app_1', url: 'https://x', yes: true });
    await endpoints.endpointsCreateCommand({ app: 'app_1', url: 'https://x', yes: true, holdOnCircuitOpen: false });
    await endpoints.endpointsUpdateCommand('ep_1', { holdOnCircuitOpen: true });
    expect(call(0).body).not.toHaveProperty('holdOnCircuitOpen');
    expect(call(1).body).toMatchObject({ holdOnCircuitOpen: false });
    expect(call(2).body).toEqual({ holdOnCircuitOpen: true });
  });

  // The registered commands: commander leaves a --x/--no-x pair undefined when neither is given.
  it.each([
    ['inbound', 'routes', 'create'],
    ['inbound', 'routes', 'update'],
    ['outbound', 'endpoints', 'create'],
    ['outbound', 'endpoints', 'update'],
  ] as const)('%s %s %s parses the pair to undefined / true / false', async (group, noun, verb) => {
    const reg = group === 'inbound' ? await import('./groups/inbound.js') : await import('./groups/outbound.js');
    const parse = (args: string[]) => {
      const program = new Command().exitOverride();
      if (group === 'inbound') (reg as typeof import('./groups/inbound.js')).registerRoutesCommands(program);
      else (reg as typeof import('./groups/outbound.js')).registerEndpointsCommands(program);
      const cmd = program.commands.find((c) => c.name() === noun)!.commands.find((c) => c.name() === verb)!;
      cmd.action(() => {});
      const positional = verb === 'update' ? ['id_1'] : [];
      program.parse(['node', 'hookbase', noun, verb, ...positional, ...args]);
      return cmd.opts().holdOnCircuitOpen;
    };
    expect(parse([])).toBeUndefined();
    expect(parse(['--hold-on-circuit-open'])).toBe(true);
    expect(parse(['--no-hold-on-circuit-open'])).toBe(false);
  });
});

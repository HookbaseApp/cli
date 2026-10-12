import { describe, it, expect, vi, beforeEach } from 'vitest';

// Command-level behaviour of the secret flows, with the API module and prompts mocked.

const api = {
  getSource: vi.fn(),
  createSource: vi.fn(),
  updateSource: vi.fn(),
  rotateSourceSecret: vi.fn(),
  revealSourceSecret: vi.fn(),
  getSourceVerifyToken: vi.fn(),
  rotateSourceVerifyToken: vi.fn(),
  getSourcePendingVerification: vi.fn(),
  adoptSourcePendingVerification: vi.fn(),
  getProviderCatalog: vi.fn(),
  getProviderCatalogEntry: vi.fn(),
};
vi.mock('../lib/api.js', () => api);

const prompts = {
  input: vi.fn(),
  confirm: vi.fn(),
  select: vi.fn(),
  number: vi.fn(),
  password: vi.fn(),
  search: vi.fn(),
};
vi.mock('@inquirer/prompts', () => prompts);

vi.mock('../lib/requireAuth.js', () => ({ requireAuth: () => {} }));
vi.mock('../lib/config.js', () => ({
  getCurrentOrg: () => ({ id: 'org1', slug: 'acme' }),
  getApiUrl: () => 'https://api.example.test',
}));
vi.mock('../lib/advanced.js', () => ({
  askAdvanced: async () => false,
  gatedPrompt: async () => {},
  ensureFeature: () => true,
  loadFeatures: async () => {},
}));

const out: string[] = [];
const spinner = { succeed: vi.fn(), fail: vi.fn(), stop: vi.fn() };
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

const sources = await import('./sources.js');
const text = () => out.join('\n');

function catalog(...providers: Array<{ id: string; name: string; hookbaseProvider: string; secretSource?: string; secretAfterRegistration?: boolean }>) {
  api.getProviderCatalog.mockResolvedValue({
    status: 200,
    data: {
      providers: providers.map((p) => ({
        ...p,
        category: 'x', description: '', icon: '', eventTypeCount: 0, hasSignatureVerification: true, hasIpRanges: false,
        signatureVerification: p.secretSource
          ? { supported: true, secretSource: p.secretSource, secretLabel: 'Signing secret', ...(p.secretAfterRegistration ? { secretAfterRegistration: true } : {}) }
          : null,
      })),
    },
  });
}

beforeEach(() => {
  out.length = 0;
  for (const fn of [...Object.values(api), ...Object.values(prompts)]) fn.mockReset();
  api.getProviderCatalogEntry.mockResolvedValue({ error: 'not found', status: 404 });
});

describe('sources rotate-secret', () => {
  it('refuses a vendor-issued secret without calling the API or prompting', async () => {
    api.getSource.mockResolvedValue({ status: 200, data: { source: { id: 's1', slug: 'pay', provider: 'stripe' } } });
    catalog({ id: 'stripe', name: 'Stripe', hookbaseProvider: 'stripe', secretSource: 'provider' });
    await sources.sourcesRotateSecretCommand('pay', {});
    expect(api.rotateSourceSecret).not.toHaveBeenCalled();
    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(text()).toContain('Stripe issues its own signing secret');
    expect(text()).toContain('400');
  });

  it('rotates an operator secret and tells the user to update the vendor', async () => {
    api.getSource.mockResolvedValue({ status: 200, data: { source: { id: 's1', slug: 'gh', provider: 'github' } } });
    catalog({ id: 'github', name: 'GitHub', hookbaseProvider: 'github', secretSource: 'operator' });
    api.rotateSourceSecret.mockResolvedValue({ status: 200, data: { signingSecret: 'new-secret' } });
    await sources.sourcesRotateSecretCommand('gh', { yes: true });
    expect(api.rotateSourceSecret).toHaveBeenCalledWith('gh');
    expect(text()).toContain('new-secret');
    expect(text()).toContain("GitHub's webhook settings");
  });
});

describe('sources create (non-interactive)', () => {
  it('passes --signing-secret and --verify-token through', async () => {
    api.createSource.mockResolvedValue({ status: 200, data: { source: { id: 's1', slug: 'wa', provider: 'whatsapp', hasSigningSecret: true, signingSecret: 'app-secret', verifyToken: 'vt-123' } } });
    await sources.sourcesCreateCommand({ name: 'WA', provider: 'whatsapp', signingSecret: 'app-secret', verifyToken: 'vt-123' });
    expect(api.createSource).toHaveBeenCalledWith('WA', 'wa', 'whatsapp', expect.objectContaining({ signingSecret: 'app-secret', verifyToken: 'vt-123' }));
    // The user typed the secret: it is not echoed back as a "save this" box, the verify token is.
    expect(text()).not.toContain('Shown once');
    expect(text()).toContain('vt-123');
  });

  it('shows a generated secret once', async () => {
    api.createSource.mockResolvedValue({ status: 200, data: { source: { id: 's1', slug: 'gh', provider: 'github', signingSecret: 'generated-xyz' } } });
    await sources.sourcesCreateCommand({ name: 'gh', provider: 'github' });
    expect(text()).toContain('Shown once');
    expect(text()).toContain('generated-xyz');
  });

  it('notes a secret that arrives after registration', async () => {
    api.createSource.mockResolvedValue({ status: 200, data: { source: { id: 's1', slug: 'notion', provider: 'notion', signingSecret: null, awaitingSigningSecret: true } } });
    await sources.sourcesCreateCommand({ name: 'notion', provider: 'notion' });
    expect(text()).toContain('pending-verification notion');
  });

  it('accepts any provider string', async () => {
    api.createSource.mockResolvedValue({ status: 200, data: { source: { id: 's1', slug: 'g', provider: 'grafana-hmac' } } });
    await sources.sourcesCreateCommand({ name: 'g', provider: 'grafana-hmac' });
    expect(api.createSource.mock.calls[0][2]).toBe('grafana-hmac');
  });
});

describe('sources create (interactive secret prompt)', () => {
  /** Drive the interactive path: name prompt, auto slug, provider search, transient, confirm. */
  function interactive(provider: string) {
    prompts.input.mockResolvedValueOnce('My Source');
    prompts.confirm.mockResolvedValue(true); // auto slug, then final confirm
    prompts.search.mockResolvedValueOnce(provider);
  }

  it('prompts (required) for a vendor-issued secret', async () => {
    catalog({ id: 'stripe', name: 'Stripe', hookbaseProvider: 'stripe', secretSource: 'provider' });
    interactive('stripe');
    prompts.password.mockResolvedValueOnce('whsec_abc');
    prompts.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    api.createSource.mockResolvedValue({ status: 200, data: { source: { id: 's1', slug: 'my-source', provider: 'stripe', hasSigningSecret: true } } });
    await sources.sourcesCreateCommand({});
    expect(prompts.password).toHaveBeenCalledTimes(1);
    const validate = prompts.password.mock.calls[0][0].validate as (v: string) => true | string;
    expect(validate('')).not.toBe(true);
    expect(api.createSource.mock.calls[0][3]).toMatchObject({ signingSecret: 'whsec_abc' });
  });

  it('does not prompt for an operator secret', async () => {
    catalog({ id: 'github', name: 'GitHub', hookbaseProvider: 'github', secretSource: 'operator' });
    interactive('github');
    prompts.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    api.createSource.mockResolvedValue({ status: 200, data: { source: { id: 's1', slug: 'my-source', provider: 'github', signingSecret: 'gen' } } });
    await sources.sourcesCreateCommand({});
    expect(prompts.password).not.toHaveBeenCalled();
    expect(prompts.input).toHaveBeenCalledTimes(1);
    expect(api.createSource.mock.calls[0][3]).not.toHaveProperty('signingSecret');
  });

  it('prompts for a public key', async () => {
    catalog({ id: 'discord', name: 'Discord', hookbaseProvider: 'discord', secretSource: 'public_key' });
    interactive('discord');
    prompts.input.mockResolvedValueOnce('abcdef0123');
    prompts.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    api.createSource.mockResolvedValue({ status: 200, data: { source: { id: 's1', slug: 'my-source', provider: 'discord', hasSigningSecret: true } } });
    await sources.sourcesCreateCommand({});
    expect(api.createSource.mock.calls[0][3]).toMatchObject({ signingSecret: 'abcdef0123' });
  });

  it('skips built-in keys and says why', async () => {
    catalog({ id: 'wise', name: 'Wise', hookbaseProvider: 'wise', secretSource: 'built_in' });
    interactive('wise');
    prompts.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    api.createSource.mockResolvedValue({ status: 200, data: { source: { id: 's1', slug: 'my-source', provider: 'wise', verifiesWithoutSecret: true } } });
    await sources.sourcesCreateCommand({});
    expect(prompts.password).not.toHaveBeenCalled();
    expect(text()).toContain('key Hookbase already has');
  });
});

describe('new subcommands', () => {
  it('reveal-secret prints the secret', async () => {
    api.revealSourceSecret.mockResolvedValue({ status: 200, data: { signingSecret: 's3cret' } });
    await sources.sourcesRevealSecretCommand('src', {});
    expect(text()).toContain('s3cret');
  });

  it('pending-verification shows the token and the adopt step', async () => {
    api.getSourcePendingVerification.mockResolvedValue({ status: 200, data: { provider: 'notion', token: 'secret_tok', receivedAt: '2026-10-11T00:00:00Z', clientIp: '1.2.3.4' } });
    await sources.sourcesPendingVerificationCommand('n', {});
    expect(text()).toContain('secret_tok');
    expect(text()).toContain('adopt-verification n');
  });

  it('adopt-verification asks first and honours a no', async () => {
    prompts.confirm.mockResolvedValueOnce(false);
    await sources.sourcesAdoptVerificationCommand('n', {});
    expect(api.adoptSourcePendingVerification).not.toHaveBeenCalled();
  });

  it('adopt-verification --yes skips the prompt', async () => {
    api.adoptSourcePendingVerification.mockResolvedValue({ status: 200, data: { success: true } });
    await sources.sourcesAdoptVerificationCommand('n', { yes: true });
    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(api.adoptSourcePendingVerification).toHaveBeenCalledWith('n');
  });

  it('rotate-verify-token --yes rotates and shows the new token', async () => {
    api.rotateSourceVerifyToken.mockResolvedValue({ status: 200, data: { verifyToken: 'vt-new' } });
    await sources.sourcesRotateVerifyTokenCommand('wa', { yes: true });
    expect(text()).toContain('vt-new');
  });

  it('update sends --signing-secret and --verify-token', async () => {
    api.updateSource.mockResolvedValue({ status: 200, data: { success: true } });
    await sources.sourcesUpdateCommand('wa', { signingSecret: ' new ', verifyToken: '' });
    expect(api.updateSource).toHaveBeenCalledWith('wa', { signingSecret: 'new', verifyToken: '' });
  });
});

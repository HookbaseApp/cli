import { describe, it, expect, vi, beforeEach } from 'vitest';

const getProviderCatalog = vi.fn();
const getProviderCatalogEntry = vi.fn();
vi.mock('./api.js', () => ({ getProviderCatalog, getProviderCatalogEntry }));

const {
  buildProviderChoices,
  loadProviderChoices,
  lookupProviderSecretInfo,
  planSecret,
  rotateRefusal,
  FALLBACK_PROVIDERS,
  NO_PROVIDER,
  OTHER_PROVIDER,
} = await import('./providerCatalog.js');

type Summary = Parameters<typeof buildProviderChoices>[0][number];

function entry(id: string, name: string, hookbaseProvider: string, secretSource?: string, extra: Record<string, unknown> = {}): Summary {
  return {
    id, name, hookbaseProvider,
    category: 'x', description: '', icon: '', eventTypeCount: 0, hasSignatureVerification: true, hasIpRanges: false,
    signatureVerification: secretSource ? { supported: true, secretSource, secretLabel: 'Secret', ...extra } : undefined,
  } as Summary;
}

beforeEach(() => {
  getProviderCatalog.mockReset();
  getProviderCatalogEntry.mockReset();
});

describe('buildProviderChoices', () => {
  const catalog = [
    entry('stripe', 'Stripe', 'stripe', 'provider'),
    entry('resend', 'Resend', 'standard-webhooks', 'provider'),
    entry('clerk', 'Clerk', 'standard-webhooks', 'provider'),
    entry('mollie', 'Mollie', 'custom', 'none'),
    entry('mollie-nextgen', 'Mollie (Next-gen)', 'mollie', 'provider'),
    entry('github', 'GitHub', 'github', 'operator'),
  ];

  it('gives one choice per hookbaseProvider, valued by it', () => {
    const values = buildProviderChoices(catalog).map((c) => c.value);
    expect(values.filter((v) => v === 'standard-webhooks')).toHaveLength(1);
    expect(values).toContain('mollie');
    expect(values).not.toContain('mollie-nextgen');
  });

  it('labels a shared provider with every vendor that uses it', () => {
    const sw = buildProviderChoices(catalog).find((c) => c.value === 'standard-webhooks')!;
    expect(sw.name).toContain('Resend');
    expect(sw.name).toContain('Clerk');
  });

  it('keeps the catalog id for the detail lookup', () => {
    expect(buildProviderChoices(catalog).find((c) => c.value === 'mollie')!.catalogId).toBe('mollie-nextgen');
  });

  it('folds vendors that do not sign into "None", and adds custom + other last', () => {
    const choices = buildProviderChoices(catalog);
    expect(choices[0].value).toBe(NO_PROVIDER);
    expect(choices[0].name).toContain('Mollie');
    expect(choices.slice(-2).map((c) => c.value)).toEqual(['custom', OTHER_PROVIDER]);
  });

  it('carries secretSource from the list item', () => {
    expect(buildProviderChoices(catalog).find((c) => c.value === 'github')!.secretSource).toBe('operator');
  });
});

describe('loadProviderChoices', () => {
  it('falls back to the short list when the catalog fails', async () => {
    getProviderCatalog.mockResolvedValue({ error: 'Network error', status: 0 });
    const r = await loadProviderChoices();
    expect(r.offline).toBe(true);
    expect(r.choices).toEqual([...FALLBACK_PROVIDERS]);
  });
});

describe('lookupProviderSecretInfo', () => {
  it('uses the list summary when it has secretSource', async () => {
    getProviderCatalog.mockResolvedValue({ data: { providers: [entry('github', 'GitHub', 'github', 'operator')] }, status: 200 });
    expect((await lookupProviderSecretInfo('github'))?.secretSource).toBe('operator');
    expect(getProviderCatalogEntry).not.toHaveBeenCalled();
  });

  it('falls back to the detail when the list lacks the summary (older API)', async () => {
    getProviderCatalog.mockResolvedValue({ data: { providers: [entry('stripe', 'Stripe', 'stripe')] }, status: 200 });
    getProviderCatalogEntry.mockResolvedValue({
      data: { provider: { id: 'stripe', name: 'Stripe', hookbaseProvider: 'stripe', signatureVerification: { supported: true, secretSource: 'provider', secretInstruction: 'Copy it from Stripe' } } },
      status: 200,
    });
    const info = await lookupProviderSecretInfo('stripe');
    expect(getProviderCatalogEntry).toHaveBeenCalledWith('stripe');
    expect(info?.secretSource).toBe('provider');
    expect(info?.secretInstruction).toBe('Copy it from Stripe');
  });

  it('treats custom/generic as Hookbase-generated without asking the catalog', async () => {
    expect((await lookupProviderSecretInfo('generic'))?.secretSource).toBe('operator');
    expect(getProviderCatalog).not.toHaveBeenCalled();
  });

  it('is undefined for unknown providers and a failed fetch', async () => {
    getProviderCatalog.mockResolvedValue({ data: { providers: [] }, status: 200 });
    expect(await lookupProviderSecretInfo('grafana-hmac')).toBeUndefined();
    getProviderCatalog.mockRejectedValue(new Error('offline'));
    expect(await lookupProviderSecretInfo('stripe')).toBeUndefined();
  });
});

describe('planSecret', () => {
  it.each([
    ['provider', 'prompt'],
    ['public_key', 'prompt_public_key'],
    ['operator', 'generated'],
    ['built_in', 'skip'],
    ['none', 'skip'],
  ] as const)('%s -> %s', (secretSource, action) => {
    expect(planSecret('x', { secretSource }).action).toBe(action);
  });

  it('skips with a pending-verification hint for Notion', () => {
    const plan = planSecret('notion', { secretSource: 'provider', secretAfterRegistration: true });
    expect(plan.action).toBe('skip');
    expect(plan.action === 'skip' && plan.reason).toContain('pending-verification');
  });

  it('asks optionally when the catalog could not say', () => {
    expect(planSecret('grafana-hmac', undefined).action).toBe('optional');
  });

  it('skips silently-ish for no provider', () => {
    expect(planSecret('', undefined).action).toBe('skip');
  });
});

describe('rotateRefusal', () => {
  it('allows operator secrets and unknown providers', () => {
    expect(rotateRefusal('github', { secretSource: 'operator' })).toBeNull();
    expect(rotateRefusal('grafana-hmac', undefined)).toBeNull();
  });

  it.each(['provider', 'public_key', 'built_in'] as const)('refuses %s, saying the API would 400', (secretSource) => {
    expect(rotateRefusal('x', { secretSource })).toMatchObject({ apiRejects: true });
  });

  it('refuses secret-after-registration providers', () => {
    expect(rotateRefusal('asana', { secretSource: 'provider', secretAfterRegistration: true })?.apiRejects).toBe(true);
  });

  it('refuses a vendor that does not sign, without claiming a 400', () => {
    expect(rotateRefusal('x', { secretSource: 'none' })).toMatchObject({ apiRejects: false });
  });
});

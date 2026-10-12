import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FALLBACK_PROVIDERS, NO_PROVIDER, OTHER_PROVIDER } from '../lib/providerCatalog.js';

// The create/edit pickers (CLI and TUI) are built from the API's provider catalog at runtime, so
// they can't drift. What is still hardcoded here is checked against the API's signature scheme
// table directly:
//   - init.ts, which scaffolds a verifier per provider, must cover every scheme id (as a local
//     verifier or as an ingest-verified pass-through) and accept the API's aliases;
//   - the offline fallback picker list must only offer ids the API accepts.
//
// api/ is a sibling repository, not a dependency: it is present in a full checkout of the
// platform but not in the CLI's own CI. When it is absent the test skips rather than fails --
// a guard that breaks CI on an unrelated repo's absence gets deleted, which protects nobody.

const API_SCHEMES = join(import.meta.dirname, '../../../api/src/utils/signature-schemes.ts');

/** Top-level `id: '...'` entries in a scheme/provider table. */
function schemeIds(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/^ {4}id: '([a-z0-9-]+)',$/gm)].map((m) => m[1])
  );
}

/** Every `aliases: [...]` entry in the API table. */
function aliasIds(source: string): Set<string> {
  const out = new Set<string>();
  for (const m of source.matchAll(/^ {4}aliases: \[([^\]]*)\]/gm)) {
    for (const a of m[1].matchAll(/'([a-z0-9-]+)'/g)) out.add(a[1]);
  }
  return out;
}

/** Keys of init.ts's PROVIDER_ALIASES object. */
function initAliasIds(source: string): Set<string> {
  const start = source.indexOf('const PROVIDER_ALIASES = {');
  expect(start, 'could not find PROVIDER_ALIASES').toBeGreaterThan(-1);
  const block = source.slice(start, source.indexOf('} as const', start));
  return new Set([...block.matchAll(/^ {2}([a-z0-9-]+): '/gm)].map((m) => m[1]));
}

describe.skipIf(!existsSync(API_SCHEMES))('CLI provider lists track the API', () => {
  // Read lazily. describe.skipIf still runs this callback to collect the tests it then marks
  // skipped, so reading the API file here instead of inside a test throws at collection time and
  // fails the suite in the CLI's own CI -- exactly the outcome the skip exists to avoid.
  let cached: string | undefined;
  const apiSource = (): string => (cached ??= readFileSync(API_SCHEMES, 'utf8'));
  const apiIds = (): Set<string> => schemeIds(apiSource());
  const apiAliases = (): Set<string> => aliasIds(apiSource());

  it('finds a plausible number of providers in the API table', () => {
    // Guards the regexes above: if the API file is reformatted so nothing matches, every
    // comparison below would trivially pass against an empty set.
    expect(apiIds().size).toBeGreaterThan(60);
    expect(apiIds()).toContain('github');
    expect(apiIds()).toContain('custom');
    expect(apiAliases()).toContain('svix');
    expect(apiAliases()).toContain('generic');
  });

  it('init.ts covers every scheme the API verifies, and nothing else', () => {
    const initIds = schemeIds(readFileSync(join(import.meta.dirname, 'init.ts'), 'utf8'));
    expect([...apiIds()].filter((id) => !initIds.has(id))).toEqual([]);
    expect([...initIds].filter((id) => !apiIds().has(id))).toEqual([]);
  });

  it('init.ts accepts exactly the API aliases', () => {
    const aliases = initAliasIds(readFileSync(join(import.meta.dirname, 'init.ts'), 'utf8'));
    expect([...aliases].sort()).toEqual([...apiAliases()].sort());
  });

  it('the offline fallback picker only offers providers the API accepts', () => {
    const accepted = new Set([...apiIds(), ...apiAliases()]);
    const values = FALLBACK_PROVIDERS
      .map((c) => c.value)
      .filter((v) => v !== NO_PROVIDER && v !== OTHER_PROVIDER);
    expect(values.length).toBeGreaterThan(0);
    expect(values.filter((v) => !accepted.has(v))).toEqual([]);
  });

  it('no hardcoded provider picker is left in sources.ts or the TUI', () => {
    for (const file of ['sources.ts', '../tui/views/Sources.tsx']) {
      const source = readFileSync(join(import.meta.dirname, file), 'utf8');
      expect(source, file).not.toContain('const PROVIDERS = [');
    }
  });
});

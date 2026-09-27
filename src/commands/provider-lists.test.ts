import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The CLI hardcodes the provider list in three places and nothing regenerates them, so adding a
// provider to the API silently leaves the CLI unable to offer it (and, before this guard, left
// pickers listing five providers long after the API had twenty-two). This reads the API's
// signature scheme table directly and fails when the CLI has fallen behind.
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

/** `value: '...'` entries that name a provider, skipping the empty generic sentinel. */
function pickerValues(source: string, marker: string): Set<string> {
  const start = source.indexOf(marker);
  expect(start, `could not find ${marker}`).toBeGreaterThan(-1);
  const end = source.indexOf('];', start);
  expect(end, `${marker} is not terminated by "];"`).toBeGreaterThan(start);
  const block = source.slice(start, end);
  return new Set(
    [...block.matchAll(/value: '([a-z0-9-]+)'/g)].map((m) => m[1])
  );
}

describe.skipIf(!existsSync(API_SCHEMES))('CLI provider lists track the API', () => {
  // Read lazily. describe.skipIf still runs this callback to collect the tests it then marks
  // skipped, so reading the API file here instead of inside a test throws at collection time and
  // fails the suite in the CLI's own CI -- exactly the outcome the skip exists to avoid.
  let cached: Set<string> | undefined;
  const apiIds = (): Set<string> => (cached ??= schemeIds(readFileSync(API_SCHEMES, 'utf8')));

  it('finds a plausible number of providers in the API table', () => {
    // Guards the regexes above: if the API file is reformatted so nothing matches, every
    // comparison below would trivially pass against an empty set.
    expect(apiIds().size).toBeGreaterThan(15);
    expect(apiIds()).toContain('github');
    expect(apiIds()).toContain('custom');
  });

  it('init.ts offers every provider the API verifies', () => {
    const initIds = schemeIds(readFileSync(join(import.meta.dirname, 'init.ts'), 'utf8'));
    expect([...apiIds()].filter((id) => !initIds.has(id))).toEqual([]);
    expect([...initIds].filter((id) => !apiIds().has(id))).toEqual([]);
  });

  it('the sources create picker offers every provider the API verifies', () => {
    const values = pickerValues(
      readFileSync(join(import.meta.dirname, 'sources.ts'), 'utf8'),
      'const PROVIDERS = ['
    );
    expect([...apiIds()].filter((id) => !values.has(id))).toEqual([]);
    expect([...values].filter((id) => !apiIds().has(id))).toEqual([]);
  });

  it('the TUI sources picker offers every provider the API verifies', () => {
    const source = readFileSync(
      join(import.meta.dirname, '../tui/views/Sources.tsx'),
      'utf8'
    );
    const values = pickerValues(source, 'const PROVIDERS = [');
    expect([...apiIds()].filter((id) => !values.has(id))).toEqual([]);
    expect([...values].filter((id) => !apiIds().has(id))).toEqual([]);
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseJsonField, readJsonArg, isJsonObject, MAX_JSON_FILE_BYTES } from './parseJson.js';

describe('parseJsonField', () => {
  it('parses a valid JSON string', () => {
    expect(parseJsonField('{"a":1}', {})).toEqual({ a: 1 });
    expect(parseJsonField('[1,2,3]', [])).toEqual([1, 2, 3]);
  });

  it('passes through an already-parsed object unchanged', () => {
    const obj = { a: 1 };
    expect(parseJsonField(obj, {})).toBe(obj);
  });

  it('passes through an already-parsed array unchanged', () => {
    const arr = [1, 2, 3];
    expect(parseJsonField(arr, [])).toBe(arr);
  });

  it('returns the fallback for null', () => {
    expect(parseJsonField(null, { fallback: true })).toEqual({ fallback: true });
  });

  it('returns the fallback for undefined', () => {
    expect(parseJsonField(undefined, { fallback: true })).toEqual({ fallback: true });
  });

  it('returns the fallback for malformed JSON', () => {
    expect(parseJsonField('{not valid json', { fallback: true })).toEqual({ fallback: true });
  });

  it('parses nested objects correctly', () => {
    expect(parseJsonField('{"a":{"b":{"c":1}}}', {})).toEqual({ a: { b: { c: 1 } } });
  });

  it('parses an empty-object string', () => {
    expect(parseJsonField('{}', { fallback: true })).toEqual({});
  });

  it('returns non-string, non-nullish primitives unchanged', () => {
    expect(parseJsonField(42, 0)).toBe(42);
    expect(parseJsonField(true, false)).toBe(true);
  });
});

describe('readJsonArg', () => {
  it('parses inline JSON', () => {
    expect(readJsonArg(' {"a":1} ', '--patch')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('reads @file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hb-json-'));
    const file = join(dir, 'p.json');
    writeFileSync(file, '{"order":{"total":5}}');
    expect(readJsonArg(`@${file}`, '--payload')).toEqual({ ok: true, value: { order: { total: 5 } } });
  });

  it('names the flag on bad JSON and on a missing file', () => {
    const bad = readJsonArg('{nope', '--patch');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatch(/^--patch: invalid JSON/);
    const missing = readJsonArg('@/definitely/not/here.json', '--payload');
    expect(!missing.ok && missing.error).toMatch(/^--payload: cannot read \/definitely\/not\/here\.json/);
  });

  // V8 quotes ~10 characters around a bad token; for a credentials file that is part of a secret.
  it.each([
    ['an unquoted value', '{"accessKeyId":"AKIAEXAMPLE","secretAccessKey":wJalrXUtnFEMIK7MDENG}', 'syntax error'],
    ['a trailing comma', '{\n  "secretAccessKey": "wJalrXUtnFEMIK7MDENG",\n}', 'at line 3, column 1'],
    ['a missing comma', '{"secretAccessKey": "wJalrXUtnFEMIK7MDENG" "region": "us-east-1"}', 'at line 1, column 44'],
    ['a truncated file', '{"secretAccessKey": "wJalrXUtnFEMIK7MDENG"', 'at line 1, column 43'],
  ])('a malformed @file with %s reports where, not what', (_label, content, location) => {
    const dir = mkdtempSync(join(tmpdir(), 'hb-json-'));
    const file = join(dir, 'creds.json');
    writeFileSync(file, content);
    const result = readJsonArg(`@${file}`, '--config');
    expect(result.ok).toBe(false);
    const error = !result.ok ? result.error : '';
    expect(error).toBe(`--config: invalid JSON in ${file} (${location})`);
    for (const fragment of ['wJal', 'MDENG', 'AKIA', 'ccessKey', 'region', 'us-east']) {
      expect(error).not.toContain(fragment);
    }
  });

  it('inline JSON errors carry no input either', () => {
    const result = readJsonArg('{"token": sk_live_abcdef}', '--payload');
    expect(!result.ok && result.error).toBe('--payload: invalid JSON (syntax error)');
  });

  it('refuses a file over the size limit without reading it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hb-json-'));
    const file = join(dir, 'big.json');
    writeFileSync(file, `"${'x'.repeat(MAX_JSON_FILE_BYTES)}"`);
    const result = readJsonArg(`@${file}`, '--payload');
    expect(!result.ok && result.error).toMatch(/^--payload: .*big\.json is \d+ bytes; the limit is 1048576 \(1 MB\)$/);
  });

  it('accepts a file at the size limit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hb-json-'));
    const file = join(dir, 'max.json');
    writeFileSync(file, `"${'x'.repeat(MAX_JSON_FILE_BYTES - 2)}"`);
    expect(readJsonArg(`@${file}`, '--payload').ok).toBe(true);
  });

  describe('~ expansion', () => {
    const home = process.env.HOME;
    afterEach(() => { process.env.HOME = home; });

    it('expands @~/path to the home directory', () => {
      const fakeHome = mkdtempSync(join(tmpdir(), 'hb-home-'));
      mkdirSync(join(fakeHome, 'cfg'));
      writeFileSync(join(fakeHome, 'cfg', 'bridge.json'), '{"eventType":"a.b"}');
      process.env.HOME = fakeHome;
      expect(readJsonArg('@~/cfg/bridge.json', '--config')).toEqual({ ok: true, value: { eventType: 'a.b' } });
    });

    it('names the path as typed when it cannot be read', () => {
      process.env.HOME = mkdtempSync(join(tmpdir(), 'hb-home-'));
      const result = readJsonArg('@~/missing.json', '--config');
      expect(!result.ok && result.error).toBe('--config: cannot read ~/missing.json (ENOENT)');
    });
  });
});

describe('isJsonObject', () => {
  it('accepts plain objects only', () => {
    expect(isJsonObject({})).toBe(true);
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject('x')).toBe(false);
  });
});

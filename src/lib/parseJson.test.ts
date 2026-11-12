import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseJsonField, readJsonArg, isJsonObject } from './parseJson.js';

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
});

describe('isJsonObject', () => {
  it('accepts plain objects only', () => {
    expect(isJsonObject({})).toBe(true);
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject('x')).toBe(false);
  });
});

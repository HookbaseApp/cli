import { describe, it, expect } from 'vitest';
import { parseJsonField } from './parseJson.js';

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

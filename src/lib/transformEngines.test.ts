import { describe, it, expect } from 'vitest';
import { inferTransformTypeFromFile, engineUnavailableMessage, transformEngineChoices, STATIC_TRANSFORM_ENGINES } from './transformEngines.js';

describe('transformEngines', () => {
  it('infers type from extension', () => {
    expect(inferTransformTypeFromFile('a/b.ts')).toBe('typescript');
    expect(inferTransformTypeFromFile('x.JQ')).toBe('jq');
    expect(inferTransformTypeFromFile('x.xsl')).toBe('xslt');
    expect(inferTransformTypeFromFile('x.json')).toBeUndefined();
  });
  it('explains TRANSFORM_ENGINE_UNAVAILABLE only for that code', () => {
    expect(engineUnavailableMessage({ error: 'jq transforms are not available', code: 'TRANSFORM_ENGINE_UNAVAILABLE' })).toContain('Pick another language');
    expect(engineUnavailableMessage({ error: 'boom' })).toBeUndefined();
  });
  it('disables unavailable engines in the picker', () => {
    const c = transformEngineChoices([{ ...STATIC_TRANSFORM_ENGINES[0], available: false }, STATIC_TRANSFORM_ENGINES[1]]);
    expect(c[0].disabled).toBeTruthy();
    expect(c[1].disabled).toBe(false);
  });
});

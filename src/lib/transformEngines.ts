import * as api from './api.js';

/** Static fallback used when GET /transforms/engines is unavailable (older server, offline, auth). */
export const STATIC_TRANSFORM_ENGINES: api.TransformEngine[] = [
  { type: 'jsonata', label: 'JSONata', fileExtension: 'jsonata' },
  { type: 'javascript', label: 'JavaScript', fileExtension: 'js' },
  { type: 'typescript', label: 'TypeScript', fileExtension: 'ts' },
  { type: 'liquid', label: 'Liquid', fileExtension: 'liquid' },
  { type: 'xslt', label: 'XSLT', fileExtension: 'xslt' },
  { type: 'jmespath', label: 'JMESPath', fileExtension: 'jmespath' },
  { type: 'jsonlogic', label: 'JSON Logic', fileExtension: 'json' },
  { type: 'jq', label: 'jq', fileExtension: 'jq' },
].map((e) => ({ ...e, description: '', starterCode: '', aiGenerate: e.type !== 'xslt', available: true }));

/** Fetch the server's engine catalog, falling back to the static list on any failure. */
export async function loadTransformEngines(): Promise<api.TransformEngine[]> {
  try {
    const res = await api.getTransformEngines();
    const engines = res.data?.engines;
    if (!res.error && Array.isArray(engines) && engines.length > 0) return engines;
  } catch {
    // fall through to the static list
  }
  return STATIC_TRANSFORM_ENGINES;
}

export function transformEngineChoices(engines: api.TransformEngine[]) {
  return engines.map((e) => ({
    name: e.available ? e.label : `${e.label} (not available on this server)`,
    value: e.type,
    disabled: e.available ? false : 'not available on this server',
  }));
}

/** Guess a transform type from a file extension; undefined when ambiguous or unknown. */
export function inferTransformTypeFromFile(file: string): api.TransformType | undefined {
  const ext = file.toLowerCase().split('.').pop();
  switch (ext) {
    case 'jsonata': return 'jsonata';
    case 'js': case 'mjs': return 'javascript';
    case 'ts': return 'typescript';
    case 'liquid': return 'liquid';
    case 'xsl': case 'xslt': return 'xslt';
    case 'jmespath': return 'jmespath';
    case 'jq': return 'jq';
    default: return undefined; // .json could be jsonlogic but is too ambiguous to infer
  }
}

export const ENGINE_UNAVAILABLE_CODE = 'TRANSFORM_ENGINE_UNAVAILABLE';

export function engineUnavailableMessage(res: { error?: string; code?: string }): string | undefined {
  if (res.code !== ENGINE_UNAVAILABLE_CODE) return undefined;
  return `${res.error || 'That transform language is not available on this server.'} Pick another language (e.g. jsonata) or try again once the server enables it.`;
}

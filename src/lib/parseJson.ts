// Several API response fields come back as JSON-encoded strings rather than
// parsed objects (headers, config, scopes, etc.) — this normalizes either shape.
export function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

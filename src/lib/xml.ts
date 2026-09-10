function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Object keys from our own API responses (camelCase/snake_case) are always
// valid tag names, but this guards against anything unexpected — an element
// name can't start with a digit or contain most punctuation.
function sanitizeTagName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'item';
  return /^[a-zA-Z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

function valueToXml(value: unknown, tagName: string, indent: string): string {
  if (value === null || value === undefined) {
    return `${indent}<${tagName} />\n`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${indent}<${tagName} />\n`;
    }
    return (
      `${indent}<${tagName}>\n` +
      value.map((item) => valueToXml(item, 'item', `${indent}  `)).join('') +
      `${indent}</${tagName}>\n`
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return `${indent}<${tagName} />\n`;
    }
    return (
      `${indent}<${tagName}>\n` +
      entries.map(([key, val]) => valueToXml(val, sanitizeTagName(key), `${indent}  `)).join('') +
      `${indent}</${tagName}>\n`
    );
  }

  return `${indent}<${tagName}>${escapeXml(String(value))}</${tagName}>\n`;
}

/** Generic JSON-shaped-data-to-XML serializer, used by every command's `--xml` output. */
export function toXml(data: unknown, rootName = 'response'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${valueToXml(data, sanitizeTagName(rootName), '')}`;
}

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as nodeCrypto from 'node:crypto';
import ts from 'typescript';
import { __testing } from './init.js';

// `hookbase init` emits a verifier per provider from its own copy of the API's scheme table. A
// round trip through that same table proves nothing, so this signs with the API's own test-send
// code (api/src/utils/signature.ts — what the dashboard's "Send test event" uses) and checks every
// generated verifier accepts it, and rejects a tampered body. Like provider-lists.test.ts it reads
// the sibling api/ checkout and skips without one.

const API_SIGNATURE = join(import.meta.dirname, '../../../api/src/utils/signature.ts');

const { getVerifySnippet, PROVIDER_SCHEMES, INGEST_VERIFIED, passThroughSnippet } = __testing;

/** A secret in the shape each scheme needs (base64 keys, whsec_ prefixes). */
function secretFor(id: string): string {
  const b64 = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
  switch (id) {
    case 'standard-webhooks':
    case 'gitlab-signing-token':
      return `whsec_${b64}`;
    case 'supabase-auth-hooks':
      return `v1,whsec_${b64}`;
    case 'airtable':
      return b64;
    default:
      return 'test-secret-value';
  }
}

type Verify = (rawBody: string, secret: string, getHeader: (n: string) => string, url: string) => boolean | Promise<boolean>;

/** Compile a generated snippet (TS when needed) into a callable verifySignature. */
function load(snippet: string, isTs: boolean): Verify {
  const js = isTs
    ? ts.transpileModule(snippet, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
    : snippet;
  // The node flavour uses the `crypto` module, the web flavour the global WebCrypto `crypto`.
  const cryptoArg = snippet.includes('crypto.subtle') ? globalThis.crypto : nodeCrypto;
  return new Function('crypto', 'Buffer', `${js}\nreturn verifySignature;`)(cryptoArg, Buffer) as Verify;
}

const TARGETS = [
  { framework: 'express', isTs: false },
  { framework: 'hono', isTs: true },
  { framework: 'cloudflare-worker', isTs: true },
] as const;

describe.skipIf(!existsSync(API_SIGNATURE))('init verifiers accept what the API signs', () => {
  // Twilio signs URL + sorted form params; the API's signer needs a URL-specific setup that this
  // generic loop doesn't do, and its verifier is unchanged from before this test existed.
  const schemes = PROVIDER_SCHEMES.filter((s) => s.id !== 'twilio');

  for (const scheme of schemes) {
    for (const target of TARGETS) {
      it(`${scheme.id} (${target.framework})`, async () => {
        const sig = await import(API_SIGNATURE);
        const body = JSON.stringify({ id: 'evt_1', type: 'test.event', data: { n: 1 } });
        const secret = secretFor(scheme.id);
        const headers: Record<string, string> = {};
        if (scheme.kind === 'shared_secret') {
          // Nothing to compute: the vendor echoes the configured token (behind its prefix, if any).
          headers[scheme.header[0]] = `${'signaturePrefix' in scheme ? scheme.signaturePrefix : ''}${secret}`;
        } else {
          const result = await sig.computeSignature(scheme.id, body, secret);
          for (const [k, v] of Object.entries(sig.buildSignatureHeaders(scheme.id, result) as Record<string, string>)) {
            headers[k.toLowerCase()] = v;
          }
        }
        // DocuSign's signer writes the first numbered header.
        const getHeader = (name: string) => headers[name.toLowerCase()] ?? '';

        const verify = load(getVerifySnippet(scheme.id, target.framework), target.isTs);
        expect(await verify(body, secret, getHeader, 'https://example.test/webhook')).toBe(true);

        if (scheme.kind === 'hmac') {
          expect(await verify(body + ' ', secret, getHeader, 'https://example.test/webhook')).toBe(false);
        }
        expect(await verify(body, 'a-different-secret', getHeader, 'https://example.test/webhook')).toBe(false);
      });
    }
  }
});

describe('ingest-verified providers', () => {
  it('get a pass-through verifier in every flavour', async () => {
    for (const p of INGEST_VERIFIED) {
      for (const target of TARGETS) {
        const verify = load(passThroughSnippet(p, target.framework), target.isTs);
        expect(await verify('{}', '', () => '', 'https://example.test/webhook')).toBe(true);
      }
    }
  });
});

import { select, input, confirm } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as logger from '../lib/logger.js';

function isPromptCancelled(error: unknown): boolean {
  return error instanceof ExitPromptError ||
    (error instanceof Error && error.name === 'ExitPromptError');
}

const FRAMEWORKS = ['express', 'fastify', 'hono', 'nextjs', 'cloudflare-worker'] as const;
type Framework = typeof FRAMEWORKS[number];

const PROVIDERS = ['stripe', 'github', 'shopify', 'slack', 'custom'] as const;
type Provider = typeof PROVIDERS[number];

interface InitOptions {
  framework?: string;
  provider?: string;
  dir?: string;
  source?: string;
  force?: boolean;
}

function templatesRoot(): string {
  // Resolve relative to the compiled file. tsc emits to dist/commands/init.js,
  // and the build copy step lands templates at dist/templates/.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, '..', 'templates');
}

function isDirNonEmpty(dir: string): boolean {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

function copyTemplate(srcDir: string, destDir: string, replacements: Record<string, string>): void {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    // Strip the .tmpl extension so the rendered filename is the real one.
    const outName = entry.name.endsWith('.tmpl') ? entry.name.slice(0, -5) : entry.name;
    const destPath = path.join(destDir, outName);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyTemplate(srcPath, destPath, replacements);
      continue;
    }

    const content = fs.readFileSync(srcPath, 'utf-8');
    const rendered = Object.entries(replacements).reduce(
      (acc, [key, value]) => acc.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value),
      content
    );
    fs.writeFileSync(destPath, rendered);
  }
}

export async function initCommand(options: InitOptions): Promise<void> {
  try {
    let framework = options.framework as Framework | undefined;
    if (!framework) {
      framework = (await select({
        message: 'Choose a framework:',
        choices: [
          { name: 'Express (Node.js, most common)', value: 'express' },
          { name: 'Fastify (Node.js, faster)', value: 'fastify' },
          { name: 'Hono (Node/Bun/edge runtimes)', value: 'hono' },
          { name: 'Next.js (App Router route handler)', value: 'nextjs' },
          { name: 'Cloudflare Worker', value: 'cloudflare-worker' },
        ],
      })) as Framework;
    }
    if (!FRAMEWORKS.includes(framework)) {
      logger.error(`Unknown framework: ${framework}. Choose one of: ${FRAMEWORKS.join(', ')}`);
      return;
    }

    let provider = options.provider as Provider | undefined;
    if (!provider) {
      provider = (await select({
        message: 'Provider for signature verification:',
        choices: [
          { name: 'Stripe', value: 'stripe' },
          { name: 'GitHub', value: 'github' },
          { name: 'Shopify', value: 'shopify' },
          { name: 'Slack', value: 'slack' },
          { name: 'Generic HMAC-SHA256 (custom)', value: 'custom' },
        ],
      })) as Provider;
    }
    if (!PROVIDERS.includes(provider)) {
      logger.error(`Unknown provider: ${provider}. Choose one of: ${PROVIDERS.join(', ')}`);
      return;
    }

    let dir = options.dir;
    if (!dir) {
      dir = await input({ message: 'Output directory:', default: './hookbase-handler' });
    }
    const targetDir = path.resolve(dir);

    if (fs.existsSync(targetDir) && isDirNonEmpty(targetDir) && !options.force) {
      const overwrite = await confirm({
        message: `Directory ${targetDir} is not empty. Continue and overwrite?`,
        default: false,
      });
      if (!overwrite) {
        logger.info('Aborted.');
        return;
      }
    }

    fs.mkdirSync(targetDir, { recursive: true });

    const srcDir = path.join(templatesRoot(), framework);
    if (!fs.existsSync(srcDir)) {
      logger.error(`Template not found at ${srcDir}. The CLI may have been installed without templates.`);
      return;
    }

    copyTemplate(srcDir, targetDir, {
      PROVIDER: provider,
      PROVIDER_LABEL: providerLabel(provider),
      VERIFY_SNIPPET: getVerifySnippet(provider, framework),
      ENV_VAR_NAME: envVarName(provider),
      SOURCE_URL: options.source ? `Configure your Hookbase source destination URL to hit this endpoint.` : 'See https://www.hookbase.app/docs',
      HEADER_NAME: signatureHeader(provider),
    });

    logger.success(`Scaffold created at ${targetDir}`);
    logger.log('');
    logger.log('Next steps:');
    logger.log(`  cd ${path.relative(process.cwd(), targetDir) || '.'}`);
    logger.log('  npm install');
    if (framework === 'cloudflare-worker') {
      logger.log('  npx wrangler dev');
    } else {
      logger.log('  npm run dev');
    }
    logger.log('');
    logger.dim(`Then point a Hookbase destination at your dev URL (use 'hookbase listen <port>' for a tunnel).`);
  } catch (error) {
    if (isPromptCancelled(error)) {
      return;
    }
    logger.error(error instanceof Error ? error.message : 'init failed');
  }
}

function providerLabel(p: Provider): string {
  return { stripe: 'Stripe', github: 'GitHub', shopify: 'Shopify', slack: 'Slack', custom: 'Custom HMAC' }[p];
}

function envVarName(p: Provider): string {
  return p === 'custom' ? 'WEBHOOK_SIGNING_SECRET' : `${p.toUpperCase()}_SIGNING_SECRET`;
}

function signatureHeader(p: Provider): string {
  return {
    stripe: 'stripe-signature',
    github: 'x-hub-signature-256',
    shopify: 'x-shopify-hmac-sha256',
    slack: 'x-slack-signature',
    custom: 'x-signature',
  }[p];
}

// Inline verifier for each provider. Generated as a string so we can emit it
// into framework templates without having to maintain a 5×5 matrix of files.
function getVerifySnippet(p: Provider, framework: Framework): string {
  const indent = framework === 'nextjs' ? '  ' : '  ';
  // We emit a `verifySignature(rawBody, header, secret)` function; templates
  // call into it. Using Node's `crypto` directly keeps zero dependencies for
  // the generated project beyond the framework itself.
  switch (p) {
    case 'stripe':
      return [
        `function verifySignature(rawBody, header, secret) {`,
        `${indent}// Stripe header: "t=<timestamp>,v1=<signature>" (timestamp tolerance 5min)`,
        `${indent}const parts = Object.fromEntries(header.split(',').map(s => s.split('=')));`,
        `${indent}const ts = parts.t; const v1 = parts.v1;`,
        `${indent}if (!ts || !v1) return false;`,
        `${indent}if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;`,
        `${indent}const sig = crypto.createHmac('sha256', secret).update(\`\${ts}.\${rawBody}\`).digest('hex');`,
        `${indent}return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(v1));`,
        `}`,
      ].join('\n');
    case 'github':
      return [
        `function verifySignature(rawBody, header, secret) {`,
        `${indent}// GitHub header: "sha256=<hex>"`,
        `${indent}if (!header?.startsWith('sha256=')) return false;`,
        `${indent}const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');`,
        `${indent}return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header));`,
        `}`,
      ].join('\n');
    case 'shopify':
      return [
        `function verifySignature(rawBody, header, secret) {`,
        `${indent}// Shopify header: base64-encoded HMAC-SHA256`,
        `${indent}const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');`,
        `${indent}return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header));`,
        `}`,
      ].join('\n');
    case 'slack':
      return [
        `function verifySignature(rawBody, header, secret, timestamp) {`,
        `${indent}// Slack header: "v0=<hex>". Requires X-Slack-Request-Timestamp header (tolerance 5min).`,
        `${indent}if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;`,
        `${indent}const base = \`v0:\${timestamp}:\${rawBody}\`;`,
        `${indent}const expected = 'v0=' + crypto.createHmac('sha256', secret).update(base).digest('hex');`,
        `${indent}return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header));`,
        `}`,
      ].join('\n');
    case 'custom':
    default:
      return [
        `function verifySignature(rawBody, header, secret) {`,
        `${indent}// Generic HMAC-SHA256 hex digest`,
        `${indent}const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');`,
        `${indent}return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header));`,
        `}`,
      ].join('\n');
  }
}

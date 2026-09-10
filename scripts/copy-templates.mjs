#!/usr/bin/env node
import { cpSync, existsSync, rmSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src', 'templates');
const dest = join(here, '..', 'dist', 'templates');
const entry = join(here, '..', 'dist', 'index.js');

// tsc doesn't preserve the executable bit when it (re)writes dist/index.js,
// which breaks the `hookbase` bin symlink (npm link, npm install -g, etc.)
// after every rebuild — restore it here since this script always runs post-tsc.
if (existsSync(entry)) chmodSync(entry, 0o755);

if (!existsSync(src)) {
  console.warn(`templates source not found at ${src} — skipping copy`);
  process.exit(0);
}

if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`templates copied → ${dest}`);

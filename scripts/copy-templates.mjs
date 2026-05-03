#!/usr/bin/env node
import { cpSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src', 'templates');
const dest = join(here, '..', 'dist', 'templates');

if (!existsSync(src)) {
  console.warn(`templates source not found at ${src} — skipping copy`);
  process.exit(0);
}

if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`templates copied → ${dest}`);

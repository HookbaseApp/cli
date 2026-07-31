import { spawn, type StdioOptions } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import type { Command } from 'commander';
import * as logger from '../lib/logger.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { name: string; version: string };

const PACKAGE_NAME = pkg.name; // '@hookbase/cli'

interface PackageManager {
  /** Human-readable name */
  name: string;
  /** Command + args used to install the latest version globally */
  install: string[];
}

/**
 * Best-effort detection of how this CLI was installed globally, based on the
 * on-disk location of the running module. Falls back to npm, which is how the
 * README tells users to install.
 */
export function detectPackageManager(selfPathOverride?: string): PackageManager {
  let selfPath = selfPathOverride ?? '';
  if (!selfPath) {
    try {
      selfPath = fileURLToPath(import.meta.url);
    } catch {
      selfPath = process.argv[1] || '';
    }
  }
  const p = selfPath.replace(/\\/g, '/').toLowerCase();

  const target = `${PACKAGE_NAME}@latest`;

  // Order matters: check the more specific managers before npm.
  // Each manager is matched against both its POSIX (`~/.volta/`) and Windows
  // (`%LOCALAPPDATA%\Volta`, no leading dot) install layouts.
  if (p.includes('/.volta/') || p.includes('/volta/')) {
    return { name: 'volta', install: ['volta', 'install', target] };
  }
  if (p.includes('/.bun/') || p.includes('/bun/install/')) {
    return { name: 'bun', install: ['bun', 'add', '-g', target] };
  }
  if (p.includes('/pnpm/') || p.includes('/.pnpm/')) {
    return { name: 'pnpm', install: ['pnpm', 'add', '-g', target] };
  }
  // POSIX: ~/.config/yarn/global/... ; Windows: %LOCALAPPDATA%\Yarn\Data\global\...
  if (p.includes('/.yarn/') || p.includes('/yarn/global/') || p.includes('/yarn/data/global/')) {
    return { name: 'yarn', install: ['yarn', 'global', 'add', target] };
  }
  return { name: 'npm', install: ['npm', 'install', '-g', target] };
}

/** Fetch the latest published version from the npm registry (null on failure). */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

/** True if `latest` is a strictly higher x.y.z than `current`. Ignores pre-release tags. */
function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

/** Spawn the install command, streaming its output. Resolves with the exit code (non-zero on failure). */
function runInstall(pm: PackageManager, json: boolean): Promise<number> {
  return new Promise((resolve) => {
    const [cmd, ...args] = pm.install;
    // In --json mode the installer's own output would corrupt the JSON on
    // stdout, so route the child's stdout to our stderr (fd 2) and keep stdout
    // reserved for the final JSON summary.
    const stdio: StdioOptions = json ? ['inherit', 2, 2] : 'inherit';
    // shell:true on Windows so `.cmd` shims (npm.cmd, pnpm.cmd) resolve.
    const child = spawn(cmd, args, { stdio, shell: process.platform === 'win32' });
    child.on('error', (err) => {
      logger.error(`Failed to launch ${cmd}: ${(err as Error).message}`);
      resolve(1);
    });
    // A signal-terminated child reports code=null; treat that as failure so we
    // never print "updated" for an interrupted/killed install.
    child.on('close', (code, signal) => {
      if (signal) {
        logger.error(`Install was terminated by signal ${signal}.`);
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

interface UpgradeOptions {
  check?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export async function upgradeCommand(cmdOptions: UpgradeOptions = {}, command?: Command): Promise<void> {
  // `--json` is declared on both the root program and this subcommand, so
  // commander binds the token to the parent option. optsWithGlobals() merges
  // parent globals with local options so we see --json regardless of position.
  const options: UpgradeOptions = command ? command.optsWithGlobals() : cmdOptions;

  const current = pkg.version;
  const pm = detectPackageManager();
  const commandStr = pm.install.join(' ');

  const spinner = options.json ? null : logger.spinner('Checking for the latest version…');
  // Note: this check queries the public npm registry, whereas the install below
  // resolves `@latest` through the user's own package-manager config (which may
  // point at a private/scoped registry). They can therefore disagree — see the
  // handling of an inconclusive `latest` on the actual-upgrade path.
  const latest = await fetchLatestVersion();
  spinner?.stop();

  // --check / --dry-run are purely informational, so they require the lookup.
  if (options.check || options.dryRun) {
    if (!latest) {
      if (options.json) {
        console.log(JSON.stringify({ current, latest: null, error: 'registry_unreachable' }, null, 2));
      } else {
        logger.error('Could not reach the npm registry to check for updates.');
        logger.dim(`To update manually, run: ${commandStr}`);
      }
      process.exitCode = 1;
      return;
    }
    const upToDate = !isNewer(latest, current);
    if (options.json) {
      console.log(JSON.stringify({ current, latest, upToDate, packageManager: pm.name, command: commandStr }, null, 2));
    } else if (upToDate) {
      logger.success(`You're on the latest version (${current}).`);
    } else {
      logger.info(`Update available: ${current} → ${logger.green(latest)}`);
      logger.dim(`${options.dryRun ? 'Would run' : 'Run'}: ${commandStr}`);
    }
    return;
  }

  // Actual upgrade. Only skip the install when we could confirm we're current.
  if (latest && !isNewer(latest, current)) {
    if (options.json) {
      console.log(JSON.stringify({ current, latest, upToDate: true, updated: false, packageManager: pm.name }, null, 2));
    } else {
      logger.success(`You're already on the latest version (${current}).`);
    }
    return;
  }

  // Either a newer version is available, or the public check was inconclusive
  // (offline / private registry). In both cases defer to the package manager,
  // which resolves `@latest` against the user's own registry.
  if (!options.json) {
    if (latest) {
      logger.info(`Updating ${PACKAGE_NAME}: ${current} → ${logger.green(latest)}`);
    } else {
      logger.warn('Could not confirm the latest version; updating via your package manager anyway.');
      logger.info(`Updating ${PACKAGE_NAME} to the latest published version`);
    }
    logger.dim(`Detected package manager: ${pm.name}`);
    logger.dim(`Running: ${commandStr}`);
    logger.log('');
  }

  const code = await runInstall(pm, !!options.json);

  if (code === 0) {
    if (options.json) {
      console.log(JSON.stringify({ current, latest, updated: true, packageManager: pm.name }, null, 2));
    } else {
      logger.log('');
      // This already-running process can't observe the freshly-installed
      // version, and behind a private registry it may differ from the public
      // `latest` we fetched — so don't assert a specific version number.
      logger.success('Update complete. Run "hookbase --version" to confirm.');
    }
    return;
  }

  if (options.json) {
    console.log(JSON.stringify({ current, latest, updated: false, exitCode: code, packageManager: pm.name }, null, 2));
  } else {
    logger.log('');
    logger.error(`Update failed (exit code ${code}).`);
    logger.dim('If this looks like a permissions error, re-run with elevated privileges, or run manually:');
    logger.dim(`  ${commandStr}`);
  }
  process.exitCode = code || 1;
}

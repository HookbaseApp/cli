import { describe, it, expect } from 'vitest';
import { detectPackageManager, isNewer } from './upgrade.js';

describe('detectPackageManager', () => {
  it('detects volta from a POSIX path', () => {
    const pm = detectPackageManager('/home/user/.volta/tools/image/node/20.11.0/bin/hookbase');
    expect(pm.name).toBe('volta');
    expect(pm.install[0]).toBe('volta');
  });

  it('detects volta from a Windows path', () => {
    const pm = detectPackageManager('C:\\Users\\foo\\AppData\\Local\\Volta\\tools\\image\\node\\hookbase.cmd');
    expect(pm.name).toBe('volta');
  });

  it('detects bun from a POSIX path', () => {
    const pm = detectPackageManager('/home/user/.bun/install/global/node_modules/@hookbase/cli/dist/index.js');
    expect(pm.name).toBe('bun');
    expect(pm.install[0]).toBe('bun');
  });

  it('detects bun from a Windows path', () => {
    const pm = detectPackageManager('C:\\Users\\foo\\AppData\\Local\\bun\\install\\global\\node_modules\\@hookbase\\cli\\dist\\index.js');
    expect(pm.name).toBe('bun');
  });

  it('detects pnpm from a POSIX path', () => {
    const pm = detectPackageManager('/home/user/.local/share/pnpm/global/5/node_modules/.pnpm/@hookbase+cli@1.0.0/node_modules/@hookbase/cli/dist/index.js');
    expect(pm.name).toBe('pnpm');
    expect(pm.install[0]).toBe('pnpm');
  });

  it('detects pnpm from a Windows path', () => {
    const pm = detectPackageManager('C:\\Users\\foo\\AppData\\Local\\pnpm\\global\\5\\node_modules\\@hookbase\\cli\\dist\\index.js');
    expect(pm.name).toBe('pnpm');
  });

  it('detects yarn from a POSIX path', () => {
    const pm = detectPackageManager('/home/user/.config/yarn/global/node_modules/@hookbase/cli/dist/index.js');
    expect(pm.name).toBe('yarn');
    expect(pm.install[0]).toBe('yarn');
  });

  it('detects yarn from a Windows path', () => {
    const pm = detectPackageManager('C:\\Users\\foo\\AppData\\Local\\Yarn\\Data\\global\\node_modules\\@hookbase\\cli\\dist\\index.js');
    expect(pm.name).toBe('yarn');
  });

  it('falls back to npm for a POSIX path with no matching manager', () => {
    const pm = detectPackageManager('/usr/local/lib/node_modules/@hookbase/cli/dist/index.js');
    expect(pm.name).toBe('npm');
    expect(pm.install[0]).toBe('npm');
  });

  it('falls back to npm for a Windows path with no matching manager', () => {
    const pm = detectPackageManager('C:\\Program Files\\nodejs\\node_modules\\@hookbase\\cli\\dist\\index.js');
    expect(pm.name).toBe('npm');
  });
});

describe('isNewer', () => {
  it('returns true when the latest patch version is higher', () => {
    expect(isNewer('1.2.3', '1.2.2')).toBe(true);
  });

  it('returns false when the latest version is lower', () => {
    expect(isNewer('1.2.2', '1.2.3')).toBe(false);
  });

  it('returns false for equal versions', () => {
    expect(isNewer('1.2.3', '1.2.3')).toBe(false);
  });

  it('compares numerically, not lexicographically', () => {
    expect(isNewer('1.10.0', '1.9.0')).toBe(true);
  });

  it('detects a higher major version', () => {
    expect(isNewer('2.0.0', '1.9.9')).toBe(true);
  });

  it('ignores pre-release tags on both sides', () => {
    expect(isNewer('1.2.3', '1.2.3-beta.1')).toBe(false);
    expect(isNewer('1.2.3-rc.2', '1.2.3')).toBe(false);
  });

  it('still detects a real bump when one side has a pre-release tag', () => {
    expect(isNewer('2.0.0-rc.1', '1.9.9')).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import type { Command } from 'commander';
import { program } from './index.js';

function hasActionHandler(cmd: Command): boolean {
  return (cmd as unknown as { _actionHandler: unknown })._actionHandler !== null;
}

function namesAndAliases(cmd: Command): string[] {
  return [cmd.name(), ...cmd.aliases()];
}

function collectLeaves(cmd: Command, path: string[] = []): { path: string[]; cmd: Command }[] {
  const children = cmd.commands.filter((c) => c.name() !== 'help');
  if (children.length === 0) {
    return [{ path, cmd }];
  }
  return children.flatMap((child) => collectLeaves(child, [...path, child.name()]));
}

function collectDuplicates(cmd: Command, path: string[] = []): string[] {
  const seen = new Map<string, string>();
  const dupes: string[] = [];

  for (const child of cmd.commands) {
    for (const n of namesAndAliases(child)) {
      const owner = seen.get(n);
      if (owner && owner !== child.name()) {
        dupes.push(`${path.join(' ') || '(root)'}: "${n}" registered by both "${owner}" and "${child.name()}"`);
      } else {
        seen.set(n, child.name());
      }
    }
  }

  for (const child of cmd.commands) {
    dupes.push(...collectDuplicates(child, [...path, child.name()]));
  }

  return dupes;
}

describe('CLI command registration', () => {
  it('registers a non-trivial number of top-level commands', () => {
    expect(program.commands.length).toBeGreaterThan(10);
  });

  it('every leaf command has an action handler', () => {
    const leaves = collectLeaves(program);
    const missing = leaves.filter((l) => !hasActionHandler(l.cmd)).map((l) => l.path.join(' '));
    expect(missing).toEqual([]);
  });

  it('has no duplicate command name or alias registered under the same parent', () => {
    expect(collectDuplicates(program)).toEqual([]);
  });
});

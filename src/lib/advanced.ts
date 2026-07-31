import { confirm } from '@inquirer/prompts';
import * as api from './api.js';
import * as logger from './logger.js';

// ============================================================================
// Plan-gating helpers for advanced create flows.
//
// The server is the authoritative source of feature enablement (GET
// /api/organizations/:orgId/features). The CLI fetches that map once, then gates
// which advanced prompts/flags it offers so users on lower plans aren't shown
// options they can't use. The API still enforces the gate on every write, so if
// the map is unavailable (e.g. an API too old to have the endpoint) the CLI
// degrades to "offer everything, let the API reject".
// ============================================================================

let loaded = false;
let featureMap: Record<string, boolean> | null = null; // null => unknown (optimistic)
let planName = 'unknown';

/**
 * Fetch and cache the current org's plan feature map (once per process).
 * On any failure — including a 404 from an API too old to expose /features —
 * the map is left null and the CLI degrades gracefully (see module comment).
 */
export async function loadFeatures(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const res = await api.getOrgFeatures();
  if (res.data && res.data.features) {
    featureMap = res.data.features;
    planName = res.data.plan || 'unknown';
  }
}

/** Whether a feature is enabled for the current plan. An unknown key or an
 * unavailable map returns true (optimistic — the API remains the real gate). */
export function featureEnabled(key: string): boolean {
  if (!featureMap) return true;
  const v = featureMap[key];
  return v === undefined ? true : v;
}

/** The current plan name ('unknown' if the feature map couldn't be loaded). */
export function currentPlan(): string {
  return planName;
}

/**
 * Guard a flag-driven advanced option: returns true if the feature is allowed;
 * otherwise prints an upgrade message and returns false so the caller can abort
 * before doing any work. Mirrors the API's fallback 403 message wording.
 */
export function ensureFeature(key: string, label: string): boolean {
  if (featureEnabled(key)) return true;
  logger.error(
    `${label} is not available on your ${planName} plan. Upgrade at https://www.hookbase.app/pricing to use it.`,
  );
  return false;
}

/**
 * The shared "Advanced setup?" gate used by every create command. Returns false
 * WITHOUT prompting when `skip` is true (e.g. `--yes`, or advanced flags were
 * already supplied) or when stdin isn't a TTY (scripting) — so the basic,
 * fast path is never slowed down for users who just want a simple entity.
 */
export async function askAdvanced(entity: string, skip = false): Promise<boolean> {
  if (skip || !process.stdin.isTTY) return false;
  return confirm({
    message: `Configure advanced ${entity} options?`,
    default: false,
  });
}

/**
 * Run an advanced sub-prompt only when its feature is enabled. When the feature
 * is disabled for the current plan, note the skip on one dim line and return the
 * provided fallback value instead of prompting.
 */
export async function gatedPrompt<T>(
  key: string,
  label: string,
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  if (featureEnabled(key)) return fn();
  logger.dim(`  ${label} — not on your ${planName} plan, skipped`);
  return fallback;
}

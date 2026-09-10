import {
  getApiUrl,
  getAuthToken,
  getCurrentOrg,
  getSessionAccessToken,
  getSessionRefreshToken,
  getSessionUser,
  setSession,
  clearSession,
  isAuthenticated,
  hasSession,
} from './config.js';

interface ApiResponse<T> {
  data?: T;
  error?: string;
  status: number;
}

// Resource routes are mounted twice server-side: org-implicit (/api/<resource>,
// org inferred from the API key) and org-explicit (/api/organizations/:orgId/<resource>).
// A session token isn't scoped to one org the way a key is — the org-access
// middleware requires an explicit orgId in the URL for session/JWT auth — so a
// session-authenticated call has to go through the org-explicit form instead.
// This is every org-scoped prefix the CLI actually calls via request().
const ORG_SCOPED_PATH_PREFIXES = new Set([
  'analytics', 'api-keys', 'audit-logs', 'cron', 'cron-groups', 'deliveries',
  'destinations', 'events', 'filters', 'notification-channels',
  'outbound-messages', 'realtime', 'routes', 'schemas', 'send-event',
  'sources', 'transforms', 'tunnels', 'webhook-applications', 'webhook-endpoints',
]);

function toOrgScopedPath(path: string, orgId: string): string | null {
  const match = path.match(/^\/api\/([a-zA-Z0-9_-]+)(.*)$/);
  if (!match) return null;
  const [, prefix, rest] = match;
  if (!ORG_SCOPED_PATH_PREFIXES.has(prefix)) return null;
  return `/api/organizations/${orgId}/${prefix}${rest}`;
}

async function request<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<ApiResponse<T>> {
  const apiUrl = getApiUrl();
  const token = getAuthToken();
  const hasApiKey = !!token && token.startsWith('whr_');

  if (!hasApiKey) {
    if (hasSession()) {
      const org = getCurrentOrg();
      const scopedPath = org ? toOrgScopedPath(path, org.id) : null;
      if (!scopedPath) {
        return {
          error: org
            ? 'This request is not supported with a session login — run "hookbase login" with an API key instead.'
            : 'No organization selected. Run "hookbase org switch <idOrSlug>" first.',
          status: 0,
        };
      }
      return sessionRequest<T>(method, scopedPath, body);
    }

    return {
      error: 'Not authenticated. Run "hookbase login".',
      status: 0,
    };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  try {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Read the body as text first: a non-JSON response (Cloudflare 502/504 HTML,
    // an empty 204) must not throw a JSON-parse error that masks the real status.
    const rawBody = await response.text();
    let data: Record<string, unknown> = {};
    if (rawBody) {
      try {
        data = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        data = {};
      }
    }

    if (!response.ok) {
      let errorMsg =
        (data.error as string) ||
        (data.message as string) ||
        `Request failed (HTTP ${response.status})`;
      if (data.details) {
        errorMsg += ` - ${JSON.stringify(data.details)}`;
      }
      return {
        error: errorMsg,
        status: response.status,
      };
    }

    return { data: data as T, status: response.status };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Network error',
      status: 0,
    };
  }
}

// ============================================================================
// Auth - API Key verification
// ============================================================================

export interface VerifyApiKeyResponse {
  // GET /auth/me returns exactly one of these two depending on how the request authenticated.
  // An API key (the only credential `hookbase login` accepts) has no user identity of its own —
  // see the `if (apiKey)` branch in api/src/routes/auth.ts — so `user` is absent in that case.
  user?: {
    id: string;
    email: string;
    displayName: string;
  };
  apiKey?: {
    id: string;
    name: string;
    scopes: string[];
  };
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    plan: string;
  }>;
}

export async function verifyApiKey(apiKey: string): Promise<ApiResponse<VerifyApiKeyResponse>> {
  const apiUrl = getApiUrl();

  try {
    const response = await fetch(`${apiUrl}/api/auth/me`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const rawBody = await response.text();
    let data: Record<string, unknown> = {};
    if (rawBody) {
      try {
        data = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        data = {};
      }
    }

    if (!response.ok) {
      return {
        error: (data.error as string) || (data.message as string) || `Invalid API key (HTTP ${response.status})`,
        status: response.status,
      };
    }

    return { data: data as unknown as VerifyApiKeyResponse, status: response.status };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Network error',
      status: 0,
    };
  }
}

// ============================================================================
// Platform status (BetterStack, proxied through the API)
// ============================================================================

export interface PlatformStatus {
  overallStatus: string;
  components: Array<{ name: string; status: string }>;
  updatedAt: string;
  statusPageUrl: string;
}

// GET /api/status is public and unauthenticated — no bearer token, so this
// doesn't go through request()/sessionRequest() at all. Works whether or not
// the caller is logged in.
export async function getStatus(): Promise<ApiResponse<PlatformStatus>> {
  const apiUrl = getApiUrl();

  try {
    const response = await fetch(`${apiUrl}/api/status`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const rawBody = await response.text();
    let data: Record<string, unknown> = {};
    if (rawBody) {
      try {
        data = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        data = {};
      }
    }

    if (!response.ok) {
      return {
        error: (data.error as string) || (data.message as string) || `Failed to fetch status (HTTP ${response.status})`,
        status: response.status,
      };
    }

    return { data: data as unknown as PlatformStatus, status: response.status };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Network error',
      status: 0,
    };
  }
}

// /api/auth/me accepts either an API key or a session bearer token server-side
// (plain authMiddleware, no requireUserAuth() gate) — so unlike most endpoints,
// this should work with whichever credential the caller actually has.
export async function getMe(): Promise<ApiResponse<VerifyApiKeyResponse>> {
  if (isAuthenticated()) {
    return request<VerifyApiKeyResponse>('GET', '/api/auth/me');
  }
  if (hasSession()) {
    return sessionRequest<VerifyApiKeyResponse>('GET', '/api/auth/me');
  }
  return {
    error: 'Not authenticated. Run "hookbase login".',
    status: 0,
  };
}

// ============================================================================
// Session Auth (device flow) — separate credential set from API-key auth,
// used for features that require a real user session (2FA, org members,
// API key rotation).
// ============================================================================

export interface DeviceAuthStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export async function startDeviceAuth(): Promise<ApiResponse<DeviceAuthStart>> {
  const apiUrl = getApiUrl();

  try {
    const response = await fetch(`${apiUrl}/api/auth/device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const rawBody = await response.text();
    let data: Record<string, unknown> = {};
    if (rawBody) {
      try {
        data = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        data = {};
      }
    }

    if (!response.ok) {
      return {
        error: (data.error as string) || `Failed to start device auth (HTTP ${response.status})`,
        status: response.status,
      };
    }

    return { data: data as unknown as DeviceAuthStart, status: response.status };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Network error',
      status: 0,
    };
  }
}

export interface DeviceTokenResult {
  user: { id: string; email: string; displayName: string; avatarUrl?: string };
  accessToken: string;
  refreshToken: string;
}

export async function pollDeviceToken(deviceCode: string): Promise<ApiResponse<DeviceTokenResult>> {
  const apiUrl = getApiUrl();

  try {
    const response = await fetch(`${apiUrl}/api/auth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode }),
    });

    const rawBody = await response.text();
    let data: Record<string, unknown> = {};
    if (rawBody) {
      try {
        data = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        data = {};
      }
    }

    // Non-terminal "keep polling" state — the caller distinguishes this from
    // a real failure via `status` (428 = authorization_pending).
    if (!response.ok) {
      return {
        error: (data.error as string) || `Device token request failed (HTTP ${response.status})`,
        status: response.status,
      };
    }

    return { data: data as unknown as DeviceTokenResult, status: response.status };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Network error',
      status: 0,
    };
  }
}

export async function refreshSession(): Promise<boolean> {
  const refreshToken = getSessionRefreshToken();
  if (!refreshToken) return false;

  const apiUrl = getApiUrl();

  try {
    const response = await fetch(`${apiUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) return false;

    const data = await response.json() as { accessToken: string; refreshToken: string };
    if (!data.accessToken || !data.refreshToken) return false;

    // Preserve the currently-stored session user identity; the refresh
    // response doesn't repeat it.
    const user = getSessionUser();
    if (!user) return false;

    setSession(data.accessToken, data.refreshToken, user);
    return true;
  } catch {
    return false;
  }
}

export async function sessionRequest<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<ApiResponse<T>> {
  const apiUrl = getApiUrl();
  let token = getSessionAccessToken();

  if (!token) {
    return {
      error: 'Not logged in with a session. Run "hookbase login" first.',
      status: 0,
    };
  }

  const doFetch = async (bearerToken: string) => {
    return fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearerToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  };

  try {
    let response = await doFetch(token);

    if (response.status === 401) {
      const refreshed = await refreshSession();
      if (refreshed) {
        token = getSessionAccessToken()!;
        response = await doFetch(token);
      } else {
        clearSession();
        return {
          error: 'Session expired. Run "hookbase session login" again.',
          status: 401,
        };
      }
    }

    const rawBody = await response.text();
    let data: Record<string, unknown> = {};
    if (rawBody) {
      try {
        data = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        data = {};
      }
    }

    if (!response.ok) {
      if (response.status === 401) {
        clearSession();
        return {
          error: 'Session expired. Run "hookbase session login" again.',
          status: 401,
        };
      }
      let errorMsg =
        (data.error as string) ||
        (data.message as string) ||
        `Request failed (HTTP ${response.status})`;
      if (data.details) {
        errorMsg += ` - ${JSON.stringify(data.details)}`;
      }
      return { error: errorMsg, status: response.status };
    }

    return { data: data as T, status: response.status };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Network error',
      status: 0,
    };
  }
}

// ============================================================================
// API Keys
// ============================================================================

export interface ApiKey {
  id: string;
  name: string;
  key?: string; // Full key, only returned on creation
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface CreateApiKeyResponse {
  apiKey: ApiKey;
}

export async function listApiKeys(): Promise<ApiResponse<{ apiKeys: ApiKey[] }>> {

  return request<{ apiKeys: ApiKey[] }>('GET', `/api/api-keys`);
}

// Creating an API key requires a real user session (api/src/routes/apiKeys.ts:
// requireUserAuth() — key minting stays human-only, an API key can't spawn
// another one). Org resolution for a session request needs the explicit
// :orgId path param (JWT auth has no apiKeyInfo for orgAccessMiddleware to
// infer the org from), so this goes through the org-scoped route.
export async function createApiKey(
  name: string,
  scopes: string[] = ['read', 'write', 'delete'],
  expiresInDays?: number
): Promise<ApiResponse<CreateApiKeyResponse>> {
  const org = getCurrentOrg();
  if (!org) {
    return { error: 'No organization selected. Run "hookbase org switch <idOrSlug>" first.', status: 0 };
  }

  return sessionRequest<CreateApiKeyResponse>('POST', `/api/organizations/${org.id}/api-keys`, {
    name,
    scopes,
    // Server reads `expiresIn` in seconds, not days.
    expiresIn: expiresInDays ? expiresInDays * 24 * 60 * 60 : undefined,
  });
}

export async function revokeApiKey(keyId: string): Promise<ApiResponse<{ success: boolean }>> {

  return request<{ success: boolean }>('DELETE', `/api/api-keys/${keyId}`);
}

export async function rotateApiKeySecret(keyId: string): Promise<ApiResponse<CreateApiKeyResponse>> {
  const org = getCurrentOrg();
  if (!org) {
    return { error: 'No organization selected. Run "hookbase org switch <idOrSlug>" first.', status: 0 };
  }

  return sessionRequest<CreateApiKeyResponse>('POST', `/api/organizations/${org.id}/api-keys/${keyId}/rotate-secret`);
}

// ============================================================================
// Organization Members (requires a session login — org membership is a
// human-only concept server-side, api/src/routes/organizations.ts)
// ============================================================================

function resolveOrgId(explicitOrgId?: string): string | null {
  if (explicitOrgId) return explicitOrgId;
  return getCurrentOrg()?.id || null;
}

export interface OrgMember {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: string;
  createdAt: string;
  membershipId: string;
}

export async function getOrgMembers(orgId?: string): Promise<ApiResponse<{ members: OrgMember[] }>> {
  const id = resolveOrgId(orgId);
  if (!id) {
    return { error: 'No organization selected. Run "hookbase org switch <idOrSlug>" first.', status: 0 };
  }
  return sessionRequest<{ members: OrgMember[] }>('GET', `/api/organizations/${id}/members`);
}

export async function updateOrgMemberRole(
  userId: string,
  role: string,
  orgId?: string
): Promise<ApiResponse<{ success: boolean }>> {
  const id = resolveOrgId(orgId);
  if (!id) {
    return { error: 'No organization selected. Run "hookbase org switch <idOrSlug>" first.', status: 0 };
  }
  return sessionRequest<{ success: boolean }>('PATCH', `/api/organizations/${id}/members/${userId}`, { role });
}

export async function removeOrgMember(userId: string, orgId?: string): Promise<ApiResponse<{ success: boolean }>> {
  const id = resolveOrgId(orgId);
  if (!id) {
    return { error: 'No organization selected. Run "hookbase org switch <idOrSlug>" first.', status: 0 };
  }
  return sessionRequest<{ success: boolean }>('DELETE', `/api/organizations/${id}/members/${userId}`);
}

export interface OrgInvite {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt?: string;
  invitedByName?: string | null;
  emailSent?: boolean;
}

export async function inviteOrgMember(
  email: string,
  role: string,
  orgId?: string
): Promise<ApiResponse<{ invite: OrgInvite }>> {
  const id = resolveOrgId(orgId);
  if (!id) {
    return { error: 'No organization selected. Run "hookbase org switch <idOrSlug>" first.', status: 0 };
  }
  return sessionRequest<{ invite: OrgInvite }>('POST', `/api/organizations/${id}/invites`, { email, role });
}

export async function listOrgInvites(orgId?: string): Promise<ApiResponse<{ invites: OrgInvite[] }>> {
  const id = resolveOrgId(orgId);
  if (!id) {
    return { error: 'No organization selected. Run "hookbase org switch <idOrSlug>" first.', status: 0 };
  }
  return sessionRequest<{ invites: OrgInvite[] }>('GET', `/api/organizations/${id}/invites`);
}

export async function deleteOrgInvite(inviteId: string, orgId?: string): Promise<ApiResponse<{ success: boolean }>> {
  const id = resolveOrgId(orgId);
  if (!id) {
    return { error: 'No organization selected. Run "hookbase org switch <idOrSlug>" first.', status: 0 };
  }
  return sessionRequest<{ success: boolean }>('DELETE', `/api/organizations/${id}/invites/${inviteId}`);
}

// ============================================================================
// Sources
// ============================================================================

export interface Source {
  id: string;
  name: string;
  slug: string;
  provider: string | null;
  description?: string;
  signing_secret?: string;
  reject_invalid_signatures?: boolean;
  rate_limit_per_minute?: number;
  isActive?: boolean;
  is_active?: number;
  eventCount?: number;
  event_count?: number;
  routeCount?: number;
  route_count?: number;
  transientMode?: boolean;
  transient_mode?: number;
  allowedMethods?: string[];
  allowed_methods?: string[];
  created_at?: string;
}

/** HTTP verbs an ingest endpoint can be restricted to. OPTIONS is excluded: CORS preflight is
 * answered before ingest runs, so it is never gateable. */
export type IngestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

export async function getSources(): Promise<ApiResponse<{ sources: Source[] }>> {

  return request<{ sources: Source[] }>('GET', `/api/sources?pageSize=100`);
}

export async function getSource(sourceId: string): Promise<ApiResponse<{ source: Source }>> {

  return request<{ source: Source }>('GET', `/api/sources/${sourceId}`);
}

export async function createSource(
  name: string,
  slug: string,
  provider?: string,
  options?: {
    description?: string;
    signingSecret?: string;
    rejectInvalidSignatures?: boolean;
    rateLimitPerMinute?: number;
    ipFilterMode?: 'none' | 'allowlist' | 'denylist' | 'both';
    ipAllowlist?: string[];
    ipDenylist?: string[];
    encryptFields?: string[];
    maskFields?: string[];
    dedupEnabled?: boolean;
    dedupStrategy?: string;
    dedupWindowHours?: number;
    dedupCustomHeader?: string;
    transientMode?: boolean;
    allowedMethods?: string[];
  }
): Promise<ApiResponse<{ source: Source }>> {

  const body: Record<string, unknown> = {
    name,
    slug,
    description: options?.description,
    signingSecret: options?.signingSecret,
    rejectInvalidSignatures: options?.rejectInvalidSignatures,
    rateLimitPerMinute: options?.rateLimitPerMinute,
    ipFilterMode: options?.ipFilterMode,
    ipAllowlist: options?.ipAllowlist,
    ipDenylist: options?.ipDenylist,
    encryptFields: options?.encryptFields,
    maskFields: options?.maskFields,
    dedupEnabled: options?.dedupEnabled,
    dedupStrategy: options?.dedupStrategy,
    dedupWindowHours: options?.dedupWindowHours,
    dedupCustomHeader: options?.dedupCustomHeader,
    transientMode: options?.transientMode,
    allowedMethods: options?.allowedMethods,
  };

  // Only include provider if it's a valid value (not empty)
  if (provider && provider.length > 0) {
    body.provider = provider;
  }

  return request<{ source: Source }>('POST', `/api/sources`, body);
}

export async function updateSource(
  sourceId: string,
  data: {
    name?: string;
    provider?: string;
    description?: string;
    isActive?: boolean;
    rejectInvalidSignatures?: boolean;
    rateLimitPerMinute?: number;
    transientMode?: boolean;
    allowedMethods?: string[];
  }
): Promise<ApiResponse<{ source: Source }>> {

  return request<{ source: Source }>('PATCH', `/api/sources/${sourceId}`, {
    name: data.name,
    provider: data.provider,
    description: data.description,
    isActive: data.isActive,
    rejectInvalidSignatures: data.rejectInvalidSignatures,
    rateLimitPerMinute: data.rateLimitPerMinute,
    transientMode: data.transientMode,
    allowedMethods: data.allowedMethods,
  });
}

export async function deleteSource(sourceId: string): Promise<ApiResponse<{ success: boolean }>> {

  return request<{ success: boolean }>('DELETE', `/api/sources/${sourceId}`);
}

export async function rotateSourceSecret(sourceId: string): Promise<ApiResponse<{ source: Source; signingSecret: string }>> {
  return request<{ source: Source; signingSecret: string }>('POST', `/api/sources/${sourceId}/rotate-secret`);
}

export async function triggerSource(sourceId: string, data: {
  template?: string;
  providerId?: string;
  eventType?: string;
  customPayload?: unknown;
  customHeaders?: Record<string, string>;
  sign?: boolean;
}): Promise<ApiResponse<{
  success: boolean;
  statusCode: number;
  signed?: boolean;
  signatureHeader?: string | null;
  payloadSource?: 'catalog' | 'template' | 'generic';
  result: unknown;
  request: { url: string; method: string; headers: Record<string, string>; payload: unknown };
}>> {
  const org = getCurrentOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request('POST', `/api/organizations/${org.id}/testing/sources/${sourceId}/test`, data);
}

export async function getTestTemplates(): Promise<ApiResponse<{
  templates: Array<{ id: string; name: string; headers: Record<string, string>; body: unknown }>;
}>> {
  const org = getCurrentOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request('GET', `/api/organizations/${org.id}/testing/templates`);
}

// ============================================================================
// Plan features (authoritative gating for advanced create flows)
// ============================================================================

export interface OrgFeatures {
  plan: string;
  features: Record<string, boolean>;
  limits: {
    maxSources: number;
    maxDestinations: number;
    maxRoutes: number;
    maxTunnels: number;
    customDomains: number;
  };
}

/** Fetch the plan-gated feature map for the current org. The CLI uses this to
 * decide which advanced options to offer at create time. Returns a 404 against
 * an API too old to have the endpoint — callers degrade gracefully. */
export async function getOrgFeatures(): Promise<ApiResponse<OrgFeatures>> {
  const org = getCurrentOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<OrgFeatures>('GET', `/api/organizations/${org.id}/features`);
}

// ============================================================================
// Provider Catalog (for `hookbase trigger`)
// ============================================================================

export interface ProviderCatalogSummary {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  eventTypeCount: number;
  hookbaseProvider: string;
  hasSignatureVerification: boolean;
  hasIpRanges: boolean;
}

export interface ProviderEventType {
  type: string;
  description: string;
}

export async function getProviderCatalog(): Promise<ApiResponse<{
  providers: ProviderCatalogSummary[];
  categories: string[];
  total: number;
}>> {
  return request('GET', `/api/catalog/providers`);
}

export async function getProviderEvents(providerId: string): Promise<ApiResponse<{
  providerId: string;
  providerName: string;
  eventTypes: ProviderEventType[];
  samplePayloads: Record<string, object>;
}>> {
  return request('GET', `/api/catalog/providers/${providerId}/events`);
}

// ============================================================================
// Destinations
// ============================================================================

export interface Destination {
  id: string;
  name: string;
  slug: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  auth_type: 'none' | 'basic' | 'bearer' | 'api_key' | 'custom_header';
  auth_config?: Record<string, string>;
  timeout_ms?: number;
  // GET responses (list + single) return these flat and camelCase (unlike the
  // nested `throttle: {...}` shape used in create/update request bodies).
  throttleMode?: 'off' | 'rate' | 'concurrency';
  throttleRateLimit?: number | null;
  throttleRateUnit?: 'second' | 'minute' | 'hour' | null;
  throttleMaxConcurrency?: number | null;
  throttleQueueLimit?: number | null;
  mock_mode?: boolean;
  is_active: number;
  delivery_count?: number;
  success_count?: number;
  failure_count?: number;
  route_count?: number;
  created_at?: string;
  // Warehouse destination fields
  type?: 'http' | 's3' | 'r2' | 'gcs' | 'azure_blob';
  config?: Record<string, unknown> | string;
  batch_size?: number;
  batch_window_seconds?: number;
  field_mapping?: string;
  use_static_ip?: number;
}

export async function getDestinations(): Promise<ApiResponse<{ destinations: Destination[] }>> {

  return request<{ destinations: Destination[] }>('GET', `/api/destinations?pageSize=100`);
}

export async function getDestination(destId: string): Promise<ApiResponse<{ destination: Destination }>> {

  return request<{ destination: Destination }>('GET', `/api/destinations/${destId}`);
}

export async function createDestination(data: {
  name: string;
  slug?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  authType?: 'none' | 'basic' | 'bearer' | 'api_key' | 'custom_header';
  authConfig?: Record<string, string>;
  timeoutMs?: number;
  // Gated [throttling]
  throttle?: {
    mode: 'off' | 'rate' | 'concurrency';
    rateLimit?: number | null;
    rateUnit?: 'second' | 'minute' | 'hour' | null;
    maxConcurrency?: number | null;
    queueLimit?: number | null;
  } | null;
  mockMode?: boolean;
  useStaticIp?: boolean;
  type?: 'http' | 'sqs' | 'eventbridge' | 'servicebus' | 'pubsub' | 'oci_queue' | 's3' | 'r2' | 'gcs' | 'azure_blob';
  config?: Record<string, unknown>;
  fieldMapping?: Array<{ source: string; target: string; type: string; default?: string }>;
  batchSize?: number;
  batchWindowSeconds?: number;
}): Promise<ApiResponse<{ destination: Destination }>> {

  // Generate slug from name if not provided
  const slug = data.slug || data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return request<{ destination: Destination }>('POST', `/api/destinations`, {
    name: data.name,
    slug: slug,
    url: data.url || '',
    method: data.method || 'POST',
    headers: data.headers,
    authType: data.authType || 'none',
    authConfig: data.authConfig,
    timeoutMs: data.timeoutMs || 30000,
    throttle: data.throttle,
    useStaticIp: data.useStaticIp,
    type: data.type || 'http',
    config: data.config,
    fieldMapping: data.fieldMapping,
    batchSize: data.batchSize,
    batchWindowSeconds: data.batchWindowSeconds,
  });
}

export async function updateDestination(
  destId: string,
  data: {
    name?: string;
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    authType?: string;
    authConfig?: Record<string, string>;
    timeoutMs?: number;
    // Gated [throttling]
    throttle?: {
      mode: 'off' | 'rate' | 'concurrency';
      rateLimit?: number | null;
      rateUnit?: 'second' | 'minute' | 'hour' | null;
      maxConcurrency?: number | null;
      queueLimit?: number | null;
    } | null;
    mockMode?: boolean;
    isActive?: boolean;
    useStaticIp?: boolean;
    fieldMapping?: Array<{ source: string; target: string; type: string; default?: string }>;
    batchSize?: number;
    batchWindowSeconds?: number;
  }
): Promise<ApiResponse<{ destination: Destination }>> {

  return request<{ destination: Destination }>('PATCH', `/api/destinations/${destId}`, {
    name: data.name,
    url: data.url,
    method: data.method,
    headers: data.headers,
    authType: data.authType,
    authConfig: data.authConfig,
    timeoutMs: data.timeoutMs,
    throttle: data.throttle,
    isActive: data.isActive,
    useStaticIp: data.useStaticIp,
    fieldMapping: data.fieldMapping,
    batchSize: data.batchSize,
    batchWindowSeconds: data.batchWindowSeconds,
  });
}

export async function deleteDestination(destId: string): Promise<ApiResponse<{ success: boolean }>> {

  return request<{ success: boolean }>('DELETE', `/api/destinations/${destId}`);
}

export async function testDestination(destId: string): Promise<ApiResponse<{
  success: boolean;
  statusCode: number;
  responseTime: number;
  responseBody?: string;
  error?: string;
}>> {

  return request<{ success: boolean; statusCode: number; responseTime: number; responseBody?: string; error?: string }>(
    'POST',
    `/api/destinations/${destId}/test`
  );
}

// ============================================================================
// Routes
// ============================================================================

export interface Route {
  id: string;
  name: string;
  source_id?: string;
  sourceId?: string;
  destination_id?: string;
  destinationId?: string;
  source_name?: string;
  sourceName?: string;
  destination_name?: string;
  destinationName?: string;
  filter_id?: string;
  filterId?: string;
  transform_id?: string;
  transformId?: string;
  schema_id?: string;
  schemaId?: string;
  priority: number;
  is_active?: number | boolean;
  isActive?: number | boolean;
  delivery_count?: number;
  deliveryCount?: number;
  created_at?: string;
  createdAt?: string;
}

export interface FilterCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'starts_with' | 'ends_with' | 'exists' | 'not_exists' | 'greater_than' | 'less_than' | 'regex';
  value?: string;
}

export async function getRoutes(): Promise<ApiResponse<{ routes: Route[] }>> {

  return request<{ routes: Route[] }>('GET', `/api/routes?pageSize=100`);
}

export async function getRoute(routeId: string): Promise<ApiResponse<{ route: Route }>> {

  return request<{ route: Route }>('GET', `/api/routes/${routeId}`);
}

export async function createRoute(data: {
  name: string;
  sourceId: string;
  destinationId: string;
  filterId?: string;
  // Inline filter: the API expects a conditions ARRAY plus a separate logic
  // field (routes.ts POST reads filterConditions.length + filterLogic).
  filterConditions?: FilterCondition[];
  filterLogic?: 'AND' | 'OR';
  transformId?: string;
  schemaId?: string;
  priority?: number;
  isActive?: boolean;
  failoverDestinationIds?: string[];
  failoverAfterAttempts?: number;
  circuitCooldownSeconds?: number;
  circuitFailureThreshold?: number;
  circuitProbeSuccessThreshold?: number;
  notifyOnFailure?: boolean;
  notifyOnSuccess?: boolean;
  notifyOnRecovery?: boolean;
  notifyEmails?: string;
  failureThreshold?: number;
}): Promise<ApiResponse<{ route: Route }>> {

  return request<{ route: Route }>('POST', `/api/routes`, {
    name: data.name,
    sourceId: data.sourceId,
    destinationId: data.destinationId,
    filterId: data.filterId,
    filterConditions: data.filterConditions,
    filterLogic: data.filterLogic,
    transformId: data.transformId,
    schemaId: data.schemaId,
    priority: data.priority ?? 0,
    isActive: data.isActive ?? true,
    failoverDestinationIds: data.failoverDestinationIds,
    failoverAfterAttempts: data.failoverAfterAttempts,
    circuitCooldownSeconds: data.circuitCooldownSeconds,
    circuitFailureThreshold: data.circuitFailureThreshold,
    circuitProbeSuccessThreshold: data.circuitProbeSuccessThreshold,
    notifyOnFailure: data.notifyOnFailure,
    notifyOnSuccess: data.notifyOnSuccess,
    notifyOnRecovery: data.notifyOnRecovery,
    notifyEmails: data.notifyEmails,
    failureThreshold: data.failureThreshold,
  });
}

export async function updateRoute(
  routeId: string,
  data: {
    name?: string;
    sourceId?: string;
    destinationId?: string;
    filterId?: string;
    filterConditions?: { logic: 'AND' | 'OR'; conditions: FilterCondition[] };
    transformId?: string;
    schemaId?: string;
    priority?: number;
    isActive?: boolean;
  }
): Promise<ApiResponse<{ route: Route }>> {

  return request<{ route: Route }>('PATCH', `/api/routes/${routeId}`, {
    name: data.name,
    sourceId: data.sourceId,
    destinationId: data.destinationId,
    filterId: data.filterId,
    filterConditions: data.filterConditions,
    transformId: data.transformId,
    schemaId: data.schemaId,
    priority: data.priority,
    isActive: data.isActive,
  });
}

export async function deleteRoute(routeId: string): Promise<ApiResponse<{ success: boolean }>> {

  return request<{ success: boolean }>('DELETE', `/api/routes/${routeId}`);
}

export interface RouteCircuitStatus {
  circuitState: string;
  circuitOpenedAt: string | null;
  cooldownSeconds: number;
  probeAttempts: number;
  probeSuccessThreshold: number;
  failureThreshold: number;
  consecutiveFailures: number;
  timeUntilProbeSeconds: number | null;
}

export async function getRouteCircuitStatus(routeId: string): Promise<ApiResponse<RouteCircuitStatus>> {
  return request<RouteCircuitStatus>('GET', `/api/routes/${routeId}/circuit-status`);
}

export async function resetRouteCircuit(routeId: string): Promise<ApiResponse<{ success: boolean; circuitState: string; previousState: string | null }>> {
  return request<{ success: boolean; circuitState: string; previousState: string | null }>('POST', `/api/routes/${routeId}/reset-circuit`);
}

export async function updateRouteCircuitConfig(
  routeId: string,
  data: { circuitCooldownSeconds?: number; circuitFailureThreshold?: number; circuitProbeSuccessThreshold?: number }
): Promise<ApiResponse<{ success: boolean }>> {
  return request<{ success: boolean }>('PATCH', `/api/routes/${routeId}/circuit-config`, data);
}

// ============================================================================
// Tunnels
// ============================================================================

export interface Tunnel {
  id: string;
  name: string;
  subdomain: string;
  status: 'connected' | 'disconnected' | 'error';
  auth_token?: string;
  total_requests: number;
  last_connected_at: string | null;
  created_at?: string;
}

export interface CreateTunnelResponse {
  tunnel: Tunnel;
  tunnelUrl: string;
  wsUrl: string;
}

export async function getTunnels(): Promise<ApiResponse<{ tunnels: Tunnel[] }>> {

  return request<{ tunnels: Tunnel[] }>('GET', `/api/tunnels?pageSize=100`);
}

export async function getTunnel(tunnelId: string): Promise<ApiResponse<{ tunnel: Tunnel }>> {

  return request<{ tunnel: Tunnel }>('GET', `/api/tunnels/${tunnelId}`);
}

export async function createTunnel(
  name: string,
  subdomain?: string,
  direction?: 'inbound' | 'bidirectional',
  allowedHosts?: string[]
): Promise<ApiResponse<CreateTunnelResponse>> {

  return request<CreateTunnelResponse>('POST', `/api/tunnels`, {
    name,
    subdomain,
    direction,
    allowedHosts,
  });
}

export async function updateTunnel(tunnelId: string, data: { name?: string }): Promise<ApiResponse<{ tunnel: Tunnel }>> {

  return request<{ tunnel: Tunnel }>('PATCH', `/api/tunnels/${tunnelId}`, data);
}

export async function deleteTunnel(tunnelId: string): Promise<ApiResponse<{ success: boolean }>> {

  return request<{ success: boolean }>('DELETE', `/api/tunnels/${tunnelId}`);
}

export async function getTunnelStatus(tunnelId: string): Promise<ApiResponse<{ tunnel: Tunnel; liveStatus: unknown }>> {

  return request<{ tunnel: Tunnel; liveStatus: unknown }>('GET', `/api/tunnels/${tunnelId}/status`);
}

export async function regenerateTunnelToken(tunnelId: string): Promise<ApiResponse<{ tunnel: Tunnel; authToken: string; auth_token: string; wsUrl: string }>> {

  return request<{ tunnel: Tunnel; authToken: string; auth_token: string; wsUrl: string }>('POST', `/api/tunnels/${tunnelId}/regenerate-token`);
}

export async function disconnectTunnel(tunnelId: string): Promise<ApiResponse<{ success: boolean }>> {

  return request<{ success: boolean }>('POST', `/api/tunnels/${tunnelId}/disconnect`);
}

export interface TunnelRequest {
  id: string;
  tunnel_id: string;
  organization_id: string;
  method: string;
  path: string;
  status_code: number | null;
  duration: number | null;
  request_size: number | null;
  response_size: number | null;
  success: number;
  error_message: string | null;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface TunnelRequestStats {
  total: number;
  successful: number;
  failed: number;
  avg_duration: number | null;
  max_duration: number | null;
  total_request_bytes: number | null;
  total_response_bytes: number | null;
}

export async function getTunnelRequests(tunnelId: string, options?: {
  limit?: number;
  offset?: number;
}): Promise<ApiResponse<{ requests: TunnelRequest[]; total: number; stats: TunnelRequestStats; limit: number; offset: number }>> {

  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));

  const query = params.toString() ? `?${params.toString()}` : '';
  return request<{ requests: TunnelRequest[]; total: number; stats: TunnelRequestStats; limit: number; offset: number }>(
    'GET',
    `/api/tunnels/${tunnelId}/requests${query}`
  );
}

// ============================================================================
// Events
// ============================================================================

export interface Event {
  id: string;
  // Support both snake_case and camelCase naming conventions
  source_id?: string;
  sourceId?: string;
  source_name?: string;
  sourceName?: string;
  source_slug?: string;
  sourceSlug?: string;
  event_type?: string;
  eventType?: string;
  method?: string;
  path?: string;
  headers?: string | Record<string, string>;
  payload_size?: number;
  payloadSize?: number;
  signature_valid?: boolean;
  signatureValid?: boolean;
  status?: 'delivered' | 'failed' | 'pending' | 'partial' | 'no_routes';
  delivery_count?: number;
  deliveryCount?: number;
  // What the events-list endpoint (GET /api/.../events) actually sends —
  // delivery_count/deliveryCount above are never populated by that endpoint.
  deliveryStats?: {
    total: number;
    delivered: number;
    failed: number;
    pending: number;
  };
  // Transient-mode (compliance) events never persist a payload; both key
  // spellings are seen depending on the response route.
  payloadKey?: string;
  payload_key?: string;
  received_at?: string;
  receivedAt?: string;
}

// GET /api/events/:eventId returns payload/deliveries/transient as siblings of
// event, not nested inside it — api/src/routes/events.ts:527-546.
export interface EventDetailResponse {
  event: Event;
  payload: unknown;
  transient: boolean;
  deliveries: Delivery[];
}

export async function getEvents(options?: {
  limit?: number;
  offset?: number;
  sourceId?: string;
  status?: string;
  eventType?: string;
  fromDate?: string;
  toDate?: string;
  search?: string;
}): Promise<ApiResponse<{ events: Event[]; total: number; hasMore: boolean }>> {

  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  if (options?.sourceId) params.set('sourceId', options.sourceId);
  if (options?.status) params.set('status', options.status);
  if (options?.eventType) params.set('eventType', options.eventType);
  if (options?.fromDate) params.set('fromDate', options.fromDate);
  if (options?.toDate) params.set('toDate', options.toDate);
  if (options?.search) params.set('search', options.search);

  const queryString = params.toString();
  return request<{ events: Event[]; total: number; hasMore: boolean }>(
    'GET',
    `/api/events${queryString ? `?${queryString}` : ''}`
  );
}

export async function getEvent(eventId: string): Promise<ApiResponse<EventDetailResponse>> {

  return request<EventDetailResponse>('GET', `/api/events/${eventId}`);
}

// ============================================================================
// Deliveries
// ============================================================================

export interface Delivery {
  id: string;
  event_id: string;
  route_id: string;
  destination_id: string;
  destination_name?: string;
  route_name?: string;
  status: 'pending' | 'delivered' | 'failed' | 'failed_over' | 'schema_failed' | 'retrying';
  attempt_count: number;
  max_attempts: number;
  response_status?: number;
  response_time_ms?: number;
  response_body?: string;
  error_message?: string;
  next_retry_at?: string;
  completed_at?: string;
  created_at: string;
}

export async function getDeliveries(options?: {
  limit?: number;
  offset?: number;
  eventId?: string;
  routeId?: string;
  destinationId?: string;
  status?: string;
}): Promise<ApiResponse<{ deliveries: Delivery[]; total: number; hasMore: boolean }>> {

  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  if (options?.eventId) params.set('eventId', options.eventId);
  if (options?.routeId) params.set('routeId', options.routeId);
  if (options?.destinationId) params.set('destinationId', options.destinationId);
  if (options?.status) params.set('status', options.status);

  const queryString = params.toString();
  return request<{ deliveries: Delivery[]; total: number; hasMore: boolean }>(
    'GET',
    `/api/deliveries${queryString ? `?${queryString}` : ''}`
  );
}

export async function getDelivery(deliveryId: string): Promise<ApiResponse<{ delivery: Delivery }>> {

  return request<{ delivery: Delivery }>('GET', `/api/deliveries/${deliveryId}`);
}

export async function replayDelivery(deliveryId: string): Promise<ApiResponse<{ delivery: Delivery }>> {

  return request<{ delivery: Delivery }>('POST', `/api/deliveries/${deliveryId}/replay`);
}

export async function bulkReplayDeliveries(deliveryIds: string[]): Promise<ApiResponse<{ replayed: number; failed: number }>> {

  return request<{ replayed: number; failed: number }>('POST', `/api/deliveries/bulk-replay`, {
    deliveryIds,
  });
}

// ============================================================================
// Transforms
// ============================================================================

export interface Transform {
  id: string;
  name: string;
  type: 'jsonata' | 'javascript' | 'liquid' | 'xslt';
  expression: string;
  input_format: 'json' | 'xml' | 'text';
  output_format: 'json' | 'xml' | 'text';
  is_active: number;
  route_count?: number;
  created_at?: string;
}

export async function getTransforms(): Promise<ApiResponse<{ transforms: Transform[] }>> {

  return request<{ transforms: Transform[] }>('GET', `/api/transforms`);
}

export async function getTransform(transformId: string): Promise<ApiResponse<{ transform: Transform }>> {

  return request<{ transform: Transform }>('GET', `/api/transforms/${transformId}`);
}

export async function createTransform(data: {
  name: string;
  code: string;
  transformType?: 'jsonata' | 'javascript' | 'liquid' | 'xslt';
  description?: string;
  inputFormat?: 'json' | 'xml' | 'text';
  outputFormat?: 'json' | 'xml' | 'text';
}): Promise<ApiResponse<{ transform: Transform }>> {

  // Field names match the API contract (transforms.ts POST): code/transformType,
  // NOT expression/type.
  return request<{ transform: Transform }>('POST', `/api/transforms`, {
    name: data.name,
    description: data.description,
    code: data.code,
    transformType: data.transformType || 'jsonata',
    inputFormat: data.inputFormat || 'json',
    outputFormat: data.outputFormat || 'json',
  });
}

export async function updateTransform(
  transformId: string,
  data: {
    name?: string;
    expression?: string;
    isActive?: boolean;
  }
): Promise<ApiResponse<{ transform: Transform }>> {

  return request<{ transform: Transform }>('PATCH', `/api/transforms/${transformId}`, {
    name: data.name,
    expression: data.expression,
    is_active: data.isActive,
  });
}

export async function deleteTransform(transformId: string): Promise<ApiResponse<{ success: boolean }>> {

  return request<{ success: boolean }>('DELETE', `/api/transforms/${transformId}`);
}

export async function testTransform(data: {
  type: string;
  expression: string;
  payload: unknown;
}): Promise<ApiResponse<{ result: unknown; error?: string }>> {

  return request<{ result: unknown; error?: string }>('POST', `/api/transforms/test`, data);
}

// ============================================================================
// Filters
// ============================================================================

export interface Filter {
  id: string;
  name: string;
  logic: 'AND' | 'OR';
  conditions: FilterCondition[];
  is_active: number;
  route_count?: number;
  created_at?: string;
}

export async function getFilters(): Promise<ApiResponse<{ filters: Filter[] }>> {

  return request<{ filters: Filter[] }>('GET', `/api/filters`);
}

export async function getFilter(filterId: string): Promise<ApiResponse<{ filter: Filter }>> {

  return request<{ filter: Filter }>('GET', `/api/filters/${filterId}`);
}

export async function createFilter(data: {
  name: string;
  logic: 'AND' | 'OR';
  conditions: FilterCondition[];
}): Promise<ApiResponse<{ filter: Filter }>> {

  return request<{ filter: Filter }>('POST', `/api/filters`, data);
}

export async function updateFilter(
  filterId: string,
  data: {
    name?: string;
    logic?: 'AND' | 'OR';
    conditions?: FilterCondition[];
    isActive?: boolean;
  }
): Promise<ApiResponse<{ filter: Filter }>> {

  return request<{ filter: Filter }>('PATCH', `/api/filters/${filterId}`, {
    name: data.name,
    logic: data.logic,
    conditions: data.conditions,
    is_active: data.isActive,
  });
}

export async function deleteFilter(filterId: string): Promise<ApiResponse<{ success: boolean }>> {

  return request<{ success: boolean }>('DELETE', `/api/filters/${filterId}`);
}

export async function testFilter(data: {
  logic: 'AND' | 'OR';
  conditions: FilterCondition[];
  payload: unknown;
}): Promise<ApiResponse<{ matches: boolean; details?: unknown }>> {

  return request<{ matches: boolean; details?: unknown }>('POST', `/api/filters/test`, data);
}

// ============================================================================
// Schemas (JSON Schema validation)
// ============================================================================

export interface Schema {
  id: string;
  name: string;
  slug?: string;
  description?: string | null;
  jsonSchema?: unknown;
  routeCount?: number;
  createdAt?: string;
}

export async function getSchemas(): Promise<ApiResponse<{ schemas: Schema[] }>> {
  return request<{ schemas: Schema[] }>('GET', `/api/schemas`);
}

export async function getSchema(schemaId: string): Promise<ApiResponse<{ schema: Schema }>> {
  return request<{ schema: Schema }>('GET', `/api/schemas/${schemaId}`);
}

export async function createSchema(data: {
  name: string;
  jsonSchema: unknown;
  description?: string;
}): Promise<ApiResponse<{ schema: Schema }>> {
  return request<{ schema: Schema }>('POST', `/api/schemas`, {
    name: data.name,
    description: data.description,
    jsonSchema: data.jsonSchema,
  });
}

export async function deleteSchema(schemaId: string): Promise<ApiResponse<{ success: boolean }>> {
  return request<{ success: boolean }>('DELETE', `/api/schemas/${schemaId}`);
}

export async function updateSchema(
  schemaId: string,
  data: { name?: string; description?: string; jsonSchema?: unknown }
): Promise<ApiResponse<{ success: boolean }>> {
  return request<{ success: boolean }>('PUT', `/api/schemas/${schemaId}`, data);
}

export interface SchemaValidationError {
  path: string;
  message: string;
}

export async function validateSchema(
  schemaId: string,
  payload: unknown
): Promise<ApiResponse<{ valid: boolean; errors: SchemaValidationError[]; payload: unknown }>> {
  return request<{ valid: boolean; errors: SchemaValidationError[]; payload: unknown }>('POST', `/api/schemas/${schemaId}/validate`, { payload });
}

// ============================================================================
// Notification channels
// ============================================================================

export interface NotificationChannel {
  id: string;
  name: string;
  type: 'email' | 'slack' | 'webhook' | 'teams' | 'pagerduty' | 'discord';
  config?: Record<string, unknown>;
  isActive?: boolean;
}

export async function getNotificationChannels(): Promise<ApiResponse<{ channels: NotificationChannel[] }>> {
  return request<{ channels: NotificationChannel[] }>('GET', `/api/notification-channels`);
}

export async function createNotificationChannel(data: {
  name: string;
  type: NotificationChannel['type'];
  config: Record<string, unknown>;
}): Promise<ApiResponse<{ channel: NotificationChannel }>> {
  return request<{ channel: NotificationChannel }>('POST', `/api/notification-channels`, {
    name: data.name,
    type: data.type,
    config: data.config,
  });
}

export async function getNotificationChannel(channelId: string): Promise<ApiResponse<{ channel: NotificationChannel }>> {
  return request<{ channel: NotificationChannel }>('GET', `/api/notification-channels/${channelId}`);
}

export async function updateNotificationChannel(
  channelId: string,
  data: { name?: string; config?: Record<string, unknown>; isActive?: boolean }
): Promise<ApiResponse<{ success: boolean }>> {
  return request<{ success: boolean }>('PATCH', `/api/notification-channels/${channelId}`, data);
}

export async function testNotificationChannel(
  channelId: string
): Promise<ApiResponse<{ success: boolean; message?: string; error?: string }>> {
  return request<{ success: boolean; message?: string; error?: string }>('POST', `/api/notification-channels/${channelId}/test`);
}

/** Link a notification channel to a route (called after route creation). */
export async function linkNotificationChannel(
  channelId: string,
  data: {
    routeId: string;
    notifyOnFailure?: boolean;
    notifyOnSuccess?: boolean;
    notifyOnRecovery?: boolean;
    notifyOnCircuitOpen?: boolean;
  },
): Promise<ApiResponse<{ success: boolean }>> {
  return request<{ success: boolean }>('POST', `/api/notification-channels/${channelId}/routes`, data);
}

export interface NotificationChannelRouteLink {
  routeId: string;
  routeName: string;
  notifyOnFailure: boolean;
  notifyOnSuccess: boolean;
  notifyOnRecovery: boolean;
  notifyOnCircuitOpen: boolean;
}

export async function getNotificationChannelRoutes(
  channelId: string
): Promise<ApiResponse<{ routes: NotificationChannelRouteLink[] }>> {
  return request<{ routes: NotificationChannelRouteLink[] }>('GET', `/api/notification-channels/${channelId}/routes`);
}

export async function updateNotificationChannelRouteLink(
  channelId: string,
  routeId: string,
  data: {
    notifyOnFailure?: boolean;
    notifyOnSuccess?: boolean;
    notifyOnRecovery?: boolean;
    notifyOnCircuitOpen?: boolean;
  }
): Promise<ApiResponse<{ success: boolean }>> {
  return request<{ success: boolean }>('PATCH', `/api/notification-channels/${channelId}/routes/${routeId}`, data);
}

export async function unlinkNotificationChannelRoute(
  channelId: string,
  routeId: string
): Promise<ApiResponse<{ success: boolean }>> {
  return request<{ success: boolean }>('DELETE', `/api/notification-channels/${channelId}/routes/${routeId}`);
}

export async function deleteNotificationChannel(channelId: string): Promise<ApiResponse<{ success: boolean }>> {
  return request<{ success: boolean }>('DELETE', `/api/notification-channels/${channelId}`);
}

// ============================================================================
// Analytics
// ============================================================================

export interface AnalyticsOverview {
  totalEvents: number;
  totalDeliveries: number;
  successRate: number;
  avgLatency: number;
  activeSources: number;
  activeDestinations: number;
  activeRoutes: number;
}

export async function getAnalyticsOverview(): Promise<ApiResponse<AnalyticsOverview>> {

  return request<AnalyticsOverview>('GET', `/api/analytics/overview`);
}

export interface DashboardAnalytics {
  overview: {
    totalEvents: number;
    totalDeliveries: number;
    successfulDeliveries: number;
    failedDeliveries: number;
    successRate: number;
    avgResponseTime: number;
  };
  topSources: Array<{
    id: string;
    name: string;
    slug: string;
    eventCount: number;
  }>;
  topDestinations: Array<{
    id: string;
    name: string;
    deliveryCount: number;
    successRate: number;
  }>;
  recentEvents: Event[];
  eventsByHour?: Array<{
    hour: string;
    count: number;
  }>;
  deliveriesByStatus?: Array<{
    status: string;
    count: number;
  }>;
}

export async function getDashboardAnalytics(range: '1h' | '24h' | '7d' | '30d' = '24h'): Promise<ApiResponse<DashboardAnalytics>> {

  return request<DashboardAnalytics>('GET', `/api/analytics/dashboard?range=${range}`);
}

export async function getRecentActivity(limit: number = 20): Promise<ApiResponse<{ events: Event[] }>> {

  return request<{ events: Event[] }>('GET', `/api/realtime/recent?limit=${limit}`);
}

// ============================================================================
// Cron Jobs
// ============================================================================

export interface CronJob {
  id: string;
  organizationId: string;
  groupId?: string | null;
  name: string;
  description?: string | null;
  cronExpression: string;
  timezone: string;
  url: string;
  method: string;
  headers?: string | null;
  payload?: string | null;
  timeoutMs: number;
  useStaticIp?: boolean;
  isActive: number;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  notifyOnSuccess?: number;
  notifyOnFailure?: number;
  notifyEmails?: string | null;
  consecutiveFailures?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CronExecution {
  id: string;
  organizationId: string;
  cronJobId: string;
  status: 'pending' | 'success' | 'failed' | 'running';
  responseStatus?: number | null;
  responseBody?: string | null;
  responseHeaders?: string | null;
  errorMessage?: string | null;
  latencyMs?: number | null;
  startedAt: string;
  completedAt?: string | null;
}

// Trigger response uses camelCase (different from DB records)
export interface CronTriggerResult {
  id: string;
  status: 'success' | 'failed';
  responseStatus?: number;
  latencyMs?: number;
  error?: string;
}

export interface CronGroup {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description?: string | null;
  isCollapsed?: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export async function getCronJobs(): Promise<ApiResponse<{ cronJobs: CronJob[] }>> {

  return request<{ cronJobs: CronJob[] }>('GET', `/api/cron?pageSize=100`);
}

export async function getCronJob(jobId: string): Promise<ApiResponse<{ cronJob: CronJob }>> {

  return request<{ cronJob: CronJob }>('GET', `/api/cron/${jobId}`);
}

export async function createCronJob(data: {
  name: string;
  description?: string;
  cronExpression: string;
  timezone?: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  payload?: string;
  timeoutMs?: number;
  groupId?: string;
  notifyOnSuccess?: boolean;
  notifyOnFailure?: boolean;
  notifyEmails?: string;
  useStaticIp?: boolean;
}): Promise<ApiResponse<{ cronJob: CronJob }>> {

  return request<{ cronJob: CronJob }>('POST', `/api/cron`, {
    name: data.name,
    description: data.description,
    cronExpression: data.cronExpression,
    timezone: data.timezone || 'UTC',
    url: data.url,
    method: data.method || 'POST',
    headers: data.headers,
    payload: data.payload,
    timeoutMs: data.timeoutMs || 30000,
    groupId: data.groupId,
    notifyOnSuccess: data.notifyOnSuccess,
    notifyOnFailure: data.notifyOnFailure,
    notifyEmails: data.notifyEmails,
    useStaticIp: data.useStaticIp,
  });
}

export async function updateCronJob(
  jobId: string,
  data: {
    name?: string;
    description?: string;
    cronExpression?: string;
    timezone?: string;
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    payload?: string;
    timeoutMs?: number;
    groupId?: string | null;
    isActive?: boolean;
    notifyOnSuccess?: boolean;
    notifyOnFailure?: boolean;
    notifyEmails?: string;
    useStaticIp?: boolean;
  }
): Promise<ApiResponse<{ success: boolean }>> {

  return request<{ success: boolean }>('PATCH', `/api/cron/${jobId}`, data);
}

export async function deleteCronJob(jobId: string): Promise<ApiResponse<{ success: boolean }>> {

  return request<{ success: boolean }>('DELETE', `/api/cron/${jobId}`);
}

export async function triggerCronJob(jobId: string): Promise<ApiResponse<{ execution: CronTriggerResult }>> {

  return request<{ execution: CronTriggerResult }>('POST', `/api/cron/${jobId}/trigger`);
}

export async function getCronExecutions(
  jobId: string,
  limit: number = 20
): Promise<ApiResponse<{ executions: CronExecution[] }>> {

  return request<{ executions: CronExecution[] }>(
    'GET',
    `/api/cron/${jobId}/executions?limit=${limit}`
  );
}

// ============================================================================
// Cron Groups
// ============================================================================

export async function getCronGroups(): Promise<ApiResponse<{ groups: CronGroup[] }>> {

  return request<{ groups: CronGroup[] }>('GET', `/api/cron-groups`);
}

export async function getCronGroup(groupId: string): Promise<ApiResponse<{ group: CronGroup }>> {

  return request<{ group: CronGroup }>('GET', `/api/cron-groups/${groupId}`);
}

export async function createCronGroup(data: {
  name: string;
  description?: string;
}): Promise<ApiResponse<{ group: CronGroup }>> {

  return request<{ group: CronGroup }>('POST', `/api/cron-groups`, data);
}

export async function updateCronGroup(
  groupId: string,
  data: {
    name?: string;
    description?: string;
    sortOrder?: number;
    isCollapsed?: boolean;
  }
): Promise<ApiResponse<{ group: CronGroup }>> {

  return request<{ group: CronGroup }>('PATCH', `/api/cron-groups/${groupId}`, data);
}

export async function deleteCronGroup(groupId: string): Promise<ApiResponse<{ success: boolean }>> {

  return request<{ success: boolean }>('DELETE', `/api/cron-groups/${groupId}`);
}

export async function reorderCronGroups(groupIds: string[]): Promise<ApiResponse<{ success: boolean }>> {

  return request<{ success: boolean }>('POST', `/api/cron-groups/reorder`, { groupIds });
}

// ============================================================================
// Outbound Webhooks - Applications
// ============================================================================

export interface WebhookApplication {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  uid?: string;
  rate_limit_per_minute?: number;
  is_active: number;
  endpoint_count?: number;
  message_count?: number;
  created_at: string;
  updated_at: string;
}

export async function getWebhookApplications(): Promise<ApiResponse<{ applications: WebhookApplication[] }>> {

  return request<{ applications: WebhookApplication[] }>('GET', `/api/webhook-applications`);
}

export async function getWebhookApplication(appId: string): Promise<ApiResponse<{ application: WebhookApplication }>> {

  return request<{ application: WebhookApplication }>('GET', `/api/webhook-applications/${appId}`);
}

export async function createWebhookApplication(data: {
  name: string;
  description?: string;
  uid?: string;
  rateLimitPerMinute?: number;
}): Promise<ApiResponse<{ application: WebhookApplication }>> {

  return request<{ application: WebhookApplication }>('POST', `/api/webhook-applications`, {
    name: data.name,
    description: data.description,
    uid: data.uid,
    rateLimitPerMinute: data.rateLimitPerMinute,
  });
}

export async function updateWebhookApplication(
  appId: string,
  data: {
    name?: string;
    description?: string;
    rateLimitPerMinute?: number;
    isDisabled?: boolean;
  }
): Promise<ApiResponse<{ application: WebhookApplication }>> {

  return request<{ application: WebhookApplication }>('PATCH', `/api/webhook-applications/${appId}`, data);
}

export async function deleteWebhookApplication(appId: string): Promise<ApiResponse<{ success: boolean }>> {

  return request<{ success: boolean }>('DELETE', `/api/webhook-applications/${appId}`);
}

// ============================================================================
// Outbound Webhooks - Endpoints
// ============================================================================

export interface WebhookEndpoint {
  id: string;
  organization_id: string;
  application_id: string;
  application_name?: string;
  url: string;
  description?: string;
  secret?: string;
  event_types?: string[];
  headers?: Array<{ name: string; value: string }> | string;
  rate_limit_per_minute?: number;
  timeout_ms?: number;
  is_active?: number;
  circuit_state?: 'closed' | 'open' | 'half_open';
  failure_count?: number;
  message_count?: number;
  success_rate?: number;
  use_static_ip?: number;
  created_at: string;
  updated_at: string;
  // API-native (camelCase) fields actually returned by the endpoint routes.
  isDisabled?: boolean;
  isActive?: boolean;
  timeoutSeconds?: number;
  rateLimitPerSecond?: number;
  circuitState?: 'closed' | 'open' | 'half_open';
  useStaticIp?: boolean;
}

export async function getWebhookEndpoints(appId?: string): Promise<ApiResponse<{ endpoints: WebhookEndpoint[] }>> {

  const query = appId ? `?applicationId=${appId}` : '';
  return request<{ endpoints: WebhookEndpoint[] }>('GET', `/api/webhook-endpoints${query}`);
}

export async function getWebhookEndpoint(endpointId: string): Promise<ApiResponse<{ endpoint: WebhookEndpoint }>> {

  return request<{ endpoint: WebhookEndpoint }>('GET', `/api/webhook-endpoints/${endpointId}`);
}

export async function createWebhookEndpoint(data: {
  applicationId: string;
  url: string;
  description?: string;
  headers?: Array<{ name: string; value: string }>;
  // API-native units: requests/second (0 = unlimited) and seconds (1-120).
  rateLimitPerSecond?: number;
  timeoutSeconds?: number;
  useStaticIp?: boolean;
}): Promise<ApiResponse<{ endpoint: WebhookEndpoint; secret: string }>> {

  return request<{ endpoint: WebhookEndpoint; secret: string }>('POST', `/api/webhook-endpoints`, {
    applicationId: data.applicationId,
    url: data.url,
    description: data.description,
    headers: data.headers,
    // Only send when set; the API defaults timeout to 30s / rate limit to unlimited.
    rateLimitPerSecond: data.rateLimitPerSecond,
    timeoutSeconds: data.timeoutSeconds,
    useStaticIp: data.useStaticIp,
  });
}

export async function updateWebhookEndpoint(
  endpointId: string,
  data: {
    url?: string;
    description?: string;
    headers?: Array<{ name: string; value: string }>;
    // API-native units: requests/second (0 = unlimited) and seconds (1-120).
    rateLimitPerSecond?: number;
    timeoutSeconds?: number;
    isActive?: boolean;
    useStaticIp?: boolean;
  }
): Promise<ApiResponse<{ endpoint: WebhookEndpoint }>> {

  // The API update schema speaks `isDisabled`, not `isActive`. Translate so
  // `--active/--inactive` actually take effect instead of being silently dropped.
  const body: Record<string, unknown> = {
    url: data.url,
    description: data.description,
    headers: data.headers,
    rateLimitPerSecond: data.rateLimitPerSecond,
    timeoutSeconds: data.timeoutSeconds,
    useStaticIp: data.useStaticIp,
  };
  if (data.isActive !== undefined) {
    body.isDisabled = !data.isActive;
  }

  return request<{ endpoint: WebhookEndpoint }>('PATCH', `/api/webhook-endpoints/${endpointId}`, body);
}

export async function deleteWebhookEndpoint(endpointId: string): Promise<ApiResponse<{ success: boolean }>> {

  return request<{ success: boolean }>('DELETE', `/api/webhook-endpoints/${endpointId}`);
}

export async function testWebhookEndpoint(endpointId: string): Promise<ApiResponse<{
  success: boolean;
  statusCode: number;
  responseTime: number;
  error?: string;
}>> {

  return request<{ success: boolean; statusCode: number; responseTime: number; error?: string }>(
    'POST',
    `/api/webhook-endpoints/${endpointId}/test`
  );
}

export async function rotateWebhookEndpointSecret(endpointId: string): Promise<ApiResponse<{ endpoint: WebhookEndpoint; secret: string }>> {

  return request<{ endpoint: WebhookEndpoint; secret: string }>(
    'POST',
    `/api/webhook-endpoints/${endpointId}/rotate-secret`
  );
}

export async function resetWebhookEndpointCircuit(endpointId: string): Promise<ApiResponse<{ success: boolean; circuitState: string }>> {
  return request<{ success: boolean; circuitState: string }>('POST', `/api/webhook-endpoints/${endpointId}/reset-circuit`);
}

export async function replayFailedWebhookEndpointMessages(
  endpointId: string,
  options?: { since?: string; includeUnattempted?: boolean }
): Promise<ApiResponse<{ data: { replayed: number; newMessageIds: string[] } }>> {
  return request<{ data: { replayed: number; newMessageIds: string[] } }>('POST', `/api/webhook-endpoints/${endpointId}/replay-failed`, {
    since: options?.since,
    includeUnattempted: options?.includeUnattempted,
  });
}

// ============================================================================
// Outbound Webhooks - Send Events
// ============================================================================

export interface WebhookMessage {
  id: string;
  organization_id: string;
  application_id: string;
  endpoint_id: string;
  event_type: string;
  payload: unknown;
  status: 'pending' | 'processing' | 'delivered' | 'failed' | 'exhausted';
  attempt_count: number;
  max_attempts: number;
  response_status?: number;
  response_body?: string;
  error_message?: string;
  next_retry_at?: string;
  delivered_at?: string;
  created_at: string;
}

export async function sendWebhookEvent(data: {
  applicationId: string;
  eventType: string;
  payload: unknown;
  endpointIds?: string[];
}): Promise<ApiResponse<{ message: WebhookMessage }>> {

  return request<{ message: WebhookMessage }>('POST', `/api/send-event`, {
    applicationId: data.applicationId,
    eventType: data.eventType,
    payload: data.payload,
    endpointIds: data.endpointIds,
  });
}

// ============================================================================
// Outbound Webhooks - Messages
// ============================================================================

export async function getWebhookMessages(options?: {
  limit?: number;
  offset?: number;
  applicationId?: string;
  endpointId?: string;
  status?: string;
  eventType?: string;
}): Promise<ApiResponse<{ messages: WebhookMessage[]; total: number; hasMore: boolean }>> {

  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  if (options?.applicationId) params.set('applicationId', options.applicationId);
  if (options?.endpointId) params.set('endpointId', options.endpointId);
  if (options?.status) params.set('status', options.status);
  if (options?.eventType) params.set('eventType', options.eventType);

  const queryString = params.toString();
  return request<{ messages: WebhookMessage[]; total: number; hasMore: boolean }>(
    'GET',
    `/api/outbound-messages${queryString ? `?${queryString}` : ''}`
  );
}

export async function getWebhookMessage(messageId: string): Promise<ApiResponse<{ message: WebhookMessage }>> {

  return request<{ message: WebhookMessage }>('GET', `/api/outbound-messages/${messageId}`);
}

export async function retryWebhookMessage(messageId: string): Promise<ApiResponse<{ message: WebhookMessage }>> {

  // The API exposes `/replay` (there is no `/retry` route for a single message).
  return request<{ message: WebhookMessage }>('POST', `/api/outbound-messages/${messageId}/replay`);
}

export interface OutboundMessageAttempt {
  id: string;
  messageId: string;
  attemptNumber: number;
  status: string;
  responseStatus?: number;
  responseHeaders?: unknown;
  responseBody?: string;
  responseTimeMs?: number;
  totalTimeMs?: number;
  errorType?: string;
  errorMessage?: string;
  errorCode?: string;
  requestUrl?: string;
  requestHeaders?: unknown;
  requestBodySize?: number;
  triggeredBy?: string;
  triggeredByUser?: string;
  createdAt: string;
  completedAt?: string;
}

export async function getWebhookMessageAttempts(messageId: string): Promise<ApiResponse<{ data: OutboundMessageAttempt[] }>> {

  return request<{ data: OutboundMessageAttempt[] }>('GET', `/api/outbound-messages/${messageId}/attempts`);
}

export interface OutboundStatsSummary {
  pending: number;
  processing: number;
  success: number;
  failed: number;
  awaitingRetry: number;
  exhausted: number;
  dlq: number;
  total: number;
}

export async function getOutboundStatsSummary(): Promise<ApiResponse<{ data: OutboundStatsSummary }>> {

  return request<{ data: OutboundStatsSummary }>('GET', `/api/outbound-messages/stats/summary`);
}

export interface DlqStats {
  total: number;
  byReason: Record<string, number>;
  byEndpoint: Array<{ endpointId: string; endpointUrl?: string; count: number }>;
  byEventType: Array<{ eventType: string; count: number }>;
}

export async function getDlqStats(): Promise<ApiResponse<{ data: DlqStats }>> {

  return request<{ data: DlqStats }>('GET', `/api/outbound-messages/dlq/stats`);
}

// ============================================================================
// Outbound Webhooks - Dead Letter Queue (DLQ)
// ============================================================================

export interface DlqMessage {
  id: string;
  organization_id: string;
  application_id: string;
  endpoint_id: string;
  original_message_id: string;
  event_type: string;
  payload: unknown;
  reason: string;
  error_message?: string;
  last_response_status?: number;
  attempt_count: number;
  created_at: string;
}

// DLQ messages are just outbound messages with status=dlq
export async function getDlqMessages(options?: {
  limit?: number;
  offset?: number;
  applicationId?: string;
  endpointId?: string;
}): Promise<ApiResponse<{ messages: DlqMessage[]; total: number; hasMore: boolean }>> {

  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  if (options?.applicationId) params.set('applicationId', options.applicationId);
  if (options?.endpointId) params.set('endpointId', options.endpointId);

  // Use the dedicated DLQ endpoint: it returns `dlqReason` / `lastError*`, which
  // the generic `?status=dlq` list selection does not include.
  const queryString = params.toString();
  return request<{ messages: DlqMessage[]; total: number; hasMore: boolean }>(
    'GET',
    `/api/outbound-messages/dlq/messages${queryString ? `?${queryString}` : ''}`
  );
}

export async function getDlqMessage(messageId: string): Promise<ApiResponse<{ message: DlqMessage }>> {

  return request<{ message: DlqMessage }>('GET', `/api/outbound-messages/${messageId}`);
}

export async function retryDlqMessage(messageId: string): Promise<ApiResponse<{ message: WebhookMessage }>> {

  return request<{ message: WebhookMessage }>('POST', `/api/outbound-messages/${messageId}/replay`);
}

export async function bulkRetryDlqMessages(messageIds: string[]): Promise<ApiResponse<{ retried: number; failed: number }>> {

  // Replay each message individually since there's no bulk endpoint
  let retried = 0;
  let failed = 0;
  for (const id of messageIds) {
    const result = await retryDlqMessage(id);
    if (result.error) {
      failed++;
    } else {
      retried++;
    }
  }
  return { data: { retried, failed }, status: 200 };
}

export async function deleteDlqMessage(messageId: string): Promise<ApiResponse<{ success: boolean }>> {

  // DLQ archive/discard lives under /dlq/:id (there is no DELETE /:id route).
  return request<{ success: boolean }>('DELETE', `/api/outbound-messages/dlq/${messageId}`);
}

// ============================================================================
// Audit Logs
// ============================================================================

export interface AuditLog {
  id: string;
  organizationId: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  details: unknown;
  ipAddress: string | null;
  createdAt: string;
  userName: string | null;
  userEmail: string | null;
  apiKeyId: string | null;
  apiKeyName: string | null;
}

export async function getAuditLogs(options?: {
  action?: string;
  entityType?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}): Promise<ApiResponse<{ logs: AuditLog[]; total: number; limit: number; offset: number }>> {

  const params = new URLSearchParams();
  if (options?.action) params.set('action', options.action);
  if (options?.entityType) params.set('entityType', options.entityType);
  if (options?.userId) params.set('userId', options.userId);
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));

  const queryString = params.toString();
  return request<{ logs: AuditLog[]; total: number; limit: number; offset: number }>(
    'GET',
    `/api/audit-logs${queryString ? `?${queryString}` : ''}`
  );
}

export async function getAuditLogActions(): Promise<ApiResponse<{ actions: string[] }>> {
  return request<{ actions: string[] }>('GET', `/api/audit-logs/actions`);
}

export async function getAuditLogUsers(): Promise<ApiResponse<{ users: Array<{ id: string; name: string; email: string }> }>> {
  return request<{ users: Array<{ id: string; name: string; email: string }> }>('GET', `/api/audit-logs/users`);
}

// Not routed through request()/sessionRequest() — the export endpoint returns
// text/csv, and both of those parse the body as JSON, which would corrupt it.
// Like request(), this needs to work with either an API key (implicit-org
// path) or a session (org-explicit path, since a session isn't tied to one org).
export async function exportAuditLogs(): Promise<{ csv?: string; error?: string; status: number }> {
  const apiUrl = getApiUrl();
  const apiKey = getAuthToken();
  const hasApiKey = !!apiKey && apiKey.startsWith('whr_');

  let url: string;
  let bearerToken: string;
  if (hasApiKey) {
    url = `${apiUrl}/api/audit-logs/export`;
    bearerToken = apiKey!;
  } else if (hasSession()) {
    const org = getCurrentOrg();
    if (!org) {
      return { error: 'No organization selected. Run "hookbase org switch <idOrSlug>" first.', status: 0 };
    }
    const sessionToken = getSessionAccessToken();
    if (!sessionToken) {
      return { error: 'Not logged in with a session. Run "hookbase login" first.', status: 0 };
    }
    url = `${apiUrl}/api/organizations/${org.id}/audit-logs/export`;
    bearerToken = sessionToken;
  } else {
    return { error: 'Not authenticated. Run "hookbase login".', status: 0 };
  }

  const doFetch = (token: string) =>
    fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } });

  try {
    let response = await doFetch(bearerToken);

    if (response.status === 401 && !hasApiKey) {
      const refreshed = await refreshSession();
      if (!refreshed) {
        clearSession();
        return { error: 'Session expired. Run "hookbase session login" again.', status: 401 };
      }
      response = await doFetch(getSessionAccessToken()!);
    }

    const rawBody = await response.text();

    if (!response.ok) {
      if (response.status === 401 && !hasApiKey) {
        clearSession();
        return { error: 'Session expired. Run "hookbase session login" again.', status: 401 };
      }
      let errorMsg = `Request failed (HTTP ${response.status})`;
      try {
        const data = JSON.parse(rawBody) as Record<string, unknown>;
        errorMsg = (data.error as string) || (data.message as string) || errorMsg;
      } catch {
        // Non-JSON error body; keep the generic message.
      }
      return { error: errorMsg, status: response.status };
    }

    return { csv: rawBody, status: response.status };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Network error',
      status: 0,
    };
  }
}

// ============================================================================
// Two-Factor Authentication (2FA/TOTP)
// ============================================================================

export interface TwoFactorStatus {
  enabled: boolean;
}

export async function get2FAStatus(): Promise<ApiResponse<TwoFactorStatus>> {
  return sessionRequest<TwoFactorStatus>('GET', '/api/auth/2fa/status');
}

export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
}

export async function setup2FA(): Promise<ApiResponse<TwoFactorSetup>> {
  return sessionRequest<TwoFactorSetup>('POST', '/api/auth/2fa/setup');
}

export interface TwoFactorVerifyResult {
  success: boolean;
  recoveryCodes: string[];
  message: string;
}

export async function verify2FA(code: string): Promise<ApiResponse<TwoFactorVerifyResult>> {
  return sessionRequest<TwoFactorVerifyResult>('POST', '/api/auth/2fa/verify', { code });
}

export interface TwoFactorDisableResult {
  success: boolean;
  message: string;
}

export async function disable2FA(code: string, password: string): Promise<ApiResponse<TwoFactorDisableResult>> {
  return sessionRequest<TwoFactorDisableResult>('POST', '/api/auth/2fa/disable', { code, password });
}

export interface RecoveryCodesResult {
  success: boolean;
  recoveryCodes: string[];
}

export async function regenerateRecoveryCodes(code: string): Promise<ApiResponse<RecoveryCodesResult>> {
  return sessionRequest<RecoveryCodesResult>('POST', '/api/auth/2fa/recovery-codes', { code });
}

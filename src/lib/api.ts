import { getApiUrl, getAuthToken, getCurrentOrg } from './config.js';

interface ApiResponse<T> {
  data?: T;
  error?: string;
  status: number;
}

async function request<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<ApiResponse<T>> {
  const apiUrl = getApiUrl();
  const token = getAuthToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      return {
        error: (data.error as string) || (data.message as string) || 'Request failed',
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

// Helper to ensure org is selected
function requireOrg(): { id: string; slug: string } | null {
  const org = getCurrentOrg();
  return org;
}

// ============================================================================
// Auth - API Key verification
// ============================================================================

export interface VerifyApiKeyResponse {
  user: {
    id: string;
    email: string;
    displayName: string;
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

    const data = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      return {
        error: (data.error as string) || 'Invalid API key',
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
// Organizations
// ============================================================================

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: string;
}

export async function getOrganizations(): Promise<ApiResponse<{ organizations: Organization[] }>> {
  return request<{ organizations: Organization[] }>('GET', '/api/organizations');
}

export async function getOrganization(orgId: string): Promise<ApiResponse<{ organization: Organization }>> {
  return request<{ organization: Organization }>('GET', `/api/organizations/${orgId}`);
}

// ============================================================================
// API Keys
// ============================================================================

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
  expires_at: string | null;
}

export interface CreateApiKeyResponse {
  apiKey: ApiKey;
  key: string; // Full key, only shown once
}

export async function listApiKeys(): Promise<ApiResponse<{ apiKeys: ApiKey[] }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ apiKeys: ApiKey[] }>('GET', `/api/organizations/${org.id}/api-keys`);
}

export async function createApiKey(
  name: string,
  scopes: string[] = ['read', 'write'],
  expiresInDays?: number
): Promise<ApiResponse<CreateApiKeyResponse>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<CreateApiKeyResponse>('POST', `/api/organizations/${org.id}/api-keys`, {
    name,
    scopes,
    expiresInDays,
  });
}

export async function revokeApiKey(keyId: string): Promise<ApiResponse<{ success: boolean }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ success: boolean }>('DELETE', `/api/organizations/${org.id}/api-keys/${keyId}`);
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
  created_at?: string;
}

export async function getSources(): Promise<ApiResponse<{ sources: Source[] }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ sources: Source[] }>('GET', `/api/organizations/${org.id}/sources`);
}

export async function getSource(sourceId: string): Promise<ApiResponse<{ source: Source }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ source: Source }>('GET', `/api/organizations/${org.id}/sources/${sourceId}`);
}

export async function createSource(
  name: string,
  slug: string,
  provider?: string,
  options?: {
    description?: string;
    rejectInvalidSignatures?: boolean;
    rateLimitPerMinute?: number;
  }
): Promise<ApiResponse<{ source: Source }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };

  const body: Record<string, unknown> = {
    name,
    slug,
    description: options?.description,
    rejectInvalidSignatures: options?.rejectInvalidSignatures,
    rateLimitPerMinute: options?.rateLimitPerMinute,
  };

  // Only include provider if it's a valid value (not empty)
  if (provider && provider.length > 0) {
    body.provider = provider;
  }

  return request<{ source: Source }>('POST', `/api/organizations/${org.id}/sources`, body);
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
  }
): Promise<ApiResponse<{ source: Source }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ source: Source }>('PATCH', `/api/organizations/${org.id}/sources/${sourceId}`, {
    name: data.name,
    provider: data.provider,
    description: data.description,
    isActive: data.isActive,
    rejectInvalidSignatures: data.rejectInvalidSignatures,
    rateLimitPerMinute: data.rateLimitPerMinute,
  });
}

export async function deleteSource(sourceId: string): Promise<ApiResponse<{ success: boolean }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ success: boolean }>('DELETE', `/api/organizations/${org.id}/sources/${sourceId}`);
}

export async function rotateSourceSecret(sourceId: string): Promise<ApiResponse<{ source: Source; signingSecret: string }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ source: Source; signingSecret: string }>('POST', `/api/organizations/${org.id}/sources/${sourceId}/rotate-secret`);
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
  rate_limit_per_minute?: number;
  mock_mode?: boolean;
  is_active: number;
  delivery_count?: number;
  success_count?: number;
  failure_count?: number;
  created_at?: string;
}

export async function getDestinations(): Promise<ApiResponse<{ destinations: Destination[] }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ destinations: Destination[] }>('GET', `/api/organizations/${org.id}/destinations`);
}

export async function getDestination(destId: string): Promise<ApiResponse<{ destination: Destination }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ destination: Destination }>('GET', `/api/organizations/${org.id}/destinations/${destId}`);
}

export async function createDestination(data: {
  name: string;
  slug?: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  authType?: 'none' | 'basic' | 'bearer' | 'api_key' | 'custom_header';
  authConfig?: Record<string, string>;
  timeoutMs?: number;
  rateLimitPerMinute?: number;
  mockMode?: boolean;
}): Promise<ApiResponse<{ destination: Destination }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  // Generate slug from name if not provided
  const slug = data.slug || data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return request<{ destination: Destination }>('POST', `/api/organizations/${org.id}/destinations`, {
    name: data.name,
    slug: slug,
    url: data.url,
    method: data.method || 'POST',
    headers: data.headers,
    authType: data.authType || 'none',
    authConfig: data.authConfig,
    timeoutMs: data.timeoutMs || 30000,
    rateLimitPerMinute: data.rateLimitPerMinute,
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
    rateLimitPerMinute?: number;
    mockMode?: boolean;
    isActive?: boolean;
  }
): Promise<ApiResponse<{ destination: Destination }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ destination: Destination }>('PATCH', `/api/organizations/${org.id}/destinations/${destId}`, {
    name: data.name,
    url: data.url,
    method: data.method,
    headers: data.headers,
    authType: data.authType,
    authConfig: data.authConfig,
    timeoutMs: data.timeoutMs,
    rateLimitPerMinute: data.rateLimitPerMinute,
    isActive: data.isActive,
  });
}

export async function deleteDestination(destId: string): Promise<ApiResponse<{ success: boolean }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ success: boolean }>('DELETE', `/api/organizations/${org.id}/destinations/${destId}`);
}

export async function testDestination(destId: string): Promise<ApiResponse<{
  success: boolean;
  statusCode: number;
  responseTime: number;
  responseBody?: string;
  error?: string;
}>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ success: boolean; statusCode: number; responseTime: number; responseBody?: string; error?: string }>(
    'POST',
    `/api/organizations/${org.id}/destinations/${destId}/test`
  );
}

// ============================================================================
// Routes
// ============================================================================

export interface Route {
  id: string;
  name: string;
  source_id: string;
  destination_id: string;
  source_name?: string;
  destination_name?: string;
  filter_id?: string;
  transform_id?: string;
  schema_id?: string;
  priority: number;
  is_active: number;
  delivery_count?: number;
  created_at?: string;
}

export interface FilterCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'starts_with' | 'ends_with' | 'exists' | 'not_exists' | 'greater_than' | 'less_than' | 'regex';
  value?: string;
}

export async function getRoutes(): Promise<ApiResponse<{ routes: Route[] }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ routes: Route[] }>('GET', `/api/organizations/${org.id}/routes`);
}

export async function getRoute(routeId: string): Promise<ApiResponse<{ route: Route }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ route: Route }>('GET', `/api/organizations/${org.id}/routes/${routeId}`);
}

export async function createRoute(data: {
  name: string;
  sourceId: string;
  destinationId: string;
  filterId?: string;
  filterConditions?: { logic: 'AND' | 'OR'; conditions: FilterCondition[] };
  transformId?: string;
  schemaId?: string;
  priority?: number;
  isActive?: boolean;
}): Promise<ApiResponse<{ route: Route }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ route: Route }>('POST', `/api/organizations/${org.id}/routes`, {
    name: data.name,
    sourceId: data.sourceId,
    destinationId: data.destinationId,
    filterId: data.filterId,
    filterConditions: data.filterConditions,
    transformId: data.transformId,
    schemaId: data.schemaId,
    priority: data.priority ?? 0,
    isActive: data.isActive ?? true,
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
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ route: Route }>('PATCH', `/api/organizations/${org.id}/routes/${routeId}`, {
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
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ success: boolean }>('DELETE', `/api/organizations/${org.id}/routes/${routeId}`);
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
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ tunnels: Tunnel[] }>('GET', `/api/organizations/${org.id}/tunnels`);
}

export async function getTunnel(tunnelId: string): Promise<ApiResponse<{ tunnel: Tunnel }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ tunnel: Tunnel }>('GET', `/api/organizations/${org.id}/tunnels/${tunnelId}`);
}

export async function createTunnel(name: string, subdomain?: string): Promise<ApiResponse<CreateTunnelResponse>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<CreateTunnelResponse>('POST', `/api/organizations/${org.id}/tunnels`, {
    name,
    subdomain,
  });
}

export async function updateTunnel(tunnelId: string, data: { name?: string }): Promise<ApiResponse<{ tunnel: Tunnel }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ tunnel: Tunnel }>('PATCH', `/api/organizations/${org.id}/tunnels/${tunnelId}`, data);
}

export async function deleteTunnel(tunnelId: string): Promise<ApiResponse<{ success: boolean }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ success: boolean }>('DELETE', `/api/organizations/${org.id}/tunnels/${tunnelId}`);
}

export async function getTunnelStatus(tunnelId: string): Promise<ApiResponse<{ tunnel: Tunnel; liveStatus: unknown }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ tunnel: Tunnel; liveStatus: unknown }>('GET', `/api/organizations/${org.id}/tunnels/${tunnelId}/status`);
}

export async function regenerateTunnelToken(tunnelId: string): Promise<ApiResponse<{ tunnel: Tunnel; authToken: string; auth_token: string; wsUrl: string }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ tunnel: Tunnel; authToken: string; auth_token: string; wsUrl: string }>('POST', `/api/organizations/${org.id}/tunnels/${tunnelId}/regenerate-token`);
}

export async function disconnectTunnel(tunnelId: string): Promise<ApiResponse<{ success: boolean }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ success: boolean }>('POST', `/api/organizations/${org.id}/tunnels/${tunnelId}/disconnect`);
}

// ============================================================================
// Events
// ============================================================================

export interface Event {
  id: string;
  source_id: string;
  source_name?: string;
  source_slug?: string;
  event_type?: string;
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  payload_size?: number;
  signature_valid?: boolean;
  status?: 'delivered' | 'failed' | 'pending' | 'partial' | 'no_routes';
  delivery_count?: number;
  received_at: string;
}

export interface EventWithPayload extends Event {
  payload?: unknown;
  deliveries?: Delivery[];
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
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };

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
    `/api/organizations/${org.id}/events${queryString ? `?${queryString}` : ''}`
  );
}

export async function getEvent(eventId: string): Promise<ApiResponse<{ event: EventWithPayload }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ event: EventWithPayload }>('GET', `/api/organizations/${org.id}/events/${eventId}`);
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
  status: 'pending' | 'success' | 'failed' | 'retrying';
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
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };

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
    `/api/organizations/${org.id}/deliveries${queryString ? `?${queryString}` : ''}`
  );
}

export async function getDelivery(deliveryId: string): Promise<ApiResponse<{ delivery: Delivery }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ delivery: Delivery }>('GET', `/api/organizations/${org.id}/deliveries/${deliveryId}`);
}

export async function replayDelivery(deliveryId: string): Promise<ApiResponse<{ delivery: Delivery }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ delivery: Delivery }>('POST', `/api/organizations/${org.id}/deliveries/${deliveryId}/replay`);
}

export async function bulkReplayDeliveries(deliveryIds: string[]): Promise<ApiResponse<{ replayed: number; failed: number }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ replayed: number; failed: number }>('POST', `/api/organizations/${org.id}/deliveries/bulk-replay`, {
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
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ transforms: Transform[] }>('GET', `/api/organizations/${org.id}/transforms`);
}

export async function getTransform(transformId: string): Promise<ApiResponse<{ transform: Transform }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ transform: Transform }>('GET', `/api/organizations/${org.id}/transforms/${transformId}`);
}

export async function createTransform(data: {
  name: string;
  type: 'jsonata' | 'javascript' | 'liquid' | 'xslt';
  expression: string;
  inputFormat?: 'json' | 'xml' | 'text';
  outputFormat?: 'json' | 'xml' | 'text';
}): Promise<ApiResponse<{ transform: Transform }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ transform: Transform }>('POST', `/api/organizations/${org.id}/transforms`, {
    name: data.name,
    type: data.type,
    expression: data.expression,
    input_format: data.inputFormat || 'json',
    output_format: data.outputFormat || 'json',
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
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ transform: Transform }>('PATCH', `/api/organizations/${org.id}/transforms/${transformId}`, {
    name: data.name,
    expression: data.expression,
    is_active: data.isActive,
  });
}

export async function deleteTransform(transformId: string): Promise<ApiResponse<{ success: boolean }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ success: boolean }>('DELETE', `/api/organizations/${org.id}/transforms/${transformId}`);
}

export async function testTransform(data: {
  type: string;
  expression: string;
  payload: unknown;
}): Promise<ApiResponse<{ result: unknown; error?: string }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ result: unknown; error?: string }>('POST', `/api/organizations/${org.id}/transforms/test`, data);
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
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ filters: Filter[] }>('GET', `/api/organizations/${org.id}/filters`);
}

export async function getFilter(filterId: string): Promise<ApiResponse<{ filter: Filter }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ filter: Filter }>('GET', `/api/organizations/${org.id}/filters/${filterId}`);
}

export async function createFilter(data: {
  name: string;
  logic: 'AND' | 'OR';
  conditions: FilterCondition[];
}): Promise<ApiResponse<{ filter: Filter }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ filter: Filter }>('POST', `/api/organizations/${org.id}/filters`, data);
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
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ filter: Filter }>('PATCH', `/api/organizations/${org.id}/filters/${filterId}`, {
    name: data.name,
    logic: data.logic,
    conditions: data.conditions,
    is_active: data.isActive,
  });
}

export async function deleteFilter(filterId: string): Promise<ApiResponse<{ success: boolean }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ success: boolean }>('DELETE', `/api/organizations/${org.id}/filters/${filterId}`);
}

export async function testFilter(data: {
  logic: 'AND' | 'OR';
  conditions: FilterCondition[];
  payload: unknown;
}): Promise<ApiResponse<{ matches: boolean; details?: unknown }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ matches: boolean; details?: unknown }>('POST', `/api/organizations/${org.id}/filters/test`, data);
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
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<AnalyticsOverview>('GET', `/api/organizations/${org.id}/analytics/overview`);
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
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<DashboardAnalytics>('GET', `/api/organizations/${org.id}/analytics/dashboard?range=${range}`);
}

export async function getRecentActivity(limit: number = 20): Promise<ApiResponse<{ events: Event[] }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ events: Event[] }>('GET', `/api/organizations/${org.id}/realtime/recent?limit=${limit}`);
}

// ============================================================================
// Cron Jobs
// ============================================================================

export interface CronJob {
  id: string;
  organization_id: string;
  group_id?: string | null;
  name: string;
  description?: string | null;
  cron_expression: string;
  timezone: string;
  url: string;
  method: string;
  headers?: string | null;
  payload?: string | null;
  timeout_ms: number;
  is_active: number;
  last_run_at?: string | null;
  next_run_at?: string | null;
  notify_on_success?: number;
  notify_on_failure?: number;
  notify_emails?: string | null;
  consecutive_failures?: number;
  created_at: string;
  updated_at: string;
}

export interface CronExecution {
  id: string;
  organization_id: string;
  cron_job_id: string;
  status: 'pending' | 'success' | 'failed' | 'running';
  response_status?: number | null;
  response_body?: string | null;
  response_headers?: string | null;
  error_message?: string | null;
  latency_ms?: number | null;
  started_at: string;
  completed_at?: string | null;
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
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ cronJobs: CronJob[] }>('GET', `/api/organizations/${org.id}/cron`);
}

export async function getCronJob(jobId: string): Promise<ApiResponse<{ cronJob: CronJob }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ cronJob: CronJob }>('GET', `/api/organizations/${org.id}/cron/${jobId}`);
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
}): Promise<ApiResponse<{ cronJob: CronJob }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ cronJob: CronJob }>('POST', `/api/organizations/${org.id}/cron`, {
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
  }
): Promise<ApiResponse<{ success: boolean }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ success: boolean }>('PATCH', `/api/organizations/${org.id}/cron/${jobId}`, data);
}

export async function deleteCronJob(jobId: string): Promise<ApiResponse<{ success: boolean }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ success: boolean }>('DELETE', `/api/organizations/${org.id}/cron/${jobId}`);
}

export async function triggerCronJob(jobId: string): Promise<ApiResponse<{ execution: CronTriggerResult }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ execution: CronTriggerResult }>('POST', `/api/organizations/${org.id}/cron/${jobId}/trigger`);
}

export async function getCronExecutions(
  jobId: string,
  limit: number = 20
): Promise<ApiResponse<{ executions: CronExecution[] }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ executions: CronExecution[] }>(
    'GET',
    `/api/organizations/${org.id}/cron/${jobId}/executions?limit=${limit}`
  );
}

// ============================================================================
// Cron Groups
// ============================================================================

export async function getCronGroups(): Promise<ApiResponse<{ groups: CronGroup[] }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ groups: CronGroup[] }>('GET', `/api/organizations/${org.id}/cron-groups`);
}

export async function getCronGroup(groupId: string): Promise<ApiResponse<{ group: CronGroup }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ group: CronGroup }>('GET', `/api/organizations/${org.id}/cron-groups/${groupId}`);
}

export async function createCronGroup(data: {
  name: string;
  description?: string;
}): Promise<ApiResponse<{ group: CronGroup }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ group: CronGroup }>('POST', `/api/organizations/${org.id}/cron-groups`, data);
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
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ group: CronGroup }>('PATCH', `/api/organizations/${org.id}/cron-groups/${groupId}`, data);
}

export async function deleteCronGroup(groupId: string): Promise<ApiResponse<{ success: boolean }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ success: boolean }>('DELETE', `/api/organizations/${org.id}/cron-groups/${groupId}`);
}

export async function reorderCronGroups(groupIds: string[]): Promise<ApiResponse<{ success: boolean }>> {
  const org = requireOrg();
  if (!org) return { error: 'No organization selected', status: 0 };
  return request<{ success: boolean }>('POST', `/api/organizations/${org.id}/cron-groups/reorder`, { groupIds });
}

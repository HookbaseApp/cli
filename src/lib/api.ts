import { getApiUrl, getAuthToken } from './config.js';

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

  if (!token || !token.startsWith('whr_')) {
    return {
      error: 'Not authenticated. Run "hookbase login" with a valid API key (whr_...).',
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

    const data = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      let errorMsg = (data.error as string) || (data.message as string) || 'Request failed';
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

  return request<{ apiKeys: ApiKey[] }>('GET', `/api/api-keys`);
}

export async function createApiKey(
  name: string,
  scopes: string[] = ['read', 'write', 'delete'],
  expiresInDays?: number
): Promise<ApiResponse<CreateApiKeyResponse>> {

  return request<CreateApiKeyResponse>('POST', `/api/api-keys`, {
    name,
    scopes,
    expiresInDays,
  });
}

export async function revokeApiKey(keyId: string): Promise<ApiResponse<{ success: boolean }>> {

  return request<{ success: boolean }>('DELETE', `/api/api-keys/${keyId}`);
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
  created_at?: string;
}

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
    rejectInvalidSignatures?: boolean;
    rateLimitPerMinute?: number;
    transientMode?: boolean;
  }
): Promise<ApiResponse<{ source: Source }>> {

  const body: Record<string, unknown> = {
    name,
    slug,
    description: options?.description,
    rejectInvalidSignatures: options?.rejectInvalidSignatures,
    rateLimitPerMinute: options?.rateLimitPerMinute,
    transientMode: options?.transientMode,
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
  });
}

export async function deleteSource(sourceId: string): Promise<ApiResponse<{ success: boolean }>> {

  return request<{ success: boolean }>('DELETE', `/api/sources/${sourceId}`);
}

export async function rotateSourceSecret(sourceId: string): Promise<ApiResponse<{ source: Source; signingSecret: string }>> {

  return request<{ source: Source; signingSecret: string }>('POST', `/api/sources/${sourceId}/rotate-secret`);
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

  return request<{ destinations: Destination[] }>('GET', `/api/destinations?pageSize=100`);
}

export async function getDestination(destId: string): Promise<ApiResponse<{ destination: Destination }>> {

  return request<{ destination: Destination }>('GET', `/api/destinations/${destId}`);
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

  // Generate slug from name if not provided
  const slug = data.slug || data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return request<{ destination: Destination }>('POST', `/api/destinations`, {
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

  return request<{ destination: Destination }>('PATCH', `/api/destinations/${destId}`, {
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
  filterConditions?: { logic: 'AND' | 'OR'; conditions: FilterCondition[] };
  transformId?: string;
  schemaId?: string;
  priority?: number;
  isActive?: boolean;
}): Promise<ApiResponse<{ route: Route }>> {

  return request<{ route: Route }>('POST', `/api/routes`, {
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

export async function createTunnel(name: string, subdomain?: string): Promise<ApiResponse<CreateTunnelResponse>> {

  return request<CreateTunnelResponse>('POST', `/api/tunnels`, {
    name,
    subdomain,
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
  headers?: Record<string, string>;
  payload_size?: number;
  payloadSize?: number;
  signature_valid?: boolean;
  signatureValid?: boolean;
  status?: 'delivered' | 'failed' | 'pending' | 'partial' | 'no_routes';
  delivery_count?: number;
  deliveryCount?: number;
  received_at?: string;
  receivedAt?: string;
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

export async function getEvent(eventId: string): Promise<ApiResponse<{ event: EventWithPayload }>> {

  return request<{ event: EventWithPayload }>('GET', `/api/events/${eventId}`);
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
  type: 'jsonata' | 'javascript' | 'liquid' | 'xslt';
  expression: string;
  inputFormat?: 'json' | 'xml' | 'text';
  outputFormat?: 'json' | 'xml' | 'text';
}): Promise<ApiResponse<{ transform: Transform }>> {

  return request<{ transform: Transform }>('POST', `/api/transforms`, {
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
  event_types: string[];
  headers?: Record<string, string>;
  rate_limit_per_minute?: number;
  timeout_ms?: number;
  is_active: number;
  circuit_state?: 'closed' | 'open' | 'half_open';
  failure_count?: number;
  message_count?: number;
  success_rate?: number;
  created_at: string;
  updated_at: string;
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
  eventTypes?: string[];
  headers?: Record<string, string>;
  rateLimitPerMinute?: number;
  timeoutMs?: number;
}): Promise<ApiResponse<{ endpoint: WebhookEndpoint; secret: string }>> {

  return request<{ endpoint: WebhookEndpoint; secret: string }>('POST', `/api/webhook-endpoints`, {
    applicationId: data.applicationId,
    url: data.url,
    description: data.description,
    eventTypes: data.eventTypes || ['*'],
    headers: data.headers,
    rateLimitPerMinute: data.rateLimitPerMinute,
    timeoutMs: data.timeoutMs || 30000,
  });
}

export async function updateWebhookEndpoint(
  endpointId: string,
  data: {
    url?: string;
    description?: string;
    eventTypes?: string[];
    headers?: Record<string, string>;
    rateLimitPerMinute?: number;
    timeoutMs?: number;
    isActive?: boolean;
  }
): Promise<ApiResponse<{ endpoint: WebhookEndpoint }>> {

  return request<{ endpoint: WebhookEndpoint }>('PATCH', `/api/webhook-endpoints/${endpointId}`, data);
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

  return request<{ message: WebhookMessage }>('POST', `/api/outbound-messages/${messageId}/retry`);
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
  params.set('status', 'dlq'); // Filter for DLQ messages
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  if (options?.applicationId) params.set('applicationId', options.applicationId);
  if (options?.endpointId) params.set('endpointId', options.endpointId);

  const queryString = params.toString();
  return request<{ messages: DlqMessage[]; total: number; hasMore: boolean }>(
    'GET',
    `/api/outbound-messages?${queryString}`
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

  // Note: Delete may not be supported - check API
  return request<{ success: boolean }>('DELETE', `/api/outbound-messages/${messageId}`);
}

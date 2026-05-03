import WebSocket from 'ws';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import * as logger from './logger.js';

interface TunnelRequest {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

interface TunnelResponse {
  id: string;
  status: number;
  headers: Record<string, string>;
  body: string | null;
}

export interface OutboundResponse {
  id: string;
  type: 'outbound_response';
  status: number;
  headers: Record<string, string>;
  body?: string;
}

export interface OutboundError {
  id: string;
  type: 'error';
  message: string;
}

export interface TunnelFilter {
  // Match against `x-hookbase-source` header (set by the relay) or path prefix
  // `/<slug>/...`. Repeatable.
  sourceSlugs?: string[];
  // Glob patterns matched against the detected event type (case-insensitive,
  // supports `*` and `?`). Repeatable.
  eventPatterns?: string[];
  // JSONata expression evaluated against the parsed JSON body. Truthy = pass.
  payloadExpr?: string;
  // HTTP status to send back to the relay for filtered-out requests. Default 204.
  skipStatus?: number;
}

export interface TunnelOptions {
  wsUrl: string;
  localPort: number;
  localHost?: string;
  filter?: TunnelFilter;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onRequest?: (method: string, path: string, status: number, duration: number) => void;
  onSkip?: (method: string, path: string, reason: string) => void;
  onError?: (error: Error) => void;
}

// Detect a webhook event type from request headers and parsed body. Order
// matters: provider-specific headers win over generic body fields.
function detectEventType(headers: Record<string, string>, body: unknown): string | null {
  const lower = (k: string) => headers[k] || headers[k.toLowerCase()];
  // Explicit per-provider header
  const direct =
    lower('x-github-event') ||
    lower('x-shopify-topic') ||
    lower('x-event-name') ||
    lower('x-event-key') ||
    lower('x-mailgun-event');
  if (direct) return String(direct);
  // Stripe encodes type in body; presence of stripe-signature is the cue
  if (lower('stripe-signature') && body && typeof body === 'object') {
    const t = (body as { type?: unknown }).type;
    if (typeof t === 'string') return t;
  }
  // Generic body fields
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    for (const key of ['type', 'event', 'event_type', 'eventType']) {
      const v = obj[key];
      if (typeof v === 'string') return v;
    }
  }
  return null;
}

// Tiny glob matcher — supports `*` (any sequence) and `?` (single char). No
// regex injection risk because we escape everything else.
function globMatch(pattern: string, input: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(input);
}

export class TunnelClient {
  private ws: WebSocket | null = null;
  private options: TunnelOptions;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private pingInterval: NodeJS.Timeout | null = null;
  private isClosing = false;
  private pendingOutbound = new Map<string, {
    resolve: (value: OutboundResponse) => void;
    reject: (reason: Error) => void;
  }>();

  constructor(options: TunnelOptions) {
    this.options = {
      localHost: 'localhost',
      ...options,
    };
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.isClosing = false;

      try {
        this.ws = new WebSocket(this.options.wsUrl);

        this.ws.on('open', () => {
          this.reconnectAttempts = 0;
          this.startPingInterval();
          this.options.onConnect?.();
          resolve();
        });

        this.ws.on('message', (data: WebSocket.RawData) => {
          this.handleMessage(data.toString());
        });

        this.ws.on('close', (code, reason) => {
          this.stopPingInterval();
          this.options.onDisconnect?.();

          if (!this.isClosing && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
          }
        });

        this.ws.on('error', (error) => {
          this.options.onError?.(error);
          if (this.reconnectAttempts === 0) {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    logger.warn(`Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      if (!this.isClosing) {
        this.connect().catch(() => {});
      }
    }, delay);
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // Handle pong (response to our ping)
      if (message.type === 'pong') {
        return;
      }

      // Handle ping from server (respond with pong)
      if (message.type === 'ping') {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'pong' }));
        }
        return;
      }

      // Handle outbound response (from bidirectional proxy)
      if (message.type === 'outbound_response') {
        const pending = this.pendingOutbound.get(message.id);
        if (pending) {
          this.pendingOutbound.delete(message.id);
          pending.resolve(message as OutboundResponse);
        }
        return;
      }

      // Handle error response for outbound requests
      if (message.type === 'error' && message.id) {
        const pending = this.pendingOutbound.get(message.id);
        if (pending) {
          this.pendingOutbound.delete(message.id);
          pending.reject(new Error(message.message || 'Unknown error'));
        }
        return;
      }

      // Handle request from server (inbound forwarding)
      if (message.id && message.method) {
        this.forwardRequest(message as TunnelRequest);
      }
    } catch (error) {
      logger.error(`Failed to parse message: ${error}`);
    }
  }

  private async forwardRequest(request: TunnelRequest): Promise<void> {
    const startTime = Date.now();
    const localUrl = `http://${this.options.localHost}:${this.options.localPort}${request.url}`;

    // Apply filter (if any) before doing any local I/O. Rejected requests get
    // a configurable status (default 204) so the upstream still sees a sane
    // response and the local app stays unaware.
    const filter = this.options.filter;
    if (filter) {
      const skipReason = await this.evaluateFilter(request, filter);
      if (skipReason) {
        const skipStatus = filter.skipStatus ?? 204;
        // 1xx/204/205/304 cannot legally carry a body. Omit body for those
        // statuses so the relay can construct a valid Response.
        const isNullBodyStatus = skipStatus === 204 || skipStatus === 205 || skipStatus === 304 || (skipStatus >= 100 && skipStatus < 200);
        const skipResponse: TunnelResponse = {
          id: request.id,
          status: skipStatus,
          headers: isNullBodyStatus
            ? { 'x-hookbase-filtered': 'true', 'x-hookbase-skip-reason': skipReason.slice(0, 200) }
            : { 'content-type': 'application/json', 'x-hookbase-filtered': 'true' },
          body: isNullBodyStatus ? null : JSON.stringify({ filtered: true, reason: skipReason }),
        };
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(skipResponse));
        }
        this.options.onSkip?.(request.method, request.url, skipReason);
        return;
      }
    }

    try {
      const url = new URL(localUrl);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const response = await new Promise<TunnelResponse>((resolve, reject) => {
        // Build headers, filtering out ones that shouldn't be forwarded
        const forwardHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(request.headers)) {
          const lowerKey = key.toLowerCase();
          if (lowerKey !== 'host' && lowerKey !== 'connection' && lowerKey !== 'upgrade') {
            forwardHeaders[key] = value;
          }
        }

        const reqOptions: http.RequestOptions = {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method: request.method,
          headers: forwardHeaders,
          timeout: 30000,
        };

        const req = httpModule.request(reqOptions, (res) => {
          const chunks: Buffer[] = [];

          res.on('data', (chunk) => chunks.push(chunk));

          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            const headers: Record<string, string> = {};

            Object.entries(res.headers).forEach(([key, value]) => {
              if (typeof value === 'string') {
                headers[key] = value;
              } else if (Array.isArray(value)) {
                headers[key] = value.join(', ');
              }
            });

            resolve({
              id: request.id,
              status: res.statusCode || 500,
              headers,
              body,
            });
          });
        });

        req.on('error', (error) => {
          reject(error);
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });

        if (request.body) {
          req.write(request.body);
        }

        req.end();
      });

      // Send response back through WebSocket
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(response));
      }

      const duration = Date.now() - startTime;
      this.options.onRequest?.(request.method, request.url, response.status, duration);

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Send error response
      const errorResponse: TunnelResponse = {
        id: request.id,
        status: 502,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          error: 'Bad Gateway',
          message: `Failed to connect to localhost:${this.options.localPort}`,
          details: errorMessage,
        }),
      };

      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(errorResponse));
      }

      this.options.onRequest?.(request.method, request.url, 502, duration);
      logger.error(`Failed to forward request: ${errorMessage}`);
    }
  }

  sendOutboundRequest(
    url: string,
    method: string,
    headers: Record<string, string>,
    body?: string,
    timeoutMs = 30000,
  ): Promise<OutboundResponse> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const id = `out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const timer = setTimeout(() => {
        this.pendingOutbound.delete(id);
        reject(new Error(`Outbound request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingOutbound.set(id, {
        resolve: (response) => {
          clearTimeout(timer);
          resolve(response);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.ws.send(JSON.stringify({
        type: 'outbound_request',
        id,
        url,
        method,
        headers,
        body,
      }));
    });
  }

  // Returns a non-empty reason string when the request should be skipped, or
  // null when it passes all filter checks.
  private async evaluateFilter(request: TunnelRequest, filter: TunnelFilter): Promise<string | null> {
    let parsedBody: unknown = undefined;
    if (request.body) {
      try {
        parsedBody = JSON.parse(request.body);
      } catch {
        // Non-JSON body — body-dependent filters cannot match.
      }
    }

    if (filter.sourceSlugs && filter.sourceSlugs.length > 0) {
      const slugFromHeader = request.headers['x-hookbase-source'] || request.headers['X-Hookbase-Source'];
      const slugFromPath = request.url.split('?')[0].split('/').filter(Boolean)[0];
      const detected = slugFromHeader || slugFromPath || '';
      if (!filter.sourceSlugs.some((s) => s === detected)) {
        return `source "${detected}" not in [${filter.sourceSlugs.join(', ')}]`;
      }
    }

    if (filter.eventPatterns && filter.eventPatterns.length > 0) {
      const eventType = detectEventType(request.headers, parsedBody);
      if (!eventType) {
        return 'no detectable event type';
      }
      if (!filter.eventPatterns.some((p) => globMatch(p, eventType))) {
        return `event "${eventType}" did not match [${filter.eventPatterns.join(', ')}]`;
      }
    }

    if (filter.payloadExpr) {
      try {
        const jsonataMod = await import('jsonata');
        const jsonata = jsonataMod.default;
        const expr = jsonata(filter.payloadExpr);
        const result = await expr.evaluate(parsedBody ?? {});
        if (!result) {
          return `payload expr returned ${JSON.stringify(result)}`;
        }
      } catch (err) {
        // Broken expression: warn once then pass-through so we don't black-hole
        // every request because of a typo. Silent on subsequent runs.
        if (!this.payloadExprWarned) {
          this.payloadExprWarned = true;
          logger.warn(`payload-expr failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    return null;
  }

  private payloadExprWarned = false;

  close(): void {
    this.isClosing = true;
    this.stopPingInterval();

    if (this.ws) {
      this.ws.close(1000, 'Client closing');
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

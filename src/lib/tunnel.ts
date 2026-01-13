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

export interface TunnelOptions {
  wsUrl: string;
  localPort: number;
  localHost?: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onRequest?: (method: string, path: string, status: number, duration: number) => void;
  onError?: (error: Error) => void;
}

export class TunnelClient {
  private ws: WebSocket | null = null;
  private options: TunnelOptions;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private pingInterval: NodeJS.Timeout | null = null;
  private isClosing = false;

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

      // Handle request from server
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

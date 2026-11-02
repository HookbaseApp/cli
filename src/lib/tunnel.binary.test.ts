import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import { TunnelClient } from './tunnel.js';
import { bodyToBuffer, encodeBytes, withBinaryFlag } from './tunnelBody.js';

const BINARY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x80]);

describe('tunnel body encoding', () => {
  it('keeps valid UTF-8 as text with no flag', () => {
    expect(encodeBytes(Buffer.from('héllo ✓'))).toEqual({ body: 'héllo ✓' });
  });

  it('keeps a leading BOM', () => {
    const { body, bodyEncoding } = encodeBytes(Buffer.from([0xef, 0xbb, 0xbf, 0x61]));
    expect(bodyEncoding).toBeUndefined();
    expect([...Buffer.from(body)]).toEqual([0xef, 0xbb, 0xbf, 0x61]);
  });

  it('sends anything else as base64 that round-trips exactly', () => {
    const wire = encodeBytes(BINARY);
    expect(wire.bodyEncoding).toBe('base64');
    expect(bodyToBuffer(wire.body, wire.bodyEncoding)).toEqual(BINARY);
  });

  it('adds binary=1 and keeps the existing query', () => {
    const url = new URL(withBinaryFlag('wss://api.hookbase.app/tunnel/ws?token=a&tunnelId=t'));
    expect(url.searchParams.get('token')).toBe('a');
    expect(url.searchParams.get('binary')).toBe('1');
  });
});

describe('TunnelClient binary bodies', () => {
  let wss: WebSocketServer;
  let client: TunnelClient | undefined;
  let upgradeUrl: Promise<string>;
  let serverSocket: Promise<ServerSocket>;

  async function start(port: number): Promise<void> {
    wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
    upgradeUrl = new Promise((resolve) => wss.once('connection', (_s, req) => resolve(req.url ?? '')));
    serverSocket = new Promise((resolve) => wss.once('connection', resolve));
    client = new TunnelClient({
      wsUrl: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/ws?token=a`,
      localPort: port,
      localHost: '127.0.0.1',
    });
    await client.connect();
  }

  function localApp(reply: Buffer) {
    return new Promise<{ port: number; received: Promise<Buffer>; close: () => void }>((resolve) => {
      let got: (b: Buffer) => void;
      const received = new Promise<Buffer>((r) => { got = r; });
      const server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          got(Buffer.concat(chunks));
          res.setHeader('content-type', 'application/octet-stream');
          res.end(reply);
        });
      });
      server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as AddressInfo).port, received, close: () => server.close() }));
    });
  }

  function frameFor(socket: ServerSocket, id: string) {
    return new Promise<Record<string, unknown>>((resolve) => {
      const listener = (data: Buffer) => {
        const frame = JSON.parse(data.toString()) as Record<string, unknown>;
        if (frame.id === id) {
          socket.off('message', listener);
          resolve(frame);
        }
      };
      socket.on('message', listener);
    });
  }

  afterEach(async () => {
    client?.close();
    client = undefined;
    for (const s of wss.clients) s.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  it('asks for binary bodies on the upgrade', async () => {
    await start(1);
    expect(await upgradeUrl).toMatch(/[?&]binary=1\b/);
  });

  it('writes a base64 request body to the local app as the exact bytes', async () => {
    const app = await localApp(Buffer.from('ok'));
    await start(app.port);
    (await serverSocket).send(JSON.stringify({ id: 'a', method: 'POST', url: '/h', headers: {}, body: BINARY.toString('base64'), bodyEncoding: 'base64' }));

    expect(await app.received).toEqual(BINARY);
    app.close();
  });

  it('answers a binary response as base64 once the server has said hello', async () => {
    const app = await localApp(BINARY);
    await start(app.port);
    const socket = await serverSocket;
    socket.send(JSON.stringify({ type: 'hello', features: ['binary-bodies'] }));
    const reply = frameFor(socket, 'b');
    socket.send(JSON.stringify({ id: 'b', method: 'GET', url: '/i', headers: {}, body: null }));

    const frame = await reply;
    app.close();
    expect(frame.bodyEncoding).toBe('base64');
    expect(Buffer.from(frame.body as string, 'base64')).toEqual(BINARY);
  });

  it('keeps a text response as text even after hello', async () => {
    const app = await localApp(Buffer.from('{"n":"héllo"}'));
    await start(app.port);
    const socket = await serverSocket;
    socket.send(JSON.stringify({ type: 'hello', features: ['binary-bodies'] }));
    const reply = frameFor(socket, 'c');
    socket.send(JSON.stringify({ id: 'c', method: 'GET', url: '/j', headers: {}, body: null }));

    const frame = await reply;
    app.close();
    expect(frame.body).toBe('{"n":"héllo"}');
    expect(frame.bodyEncoding).toBeUndefined();
  });

  it('never sends base64 to a server that did not say hello', async () => {
    const app = await localApp(BINARY);
    await start(app.port);
    const socket = await serverSocket;
    const reply = frameFor(socket, 'd');
    socket.send(JSON.stringify({ id: 'd', method: 'GET', url: '/i', headers: {}, body: null }));

    const frame = await reply;
    app.close();
    expect(frame.bodyEncoding).toBeUndefined();
  });
});

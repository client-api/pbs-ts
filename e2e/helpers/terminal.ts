import { WebSocket as NodeWebSocket } from 'ws';

import type { Pbs } from '../../src/Pbs';
import { AUTH_COOKIE_NAME } from './client';
import type { Credentials } from './credentials';

/**
 * Open a PBS node-shell terminal over WebSocket.
 *
 * The PBS SDK (unlike PVE) does NOT ship a built-in WebSocket helper
 * surface — there's no `pbs.connectTerminal(...)`. This helper performs
 * the wire dance directly so the suite can still smoke-test the node
 * shell end-to-end.
 *
 * Wire protocol (same shape as PVE's termproxy family):
 *   1. POST {basePath}/nodes/{node}/termproxy → `{ ticket, port, user }`
 *   2. Open `wss://host/api2/json/nodes/{node}/vncwebsocket?port=N&vncticket=…`
 *      with the `PBSAuthCookie` cookie set as a request header.
 *   3. First frame: raw `${user}:${vncticket}\n` (in-band auth).
 *   4. Subsequent input frames: `0:LEN:MSG\n` (TextFrameCodec.encode).
 *      Server emits raw TTY bytes; we surface them as strings.
 */
export interface TerminalShell {
  send(text: string): void;
  close(): void;
  output(): string;
}

const HANDSHAKE_TIMEOUT_MS = 10_000;

export async function openNodeTerminal(
  pbs: Pbs,
  node: string,
  _creds: Credentials,
  ticketCookie: string,
  csrfToken: string,
): Promise<TerminalShell> {
  const { basePath } = pbs.configuration();

  const termproxyRes = await fetch(`${basePath}/nodes/${encodeURIComponent(node)}/termproxy`, {
    method: 'POST',
    headers: {
      Cookie: `${AUTH_COOKIE_NAME}=${ticketCookie}`,
      CSRFPreventionToken: csrfToken,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!termproxyRes.ok) {
    throw new Error(`termproxy failed: HTTP ${termproxyRes.status} ${await termproxyRes.text()}`);
  }
  const { data } = (await termproxyRes.json()) as {
    data: { ticket: string; port: string; user: string };
  };

  const wsBase = basePath.replace(/^http(s?):/, (_, s) => `ws${s}:`);
  const url = new URL(`${wsBase}/nodes/${encodeURIComponent(node)}/vncwebsocket`);
  url.searchParams.set('port', String(data.port));
  url.searchParams.set('vncticket', data.ticket);

  const socket = new NodeWebSocket(url.toString(), {
    headers: { Cookie: `${AUTH_COOKIE_NAME}=${ticketCookie}` },
    rejectUnauthorized: false,
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket open timed out')), HANDSHAKE_TIMEOUT_MS);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.once('close', (code) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket closed before open: code=${code}`));
    });
  });

  // In-band auth — the very first frame after upgrade must be
  // `<user>:<vncticket>\n`. PBS drops the socket without it.
  socket.send(`${data.user}:${data.ticket}\n`);

  const buf: string[] = [];
  socket.on('message', (chunk) => {
    buf.push(chunk.toString('utf8'));
  });

  return {
    send(text: string) {
      const frame = `0:${text.length}:${text}\n`;
      socket.send(frame);
    },
    close() {
      try {
        socket.close(1000, 'client closed');
      } catch {
        // ignore
      }
    },
    output() {
      return buf.join('');
    },
  };
}

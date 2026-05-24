import { describe, test, expect, beforeAll } from 'vitest';

import { loadCredentials, type Credentials } from '../helpers/credentials';
import { createTicketSession } from '../helpers/client';
import { openNodeTerminal } from '../helpers/terminal';
import { firstNode } from '../helpers/fixtures';

const WS_TIMEOUT = 30_000;

/**
 * WS-01 (extra) — `termproxy` against the **PBS node shell**.
 *
 * Upstream §2.2 lists WebSocket endpoints as out-of-scope (generator
 * coverage is partial), but the PBS daemon exposes the same termproxy
 * surface as PVE (`/nodes/{node}/termproxy` → `/nodes/{node}/vncwebsocket`).
 *
 * The PBS SDK doesn't ship a built-in WebSocket helper (unlike PVE),
 * so this test exercises the wire surface directly via
 * `e2e/helpers/terminal.ts` — same protocol, just bypassed at the SDK
 * level.
 */
describe('ws-terminal', () => {
  let creds: Credentials;

  beforeAll(() => {
    creds = loadCredentials();
  });

  test(
    'WS-01: PBS node terminal opens, echoes a marker, closes',
    async () => {
      const session = await createTicketSession(creds);
      const node = await firstNode(session.pbs);

      const shell = await openNodeTerminal(
        session.pbs,
        node,
        creds,
        session.ticket,
        session.csrfToken,
      );

      // Wait briefly for the post-handshake banner so the shell prompt is
      // ready to accept input.
      await new Promise((r) => setTimeout(r, 500));

      const marker = `e2e-ws-${Date.now()}`;
      shell.send(`echo ${marker}\n`);

      const start = Date.now();
      while (Date.now() - start < WS_TIMEOUT) {
        if (shell.output().includes(marker)) break;
        await new Promise((r) => setTimeout(r, 100));
      }

      expect(shell.output()).toContain(marker);

      shell.close();
    },
    WS_TIMEOUT + 5_000,
  );
});

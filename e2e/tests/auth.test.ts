import { describe, test, expect, beforeAll } from 'vitest';

import { loadCredentials, type Credentials, tokenAuthSupported } from '../helpers/credentials';
import { createTokenClient, createTicketSession, AUTH_COOKIE_NAME } from '../helpers/client';
import { Pbs } from '../../src/Pbs';
import { Configuration } from '../../src/runtime';

/**
 * SC-10..14 — authentication surface.
 *
 * Token auth is the suite-wide default (used by every other scenario file);
 * here we test both ticket and token paths plus the failure modes.
 */
describe('auth', () => {
  let creds: Credentials;

  beforeAll(() => {
    creds = loadCredentials();
  });

  test('SC-10: ticket login returns ticket + CSRF token', async () => {
    const session = await createTicketSession(creds);
    expect(session.ticket).toMatch(/^PBS:/); // PBS prefixes its tickets
    expect(session.csrfToken.length).toBeGreaterThan(0);

    // Cookie-authenticated request succeeds.
    const version = await session.pbs.version().getVersion();
    expect(version.data?.version).toMatch(/^4/);
  });

  test('SC-11: ticket login with bad password returns 401', async () => {
    const bootstrap = new Pbs(
      new Configuration({ basePath: creds.url + '/api2/json' }),
    );
    await expect(
      bootstrap.accessTicket().createTicket({
        accessTicketCreateTicketRequest: {
          username: creds.user,
          password: 'not-the-password',
        },
      }),
    ).rejects.toMatchObject({ response: { status: 401 } });
  });

  test.skipIf(!tokenAuthSupported({ ...creds }))(
    'SC-12: token-authenticated request returns 200',
    async () => {
      const pbs = createTokenClient(creds);
      const res = await pbs.version().getVersion();
      expect(res.data?.version).toBeTruthy();
    },
  );

  test.skipIf(!tokenAuthSupported({ ...creds }))(
    'SC-13: malformed token returns 401',
    async () => {
      const pbs = new Pbs(
        new Configuration({
          basePath: creds.url + '/api2/json',
          apiKey: (name: string) => {
            // Wrong UUID, right structure (Rust-family `:` separator) —
            // should be rejected as unauthenticated.
            if (name === 'Authorization') {
              return 'PBSAPIToken=root@pam!test:00000000-0000-0000-0000-000000000000';
            }
            return '';
          },
        }),
      );
      await expect(pbs.version().getVersion()).rejects.toMatchObject({
        response: { status: 401 },
      });
    },
  );

  test('SC-14: state-changing request without CSRFPreventionToken returns 401', async () => {
    const session = await createTicketSession(creds);

    // Build a copycat client that has the cookie but drops the CSRF header.
    const noCsrf = new Pbs(
      new Configuration({
        basePath: creds.url + '/api2/json',
        headers: { Cookie: `${AUTH_COOKIE_NAME}=${session.ticket}` },
      }),
    );

    // Create-user is a state-changing endpoint. PBS responds 401 when the
    // CSRF header is missing on a ticket-authenticated session.
    await expect(
      noCsrf.accessUsers().createUsers({
        accessUsersCreateUsersRequest: { userid: 'e2e-csrf-probe@pbs' },
      }),
    ).rejects.toMatchObject({ response: { status: 401 } });
  });
});

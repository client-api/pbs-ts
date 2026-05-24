import { describe, test, expect, beforeAll, afterAll } from 'vitest';

import { loadCredentials, type Credentials } from '../helpers/credentials';
import { createTokenClient, AUTH_COOKIE_NAME } from '../helpers/client';
import { cleanupE2E, E2E_PREFIX } from '../helpers/fixtures';
import { waitUntil } from '../helpers/poll';
import { Pbs } from '../../src/Pbs';
import { Configuration } from '../../src/runtime';

/**
 * SC-20..22 — authorization.
 *
 * Strategy: provision an `Audit` (read-only) user, prove it cannot
 * mutate, prove the admin (root@pam!test token) can, and read
 * `/access/permissions` to confirm the user's effective ACLs surface.
 */
describe('authz', () => {
  let creds: Credentials;
  let admin: Pbs;

  const RO_USER = `${E2E_PREFIX}readonly@pbs`;
  const RO_PASS = 'ReadOnly!2026-abc';

  beforeAll(async () => {
    creds = loadCredentials();
    admin = createTokenClient(creds);
    await cleanupE2E(admin);
  });

  afterAll(async () => {
    await cleanupE2E(admin);
  });

  test('SC-21: admin (token) can create entities', async () => {
    await admin.accessUsers().createUsers({
      accessUsersCreateUsersRequest: {
        userid: RO_USER,
        password: RO_PASS,
      },
    });
    // Grant Audit role at the root path. PBS's stock `Audit` role is
    // read-only across the server — sufficient for the SC-20 negative case.
    await admin.accessAcl().updateAcl({
      accessAclUpdateAclRequest: {
        path: '/',
        role: 'Audit',
        authId: RO_USER,
      },
    });

    const acls = await admin.accessAcl().getAcl({});
    const list = (acls as { data?: Array<{ ugid?: string; roleid?: string }> }).data ?? [];
    expect(list.some((e) => e.ugid === RO_USER && e.roleid === 'Audit')).toBe(true);
  });

  test('SC-20: read-only user cannot create entities', async () => {
    // Ticket-login as the read-only user.
    const bootstrap = new Pbs(new Configuration({ basePath: creds.url + '/api2/json' }));
    const login = await bootstrap.accessTicket().createTicket({
      accessTicketCreateTicketRequest: { username: RO_USER, password: RO_PASS },
    });
    const ticket = login.data?.ticket;
    const csrf = login.data?.cSRFPreventionToken;
    expect(ticket).toBeTruthy();

    const ro = new Pbs(
      new Configuration({
        basePath: creds.url + '/api2/json',
        headers: {
          Cookie: `${AUTH_COOKIE_NAME}=${ticket}`,
          CSRFPreventionToken: csrf ?? '',
        },
      }),
    );

    await expect(
      ro.accessUsers().createUsers({
        accessUsersCreateUsersRequest: { userid: `${E2E_PREFIX}other@pbs` },
      }),
    ).rejects.toMatchObject({ response: { status: 403 } });
  });

  test('SC-22: /access/permissions returns the user effective ACLs', async () => {
    // PBS's in-memory ACL cache can lag a moment behind the on-disk
    // acl.cfg write done by SC-21. Locally the write-then-read is
    // instant; on a fresh CI container the first read sometimes sees
    // an empty result. Poll for the populated shape — `{ "/": {...} }` —
    // rather than asserting on the first response.
    const data = await waitUntil(
      async () => {
        const perms = await admin.access().getPermissions({ authId: RO_USER });
        const d = (perms as { data?: Record<string, Record<string, boolean>> }).data ?? {};
        return Object.keys(d).length > 0 ? d : false;
      },
      { timeoutMs: 15_000, intervalMs: 500, label: 'permissions for RO_USER populated' },
    );
    // Audit role grants Datastore.Audit at the root path.
    expect(data['/']?.['Datastore.Audit']).toBe(true);
  });
});

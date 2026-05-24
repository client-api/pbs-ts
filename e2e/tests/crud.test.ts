import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { loadCredentials, type Credentials } from '../helpers/credentials';
import { createTokenClient } from '../helpers/client';
import { cleanupE2E, E2E_PREFIX } from '../helpers/fixtures';
import { waitUntil } from '../helpers/poll';
import { Pbs } from '../../src/Pbs';

/**
 * SC-30..34 — CRUD baseline against safe, idempotent PBS surfaces.
 *
 * PBS has no `/storage` resource (PVE-only); the equivalent is the
 * **datastore** under `/config/datastore`. Datastore create/delete is
 * async — both endpoints return a UPID and the listing converges a
 * moment later, so the test polls.
 */
describe('crud', () => {
  let creds: Credentials;
  let pbs: Pbs;

  const USER = `${E2E_PREFIX}user-01@pbs`;
  const USER_OTHER = `${E2E_PREFIX}user-02@pbs`;
  const STORE = `${E2E_PREFIX}store-01`;
  const STORE_PATH = '/tmp/e2e-store-01';

  beforeAll(async () => {
    creds = loadCredentials();
    pbs = createTokenClient(creds);
    await cleanupE2E(pbs);
  });

  afterAll(async () => {
    await cleanupE2E(pbs);
  });

  test('SC-30: list users contains root@pam', async () => {
    const res = await pbs.accessUsers().getUsers({});
    const users = (res as { data?: Array<{ userid?: string }> }).data ?? [];
    expect(users.some((u) => u.userid === 'root@pam')).toBe(true);
  });

  test('SC-31: create + list + delete e2e user', async () => {
    await pbs.accessUsers().createUsers({
      accessUsersCreateUsersRequest: { userid: USER, password: 'Sc31!2026-xyz' },
    });

    const list1 = await pbs.accessUsers().getUsers({});
    const list1Users = (list1 as { data?: Array<{ userid?: string }> }).data ?? [];
    expect(list1Users.some((u) => u.userid === USER)).toBe(true);

    await pbs.accessUsers().deleteUsers({ userid: USER });

    const list2 = await pbs.accessUsers().getUsers({});
    const list2Users = (list2 as { data?: Array<{ userid?: string }> }).data ?? [];
    expect(list2Users.some((u) => u.userid === USER)).toBe(false);
  });

  test('SC-32: datastore CRUD', async () => {
    await pbs.configDatastore().createDatastore({
      configDatastoreCreateDatastoreRequest: { name: STORE, path: STORE_PATH },
    });

    // Datastore creation is async (returns UPID). Poll the listing.
    await waitUntil(
      async () => {
        const list = (await pbs.configDatastore().getDatastore()) as {
          data?: Array<{ name?: string }>;
        };
        return (list.data ?? []).some((d) => d.name === STORE);
      },
      { timeoutMs: 15_000, intervalMs: 300, label: `${STORE} appears in /config/datastore` },
    );

    await pbs.configDatastore().deleteDatastore({ name: STORE, destroyData: true });

    await waitUntil(
      async () => {
        const list = (await pbs.configDatastore().getDatastore()) as {
          data?: Array<{ name?: string }>;
        };
        return !(list.data ?? []).some((d) => d.name === STORE);
      },
      { timeoutMs: 15_000, intervalMs: 300, label: `${STORE} removed from /config/datastore` },
    );
  });

  test('SC-33: ACL CRUD', async () => {
    await pbs.accessUsers().createUsers({
      accessUsersCreateUsersRequest: { userid: USER_OTHER },
    });

    // Grant Audit on /
    await pbs.accessAcl().updateAcl({
      accessAclUpdateAclRequest: { path: '/', role: 'Audit', authId: USER_OTHER },
    });
    let acls = (await pbs.accessAcl().getAcl({})) as {
      data?: Array<{ ugid?: string; roleid?: string }>;
    };
    expect((acls.data ?? []).some((e) => e.ugid === USER_OTHER && e.roleid === 'Audit')).toBe(true);

    // Revoke (PBS uses TS boolean `_delete: true`, not PVE's 0|1).
    await pbs.accessAcl().updateAcl({
      accessAclUpdateAclRequest: {
        path: '/',
        role: 'Audit',
        authId: USER_OTHER,
        _delete: true,
      },
    });
    acls = (await pbs.accessAcl().getAcl({})) as {
      data?: Array<{ ugid?: string; roleid?: string }>;
    };
    expect((acls.data ?? []).some((e) => e.ugid === USER_OTHER && e.roleid === 'Audit')).toBe(false);

    await pbs.accessUsers().deleteUsers({ userid: USER_OTHER });
  });

  test('SC-34: pagination — getUsers full enumeration', async () => {
    // PBS's /access/users doesn't paginate. SDK's only filter is
    // `includeTokens` (TS boolean). Walk the full set and assert shape.
    const res = await pbs.accessUsers().getUsers({ includeTokens: true });
    const users = (res as { data?: Array<{ userid?: string }> }).data ?? [];
    expect(users.length).toBeGreaterThan(0);
    expect(users.every((u) => typeof u.userid === 'string')).toBe(true);
  });
});

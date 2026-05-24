import { describe, test, expect, beforeAll, afterAll } from 'vitest';

import { loadCredentials, type Credentials } from '../helpers/credentials';
import { createTokenClient } from '../helpers/client';
import { cleanupE2E, E2E_PREFIX } from '../helpers/fixtures';
import { Pbs } from '../../src/Pbs';

/**
 * SC-50..52 — type edge cases.
 *
 * Strictly-typed languages catch generator bugs that loose-typed runtimes
 * silently tolerate. TypeScript falls in the middle: the *type system*
 * declares int64 as `number`, which is the silent-truncation hazard
 * SC-50 documents.
 */
describe('types', () => {
  let creds: Credentials;
  let pbs: Pbs;

  beforeAll(async () => {
    creds = loadCredentials();
    pbs = createTokenClient(creds);
    await cleanupE2E(pbs);
  });

  afterAll(async () => {
    await cleanupE2E(pbs);
  });

  /**
   * The generator emits `format: int64` fields as TypeScript `number`,
   * which silently truncates at 2^53. The contract is "bigint must
   * round-trip losslessly"; this assertion fails today.
   *
   * Marked `.fails()` so the suite stays green while the generator
   * issue is open upstream — when the generator is fixed to emit
   * `bigint`, this test starts succeeding and `.fails()` will
   * (correctly) flip the suite red until the marker is removed.
   *
   * Upstream issue: bencurio/pve-openapi  (to file)
   */
  test.fails('SC-50: bigint int64 fields are typed as bigint, not number', async () => {
    const res = await pbs.nodes().getNodes();
    const nodes = (res as { data?: Array<{ uptime?: number | bigint }> }).data ?? [];
    const uptime = nodes[0]?.uptime;
    expect(uptime).toBeDefined();
    expect(typeof uptime).toBe('bigint');
  });

  test('SC-51: nullable fields surface as undefined', async () => {
    // Create a user with no comment (the field is optional + nullable).
    const userid = `${E2E_PREFIX}nullable@pbs`;
    await pbs.accessUsers().createUsers({
      accessUsersCreateUsersRequest: { userid, password: 'PwTest!2026-zz' },
    });
    const read = await pbs.accessUsers().getAccessUsersByUserid({ userid });
    const data = (read as { data?: { comment?: string | null } }).data;
    // A user freshly created without comment should have `undefined`
    // (not `null`, not `""`) — the SDK's nullable convention.
    expect(data?.comment).toBeUndefined();
    await pbs.accessUsers().deleteUsers({ userid });
  });

  /**
   * The upstream plan's SC-52 uses `oneOf` (PVE storage type: dir vs nfs).
   * PBS has no tagged-union models in its SDK — and ACL groups are
   * "currently not supported" by PBS 4.x (the wire endpoint rejects them
   * with HTTP 400). The closest available discriminator surface is the
   * `PbsRoleidEnum` on ACL entries: when the SDK reads the list back,
   * it must classify each row into the right enum variant.
   */
  test('SC-52: ACL roleid enum classifies wire values into typed variants', async () => {
    const u1 = `${E2E_PREFIX}discrim-admin@pbs`;
    const u2 = `${E2E_PREFIX}discrim-audit@pbs`;

    await pbs.accessUsers().createUsers({
      accessUsersCreateUsersRequest: { userid: u1, password: 'PwTest!2026-aa' },
    });
    await pbs.accessUsers().createUsers({
      accessUsersCreateUsersRequest: { userid: u2, password: 'PwTest!2026-bb' },
    });
    await pbs.accessAcl().updateAcl({
      accessAclUpdateAclRequest: { path: '/', role: 'DatastoreAdmin', authId: u1 },
    });
    await pbs.accessAcl().updateAcl({
      accessAclUpdateAclRequest: { path: '/', role: 'DatastoreAudit', authId: u2 },
    });

    const acls = (await pbs.accessAcl().getAcl({})) as {
      data?: Array<{ ugid?: string; ugidType?: string; roleid?: string }>;
    };
    const entries = acls.data ?? [];
    expect(entries.find((e) => e.ugid === u1)?.roleid).toBe('DatastoreAdmin');
    expect(entries.find((e) => e.ugid === u2)?.roleid).toBe('DatastoreAudit');

    // The `ugidType` field is the other half of the SDK's discriminator
    // surface; with groups unsupported by PBS 4.x today, every row
    // collapses to `user` — still asserting it confirms the SDK's
    // enum decoding rather than emitting a raw string.
    expect(entries.find((e) => e.ugid === u1)?.ugidType).toBe('user');
  });
});

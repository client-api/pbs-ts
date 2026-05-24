import { describe, test, expect, beforeAll, afterAll } from 'vitest';

import { loadCredentials, type Credentials } from '../helpers/credentials';
import { createTokenClient, createTicketSession } from '../helpers/client';
import { cleanupE2E, E2E_PREFIX, firstNode } from '../helpers/fixtures';
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

  test('SC-50: bigint int64 fields are typed as bigint (no silent truncation)', async () => {
    // PBS's `/nodes` (list) requires a permission the test token doesn't
    // have; use `/nodes/{node}/status` which the token can read and which
    // exposes int64 `uptime` directly on its data payload.
    const node = await firstNodeTicketAuthed();
    const res = await pbs.nodesStatus().getStatus({ node });
    const uptime = (res as { data?: { uptime?: bigint } }).data?.uptime;
    expect(uptime).toBeDefined();
    expect(typeof uptime).toBe('bigint');
  });

  async function firstNodeTicketAuthed(): Promise<string> {
    // `firstNode` from fixtures requires `/nodes` which the token can't
    // see; ticket-auth a fresh session for this one call.
    const session = await createTicketSession(creds);
    return firstNode(session.pbs);
  }

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

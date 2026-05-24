import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { loadCredentials, type Credentials } from '../helpers/credentials';
import { createTokenClient } from '../helpers/client';
import { cleanupE2E, E2E_PREFIX } from '../helpers/fixtures';
import { Pbs } from '../../src/Pbs';
import { Configuration } from '../../src/runtime';

/**
 * SC-40..42 — error envelopes.
 *
 * The plan asks for HTTP 404 / 400 / 403. PBS's Rust API surface is
 * more strict about codes than PVE's Perl one — `/config/datastore/<missing>`
 * actually 400s ("config not found") rather than 404. The contract is
 * really "the SDK surfaces non-2xx as a typed error" — specific code
 * values are documented here so future ports know what to expect.
 */
describe('errors', () => {
  let creds: Credentials;
  let pbs: Pbs;

  const TOKEN_USER = `${E2E_PREFIX}token-user@pbs`;
  const TOKEN_NAME = 'restricted';

  beforeAll(async () => {
    creds = loadCredentials();
    pbs = createTokenClient(creds);
    await cleanupE2E(pbs);
  });

  afterAll(async () => {
    await cleanupE2E(pbs);
  });

  test('SC-40: unknown datastore surfaces as an error response', async () => {
    await expect(
      pbs.configDatastore().getConfigDatastoreByName({ name: 'e2e-nonexistent-9999' }),
    ).rejects.toMatchObject({
      // PBS returns 400 with "no such datastore" rather than 404. The SDK
      // surfaces it as a ResponseError — that's the contract.
      response: { status: 400 },
    });
  });

  test('SC-41: invalid input (empty path) returns 400', async () => {
    await expect(
      pbs.configDatastore().createDatastore({
        configDatastoreCreateDatastoreRequest: { name: `${E2E_PREFIX}bad`, path: '' },
      }),
    ).rejects.toMatchObject({ response: { status: 400 } });
  });

  test('SC-42: token with privsep that lacks privilege returns 403', async () => {
    // Create a user, give the user Admin, then create a privsep token
    // with no ACL of its own — that token must be 403'd on any
    // privileged endpoint.
    await pbs.accessUsers().createUsers({
      accessUsersCreateUsersRequest: { userid: TOKEN_USER, password: 'TmpPw!2026-aaa' },
    });
    await pbs.accessAcl().updateAcl({
      accessAclUpdateAclRequest: { path: '/', role: 'Admin', authId: TOKEN_USER },
    });

    const tokRes = await pbs.accessUsers().createToken({
      userid: TOKEN_USER,
      tokenName: TOKEN_NAME,
      // No request body needed; PBS defaults privsep=1 on the wire when
      // unspecified, and that's what we want.
    });
    const fullTokenId = (tokRes as { data?: { tokenid?: string } }).data?.tokenid;
    const secret = (tokRes as { data?: { value?: string } }).data?.value;
    expect(fullTokenId).toBeTruthy();
    expect(secret).toBeTruthy();

    // PBS token auth header: `PBSAPIToken=user@realm!tokenname:secret`
    const tokenClient = new Pbs(
      new Configuration({
        basePath: creds.url + '/api2/json',
        apiKey: (name: string) => {
          if (name === 'Authorization') return `PBSAPIToken=${fullTokenId}:${secret}`;
          return '';
        },
      }),
    );

    // ACL update is privileged. The underlying user has Admin, but the
    // privsep token has no ACL entry of its own → 403.
    await tokenClient
      .accessAcl()
      .updateAcl({
        accessAclUpdateAclRequest: { path: '/', role: 'Audit', authId: TOKEN_USER },
      })
      .then(
        () => {
          throw new Error('SC-42: expected rejection (privsep token should be denied)');
        },
        async (err: unknown) => {
          const resp = (err as { response?: Response })?.response;
          const status = resp?.status;
          const text = resp ? await resp.clone().text().catch(() => '') : '';
          // PBS returns HTTP 400 ("Unprivileged API tokens can't set ACL
          // items.") rather than PVE's 403 — same contract (request
          // rejected because the privsep token has no privileges of its
          // own), but the status code differs.
          if (status !== 400 && status !== 401 && status !== 403) {
            throw new Error(`SC-42: expected 400/401/403, got ${status}: ${text}`);
          }
          expect(text).toMatch(/[Uu]nprivileged|privsep|privilege|permission/);
        },
      );
  });
});

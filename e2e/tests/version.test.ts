import { describe, test, expect, beforeAll } from 'vitest';

import { loadCredentials, type Credentials } from '../helpers/credentials';
import { createTokenClient } from '../helpers/client';

describe('SC-01: /version', () => {
  let creds: Credentials;

  beforeAll(() => {
    creds = loadCredentials();
  });

  test('returns expected shape with token auth', async () => {
    const pbs = createTokenClient(creds);
    const res = await pbs.version().getVersion();

    // PBS `/version` envelope: `{ data: { release, repoid, version, ... } }`.
    expect(res).toBeDefined();
    expect(res.data).toBeDefined();
    expect(typeof res.data.release).toBe('string');
    expect(typeof res.data.repoid).toBe('string');
    expect(typeof res.data.version).toBe('string');

    // PBS reports the major in `version` (e.g. "4.2"); `release` is the
    // point-release counter and starts at "0". Sanity-check the major
    // to catch accidental image-tag drift in CI.
    expect(res.data.version.startsWith('4')).toBe(true);
  });
});

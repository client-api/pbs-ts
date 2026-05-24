import type { Pbs } from '../../src/Pbs';

/**
 * Every e2e-created entity is named with this prefix so cleanup can find
 * them even when a previous run bailed mid-test. Matches upstream §3.5
 * "test data conventions".
 */
export const E2E_PREFIX = 'e2e-';

/**
 * Best-effort cleanup of e2e-* entities. PBS has no VMs/containers,
 * just users and datastores. Errors are swallowed because the goal is
 * to leave the container in a clean state, not to assert anything.
 */
export async function cleanupE2E(pbs: Pbs): Promise<void> {
  await Promise.allSettled([cleanupUsers(pbs), cleanupDatastores(pbs)]);
}

async function cleanupUsers(pbs: Pbs): Promise<void> {
  const res = await pbs.accessUsers().getUsers({});
  const users = (res as { data?: Array<{ userid?: string }> }).data ?? [];
  for (const u of users) {
    if (u.userid?.startsWith(E2E_PREFIX)) {
      await pbs.accessUsers().deleteUsers({ userid: u.userid }).catch(() => undefined);
    }
  }
}

async function cleanupDatastores(pbs: Pbs): Promise<void> {
  const res = await pbs.configDatastore().getDatastore();
  const stores = (res as { data?: Array<{ name?: string }> }).data ?? [];
  for (const s of stores) {
    if (s.name?.startsWith(E2E_PREFIX)) {
      // `destroyData: true` removes the on-disk chunk store — safe inside
      // the throwaway test container; never set this in production.
      await pbs
        .configDatastore()
        .deleteDatastore({ name: s.name, destroyData: true })
        .catch(() => undefined);
    }
  }
}

/**
 * Read the first node hostname from `/nodes`. The PBS test container
 * runs a single node — calling this once per suite avoids hardcoding
 * `pbs-test`.
 */
export async function firstNode(pbs: Pbs): Promise<string> {
  const res = await pbs.nodes().getNodes();
  const nodes = (res as { data?: Array<{ node?: string }> }).data ?? [];
  if (!nodes[0]?.node) throw new Error('No nodes returned from /nodes: ' + JSON.stringify(res));
  return nodes[0].node;
}

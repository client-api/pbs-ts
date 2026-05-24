import { Pbs } from '../../src/Pbs';
import { Configuration } from '../../src/runtime';
import type { Credentials } from './credentials';

/**
 * PBS serves its REST API under `/api2/json` (same as PVE/PMG). PDM uses
 * `/api2/extjs`. Centralising this keeps the per-product swap a one-line
 * edit between sister repos.
 */
const API_PATH_PREFIX = '/api2/json';

/**
 * PBS cookie name. Differs from PVE (`PVEAuthCookie`) and PMG
 * (`PMGAuthCookie`); the credentials file's `token_header_value` carries
 * the correct `PBSAPIToken=` prefix for the Authorization header.
 */
const AUTH_COOKIE_NAME = 'PBSAuthCookie';

/**
 * Build an SDK client that authenticates via an API token.
 *
 * The generated APIs each look up two header names through
 * `Configuration.apiKey(name)`:
 *   - `Authorization`         → the full PBSAPIToken header value
 *   - `CSRFPreventionToken`   → not required for token auth; Proxmox
 *                               accepts an empty string here.
 *
 * NOTE: PBS belongs to the Rust-family (`:` separator between token id
 * and secret). Never reconstruct the header by hand — read
 * `tokenHeaderValue` whole from credentials.
 */
export function createTokenClient(creds: Credentials): Pbs {
  return new Pbs(
    new Configuration({
      basePath: creds.url + API_PATH_PREFIX,
      apiKey: (name: string) => {
        if (name === 'Authorization') return creds.tokenHeaderValue;
        return '';
      },
    }),
  );
}

export interface TicketSession {
  pbs: Pbs;
  ticket: string;
  csrfToken: string;
}

/**
 * Build an SDK client that authenticates via a ticket + CSRF token pair
 * obtained from `POST /access/ticket`.
 *
 * PBS expects the ticket as a `PBSAuthCookie=...` cookie and the CSRF
 * token in the `CSRFPreventionToken` header for state-changing requests.
 */
export async function createTicketSession(creds: Credentials): Promise<TicketSession> {
  const bootstrap = new Pbs(new Configuration({ basePath: creds.url + API_PATH_PREFIX }));
  const res = await bootstrap.accessTicket().createTicket({
    accessTicketCreateTicketRequest: {
      username: creds.user,
      password: creds.password,
    },
  });
  const ticket = res.data?.ticket;
  // The generator lower-cases the leading C in `CSRFPreventionToken`.
  // The wire value still says `CSRFPreventionToken` — we only need the
  // value, not the casing.
  const csrf = res.data?.cSRFPreventionToken;

  if (!ticket || !csrf) {
    throw new Error('Ticket login returned no ticket / CSRF token: ' + JSON.stringify(res));
  }

  // Set Cookie + CSRFPreventionToken as default headers rather than via
  // the apiKey callback. The generated APIs blindly assign
  // `Authorization = apiKey('Authorization')` — returning `''` from the
  // callback writes an empty Authorization header which PBS 401s.
  const pbs = new Pbs(
    new Configuration({
      basePath: creds.url + API_PATH_PREFIX,
      headers: {
        Cookie: `${AUTH_COOKIE_NAME}=${ticket}`,
        CSRFPreventionToken: csrf,
      },
    }),
  );
  return { pbs, ticket, csrfToken: csrf };
}

/**
 * Expose the SDK's basePath + auth callback to helpers that need raw
 * fetch (e.g. endpoints where the generator drops wire-required fields).
 */
export function configFor(pbs: Pbs): {
  basePath: string;
  authHeader: () => Promise<string>;
} {
  const cfg = pbs.configuration();
  return {
    basePath: cfg.basePath,
    authHeader: async () => {
      const cb = cfg.apiKey;
      if (!cb) throw new Error('SDK configuration has no apiKey callback');
      return cb('Authorization');
    },
  };
}

export { AUTH_COOKIE_NAME };

/**
 * Read PROXMOX_* env vars exported by `client-api/proxmox-docker-action@v1`
 * (or set by hand from `/run/credentials.json` for local dev) into a typed
 * Credentials object.
 *
 * NEVER reconstruct `tokenHeaderValue` by hand from `tokenId` + `tokenValue`.
 * The Perl-family products (PVE, PMG) join with `=`, the Rust-family (PBS,
 * PDM) join with `:`. The container writes the correct concatenation into
 * `token_header_value` already — read it whole.
 */

export interface Credentials {
  /** e.g. `https://localhost:8006`. No trailing slash, no `/api2/json`. */
  url: string;
  user: string;
  password: string;
  /** Whole `Authorization` header value, e.g. `PVEAPIToken=root@pam!test=<uuid>`. */
  tokenHeaderValue: string;
  /** The UUID half. `(unsupported-by-pmg)` on PMG; treat as a skip sentinel. */
  tokenValue: string;
  kvmAvailable: boolean;
  cgroupv2Available: boolean;
}

function required(name: string): string {
  const v = process.env[name];
  if (v == null || v === '') {
    throw new Error(
      `Missing required env var ${name}. ` +
        'Source it from proxmox-docker-action outputs or /run/credentials.json.',
    );
  }
  return v;
}

function flag(name: string): boolean {
  return process.env[name] === 'true';
}

export function loadCredentials(): Credentials {
  return {
    url: required('PROXMOX_URL').replace(/\/+$/, ''),
    user: required('PROXMOX_USER'),
    password: required('PROXMOX_PASSWORD'),
    tokenHeaderValue: required('PROXMOX_TOKEN_HEADER_VALUE'),
    tokenValue: required('PROXMOX_TOKEN_VALUE'),
    kvmAvailable: flag('PROXMOX_KVM_AVAILABLE'),
    cgroupv2Available: flag('PROXMOX_CGROUPV2_AVAILABLE'),
  };
}

/** PMG ships this sentinel because PMG 9.x has no token API at all. */
export const PMG_NO_TOKEN_SENTINEL = '(unsupported-by-pmg)';

export function tokenAuthSupported(creds: Credentials): boolean {
  return creds.tokenValue !== PMG_NO_TOKEN_SENTINEL;
}

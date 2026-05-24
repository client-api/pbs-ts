# E2E tests — TypeScript × PBS

This suite drives the generated SDK in `src/` against a real Proxmox
Backup Server container. It implements the `SC-NN` scenarios from
[`pve-openapi/docs/E2E_TEST_PLAN.md` §5](https://github.com/bencurio/pve-openapi/blob/main/docs/E2E_TEST_PLAN.md#5-test-scenario-specification),
with PVE-only scenarios (SC-35 ISO upload, SC-60..62 VM/CT lifecycle)
intentionally omitted because they don't apply to a backup server.

## Layout

```
e2e/
├── helpers/
│   ├── credentials.ts      # PROXMOX_* env -> typed Credentials
│   ├── client.ts           # SDK client factory (token + ticket auth)
│   ├── capability-gate.ts  # KVM, cgroupv2, network skip flags
│   ├── fixtures.ts         # e2e-* cleanup (users + datastores)
│   ├── raw.ts              # raw-fetch escape hatch (auth reused from SDK)
│   ├── terminal.ts         # WebSocket node-shell wire protocol
│   └── poll.ts             # waitUntil(predicate, timeoutMs)
└── tests/
    ├── version.test.ts     # SC-01
    ├── auth.test.ts        # SC-10..14
    ├── authz.test.ts       # SC-20..22
    ├── crud.test.ts        # SC-30..34 (datastore CRUD, not storage)
    ├── errors.test.ts      # SC-40..42
    ├── types.test.ts       # SC-50..52 (bigint + nullable + enum discriminator)
    └── ws-terminal.test.ts # WS-01  (extra — node-shell over WS)
```

### Scenarios omitted

| SC      | Why omitted on PBS                                      |
|---------|---------------------------------------------------------|
| SC-35   | ISO upload — PVE-only surface.                          |
| SC-60   | VM lifecycle — PBS has no `/qemu` API.                  |
| SC-61   | CT lifecycle — PBS has no `/lxc` API.                   |
| SC-62   | VM CDROM boot — PVE-only surface.                       |

### Per-product differences from pve-ts

- **Cookie name**: `PBSAuthCookie` (centralised in
  `e2e/helpers/client.ts:AUTH_COOKIE_NAME`).
- **Token separator**: `:` (Rust family). Read whole from
  `PROXMOX_TOKEN_HEADER_VALUE`; never reconstruct by hand.
- **Port**: `8007` (vs PVE 8006).
- **User API**: methods named `createUsers` / `deleteUsers` (plural).
- **ACL surface**: `path` + `role` (singular) + `authId`, with TS
  `boolean` `_delete` (PVE uses `roles`/`users` + `0|1` `_delete`).
- **Roles**: `Audit` (read-only), `Admin`, `Datastore*` family.
- **Datastore CRUD is async**: create/delete return UPIDs; the listing
  converges a moment later, so the test polls.
- **Error codes**: PBS returns HTTP 400 (not 403) for "privsep token
  lacks privilege" and HTTP 400 for "unknown datastore" — the SDK
  surfaces both as `ResponseError`, which is the actual contract.

### Known SDK issues surfaced by this suite

| Test                                  | Bug                                                                                            | Where                                       |
|---------------------------------------|------------------------------------------------------------------------------------------------|---------------------------------------------|
| `types.test.ts` `SC-50`               | `int64` deserialised as `number` (silent truncation hazard above 2^53). Should be `bigint`.    | OpenAPI generator typescript-fetch template.|

PBS-ts has **no built-in WebSocket helper** (PBS SDK doesn't include
`src/WebSocket.ts`), so WS-01 uses `e2e/helpers/terminal.ts` directly
without any SDK helper to bypass. Same pattern is shared with pve-ts.

## Running locally

```sh
docker compose up -d
docker compose ps                          # wait for "healthy"

CREDS=$(docker exec pbs-test cat /run/credentials.json)
export PROXMOX_URL=https://localhost:8007
export PROXMOX_USER=$(jq -r .user <<<"$CREDS")
export PROXMOX_PASSWORD=$(jq -r .password <<<"$CREDS")
export PROXMOX_TOKEN_HEADER_VALUE=$(jq -r .token_header_value <<<"$CREDS")
export PROXMOX_TOKEN_VALUE=$(jq -r .token_value <<<"$CREDS")
export PROXMOX_KVM_AVAILABLE=false         # PBS doesn't need /dev/kvm
export PROXMOX_CGROUPV2_AVAILABLE=false    # PBS has no CT lifecycle
export NODE_TLS_REJECT_UNAUTHORIZED=0

pnpm install
pnpm test:e2e
```

## Running in CI

`.github/workflows/e2e.yml` uses `client-api/proxmox-docker-action@v1`
with `product: pbs, tag: '4.2'` to start the container, export the env
vars, and clean up.

## Hard rules

- **Never reconstruct the API token header by hand.** Read
  `PROXMOX_TOKEN_HEADER_VALUE` whole — PBS uses `:` between tokenid and
  secret (Rust family) while PVE/PMG use `=` (Perl family). The
  credentials JSON already has the right format baked in.
- **bigint fields must round-trip losslessly.** Use `BigInt`; if the SDK
  truncates to `Number`, file an issue in `pve-openapi` — don't patch
  the SDK here.
- **No imports outside this repo.** Each downstream SDK ships its own copy.

# @clientapi/pbs

TypeScript SDK for the Proxmox Backup Server API. Generated
from the upstream `apidoc.js` from Proxmox Backup Server via [openapi-generator-cli][gen] with
custom Mustache template overrides.

> **Not an official Proxmox project.** Community SDK derived from the
> upstream `apidoc.js`. Always verify against the upstream API viewer.
> <https://pbs.proxmox.com/>.

## Install

```bash
npm install @clientapi/pbs
# or
pnpm add @clientapi/pbs
```

## Usage

```ts
import { Configuration, Pbs } from '@clientapi/pbs';

const cfg = new Configuration({
  basePath: 'https://pbs1.example.com:8007/api2/json',
  apiKey: 'PBSAPIToken=user@realm!tokenid:uuid-secret',
});
const pbs = new Pbs(cfg);

// Per-tag accessors are lazily instantiated and share the same Configuration.
// `removeOperationIdPrefix=true` strips the tag prefix from method names,
// so the call is `pbs.qemu().vmStatus(...)`, not `qemuVmStatus(...)` —
// you're already inside the `qemu` namespace.
const status = await pbs.qemu().vmStatus({ node: 'pbs1', vmid: 100 });
const nodes = await pbs.nodes().getNodes();
```

The unified `Pbs` class wraps each per-tag API class
(`QemuApi`, `LxcApi`, `ClusterApi`, `NodesApi`, …) so consumers don't
need to instantiate them individually.

## Compound configs

PVE encodes many fields as CLI-style shorthand strings
(`net0=virtio,bridge=vmbr0,firewall=1`). Round-trip helpers are
emitted for every compound config schema:

```ts
import { PveQemuNetConfigToShorthand, PveQemuNetConfigFromShorthand } from '@clientapi/pbs';

const shorthand = PveQemuNetConfigToShorthand({
  model: 'virtio',
  bridge: 'vmbr0',
  firewall: 1,
});
// → 'virtio,bridge=vmbr0,firewall=1'

const parsed = PveQemuNetConfigFromShorthand(shorthand);
```

## Indexed families

Numbered properties (`net0..net31`, `mp0..mp255`, …) are exposed on
every model as a single collapsed `nets` / `mps` / … field:

```ts
const req = {
  nets: {
    0: 'virtio,bridge=vmbr0',
    3: 'e1000,bridge=vmbr1',
  },
};
// Wire format: { net0: 'virtio,bridge=vmbr0', net3: 'e1000,bridge=vmbr1' }
```

## License

Apache 2.0 — see [LICENSE](./LICENSE).

[gen]: https://openapi-generator.tech

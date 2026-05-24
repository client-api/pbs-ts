/**
 * Capability gates for host features the Proxmox container needs to exercise
 * lifecycle scenarios.
 *
 * `proxmox-docker-action@v1` probes the runner and exports
 * `PROXMOX_KVM_AVAILABLE` / `PROXMOX_CGROUPV2_AVAILABLE` as `"true"|"false"`.
 *
 * Use with Vitest's conditional helpers:
 *   describe.skipIf(!KVM_AVAILABLE)('VM lifecycle', () => { ... });
 *   test.skipIf(!CGROUPV2_AVAILABLE)('SC-61: ct lifecycle', ...);
 *
 * Soft-skip is required; tests must never hard-fail when the gate is closed.
 */

export const KVM_AVAILABLE = process.env.PROXMOX_KVM_AVAILABLE === 'true';
export const CGROUPV2_AVAILABLE = process.env.PROXMOX_CGROUPV2_AVAILABLE === 'true';

/** Allow tests to opt out of network downloads on air-gapped runners. */
export const NETWORK_AVAILABLE = process.env.PROXMOX_NO_NETWORK !== '1';

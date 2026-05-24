import { defineConfig } from 'vitest/config';

/**
 * E2E config for tests that hit a live Proxmox container.
 *
 * - `include: e2e/tests/**` keeps the unit tests under `src/tests/` out of
 *   this run; they're handled by the default `npm test` script.
 * - 60s default timeout matches upstream §6.1; lifecycle suites bump
 *   themselves to 120s via `test.setTimeout(120_000)` at the top of the file.
 * - Single-fork pool serialises tests against the shared Proxmox state —
 *   creating two `e2e-storage-01`s in parallel would race.
 */
export default defineConfig({
  test: {
    include: ['e2e/tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});

import type { Pbs } from '../../src/Pbs';
import { configFor } from './client';

/**
 * Escape hatch for endpoints where the OpenAPI generator drops fields that
 * the wire endpoint actually requires (e.g. `POST /storage` needs `storage`
 * in the body but the generated `StorageCreateStorageRequest` is a tagged
 * union of per-type configs that omits it).
 *
 * Reuses the SDK's basePath + auth callback so tokens stay in the
 * Configuration object — never reconstructed by hand.
 *
 * Tracked upstream as a generator bug:
 *   https://github.com/bencurio/pve-openapi  (issue to file)
 */
export async function rawJson<T = unknown>(
  pbs: Pbs,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const { basePath, authHeader } = configFor(pbs);
  const res = await fetch(`${basePath}${path}`, {
    method,
    headers: {
      Authorization: await authHeader(),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} failed: HTTP ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

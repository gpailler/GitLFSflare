import type { PermissionLevel } from "../types/index.js";

export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function generateCacheKey(token: string, org: string, repo: string): Promise<string> {
  const hash = await hashToken(token);
  return `perm:${hash}:${org}/${repo}`;
}

export async function getCachedPermission(
  env: Env,
  token: string,
  org: string,
  repo: string
): Promise<PermissionLevel | null> {
  const key = await generateCacheKey(token, org, repo);
  const cached = await env.AUTH_CACHE.get(key);
  return cached as PermissionLevel | null;
}

export async function setCachedPermission(
  env: Env,
  token: string,
  org: string,
  repo: string,
  permission: PermissionLevel
): Promise<void> {
  const key = await generateCacheKey(token, org, repo);
  await env.AUTH_CACHE.put(key, permission, { expirationTtl: env.AUTH_CACHE_TTL });
}

export function withCache(
  env: Env,
  fn: (token: string, org: string, repo: string) => Promise<PermissionLevel>
): (token: string, org: string, repo: string) => Promise<PermissionLevel> {
  return async (token: string, org: string, repo: string): Promise<PermissionLevel> => {
    const cached = await getCachedPermission(env, token, org, repo);
    if (cached !== null) {
      return cached;
    }
    const permission = await fn(token, org, repo);
    await setCachedPermission(env, token, org, repo, permission);
    return permission;
  };
}

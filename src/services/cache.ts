import type { PermissionLevel } from "../types/index.js";

export async function hashToken(_token: string): Promise<string> {
  throw new Error("Not implemented");
}

export async function generateCacheKey(_token: string, _org: string, _repo: string): Promise<string> {
  throw new Error("Not implemented");
}

export async function getCachedPermission(
  _env: Env,
  _token: string,
  _org: string,
  _repo: string
): Promise<PermissionLevel | null> {
  throw new Error("Not implemented");
}

export async function setCachedPermission(
  _env: Env,
  _token: string,
  _org: string,
  _repo: string,
  _permission: PermissionLevel
): Promise<void> {
  throw new Error("Not implemented");
}

export function withCache(
  _env: Env,
  _fn: (token: string, org: string, repo: string) => Promise<PermissionLevel>
): (token: string, org: string, repo: string) => Promise<PermissionLevel> {
  throw new Error("Not implemented");
}

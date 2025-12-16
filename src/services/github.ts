import type { PermissionLevel } from "../types/index.js";

export class GitHubRateLimitError extends Error {
  readonly resetAt?: number;
  readonly retryAfter?: number;

  constructor(message: string, options?: { resetAt?: number; retryAfter?: number }) {
    super(message);
    this.name = "GitHubRateLimitError";
    this.resetAt = options?.resetAt;
    this.retryAfter = options?.retryAfter;
  }
}

export interface GitHubPermissions {
  admin: boolean;
  push: boolean;
  pull: boolean;
}

export type LFSOperation = "upload" | "download";

export function mapGitHubPermissions(_permissions: GitHubPermissions): PermissionLevel {
  throw new Error("Not implemented");
}

export function hasOperationPermission(_permission: PermissionLevel, _operation: LFSOperation): boolean {
  throw new Error("Not implemented");
}

export async function getRepositoryPermission(_token: string, _org: string, _repo: string): Promise<PermissionLevel> {
  throw new Error("Not implemented");
}

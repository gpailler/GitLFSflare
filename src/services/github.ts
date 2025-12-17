import type { GitHubRepository, LFSOperation, PermissionLevel } from "../types/index.js";

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

export function mapGitHubPermissions(permissions: GitHubPermissions): PermissionLevel {
  if (permissions.admin) return "admin";
  if (permissions.push) return "write";
  if (permissions.pull) return "read";
  return "none";
}

export function hasOperationPermission(permission: PermissionLevel, operation: LFSOperation): boolean {
  if (operation === "download") {
    return permission !== "none";
  }
  // upload requires write or admin
  return permission === "admin" || permission === "write";
}

export async function getRepositoryPermission(token: string, org: string, repo: string): Promise<PermissionLevel> {
  const response = await fetch(`https://api.github.com/repos/${org}/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  // Check for rate limiting
  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    throw new GitHubRateLimitError("Rate limit exceeded", {
      retryAfter: retryAfter ? Number.parseInt(retryAfter, 10) : undefined,
    });
  }

  if (response.status === 403) {
    const remaining = response.headers.get("X-RateLimit-Remaining");
    if (remaining === "0") {
      const reset = response.headers.get("X-RateLimit-Reset");
      throw new GitHubRateLimitError("Rate limit exceeded", {
        resetAt: reset ? Number.parseInt(reset, 10) : undefined,
      });
    }
    return "none";
  }

  if (response.status === 404 || response.status === 401) {
    return "none";
  }

  if (response.status >= 500) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const data = (await response.json()) as GitHubRepository;

  if (!data.permissions) {
    // Public repos may not include permissions - allow read access
    // Private repos should always have permissions; deny if missing
    return data.private ? "none" : "read";
  }

  return mapGitHubPermissions(data.permissions);
}
